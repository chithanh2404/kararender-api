// src/routes/paypal.js - FULL FIXED - Giống logic Bank 100% + Telegram
const express = require('express');
const router = express.Router();

const PAYPAL_API = process.env.PAYPAL_MODE === 'live' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalToken(){
  const clientId = (process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = (process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if(!clientId || !secret) throw new Error('Thiếu PAYPAL_CLIENT_ID / PAYPAL_SECRET');
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method:'POST',
    headers:{
      'Authorization':`Basic ${auth}`,
      'Content-Type':'application/x-www-form-urlencoded'
    },
    body:'grant_type=client_credentials'
  });
  const data = await res.json();
  if(!data.access_token) throw new Error('PayPal token failed: '+JSON.stringify(data));
  return data.access_token;
}

function getPayPalPrice(planKey){
  const key = (planKey||'1M').toUpperCase();
  const map = {
    '1M': process.env.PAYPAL_PRICE_1M || '4.99',
    '3M': process.env.PAYPAL_PRICE_3M || '9.99',
    '6M': process.env.PAYPAL_PRICE_6M || '17.99',
    '12M': process.env.PAYPAL_PRICE_12M || '27.99',
    '24M': process.env.PAYPAL_PRICE_24M || '44.99',
    '1Y': process.env.PAYPAL_PRICE_12M || '27.99',
    '2Y': process.env.PAYPAL_PRICE_24M || '44.99',
  };
  return map[key] || map['1M'];
}

function getVndPrice(planKey){
  const map = { '1m': 99000, '3m': 199000, '6m': 399000, '12m': 599000, '24m': 999000 };
  return map[(planKey||'1m').toLowerCase()] || 99000;
}

async function sendTelegram(htmlMessage){
  try{
    const token = (process.env.TELEGRAM_BOT_TOKEN||'').trim();
    const chatId = (process.env.TELEGRAM_CHAT_ID||'').trim();
    if(!token || !chatId) {
      console.warn('[Telegram] Thiếu TELEGRAM_BOT_TOKEN / CHAT_ID');
      return false;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: htmlMessage, parse_mode:'HTML', disable_web_page_preview: true})
    });
    const data = await res.json();
    console.log('[Telegram] Sent:', data.ok ? 'OK' : JSON.stringify(data));
    return data.ok;
  }catch(e){
    console.warn('[Telegram] Error', e.message);
    return false;
  }
}

// GET /api/payment/paypal/config
router.get('/config', async (req,res)=>{
  try{
    const hasKey = !!(process.env.PAYPAL_CLIENT_ID && (process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET));
    const webhookId = process.env.PAYPAL_WEBHOOK_ID || '';
    return res.json({
      success:true,
      configured: hasKey,
      mode: process.env.PAYPAL_MODE || 'live',
      clientId: process.env.PAYPAL_CLIENT_ID ? process.env.PAYPAL_CLIENT_ID.slice(0,12)+'...' : 'NOT SET',
      webhookId: webhookId ? webhookId.slice(0,8)+'...' : 'NOT SET',
      fullWebhookId: webhookId,
      prices: {
        '1m': getPayPalPrice('1M'),
        '3m': getPayPalPrice('3M'),
        '6m': getPayPalPrice('6M'),
        '12m': getPayPalPrice('12M'),
        '24m': getPayPalPrice('24M')
      }
    });
  }catch(e){ return res.json({success:false, message:e.message}); }
});

// POST /api/payment/paypal/create-order - GIỐNG HỆT BANK: tạo request-vip PENDING + Telegram
router.post('/create-order', async (req,res)=>{
  try{
    const { email, planKey } = req.body || {};
    if(!email || !planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedPlan = planKey.toLowerCase().trim();
    const token = await getPayPalToken();
    const priceUsd = getPayPalPrice(planKey);
    const priceVnd = getVndPrice(normalizedPlan);
    const customId = `${normalizedEmail}|${normalizedPlan}|${Date.now()}`;

    const payload = {
      intent:'CAPTURE',
      purchase_units:[{
        amount:{ currency_code:'USD', value: priceUsd.toString() },
        custom_id: customId,
        description: `KaraRender VIP ${planKey.toUpperCase()} - ${normalizedEmail}`,
        soft_descriptor: 'KARARENDER VIP'
      }],
      application_context:{
        brand_name:'KaraRender',
        landing_page:'BILLING',
        user_action:'PAY_NOW',
        shipping_preference:'NO_SHIPPING',
        return_url: 'https://kararender.com/vip-success',
        cancel_url: 'https://kararender.com/vip-cancel'
      }
    };

    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify(payload)
    });
    const order = await orderRes.json();
    if(!order.id){
      console.error('[PayPal Create] failed', order);
      return res.status(500).json({success:false, message:'Tạo PayPal order thất bại', detail:order});
    }

    const approveLink = (order.links||[]).find(l=>l.rel==='approve')?.href || `https://www.paypal.com/checkoutnow?token=${order.id}`;

    // ===== LÀM GIỐNG BANK: TẠO VIP REQUEST PENDING + UPDATE USERS =====
    try{
      const { supabaseAdmin } = require('../services/supabase');
      if(supabaseAdmin){
        // 1. Update users table giống bank
        const { data: user } = await supabaseAdmin.from('users').select('id,email,full_name').eq('email', normalizedEmail).maybeSingle();
        
        if(user){
          await supabaseAdmin.from('users').update({
            request_plan_key: normalizedPlan,
            request_amount: priceVnd,
            request_content: `paypal pending ${normalizedPlan} order:${order.id} $${priceUsd} ${normalizedEmail}`,
            request_vip_time: new Date().toISOString(),
            vip_status: 'PENDING',
            updated_at: new Date().toISOString()
          }).eq('id', user.id);
        }

        // 2. Insert vip_requests giống bank
        await supabaseAdmin.from('vip_requests').insert({
          email: normalizedEmail,
          full_name: user?.full_name || normalizedEmail,
          plan_key: normalizedPlan,
          amount: priceVnd,
          usd_amount: parseFloat(priceUsd),
          content: `paypal pending ${normalizedPlan} order:${order.id} $${priceUsd} ${normalizedEmail} | approve:${approveLink}`,
          status:'PENDING',
          payment_method:'PAYPAL',
          paypal_order_id: order.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        console.log(`[PayPal] Created PENDING request for ${normalizedEmail} plan ${normalizedPlan} order ${order.id}`);
      }
    }catch(e){ console.warn('[PayPal Create] supabase insert warn', e.message, e.stack); }

    // 3. Gửi Telegram giống Bank - YÊU CẦU MỚI
    try{
      const timeVN = new Date().toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'});
      const msg = `🔔 <b>YÊU CẦU VIP MỚI - PAYPAL</b> 🔔\n━━━━━━━━━━━━━━\n👤 <b>Email:</b> ${normalizedEmail}\n💳 <b>Gói:</b> ${normalizedPlan.toUpperCase()}\n💰 <b>Tiền:</b> $${priceUsd} USD (~${new Intl.NumberFormat('vi-VN').format(priceVnd)}đ)\n📝 <b>Nội dung:</b> <code>paypal ${normalizedEmail.replace(/[@.]/g,'')} ${normalizedPlan} order:${order.id}</code>\n🆔 <b>Order ID:</b> <code>${order.id}</code>\n🔗 <b>Approve:</b> ${approveLink}\n⏰ <b>Giờ:</b> ${timeVN}\n━━━━━━━━━━━━━━\n💡 <b>Chờ user thanh toán PayPal - sẽ auto duyệt khi capture</b>`;
      await sendTelegram(msg);
    }catch(e){ console.warn('[PayPal] Telegram pending error', e.message); }

    return res.json({
      success:true,
      orderId: order.id,
      price: priceUsd,
      priceVnd: priceVnd,
      currency:'USD',
      approveLink: approveLink,
      paypalOrder: order
    });
  }catch(e){
    console.error('[PayPal Create] Exception', e);
    return res.status(500).json({success:false, message:e.message});
  }
});

module.exports = router;
