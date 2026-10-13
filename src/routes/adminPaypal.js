// src/routes/adminPaypal.js - Backend quản lý bật/tắt PayPal trong adminDashboardModal
// Thêm vào src/index.js: app.use('/api/admin', adminPaypalRouter) hoặc gộp vào file admin hiện có

const express = require('express');
const router = express.Router();

// Bộ nhớ tạm nếu chưa có bảng Supabase
let memoryPaypalConfig = {
  enabled: true, // mặc định bật
  updated_at: new Date().toISOString(),
  updated_by: 'system'
};

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

// GET /api/admin/paypal-config - lấy cấu hình PayPal cho tab admin
router.get('/paypal-config', async (req,res)=>{
  try{
    const hasKey = !!(process.env.PAYPAL_CLIENT_ID && (process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET));
    let enabled = memoryPaypalConfig.enabled;

    // Thử lấy từ Supabase nếu có bảng admin_configs hoặc paypal_config
    try{
      const { supabaseAdmin } = require('../services/supabase');
      if(supabaseAdmin){
        // Thử bảng paypal_config
        const { data: row } = await supabaseAdmin.from('paypal_config').select('*').eq('id', 1).maybeSingle();
        if(row && typeof row.enabled !== 'undefined'){
          enabled = !!row.enabled;
          memoryPaypalConfig = { enabled, updated_at: row.updated_at, updated_by: row.updated_by };
        } else {
          // Thử bảng payment_gateway_config
          const { data: row2 } = await supabaseAdmin.from('payment_gateway_config').select('*').eq('gateway','paypal').maybeSingle();
          if(row2 && typeof row2.enabled !== 'undefined'){
            enabled = !!row2.enabled;
          }
        }
      }
    }catch(e){ console.warn('[PayPal Admin] supabase get warn', e.message); }

    return res.json({
      success: true,
      enabled: enabled,
      configured: hasKey,
      mode: process.env.PAYPAL_MODE || 'live',
      hasClientId: hasKey,
      webhookId: process.env.PAYPAL_WEBHOOK_ID || '8Y988759VB9565608',
      prices: {
        '1m': getPayPalPrice('1M'),
        '3m': getPayPalPrice('3M'),
        '6m': getPayPalPrice('6M'),
        '12m': getPayPalPrice('12M'),
        '24m': getPayPalPrice('24M')
      },
      updated_at: memoryPaypalConfig.updated_at,
      message: hasKey ? (enabled ? 'PayPal đang BẬT - khách nước ngoài thấy nút' : 'PayPal đang TẮT - khách không thấy') : 'Chưa cấu hình PAYPAL_CLIENT_ID/SECRET'
    });
  }catch(e){
    console.error('[PayPal Admin] GET error', e);
    return res.status(500).json({success:false, message:e.message});
  }
});

// POST /api/admin/paypal-config - bật/tắt PayPal
router.post('/paypal-config', async (req,res)=>{
  try{
    const { enabled } = req.body || {};
    const adminEmail = req.headers['x-user-email'] || req.body.adminEmail || 'admin';
    
    if(typeof enabled === 'undefined'){
      return res.status(400).json({success:false, message:'Thiếu enabled'});
    }

    memoryPaypalConfig = {
      enabled: !!enabled,
      updated_at: new Date().toISOString(),
      updated_by: adminEmail
    };

    // Lưu vào Supabase nếu có thể
    let savedToDb = false;
    try{
      const { supabaseAdmin } = require('../services/supabase');
      if(supabaseAdmin){
        // Thử upsert vào paypal_config
        const { error } = await supabaseAdmin.from('paypal_config').upsert({
          id: 1,
          enabled: !!enabled,
          updated_at: new Date().toISOString(),
          updated_by: adminEmail
        }, { onConflict: 'id' });
        if(!error) savedToDb = true;
        else {
          // Fallback bảng payment_gateway_config
          const { error: error2 } = await supabaseAdmin.from('payment_gateway_config').upsert({
            gateway: 'paypal',
            enabled: !!enabled,
            updated_at: new Date().toISOString(),
            updated_by: adminEmail
          }, { onConflict: 'gateway' });
          if(!error2) savedToDb = true;
        }
      }
    }catch(e){ console.warn('[PayPal Admin] supabase save warn', e.message); }

    console.log(`[PayPal Admin] ${enabled ? 'BẬT' : 'TẮT'} PayPal bởi ${adminEmail} - savedToDb:${savedToDb}`);

    return res.json({
      success:true,
      enabled: !!enabled,
      savedToDb,
      message: enabled ? '✅ Đã BẬT cổng PayPal - IP nước ngoài sẽ thấy nút PayPal' : '⏸️ Đã TẮT cổng PayPal - khách không thấy nút PayPal nữa'
    });
  }catch(e){
    console.error('[PayPal Admin] POST error', e);
    return res.status(500).json({success:false, message:e.message});
  }
});

module.exports = router;
