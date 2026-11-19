// routes/dodo.js - Dodo Payments cho khách nước ngoài, giống flow Lemon / 【entity-PayPal¦canonical_name=PayPal】
// Mount ở index.js: app.use('/api', dodoRouter)
// -> POST /api/payment/dodo/create
// -> GET  /api/payment/dodo/config
// -> POST /api/webhook/dodo (raw body để verify Svix)
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

function getDodoConfig() {
  const apiKey = (process.env.DODO_API_KEY || process.env.DODO_PAYMENTS_API_KEY || '').trim();
  const webhookSecret = (
    process.env.DODO_WEBHOOK_SECRET ||
    process.env.DODO_PAYMENTS_WEBHOOK_KEY ||
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET || ''
  ).trim();

  // Product ID lấy từ Render env, fallback là ID Live đã tạo trong dashboard
  const products = {
    '1m':  { productId: process.env.DODO_PRODUCT_1M  || 'pdt_0Ns9fXL1zpILgI3wjkkIg', months: 1,  usd: 3.99,  label: 'KaraRender VIP - 1 Month' },
    '3m':  { productId: process.env.DODO_PRODUCT_3M  || 'pdt_0Ns9fiWFTnfiE6Ky9gtfw', months: 3,  usd: 7.65,  label: 'KaraRender VIP - 3 Months' },
    '6m':  { productId: process.env.DODO_PRODUCT_6M  || 'pdt_0Ns9gB1f1X4doNEHllDY7', months: 6,  usd: 15.35, label: 'KaraRender VIP - 6 Months' },
    '12m': { productId: process.env.DODO_PRODUCT_12M || 'pdt_0Ns9gl2rPqM9tHjwZiybt', months: 12, usd: 23.04, label: 'KaraRender VIP - 1 Year' },
    '24m': { productId: process.env.DODO_PRODUCT_24M || 'pdt_0Ns9gP9wfdejKJNUWqNKG', months: 24, usd: 38.42, label: 'KaraRender VIP - 2 Years' },
  };

  // Live key -> live.dodopayments.com, Test key -> test.dodopayments.com
  // Tránh lỗi Live key gọi nhầm Test product và ngược lại
  const isTest = apiKey.startsWith('dodo_test_');
  const base = isTest ? 'https://test.dodopayments.com' : 'https://live.dodopayments.com';
  return { apiKey, webhookSecret, products, base, isTest };
}

// DB (users.request_amount, vip_requests.amount) đang là INTEGER chứa VND.
// Dodo trả total_amount là cents EUR (4189 = €41.89, đã gồm VAT) -> KHÔNG được ghi trực tiếp vào DB.
// Dùng map cứng theo giá bạn đang set: 1M 99000, 3M 199000, 6M 299000, 12M 499000, 24M 899000.
const VND_BY_PLAN = { '1m': 99000, '3m': 199000, '6m': 299000, '12m': 499000, '24m': 899000 };

function normalizePlanKey(raw) {
  const k = String(raw || '1m').toLowerCase().trim();
  const map = {
    '1': '1m', '1m': '1m', '1month': '1m', '1-month': '1m',
    '3': '3m', '3m': '3m', '3months': '3m',
    '6': '6m', '6m': '6m', '6months': '6m',
    '12': '12m', '12m': '12m', '1y': '12m', '1year': '12m', '1-year': '12m',
    '24': '24m', '24m': '24m', '2y': '24m', '2years': '24m', '2-year': '24m',
  };
  return map[k] || null;
}

function getPlanByProductId(productId) {
  if (!productId) return null;
  const { products } = getDodoConfig();
  for (const [planKey, p] of Object.entries(products)) {
    if (p.productId === productId) return planKey;
  }
  return null;
}

function getSupabaseAdmin() {
  try { return require('../services/supabase').supabaseAdmin; }
  catch { try { return require('./../services/supabase').supabaseAdmin; } catch { return null; } }
}

// ===== Verify webhook Svix / Standard Webhooks =====
function verifyDodoWebhook(rawString, req) {
  const { webhookSecret } = getDodoConfig();
  if (!webhookSecret) {
    console.warn('[Dodo Webhook] No webhook secret configured - skip verify (giong Lemon)');
    return { verified: false, reason: 'no-secret', allow: true };
  }
  const id = req.headers['webhook-id'] || req.headers['svix-id'] || '';
  const ts = req.headers['webhook-timestamp'] || req.headers['svix-timestamp'] || '';
  const sigHeader = req.headers['webhook-signature'] || req.headers['svix-signature'] || '';
  if (!id || !ts || !sigHeader) return { verified: false, reason: 'missing-headers', allow: false };

  const secretB64 = webhookSecret.replace(/^whsec_/, '').trim();
  let key;
  try { key = Buffer.from(secretB64, 'base64'); } catch { key = Buffer.from(secretB64); }
  const signed = `${id}.${ts}.${rawString}`;
  const expected = crypto.createHmac('sha256', key).update(signed).digest('base64');

  // Header dạng: "v1,abc v1,def" - thử từng signature
  const sigs = String(sigHeader).split(' ').flatMap(p => p.split(',')).map(s => s.trim()).filter(Boolean);
  for (const s of sigs) {
    const v = s.startsWith('v1,') ? s.slice(3) : s.startsWith('v1=') ? s.slice(3) : s;
    if (v.length === expected.length) {
      try {
        if (crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected))) {
          return { verified: true };
        }
      } catch {}
    }
  }
  return { verified: false, reason: 'mismatch', allow: false };
}

function extractProductId(data) {
  if (!data) return null;
  if (data.product_id) return data.product_id;
  const cart = data.product_cart || data.checkout_session?.product_cart;
  if (Array.isArray(cart) && cart[0]) {
    const it = cart[0];
    return it.product_id || it.product?.product_id || it.product?.id || it.id || null;
  }
  return null;
}

function toUsd(totalAmount) {
  const n = Number(totalAmount);
  if (!n) return 0;
  // Dodo trả total_amount theo cents (399 = $3.99). Nếu đã là đô thì giữ nguyên.
  return n >= 100 ? Math.round((n / 100) * 100) / 100 : n;
}

async function sendTelegramAutoVip({ email, fullName, planKey, monthsToAdd, amountUsd, paymentId, expireDate }) {
  try {
    const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const expireVN = expireDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const msg = `✅🤖 <b>AUTO DUYỆT VIP - KARARENDER</b> 🤖✅\n━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>Email:</b> ${email}\n👤 <b>Tên:</b> ${fullName || email}\n💳 <b>Gói:</b> ${planKey} (${monthsToAdd} tháng)\n💰 <b>Số tiền:</b> $${amountUsd}\n📝 <b>Nội dung:</b> <code>dodo ${email.replace(/[@.]/g, '')} ${planKey}</code>\n📅 <b>Hạn dùng:</b> ${expireVN}\n⏰ <b>Thời gian:</b> ${timeVN}\n🆔 <b>Payment ID:</b> ${paymentId || 'N/A'}\n━━━━━━━━━━━━━━━━━━━━━━\n🤖 <b>Hệ thống tự động duyệt qua webhook Dodo Payments!</b>`;
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
      });
    }
  } catch (e) { console.warn('[Dodo Webhook] Telegram error', e.message); }
}

// ===== GET /api/admin/dodo-config =====
router.get('/admin/dodo-config', async (req, res) => {
  const cfg = getDodoConfig();
  let enabled = false;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from('app_settings')
        .select('value').eq('id', 'dodo_enabled').single();
      if (data?.value) enabled = !!data.value.enabled;
    }
  } catch (e) { console.warn('[Dodo Admin] get config error', e.message); }
  res.json({
    success: true,
    enabled,
    configured: !!cfg.apiKey,
    hasApiKey: !!cfg.apiKey,
    hasWebhookSecret: !!cfg.webhookSecret,
    mode: cfg.isTest ? 'test' : 'live',
  });
});

// ===== POST /api/admin/dodo-config =====
router.post('/admin/dodo-config', express.json(), async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Supabase not configured' });
    const value = {
      enabled: !!req.body?.enabled,
      updated_at: new Date().toISOString(),
      updated_by: (req.headers['x-user-email'] || '').toLowerCase(),
    };
    const { error } = await supabaseAdmin.from('app_settings')
      .upsert({ id: 'dodo_enabled', value }, { onConflict: 'id' });
    if (error) throw error;
    return res.json({ success: true, value, message: `Đã ${value.enabled ? 'BẬT' : 'TẮT'} Dodo Payments` });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ===== GET /api/payment/dodo/config - giống Lemon config =====
router.get('/payment/dodo/config', async (req, res) => {
  let enabled = false;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from('app_settings').select('value').eq('id', 'dodo_enabled').single();
      if (data?.value) enabled = !!data.value.enabled;
    }
  } catch {}
  const cfg = getDodoConfig();
  const products = {};
  for (const [k, v] of Object.entries(cfg.products)) {
    products[k] = { productId: v.productId, months: v.months, usd: v.usd, label: v.label };
  }
  res.json({
    success: true,
    enabled,
    configured: !!cfg.apiKey,
    hasApiKey: !!cfg.apiKey,
    hasWebhookSecret: !!cfg.webhookSecret,
    mode: cfg.isTest ? 'test' : 'live',
    base: cfg.base,
    products,
    timestamp: new Date().toISOString(),
  });
});

// ===== POST /api/payment/dodo/create =====
// Body: { email, planKey } - planKey: 1m | 3m | 6m | 12m | 24m
router.post('/payment/dodo/create', express.json(), async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const planKey = normalizePlanKey(req.body?.planKey || req.body?.plan_key || req.body?.plan || req.body?.key);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Thiếu email hợp lệ' });
    }
    if (!planKey) {
      return res.status(400).json({ success: false, message: 'Gói không hợp lệ. Dùng 1m / 3m / 6m / 12m / 24m' });
    }

    const cfg = getDodoConfig();
    if (!cfg.apiKey) {
      return res.status(500).json({ success: false, message: 'Chưa cấu hình DODO_API_KEY trong Render ENV' });
    }
    const product = cfg.products[planKey];
    if (!product?.productId) {
      return res.status(400).json({ success: false, message: `Chưa cấu hình DODO_PRODUCT_${planKey.toUpperCase()} cho gói ${planKey}` });
    }

    // Admin tắt Dodo -> chặn cho tất cả, kể cả whitelist/admin
    try {
      const supabaseAdminGate = getSupabaseAdmin();
      if (supabaseAdminGate) {
        const { data: gate } = await supabaseAdminGate.from('app_settings').select('value').eq('id', 'dodo_enabled').single();
        if (gate?.value && gate.value.enabled === false) {
          return res.status(403).json({ success: false, message: 'Dodo đang tắt' });
        }
      }
    } catch {}

    const supabaseAdmin = getSupabaseAdmin();
    let fullName = email;
    try {
      if (supabaseAdmin) {
        const { data: u } = await supabaseAdmin.from('users').select('full_name').eq('email', email).maybeSingle();
        if (u?.full_name) fullName = u.full_name;
      }
    } catch {}

    // Dodo không nhận price từ backend - price nằm trong Product đã tạo ở dashboard.
    // Chỉ gửi product_id, customer, return_url, metadata.
    const payload = {
      product_cart: [{ product_id: product.productId, quantity: 1 }],
      customer: { email, name: fullName },
      return_url: `${process.env.FRONTEND_URL || 'https://www.kararender.com'}/vip-success?email=${encodeURIComponent(email)}&plan=${planKey}&provider=dodo`,
      metadata: {
        email,
        plan_key: planKey,
        months: String(product.months),
        amount_usd: String(product.usd),
      },
    };

    console.log('[Dodo Create]', email, planKey, product.productId);
    const dodoRes = await fetch(`${cfg.base}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const dodoData = await dodoRes.json().catch(() => ({}));
    if (!dodoRes.ok) {
      console.error('[Dodo Create] Error', JSON.stringify(dodoData).slice(0, 2000));
      return res.status(400).json({ success: false, message: dodoData.message || dodoData.error || 'Dodo API error', detail: dodoData });
    }

    const checkoutUrl = dodoData.checkout_url || dodoData.checkoutUrl;
    const sessionId = dodoData.session_id || dodoData.sessionId;
    const paymentId = dodoData.payment_id || dodoData.paymentId || null;
    if (!checkoutUrl) {
      return res.status(500).json({ success: false, message: 'Dodo không trả checkout_url', detail: dodoData });
    }

    // Lưu PENDING giống Lemon để webhook / admin đối chiếu
    let insertedRequestId = null;
    if (supabaseAdmin) {
      try {
        const { data: existing } = await supabaseAdmin.from('vip_requests')
          .select('id').eq('email', email).eq('status', 'PENDING').eq('plan_key', planKey)
          .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
          .limit(1).maybeSingle();
        if (!existing) {
          const { data: ins, error: insErr } = await supabaseAdmin.from('vip_requests').insert({
            email,
            full_name: fullName,
            plan_key: planKey,
            amount: VND_BY_PLAN[planKey] || 99000,
            content: `dodo ${email.replace(/[@.]/g, '')} ${planKey} $${product.usd} session:${sessionId || ''} payment:${paymentId || ''}`,
            status: 'PENDING',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).select().single();
          if (insErr) console.error('[Dodo Create] save pending error', insErr.message);
          insertedRequestId = ins?.id || null;
        } else {
          insertedRequestId = existing?.id || null;
        }
      } catch (e) { console.warn('[Dodo Create] save pending error', e.message); }
    }

    // Telegram yêu cầu nâng cấp - giống Lemon
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
      const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
      const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
      if (token && chatId) {
        const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const msg = `💥💎🚀 <b>YÊU CẦU NÂNG CẤP VIP - DODO PAYMENTS</b> 🚀💎💥\n━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>Khách hàng:</b> ${fullName}\n📧 <b>Email:</b> ${email}\n💳 <b>Gói:</b> ${planKey} (${product.months} tháng)\n💰 <b>Giá:</b> $${product.usd}\n📝 <b>Nội dung:</b> <code>dodo ${email.replace(/[@.]/g, '')} ${planKey}</code>\n🆔 <b>Session:</b> ${sessionId || 'N/A'}\n📍 <b>IP:</b> ${ip}\n⏰ <b>Thời gian:</b> ${timeVN}\n🆔 <b>Request ID:</b> <code>${insertedRequestId || 'N/A'}</code>\n━━━━━━━━━━━━━━━━━━━━━━\n⚡ <b>HÀNH ĐỘNG:</b> Chờ thanh toán Dodo - sẽ auto duyệt khi webhook payment.succeeded về!`;
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
        }).catch(() => {});
      }
    } catch {}

    return res.json({
      success: true,
      checkoutUrl,
      checkout_url: checkoutUrl,
      sessionId,
      paymentId,
      displayPrice: product.usd,
      planKey,
      months: product.months,
      message: `Đã tạo link thanh toán Dodo $${product.usd} cho gói ${product.label}`,
    });
  } catch (e) {
    console.error('[Dodo Create] Exception', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ===== POST /api/webhook/dodo =====
// QUAN TRỌNG: phải dùng express.raw để giữ nguyên raw bytes verify signature.
// Global parser ở index.js đã bỏ qua /api/webhook/* nên req.body ở đây là Buffer.
async function handleDodoWebhook(req, res) {
  try {
    const rawBody = req.body;
    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {});
    console.log('[Dodo Webhook] Raw:', bodyString.slice(0, 2000));

    const check = verifyDodoWebhook(bodyString, req);
    if (check.verified) {
      console.log('[Dodo Webhook] Signature verified OK');
    } else if (!check.allow) {
      console.warn('[Dodo Webhook] Invalid signature', check.reason);
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    } else {
      console.warn('[Dodo Webhook] Verify skipped:', check.reason);
    }

    let body;
    try { body = JSON.parse(bodyString); } catch { body = {}; }
    const eventType = body.type || body.event_type || '';
    const data = body.data || {};
    console.log('[Dodo Webhook] Event:', eventType, 'payload_type:', data.payload_type);

    // Chỉ payment.succeeded mới auto duyệt. Các event khác chỉ log / dọn PENDING.
    if (eventType !== 'payment.succeeded') {
      if (['payment.failed', 'payment.cancelled', 'refund.succeeded'].includes(eventType)) {
        try {
          const emailX = String(data.metadata?.email || data.customer?.email || '').toLowerCase().trim();
          const supabaseAdmin = getSupabaseAdmin();
          if (emailX && supabaseAdmin) {
            await supabaseAdmin.from('vip_requests')
              .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
              .eq('email', emailX).eq('status', 'PENDING');
            console.log(`[Dodo Webhook] ${eventType} -> REJECTED pending cho ${emailX}`);
          }
        } catch (e) { console.warn('[Dodo Webhook] failed/cancelled cleanup error', e.message); }
      }
      return res.json({ success: true, ignored: true, event: eventType });
    }

    const email = String(data.metadata?.email || data.customer?.email || data.customer_email || data.email || '').toLowerCase().trim();
    let planKey = String(data.metadata?.plan_key || data.metadata?.planKey || '').toLowerCase().trim();
    if (!planKey) planKey = getPlanByProductId(extractProductId(data)) || '1m';
    planKey = normalizePlanKey(planKey) || '1m';

    const paymentId = data.payment_id || data.id || body.payment_id || '';
    // amountUsd chỉ để hiển thị/log. total_amount là cents EUR (4189 = 41.89 EUR) -> không dùng cho DB.
    const amountUsd = parseFloat(data.metadata?.amount_usd) || getDodoConfig().products[planKey]?.usd || toUsd(data.total_amount) || 0;
    const amountVnd = VND_BY_PLAN[planKey] || 99000;

    if (!email) {
      console.warn('[Dodo Webhook] No email found');
      return res.json({ success: false, message: 'No email in webhook' });
    }
    console.log(`[Dodo Webhook] Parsed email: ${email} planKey: ${planKey} paymentId: ${paymentId} amountUsd: ${amountUsd} amountVnd: ${amountVnd} total_amount: ${data.total_amount} currency: ${data.currency}`);

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Supabase not configured' });

    // Chống xử lý trùng webhook: cùng payment_id đã APPROVED thì bỏ qua
    if (paymentId) {
      try {
        const { data: dup } = await supabaseAdmin.from('vip_requests')
          .select('id').eq('status', 'APPROVED').ilike('content', `%${paymentId}%`).limit(1).maybeSingle();
        if (dup) {
          console.log('[Dodo Webhook] Duplicate payment_id, skip', paymentId);
          return res.json({ success: true, duplicate: true, email, plan: planKey });
        }
      } catch {}
    }

    const { data: targetUser } = await supabaseAdmin.from('users').select('*').eq('email', email).maybeSingle();
    if (!targetUser) {
      console.warn('[Dodo Webhook] User not found', email);
      return res.json({ success: false, message: 'User not found: ' + email });
    }

    const monthsMap = { '1m': 1, '3m': 3, '6m': 6, '12m': 12, '24m': 24 };
    const monthsToAdd = monthsMap[planKey] || Number(data.metadata?.months) || 1;
    const now = new Date();
    let expireDate = new Date();
    if (targetUser.expired_date && new Date(targetUser.expired_date) > now) {
      expireDate = new Date(targetUser.expired_date);
    }
    expireDate.setMonth(expireDate.getMonth() + monthsToAdd);

    const { error: upErr } = await supabaseAdmin.from('users').update({
      is_vip: true,
      is_vip_bool: true,
      role: 'VIP',
      vip_status: 'APPROVED',
      expired_date: expireDate.toISOString(),
      request_plan_key: planKey,
      request_amount: amountVnd,
      request_content: `dodo ${email.replace(/[@.]/g, '')} ${planKey} payment:${paymentId} $${amountUsd}`,
      request_vip_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', targetUser.id);
    if (upErr) {
      console.error('[Dodo Webhook] Update user error', upErr.message);
      return res.status(500).json({ success: false, error: upErr.message });
    }

    try {
      const { data: pendingList } = await supabaseAdmin.from('vip_requests')
        .select('id').eq('email', email).eq('status', 'PENDING')
        .order('created_at', { ascending: false }).limit(5);
      if (pendingList && pendingList.length > 0) {
        await supabaseAdmin.from('vip_requests').update({
          status: 'APPROVED',
          amount: amountVnd,
          content: `dodo ${planKey} payment:${paymentId} $${amountUsd}`,
          updated_at: new Date().toISOString(),
        }).eq('id', pendingList[0].id);
      } else {
        await supabaseAdmin.from('vip_requests').insert({
          email,
          full_name: targetUser.full_name || email,
          plan_key: planKey,
          amount: amountVnd,
          content: `dodo auto ${planKey} payment:${paymentId} $${amountUsd}`,
          status: 'APPROVED',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) { console.warn('[Dodo Webhook] vip_requests update error', e.message); }

    console.log(`[Dodo Webhook] AUTO APPROVED ${email} gói ${planKey} hết hạn ${expireDate.toISOString()}`);
    await sendTelegramAutoVip({
      email, fullName: targetUser.full_name || email,
      planKey, monthsToAdd, amountUsd, paymentId, expireDate,
    });

    return res.json({ success: true, autoApproved: true, email, plan: planKey, expire: expireDate.toISOString() });
  } catch (e) {
    console.error('[Dodo Webhook] Exception', e);
    return res.status(500).json({ success: false, error: e.message });
  }
}

router.post('/webhook/dodo', express.raw({ type: 'application/json' }), handleDodoWebhook);
router.post('/webhook/dodo-payments', express.raw({ type: 'application/json' }), handleDodoWebhook);

// Log ENV khi load - chỉ log boolean, không log key/secret
(() => {
  const cfg = getDodoConfig();
  console.log(`[Dodo] Route loaded - apiKey:${!!cfg.apiKey} webhookSecret:${!!cfg.webhookSecret} mode:${cfg.isTest ? 'test' : 'live'} base:${cfg.base} products:${Object.keys(cfg.products).join(',')}`);
})();

module.exports = router;
