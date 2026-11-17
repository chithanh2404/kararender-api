// ===== DODO PAYMENTS - CONG THANH TOAN QUOC TE - AUTO DUYET VIP =====
// Mirror flow Lemon Squeezy trong index.js:
//   POST /api/payment/dodo/create  -> tao checkout session, ghi vip_requests PENDING, gui Telegram
//   POST /api/webhook/dodo         -> payment.succeeded -> auto duyet VIP + Telegram
//   GET  /api/payment/dodo/config  -> frontend + admin check bat/tat
//   GET/POST /api/admin/dodo-config -> bat/tat trong admin dashboard (app_settings id='dodo_enabled')
//
// KHAC BIET SO VOI LEMON:
//   - Dodo KHONG co variant_id. Gia nam trong Product tao san o dashboard.
//     Backend chi gui product_id. Doi gia -> sua trong Dodo Dashboard, khong sua code/env gia.
//   - Webhook Dodo theo chuan Standard Webhooks (khong phai HMAC hex nhu Lemon):
//     headers webhook-id / webhook-timestamp / webhook-signature
//     signed = `${webhook-id}.${webhook-timestamp}.${rawBody}`
//     signature = base64(HMAC-SHA256(secret_base64_decoded, signed)), format "v1,<sig>"
//   - total_amount tra ve theo DON VI NHO NHAT (cents): $3.99 -> 399. Phai /100 truoc khi hien thi.
//   - Chi duyet o event payment.succeeded. return_url chi la hint, KHONG duyet theo return_url.
//
// Mount trong src/index.js - BAT BUOC DAT TRUOC app.use(express.json()) (dong ~142):
//   const dodoRouter = require('./routes/dodo');
//   app.use('/api', dodoRouter);   // <-- chen ngay TRUOC dong app.use(express.json(...))
// Ly do: webhook Dodo can RAW BODY de verify signature. Neu express.json() chay truoc,
// req.body da bi parse thanh object, express.raw() se bi bo qua, signature luon fail.
// Day cung la ly do webhook Lemon/PayPal hien tai de bi ignored (chi warn, khong reject).
// Router nay tu parse JSON o tung route create/config (express.json() per-route) nen
// mount som khong anh huong route khac.
//
// ENV can thiet:
//   DODO_PAYMENTS_API_KEY= dodo_test_... (test) / dodo_live_... (live)
//   DODO_PAYMENTS_WEBHOOK_KEY= whsec_... (signing secret cua endpoint webhook)
//   DODO_PRODUCT_1M / _3M / _6M / _12M / _24M = product_id trong Dodo Dashboard (vd pdt_...)
//   DODO_PRICE_1M / _3M / _6M / _12M / _24M (optional, chi de hien thi + Telegram; gia that lay tu Product)
//   FRONTEND_URL=https://www.kararender.com (da co san)

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const MONTHS_MAP = { '1m': 1, '3m': 3, '6m': 6, '12m': 12, '24m': 24, '1y': 12, '2y': 24, 'lifetime': 1200 };
const PLAN_LABEL_MAP = { '1m': 'Goi 1 thang', '3m': 'Goi 3 thang', '6m': 'Goi 6 thang', '12m': 'Goi 1 nam', '24m': 'Goi 2 nam' };

// ---------- Helpers: giong getLemonVariantId / getLemonUsdPrice nhung cho Dodo ----------
function getDodoBaseUrl() {
  if ((process.env.DODO_PAYMENTS_BASE_URL || '').trim()) return process.env.DODO_PAYMENTS_BASE_URL.trim().replace(/\/$/, '');
  const key = (process.env.DODO_PAYMENTS_API_KEY || '').trim();
  // Test key chi chay duoc tren test host, live key chi chay duoc tren live host.
  if (key.startsWith('dodo_test_')) return 'https://test.dodopayments.com';
  return 'https://live.dodopayments.com';
}

function getDodoProductId(planKey) {
  const key = (planKey || '').toLowerCase();
  const envMap = {
    '1m': process.env.DODO_PRODUCT_1M,
    '3m': process.env.DODO_PRODUCT_3M,
    '6m': process.env.DODO_PRODUCT_6M,
    '12m': process.env.DODO_PRODUCT_12M,
    '24m': process.env.DODO_PRODUCT_24M,
    '1y': process.env.DODO_PRODUCT_12M || process.env.DODO_PRODUCT_1Y,
    '2y': process.env.DODO_PRODUCT_24M,
    'vip1m': process.env.DODO_PRODUCT_1M,
    'vip3m': process.env.DODO_PRODUCT_3M,
    'vip6m': process.env.DODO_PRODUCT_6M,
    'vip12m': process.env.DODO_PRODUCT_12M,
    'vip24m': process.env.DODO_PRODUCT_24M,
  };
  return (envMap[key] || process.env.DODO_PRODUCT_DEFAULT || '').trim() || null;
}

function getDodoProductIdReverse(productId) {
  if (!productId) return null;
  const pairs = [
    ['1m', process.env.DODO_PRODUCT_1M], ['3m', process.env.DODO_PRODUCT_3M],
    ['6m', process.env.DODO_PRODUCT_6M], ['12m', process.env.DODO_PRODUCT_12M],
    ['24m', process.env.DODO_PRODUCT_24M],
  ];
  for (const [plan, id] of pairs) if (id && String(id).trim() === String(productId).trim()) return plan;
  return null;
}

function getDodoUsdPrice(planKey, vndPrice) {
  // Chi de HIEN THI + Telegram. Gia thu that la gia cua Product trong Dodo Dashboard.
  // Thu tu uu tien: DODO_PRICE_* -> LEMON_PRICE_* (de 2 cong gia dong nhat) -> quy doi VND/26000.
  // FIX bug cua getLemonUsdPrice: khong return nguyen so VND (99000) lam gia USD.
  const key = (planKey || '').toUpperCase();
  const envPriceMap = {
    '1M': process.env.DODO_PRICE_1M || process.env.LEMON_PRICE_1M,
    '3M': process.env.DODO_PRICE_3M || process.env.LEMON_PRICE_3M,
    '6M': process.env.DODO_PRICE_6M || process.env.LEMON_PRICE_6M,
    '12M': process.env.DODO_PRICE_12M || process.env.LEMON_PRICE_12M,
    '24M': process.env.DODO_PRICE_24M || process.env.LEMON_PRICE_24M,
    '1Y': process.env.DODO_PRICE_12M || process.env.LEMON_PRICE_12M,
    '2Y': process.env.DODO_PRICE_24M || process.env.LEMON_PRICE_24M,
  };
  if (envPriceMap[key]) return parseFloat(envPriceMap[key]);
  const defaultVndMap = { '1M': 99000, '3M': 199000, '6M': 399000, '12M': 599000, '24M': 999000, '1Y': 599000, '2Y': 999000 };
  const vnd = vndPrice || defaultVndMap[key] || 99000;
  return Math.max(3.99, Math.round((vnd / 26000) * 100) / 100);
}

async function getSupabaseAdmin() {
  try { return require('../services/supabase').supabaseAdmin; } catch (e) { return null; }
}

async function sendTelegramDodo(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const d = await r.json().catch(() => ({}));
    console.log('[Dodo] Telegram sent:', d.ok);
  } catch (e) { console.warn('[Dodo] Telegram error', e.message); }
}

// ---------- Verify webhook: Standard Webhooks ----------
function verifyDodoWebhook(rawBodyString, headers) {
  const secretRaw = (process.env.DODO_PAYMENTS_WEBHOOK_KEY || process.env.DODO_WEBHOOK_SECRET || '').trim();
  if (!secretRaw) { console.warn('[Dodo Webhook] Chua cau hinh DODO_PAYMENTS_WEBHOOK_KEY - bo qua verify (chi nen de vay luc dev)'); return true; }
  const id = headers['webhook-id'] || headers['Webhook-Id'] || '';
  const timestamp = headers['webhook-timestamp'] || headers['Webhook-Timestamp'] || '';
  const signature = headers['webhook-signature'] || headers['Webhook-Signature'] || '';
  if (!id || !timestamp || !signature) { console.warn('[Dodo Webhook] Thieu webhook headers'); return false; }
  // Chong replay: Dodo dung tolerance 5 phut
  const ts = parseInt(timestamp, 10);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) { console.warn('[Dodo Webhook] Timestamp qua han / sai'); return false; }
  let key;
  try {
    // Secret Dodo co dang whsec_<base64>. Phai base64-decode moi dung lam HMAC key.
    if (secretRaw.startsWith('whsec_')) key = Buffer.from(secretRaw.slice('whsec_'.length), 'base64');
    else key = Buffer.from(secretRaw, 'utf8');
  } catch (e) { key = Buffer.from(secretRaw, 'utf8'); }
  const signed = `${id}.${timestamp}.${rawBodyString}`;
  const expected = crypto.createHmac('sha256', key).update(signed, 'utf8').digest('base64');
  // Header co dang "v1,<sig>" va co the co nhieu signature cach nhau boi khoang trang
  const candidates = String(signature).split(' ').map((p) => (p.includes(',') ? p.split(',')[1] : p)).filter(Boolean);
  for (const cand of candidates) {
    try {
      const a = Buffer.from(cand); const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch (e) { if (cand === expected) return true; }
  }
  console.warn('[Dodo Webhook] Invalid signature');
  return false;
}

// ================= CREATE CHECKOUT =================
// POST /api/payment/dodo/create  { email, planKey } -> { success, checkoutUrl, checkoutId, paymentId, displayPrice }
router.post('/payment/dodo/create', express.json(), async (req, res) => {
  try {
    const { email, planKey } = req.body || {};
    if (!email || !planKey) return res.status(400).json({ success: false, message: 'Thieu email hoac planKey' });
    const apiKey = (process.env.DODO_PAYMENTS_API_KEY || '').trim();
    if (!apiKey) return res.status(500).json({ success: false, message: 'Chua cau hinh DODO_PAYMENTS_API_KEY trong ENV' });

    const supabaseAdmin = await getSupabaseAdmin();
    let planPriceVnd = 99000;
    let planLabel = planKey;
    let months = MONTHS_MAP[String(planKey).toLowerCase()] || 1;
    try {
      if (supabaseAdmin) {
        const { data: planData } = await supabaseAdmin.from('upgrade_plans').select('*').eq('key', String(planKey).toLowerCase()).single();
        if (planData) { planPriceVnd = planData.price || 99000; planLabel = planData.label || planKey; months = planData.months || months; }
      }
    } catch (e) {}

    const productId = getDodoProductId(planKey);
    if (!productId) return res.status(400).json({ success: false, message: `Chua cau hinh DODO_PRODUCT cho goi ${planKey} (vd DODO_PRODUCT_1M=pdt_...)` });
    const displayPrice = getDodoUsdPrice(planKey, planPriceVnd);
    const frontend = (process.env.FRONTEND_URL || 'https://www.kararender.com').replace(/\/$/, '');

    // Dodo Checkout Sessions API: POST {base}/checkouts
    // Chi can product_cart + customer + metadata + return_url. Gia lay tu Product, khong gui gia o day.
    const payload = {
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email: email.toLowerCase(), name: email.toLowerCase() },
      metadata: {
        email: email.toLowerCase(),
        plan_key: String(planKey).toLowerCase(),
        plan_label: planLabel,
        months: String(months),
        amount_vnd: String(planPriceVnd),
      },
      return_url: `${frontend}/vip-success?email=${encodeURIComponent(email)}&plan=${planKey}`,
      billing_currency: 'USD',
    };
    console.log('[Dodo Create] Payload:', JSON.stringify({ ...payload, customer: { email: payload.customer.email } }));
    const dodoRes = await fetch(`${getDodoBaseUrl()}/checkouts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const dodoData = await dodoRes.json().catch(() => ({}));
    console.log('[Dodo Create] Response:', JSON.stringify(dodoData).slice(0, 2000));
    if (!dodoRes.ok) {
      return res.status(400).json({ success: false, message: dodoData.message || dodoData.code || 'Dodo API error', detail: dodoData });
    }
    const checkoutUrl = dodoData.checkout_url;
    const checkoutId = dodoData.session_id; // session_id cua checkout
    const paymentId = dodoData.payment_id || null; // null neu chua confirm, webhook se co payment_id that
    if (!checkoutUrl) return res.status(400).json({ success: false, message: 'Dodo khong tra ve checkout_url', detail: dodoData });

    // Ghi PENDING giong Lemon de admin thay + webhook co cai de doi sang APPROVED
    let insertedRequestId = null;
    let fullNameForTelegram = email.toLowerCase();
    if (supabaseAdmin) {
      try {
        try {
          const { data: userData } = await supabaseAdmin.from('users').select('full_name').eq('email', email.toLowerCase()).maybeSingle();
          if (userData?.full_name) fullNameForTelegram = userData.full_name;
        } catch (e) {}
        const { data: existing } = await supabaseAdmin.from('vip_requests')
          .select('id').eq('email', email.toLowerCase()).eq('status', 'PENDING').eq('plan_key', String(planKey).toLowerCase())
          .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
          .limit(1).maybeSingle();
        if (!existing) {
          const { data: insData } = await supabaseAdmin.from('vip_requests').insert({
            email: email.toLowerCase(),
            full_name: fullNameForTelegram,
            plan_key: String(planKey).toLowerCase(),
            amount: planPriceVnd,
            content: `dodo ${email.replace(/[@.]/g, '')} ${planKey} $${displayPrice} session:${checkoutId}${paymentId ? ` payment:${paymentId}` : ''}`,
            status: 'PENDING',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).select().single();
          insertedRequestId = insData?.id || null;
        } else insertedRequestId = existing?.id || null;
      } catch (e) { console.warn('[Dodo Create] save pending error', e.message); }
    }

    // Telegram: YEU CAU NANG CAP - giong Lemon
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.headers['x-real-ip'] || 'unknown';
      const domain = req.headers.origin || req.headers.referer || req.body?.domain || 'https://kararender.com';
      const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const label = PLAN_LABEL_MAP[String(planKey).toLowerCase()] || planLabel;
      const msg = `💥💎🚀 <b>YÊU CẦU NÂNG CẤP VIP - DODO PAYMENTS</b> 🚀💎💥\n━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>Khách hàng:</b> ${fullNameForTelegram}\n📧 <b>Email:</b> ${email}\n🆔 <b>User:</b> <code>${email}</code>\n\n💳 <b>GÓI NÂNG CẤP:</b>\n├─ <b>Mã gói:</b> ${planKey}\n├─ <b>Tên gói:</b> ${label}\n├─ <b>Thời hạn:</b> ${months} tháng\n└─ <b>Giá:</b> ${planPriceVnd.toLocaleString('vi-VN')}đ ($${displayPrice})\n\n📝 <b>Nội dung CK:</b> <code>dodo ${email.replace(/[@.]/g, '')} ${planKey}</code>\n💰 <b>Số tiền:</b> ${planPriceVnd.toLocaleString('vi-VN')}đ\n🆔 <b>Session:</b> ${checkoutId || 'N/A'}\n\n🌐 <b>THÔNG TIN TRUY CẬP:</b>\n├─ <b>Domain:</b> ${domain}\n├─ <b>Origin:</b> ${req.headers.origin || 'unknown'}\n├─ <b>Referer:</b> ${req.headers.referer || 'unknown'}\n├─ <b>IP:</b> ${ip}\n└─ <b>Browser:</b> ${(req.headers['user-agent'] || 'unknown').slice(0, 220)}\n\n⏰ <b>Thời gian:</b> ${timeVN}\n🆔 <b>Request ID:</b> <code>${insertedRequestId || 'N/A'}</code>\n━━━━━━━━━━━━━━━━━━━━━━\n⚡ <b>HÀNH ĐỘNG:</b> Chờ thanh toán Dodo Payments - sẽ auto duyệt khi thanh toán xong!`;
      await sendTelegramDodo(msg);
    } catch (e) { console.warn('[Dodo Create] Telegram exception', e.message); }

    return res.json({ success: true, checkoutUrl, checkoutId, paymentId, displayPrice, vndPrice: planPriceVnd, message: `Da tao link thanh toan Dodo Payments $${displayPrice} cho goi ${planLabel}` });
  } catch (e) {
    console.error('[Dodo Create] Exception', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ================= CONFIG (frontend + admin) =================
// GET /api/payment/dodo/config -> { success, configured, enabled, storeActive, demoMode, prices, hasProduct }
async function dodoConfigHandler(req, res) {
  try {
    const supabaseAdmin = await getSupabaseAdmin();
    let dbEnabled = false; let dbStoreActive = false;
    try {
      if (supabaseAdmin) {
        const { data } = await supabaseAdmin.from('app_settings').select('value').eq('id', 'dodo_enabled').single();
        if (data?.value) { dbEnabled = !!data.value.enabled; dbStoreActive = !!data.value.storeActive; }
      }
    } catch (e) {}
    const hasKey = !!(process.env.DODO_PAYMENTS_API_KEY || '').trim();
    const hasProduct = { '1m': !!getDodoProductId('1m'), '3m': !!getDodoProductId('3m'), '6m': !!getDodoProductId('6m'), '12m': !!getDodoProductId('12m'), '24m': !!getDodoProductId('24m') };
    return res.json({
      success: true,
      configured: hasKey && Object.values(hasProduct).some(Boolean),
      enabled: dbEnabled, storeActive: dbStoreActive, demoMode: !dbStoreActive,
      hasApiKey: hasKey, hasProduct,
      prices: { '1m': 99000, '3m': 199000, '6m': 399000, '12m': 599000, '24m': 999000 },
      usdPrices: { '1m': getDodoUsdPrice('1m'), '3m': getDodoUsdPrice('3m'), '6m': getDodoUsdPrice('6m'), '12m': getDodoUsdPrice('12m'), '24m': getDodoUsdPrice('24m') },
      message: !hasKey ? 'Chua cau hinh API key' : !dbEnabled ? 'Da cau hinh nhung dang TAT trong admin' : !dbStoreActive ? 'Dang o che do DEMO - cho store active' : 'Dang hoat dong LIVE',
    });
  } catch (e) { return res.json({ success: false, message: e.message }); }
}
router.get('/payment/dodo/config', dodoConfigHandler);
router.get('/payment/dodo/config-v2', dodoConfigHandler); // alias, phong frontend cu goi config-v2 nhu Lemon

router.get('/admin/dodo-config', async (req, res) => {
  try {
    const r = await dodoConfigHandler(req, res); return r;
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});
router.post('/admin/dodo-config', express.json(), async (req, res) => {
  try {
    const { enabled, storeActive } = req.body || {};
    const supabaseAdmin = await getSupabaseAdmin();
    if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Supabase not configured' });
    const value = { enabled: !!enabled, storeActive: !!storeActive, updated_at: new Date().toISOString(), updated_by: (req.headers['x-user-email'] || '').toLowerCase() };
    const { error } = await supabaseAdmin.from('app_settings').upsert({ id: 'dodo_enabled', value }, { onConflict: 'id' });
    if (error) throw error;
    console.log(`[Dodo Admin] Saved config enabled:${!!enabled} storeActive:${!!storeActive}`);
    return res.json({ success: true, value, message: `Da ${enabled ? 'BAT' : 'TAT'} Dodo Payments - Store ${storeActive ? 'ACTIVE' : 'DEMO'}` });
  } catch (e) { console.error('[Dodo Admin] save error', e.message); return res.status(500).json({ success: false, message: e.message }); }
});

// ================= WEBHOOK =================
// POST /api/webhook/dodo - PHAI dung express.raw de verify signature tren raw bytes goc.
// + PHAI mount router TRUOC express.json() (xem header file).
// Neu global express.json() da parse truoc thi signature se fail (giong canh bao trong docs Dodo).
router.post('/webhook/dodo', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Neu router bi mount SAU express.json(), req.body da la object, khong con Buffer -> raw mat.
    if (req.body && !Buffer.isBuffer(req.body)) {
      console.error('[Dodo Webhook] RAW BODY LOST: router dang mount sau express.json(). Chuyen app.use(\'/api\', dodoRouter) len TRUOC app.use(express.json()) trong index.js.');
      return res.status(400).json({ success: false, message: 'Webhook mounted after express.json() - raw body lost' });
    }
    const rawBody = req.body;
    const bodyString = rawBody ? rawBody.toString('utf8') : '';
    console.log('[Dodo Webhook] Raw:', bodyString.slice(0, 2000));
    if (!verifyDodoWebhook(bodyString, req.headers)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }
    let body; try { body = JSON.parse(bodyString); } catch (e) { body = {}; }
    const eventType = body.type || '';
    console.log('[Dodo Webhook] Event:', eventType);
    if (eventType === 'payment.failed' || eventType === 'payment.cancelled') {
      console.log('[Dodo Webhook] Payment not succeeded, khong duyet:', eventType);
      return res.json({ success: true, ignored: true, event: eventType });
    }
    if (eventType !== 'payment.succeeded') {
      console.log('[Dodo Webhook] Ignored event:', eventType);
      return res.json({ success: true, ignored: true, event: eventType });
    }

    const data = body.data || {};
    const metadata = data.metadata || {};
    const customer = data.customer || {};
    let email = String(metadata.email || customer.email || '').toLowerCase().trim();
    let planKey = String(metadata.plan_key || '').toLowerCase().trim();
    // Fallback: suy ra plan tu product_id trong cart (khi metadata bi mat)
    if (!planKey && Array.isArray(data.product_cart) && data.product_cart[0]?.product_id) {
      planKey = getDodoProductIdReverse(data.product_cart[0].product_id) || '';
    }
    if (!planKey) planKey = '1m';
    if (!email) { console.warn('[Dodo Webhook] No email found'); return res.json({ success: false, message: 'No email in webhook' }); }
    console.log(`[Dodo Webhook] Parsed email: ${email} planKey: ${planKey} paymentId: ${data.payment_id}`);

    const supabaseAdmin = await getSupabaseAdmin();
    if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Supabase not configured' });

    // Idempotency: Dodo retry webhook it nhat 1 lan. Neu payment_id nay da APPROVED thi bo qua.
    const paymentId = data.payment_id || '';
    if (paymentId) {
      try {
        const { data: dup } = await supabaseAdmin.from('vip_requests').select('id').ilike('content', `%${paymentId}%`).eq('status', 'APPROVED').limit(1).maybeSingle();
        if (dup) { console.log(`[Dodo Webhook] Da xu ly payment ${paymentId}, bo qua retry`); return res.json({ success: true, alreadyProcessed: true, payment_id: paymentId }); }
      } catch (e) {}
    }

    const { data: targetUser } = await supabaseAdmin.from('users').select('*').eq('email', email).maybeSingle();
    if (!targetUser) { console.warn('[Dodo Webhook] User not found', email); return res.json({ success: false, message: 'User not found: ' + email }); }

    const monthsToAdd = MONTHS_MAP[planKey] || parseInt(metadata.months) || 1;
    const totalAmountUsd = typeof data.total_amount === 'number' ? data.total_amount / 100 : null; // cents -> USD
    const currency = data.currency || 'USD';
    const now = new Date();
    let expireDate = new Date();
    if (targetUser.expired_date && new Date(targetUser.expired_date) > now) expireDate = new Date(targetUser.expired_date);
    expireDate.setMonth(expireDate.getMonth() + monthsToAdd);
    if (planKey === 'lifetime') expireDate = new Date('2099-12-31');

    // Update users - giong Lemon/PayPal. KHONG ghi de request_amount bang USD (giu VND tu luc create).
    const { error: upErr } = await supabaseAdmin.from('users').update({
      is_vip: true, is_vip_bool: true, role: 'VIP', vip_status: 'APPROVED',
      expired_date: expireDate.toISOString(),
      request_plan_key: planKey,
      request_content: `dodo ${email} ${planKey} payment:${paymentId} $${totalAmountUsd ?? ''}`,
      request_vip_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', targetUser.id);
    if (upErr) { console.error('[Dodo Webhook] Update user error', upErr.message); return res.status(500).json({ success: false, error: upErr.message }); }

    try {
      const { data: pendingList } = await supabaseAdmin.from('vip_requests').select('id').eq('email', email).eq('status', 'PENDING').order('created_at', { ascending: false }).limit(5);
      const newContent = `dodo ${planKey} payment:${paymentId} $${totalAmountUsd ?? ''} ${currency}`;
      if (pendingList && pendingList.length > 0) {
        // Chi duyet PENDING moi nhat, giong Lemon (khong duyet het nhu PayPal cu)
        await supabaseAdmin.from('vip_requests').update({ status: 'APPROVED', content: newContent, updated_at: new Date().toISOString() }).eq('id', pendingList[0].id);
      } else {
        await supabaseAdmin.from('vip_requests').insert({
          email, full_name: targetUser.full_name || email, plan_key: planKey,
          amount: parseInt(metadata.amount_vnd) || 0,
          content: `dodo auto ${planKey} payment:${paymentId}`,
          status: 'APPROVED', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
      }
    } catch (e) { console.warn('[Dodo Webhook] vip_requests update error', e.message); }

    console.log(`[Dodo Webhook] AUTO APPROVED ${email} goi ${planKey} het han ${expireDate.toISOString()}`);
    try {
      const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const expireVN = expireDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const autoMsg = `✅🤖 <b>AUTO DUYỆT VIP - KARARENDER</b> 🤖✅\n━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>Email:</b> ${email}\n👤 <b>Tên:</b> ${targetUser.full_name || email}\n💳 <b>Gói:</b> ${planKey} (${monthsToAdd} tháng)\n💰 <b>Số tiền:</b> $${totalAmountUsd ?? 'N/A'} ${currency}\n📝 <b>Nội dung:</b> <code>dodo ${email.replace(/[@.]/g, '')} ${planKey} payment:${paymentId}</code>\n📅 <b>Hạn dùng:</b> ${expireVN}\n⏰ <b>Thời gian:</b> ${timeVN}\n🆔 <b>Payment ID:</b> ${paymentId}\n━━━━━━━━━━━━━━━━━━━━━━\n🤖 <b>Hệ thống tự động duyệt qua webhook Dodo Payments!</b>`;
      await sendTelegramDodo(autoMsg);
    } catch (e) { console.warn('[Dodo Webhook] Telegram error', e.message); }

    return res.json({ success: true, autoApproved: true, email, plan: planKey, expire: expireDate.toISOString() });
  } catch (e) {
    console.error('[Dodo Webhook] Exception', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Alias phong khi dashboard dang ky sai duong dan
router.post('/webhook/dodo-payments', (req, res, next) => { req.url = '/webhook/dodo'; req.method = 'POST'; router.handle(req, res, next); });

module.exports = router;
