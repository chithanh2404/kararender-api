// src/routes/upgrade.js - FINAL V5 - DÙNG BẢNG vip_requests RIÊNG - FIX 50 USER ẢO

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../services/supabase');

const DEFAULT_PLANS = [
  { key: '1m', label: 'Gói 1 tháng', months: 1, price: 99000, enabled: true, is_custom: false, sort_order: 1 },
  { key: '3m', label: 'Gói 3 tháng', months: 3, price: 199000, enabled: true, is_custom: false, sort_order: 2 },
  { key: '6m', label: 'Gói 6 tháng', months: 6, price: 299000, enabled: true, is_custom: false, sort_order: 3 },
  { key: '12m', label: 'Gói 1 năm', months: 12, price: 499000, enabled: true, is_custom: false, sort_order: 4 },
];

let cache=null, cacheTime=0, tabCache=true, TTL=60*1000;

async function getPlans(includeDisabled=false){
  if(!supabaseAdmin) return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled:true};
  let tabEnabled=true;
  try{
    const {data}=await supabaseAdmin.from('app_settings').select('value').eq('id','upgrade_tab_enabled').single();
    if(data?.value?.enabled!==undefined) tabEnabled=data.value.enabled;
  }catch{}
  let q=supabaseAdmin.from('upgrade_plans').select('*').order('sort_order');
  if(!includeDisabled) q=q.eq('enabled',true);
  const {data}=await q;
  if(!data||!data.length) return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled};
  return {plans:data, tabEnabled};
}

router.get('/upgrade-plans', async (req,res)=>{
  try{
    const now=Date.now();
    if(cache && (now-cacheTime)<TTL){
      const hasEnabled=cache.some(p=>p.enabled);
      return res.json({success:true, plans:cache.filter(p=>p.enabled), tabEnabled:tabCache&&hasEnabled});
    }
    const result=await getPlans(false);
    cache=result.plans; tabCache=result.tabEnabled; cacheTime=now;
    const hasEnabled=cache.some(p=>p.enabled);
    res.json({success:true, plans:cache, tabEnabled:tabCache&&hasEnabled});
  }catch{ res.json({success:true, plans:DEFAULT_PLANS, tabEnabled:true}); }
});

router.get('/admin/upgrade-plans', async (req,res)=>{
  try{
    const result=await getPlans(true);
    res.json({success:true, plans:result.plans, tabEnabled:result.tabEnabled});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

router.post('/admin/upgrade-plans', async (req,res)=>{
  try{
    const {plans, tabEnabled, deletedKeys}=req.body;
    if(!Array.isArray(plans)) return res.status(400).json({success:false, message:'plans must be array'});
    for(let p of plans){
      await supabaseAdmin.from('upgrade_plans').upsert({
        key:p.key, label:p.label, months:parseInt(p.months)||1, price:parseInt(p.price)||0,
        enabled:!!p.enabled, is_custom:!!p.is_custom, sort_order:parseInt(p.sort_order)||0,
      },{onConflict:'key'});
    }
    if(Array.isArray(deletedKeys)){
      for(let k of deletedKeys) await supabaseAdmin.from('upgrade_plans').delete().eq('key',k).eq('is_custom',true);
    }
    if(typeof tabEnabled==='boolean'){
      await supabaseAdmin.from('app_settings').upsert({id:'upgrade_tab_enabled', value:{enabled:tabEnabled}},{onConflict:'id'});
    }
    cache=null;
    res.json({success:true});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

// LOGIC MỚI: DÙNG BẢNG vip_requests RIÊNG - CHỈ HIỆN KHI USER BẤM THANH TOÁN
router.get('/admin/pending-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.json({success:true, users:[], count:0});

    // Lấy từ bảng vip_requests status = PENDING
    const {data, error}=await supabaseAdmin.from('vip_requests').select('*').eq('status','PENDING').order('created_at',{ascending:false}).limit(50);
    
    if(error){
      console.error('[pending-vip] error', error.message);
      // Nếu bảng chưa tồn tại, trả rỗng
      return res.json({success:true, users:[], count:0, message:'vip_requests table not found, run SQL migration'});
    }

    const mapped=(data||[]).map(u=>({
      id:u.id,
      email:u.email,
      fullName:u.full_name||u.email,
      requestVipTime:u.created_at,
      planKey:u.plan_key,
      amount:u.amount,
      content:u.content,
      created_at:u.created_at
    }));

    console.log(`[pending-vip] Found ${mapped.length} pending from vip_requests table`);
    res.json({success:true, users:mapped, count:mapped.length});
  }catch(e){
    console.error('[pending-vip] fatal', e.message);
    res.json({success:true, users:[], count:0, message:e.message});
  }
});

// USER BẤM "TÔI ĐÃ THANH TOÁN"
router.post('/request-vip', async (req,res)=>{
  try{
    const {email, planKey, content}=req.body;
    if(!email||!planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});
    
    const plansRes=await getPlans(false);
    const plan=plansRes.plans.find(p=>p.key===planKey)||{price:0, label:planKey, months:1};

    if(!supabaseAdmin) return res.json({success:true, message:'Mock success'});

    // Lấy full_name từ bảng users
    let fullName=email;
    try{
      const {data:user}=await supabaseAdmin.from('users').select('full_name').eq('email',email.toLowerCase()).single();
      if(user?.full_name) fullName=user.full_name;
    }catch{}

    // Insert vào vip_requests
    const {data:inserted, error:insertError}=await supabaseAdmin.from('vip_requests').insert({
      email:email.toLowerCase(),
      full_name:fullName,
      plan_key:planKey,
      amount:plan.price,
      content:content||`nang cap ${email} ${planKey}`,
      status:'PENDING'
    }).select().single();

    if(insertError){
      console.error('[request-vip] insert error', insertError.message);
      return res.status(500).json({success:false, message:insertError.message});
    }

    // Cập nhật users table để đánh dấu đang chờ (optional)
    try{
      await supabaseAdmin.from('users').update({
        vip_status:'PENDING',
        request_vip_time:new Date().toISOString(),
        request_plan_key:planKey,
        updated_at:new Date().toISOString()
      }).eq('email',email.toLowerCase());
    }catch{}

    // Gửi Telegram
    try{
      const {sendTelegram}=require('../services/telegram');
      if(sendTelegram){
        await sendTelegram(`🔔 <b>Yêu cầu VIP mới</b>\n👤 ${email} (${fullName})\n📦 ${plan.label} - ${plan.months} tháng - ${plan.price.toLocaleString('vi-VN')}đ\n📝 ${content||''}\n⏰ ${new Date().toLocaleString('vi-VN')}\n\nDuyệt tại: https://kararender.com`);
      }
    }catch(e){ console.warn('[telegram]', e.message); }

    res.json({success:true, message:'Đã gửi yêu cầu', requestId:inserted?.id});
  }catch(e){
    console.error('[request-vip]', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

// ADMIN DUYỆT
router.post('/admin/approve-vip', async (req,res)=>{
  try{
    const {email, requestId, months}=req.body;
    if(!email && !requestId) return res.status(400).json({success:false, message:'Thiếu email hoặc requestId'});

    let targetEmail=email;
    let monthsToAdd=parseInt(months)||0;

    // Nếu có requestId, lấy thông tin từ vip_requests
    if(requestId){
      const {data:reqData}=await supabaseAdmin.from('vip_requests').select('*').eq('id',requestId).single();
      if(reqData){
        targetEmail=reqData.email;
        if(!monthsToAdd){
          const plans=await getPlans(true);
          const p=plans.plans.find(x=>x.key===reqData.plan_key);
          if(p) monthsToAdd=p.months;
        }
      }
    }

    if(!monthsToAdd) monthsToAdd=12;
    if(!targetEmail) return res.status(400).json({success:false, message:'Không tìm thấy email'});

    const expireDate=new Date();
    expireDate.setMonth(expireDate.getMonth()+monthsToAdd);

    // Update users: set is_vip = true, expired_date
    const {error:userError}=await supabaseAdmin.from('users').update({
      is_vip:true,
      vip_status:'APPROVED',
      expired_date:expireDate.toISOString(),
      updated_at:new Date().toISOString()
    }).eq('email',targetEmail.toLowerCase());

    if(userError) console.warn('[approve-vip] user update error', userError.message);

    // Update vip_requests status = APPROVED
    if(requestId){
      await supabaseAdmin.from('vip_requests').update({status:'APPROVED', updated_at:new Date().toISOString()}).eq('id',requestId);
    }else{
      await supabaseAdmin.from('vip_requests').update({status:'APPROVED', updated_at:new Date().toISOString()}).eq('email',targetEmail.toLowerCase()).eq('status','PENDING');
    }

    console.log(`[approve-vip] Approved ${targetEmail} for ${monthsToAdd} months until ${expireDate.toISOString()}`);
    res.json({success:true, message:`Đã duyệt VIP ${monthsToAdd} tháng cho ${targetEmail}`, expiredDate:expireDate.toISOString()});
  }catch(e){
    console.error('[approve-vip]', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

// ADMIN TỪ CHỐI
router.post('/admin/reject-vip', async (req,res)=>{
  try{
    const {requestId, email}=req.body;
    if(requestId){
      await supabaseAdmin.from('vip_requests').update({status:'REJECTED', updated_at:new Date().toISOString()}).eq('id',requestId);
    }else if(email){
      await supabaseAdmin.from('vip_requests').update({status:'REJECTED'}).eq('email',email.toLowerCase()).eq('status','PENDING');
    }
    await supabaseAdmin.from('users').update({vip_status:'REJECTED', updated_at:new Date().toISOString()}).eq('email',(email||'').toLowerCase());
    res.json({success:true});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

// THÊM VÀO src/routes/upgrade.js - PHẦN PAYMENT CONFIG

// Lấy cấu hình ngân hàng (public - user dùng để tạo QR)
router.get('/payment-config', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
    }
    const { data } = await supabaseAdmin.from('payment_configs').select('*').eq('id','default').single();
    if (!data) {
      return res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
    }
    res.json({ success: true, config: data });
  } catch (e) {
    res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
  }
});

// Admin lấy cấu hình
router.get('/admin/payment-config', async (req, res) => {
  try {
    const { data } = await supabaseAdmin.from('payment_configs').select('*').eq('id','default').single();
    res.json({ success: true, config: data || { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Admin lưu cấu hình
router.post('/admin/payment-config', async (req, res) => {
  try {
    const { bank_id, account_number, account_name } = req.body;
    if (!bank_id || !account_number || !account_name) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin ngân hàng' });
    }
    const payload = {
      id: 'default',
      bank_id: bank_id.trim().toUpperCase(),
      account_number: account_number.trim(),
      account_name: account_name.trim(),
      updated_at: new Date().toISOString()
    };
    const { error } = await supabaseAdmin.from('payment_configs').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    console.log(`[payment-config] Updated to ${payload.bank_id} - ${payload.account_number} - ${payload.account_name}`);
    res.json({ success: true, config: payload });
  } catch (e) {
    console.error('[payment-config] save error', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});


module.exports=router;
