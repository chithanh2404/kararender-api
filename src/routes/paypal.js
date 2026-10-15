// src/routes/paypal.js - FINAL VERSION - Check admin enabled flag + Supabase compatible + Telegram
const express = require('express');
const router = express.Router();

const PAYPAL_API = process.env.PAYPAL_MODE === 'live' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

let memoryPaypalEnabled = true; // cache

async function getPayPalToken(){
  const clientId = (process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = (process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if(!clientId || !secret) throw new Error('Thiếu PAYPAL_CLIENT_ID / PAYPAL_SECRET');
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method:'POST',
    headers:{ 'Authorization':`Basic ${auth}`, 'Content-Type':'application/x-www-form-urlencoded' },
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
  };
  return map[key] || map['1M'];
}
function getVndPrice(planKey){
  const map = { '1m': 99000, '3m': 199000, '6m': 399000, '12m': 599000, '24m': 999000 };
  return map[(planKey||'1m').toLowerCase()] || 99000;
}

async function isPaypalEnabled(){
  // Kiểm tra admin có tắt không
  try{
    const { supabaseAdmin } = require('../services/supabase');
    if(supabaseAdmin){
      const { data: row } = await supabaseAdmin.from('paypal_config').select('enabled').eq('id',1).maybeSingle();
      if(row && typeof row.enabled !== 'undefined') {
        memoryPaypalEnabled = !!row.enabled;
        return memoryPaypalEnabled;
      }
      const { data: row2 } = await supabaseAdmin.from('payment_gateway_config').select('enabled').eq('gateway','paypal').maybeSingle();
      if(row2 && typeof row2.enabled !== 'undefined'){
        memoryPaypalEnabled = !!row2.enabled;
        return memoryPaypalEnabled;
      }
    }
  }catch(e){}
  return memoryPaypalEnabled;
}

async function sendTelegram(htmlMessage){
  try{
    const token = (process.env.TELEGRAM_BOT_TOKEN||'').trim();
    const chatId = (process.env.TELEGRAM_CHAT_ID||'').trim();
    if(!token || !chatId) return false;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({chat_id: chatId, text: htmlMessage, parse_mode:'HTML'})
    });
    return (await res.json()).ok;
  }catch(e){ return false; }
}

// GET /api/payment/paypal/config - Frontend check có hiện nút PayPal không
router.get('/config', async (req,res)=>{
  try{
    const hasKey = !!(process.env.PAYPAL_CLIENT_ID && (process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET));
    const enabled = await isPaypalEnabled();
    return res.json({
      success:true,
      configured: hasKey && enabled, // chỉ configured khi có key VÀ admin bật
      enabled: enabled,
      hasKey: hasKey,
      mode: process.env.PAYPAL_MODE || 'live',
      fullWebhookId: process.env.PAYPAL_WEBHOOK_ID || '8Y988759VB9565608',
      webhookId: (process.env.PAYPAL_WEBHOOK_ID || '8Y988759VB9565608').slice(0,12)+'...',
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

// POST /api/payment/paypal/create-order - Tạo hàng vip_requests PENDING + Telegram giống Bank
router.post('/create-order', async (req,res)=>{
  try{
    const { email, planKey } = req.body || {};
    if(!email || !planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});

    // Check admin có tắt không
    const enabled = await isPaypalEnabled();
    if(!enabled){
      return res.status(403).json({success:false, message:'Cổng PayPal đang TẮT bởi admin'});
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedPlan = planKey.toLowerCase().trim();
    const priceUsd = getPayPalPrice(planKey);
    const priceVnd = getVndPrice(normalizedPlan);
    const emailClean = normalizedEmail.replace(/[@.]/g,'');
    const customId = `${normalizedEmail}|${normalizedPlan}`;

    const token = await getPayPalToken();
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
        return_url: 'https://www.kararender.com/vip-success',
        cancel_url: 'https://www.kararender.com/vip-cancel'
      }
    };

    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const order = await orderRes.json();
    if(!order.id){
      return res.status(500).json({success:false, message:'Tạo PayPal order thất bại', detail:order});
    }
    const approveLink = (order.links||[]).find(l=>l.rel==='approve')?.href || `https://www.paypal.com/checkoutnow?token=${order.id}`;

    // Insert vip_requests đúng cấu trúc
    try{
      const { supabaseAdmin } = require('../services/supabase');
      if(supabaseAdmin){
        const { data: user } = await supabaseAdmin.from('users').select('id,email,full_name').eq('email', normalizedEmail).maybeSingle();
        const fullName = user?.full_name || normalizedEmail.split('@')[0] || 'user';
        const contentText = `nang cap ${emailClean} ${normalizedPlan} paypal ${order.id} $${priceUsd}`;

        await supabaseAdmin.from('vip_requests').insert({
          email: normalizedEmail,
          full_name: fullName,
          plan_key: normalizedPlan,
          amount: priceVnd,
          content: contentText,
          status: 'PENDING'
        });

        if(user){
          await supabaseAdmin.from('users').update({
            request_plan_key: normalizedPlan,
            request_amount: priceVnd,
            request_content: contentText,
            request_vip_time: new Date().toISOString(),
            vip_status: 'PENDING',
            updated_at: new Date().toISOString()
          }).eq('id', user.id);
        }
        console.log(`[PayPal] PENDING ${normalizedEmail} ${normalizedPlan} order ${order.id}`);
      }
    }catch(e){ console.warn('[PayPal] supabase', e.message); }

    // Telegram PENDING
    try{
      const timeVN = new Date().toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'});
      const msg = `🔔 <b>YÊU CẦU VIP MỚI - PAYPAL</b> 🔔\n━━━━━━━━━━━━━━\n👤 <b>Email:</b> ${normalizedEmail}\n💳 <b>Gói:</b> ${normalizedPlan.toUpperCase()}\n💰 <b>Tiền:</b> $${priceUsd} (~${new Intl.NumberFormat('vi-VN').format(priceVnd)}đ)\n📝 <b>Nội dung:</b> <code>nang cap ${emailClean} ${normalizedPlan}</code>\n🆔 <b>Order:</b> <code>${order.id}</code>\n🔗 <b>Link:</b> ${approveLink}\n⏰ <b>Giờ:</b> ${timeVN}`;
      await sendTelegram(msg);
    }catch(e){}

    return res.json({ success:true, orderId: order.id, price: priceUsd, priceVnd, approveLink });
  }catch(e){
    console.error('[PayPal Create]', e);
    return res.status(500).json({success:false, message:e.message});
  }
});

module.exports = router;
