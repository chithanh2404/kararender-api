// src/routes/paypal.js - PayPal cho IP nước ngoài - Auto VIP giống Lemon
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
    '1M': process.env.PAYPAL_PRICE_1M || process.env.PAYPAL_PLAN_1M_USD || '9.99',
    '3M': process.env.PAYPAL_PRICE_3M || '19.99',
    '6M': process.env.PAYPAL_PRICE_6M || '34.99',
    '12M': process.env.PAYPAL_PRICE_12M || '59.99',
    '24M': process.env.PAYPAL_PRICE_24M || '99.99',
    '1Y': process.env.PAYPAL_PRICE_12M || '59.99',
    '2Y': process.env.PAYPAL_PRICE_24M || '99.99',
  };
  return map[key] || map['1M'];
}

// GET /api/payment/paypal/config - để frontend check có bật PayPal không
router.get('/config', async (req,res)=>{
  try{
    const hasKey = !!(process.env.PAYPAL_CLIENT_ID && (process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET));
    const webhookId = process.env.PAYPAL_WEBHOOK_ID || '';
    return res.json({
      success:true,
      configured: hasKey,
      mode: process.env.PAYPAL_MODE || 'live',
      clientId: process.env.PAYPAL_CLIENT_ID ? process.env.PAYPAL_CLIENT_ID.slice(0,12)+'...' : 'NOT SET',
      webhookId: webhookId ? webhookId.slice(0,12)+'...' : 'NOT SET',
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

// POST /api/payment/paypal/create-order - tạo order cho PayPal Button
router.post('/create-order', async (req,res)=>{
  try{
    const { email, planKey } = req.body || {};
    if(!email || !planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});

    const token = await getPayPalToken();
    const price = getPayPalPrice(planKey);
    const customId = `${email.toLowerCase()}|${planKey.toLowerCase()}`; // để webhook biết

    const payload = {
      intent:'CAPTURE',
      purchase_units:[{
        amount:{ currency_code:'USD', value: price.toString() },
        custom_id: customId,
        description: `KaraRender VIP ${planKey.toUpperCase()} - ${email}`,
        soft_descriptor: 'KARARENDER VIP'
      }],
      application_context:{
        brand_name:'KaraRender',
        landing_page:'BILLING',
        user_action:'PAY_NOW',
        shipping_preference:'NO_SHIPPING'
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

    // Lưu pending vào supabase để tracking giống bank
    try{
      const { supabaseAdmin } = require('../services/supabase');
      if(supabaseAdmin){
        await supabaseAdmin.from('vip_requests').insert({
          email: email.toLowerCase(),
          plan_key: planKey.toLowerCase(),
          amount: parseFloat(price),
          content: `paypal pending ${planKey} order:${order.id} $${price} ${email}`,
          status:'PENDING',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    }catch(e){ console.warn('[PayPal Create] vip_requests insert warn', e.message); }

    return res.json({
      success:true,
      orderId: order.id,
      price,
      currency:'USD',
      approveLink: (order.links||[]).find(l=>l.rel==='approve')?.href || null
    });
  }catch(e){
    console.error('[PayPal Create] Exception', e);
    return res.status(500).json({success:false, message:e.message});
  }
});

// POST /api/payment/paypal/capture/:orderId - capture ngay sau khi user approve (để UX nhanh hơn webhook)
router.post('/capture/:orderId', async (req,res)=>{
  try{
    const { orderId } = req.params;
    const token = await getPayPalToken();
    const capRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${token}`,
        'Content-Type':'application/json'
      }
    });
    const cap = await capRes.json();
    // Nếu capture thành công thì webhook cũng sẽ tới, nhưng ta có thể duyệt luôn ở đây cho nhanh
    if(cap.status === 'COMPLETED' || cap.purchase_units){
      // Gọi luôn hàm duyệt VIP dùng chung (copy logic từ webhook)
      return res.json({success:true, captured:true, data:cap});
    }
    return res.json({success:true, captured:false, data:cap});
  }catch(e){
    return res.status(500).json({success:false, message:e.message});
  }
});

module.exports = router;
