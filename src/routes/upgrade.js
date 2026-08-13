
// src/routes/upgrade.js - V8 FINAL - FIX sb_secret keys + cache + payment_configs + vip_requests
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// ĐỌC ENV TRỰC TIẾP, KHÔNG QUA config - FIX sb_secret keys mới
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_URL_NEW || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

console.log('[upgrade.js V8] ENV check - URL:', !!SUPABASE_URL, 'SERVICE_KEY:', !!SUPABASE_SERVICE_KEY, 'len:', SUPABASE_SERVICE_KEY?.length, 'ANON:', !!SUPABASE_ANON_KEY);
if(SUPABASE_SERVICE_KEY) console.log('[upgrade.js V8] SERVICE_KEY prefix:', SUPABASE_SERVICE_KEY.substring(0, 15));

let supabaseAdmin = null;
try {
  if(SUPABASE_URL && SUPABASE_SERVICE_KEY){
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log('[upgrade.js V8] supabaseAdmin created SUCCESS');
  } else {
    console.error('[upgrade.js V8] Missing SUPABASE_URL or SERVICE_KEY');
  }
} catch(e){
  console.error('[upgrade.js V8] createClient failed', e.message);
}

const DEFAULT_PLANS = [
  { key: '1m', label: 'Gói 1 tháng', months: 1, price: 99000, enabled: true, is_custom: false, sort_order: 1 },
  { key: '3m', label: 'Gói 3 tháng', months: 3, price: 199000, enabled: true, is_custom: false, sort_order: 2 },
  { key: '6m', label: 'Gói 6 tháng', months: 6, price: 299000, enabled: true, is_custom: false, sort_order: 3 },
  { key: '12m', label: 'Gói 1 năm', months: 12, price: 499000, enabled: true, is_custom: false, sort_order: 4 },
];

let cache=null, cacheTime=0, tabCache=true, TTL=60*1000;

async function getPlans(includeDisabled=false){
  if(!supabaseAdmin) {
    console.warn('[getPlans] supabaseAdmin NULL, returning DEFAULT');
    return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled:true};
  }
  let tabEnabled=true;
  try{
    const {data, error}=await supabaseAdmin.from('app_settings').select('value').eq('id','upgrade_tab_enabled').single();
    if(error) console.warn('[getPlans] app_settings error', error.message);
    else if(data?.value?.enabled!==undefined) tabEnabled=data.value.enabled;
    console.log('[getPlans] tabEnabled from DB:', tabEnabled);
  }catch(e){ console.warn('[getPlans] tabEnabled fetch error', e.message); }
  try{
    let q=supabaseAdmin.from('upgrade_plans').select('*').order('sort_order');
    if(!includeDisabled) q=q.eq('enabled',true);
    const {data, error}=await q;
    if(error) {
      console.error('[getPlans] upgrade_plans error', error.message);
      return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled};
    }
    if(!data||!data.length) {
      console.warn('[getPlans] No plans in DB, using DEFAULT');
      return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled};
    }
    console.log('[getPlans] Found', data.length, 'plans');
    return {plans:data, tabEnabled};
  }catch(e){
    console.error('[getPlans] exception', e.message);
    return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled};
  }
}

router.get('/upgrade-plans', async (req,res)=>{
  try{
    // Luôn đọc tabEnabled tươi
    let freshTab = null;
    if(supabaseAdmin){
      try{
        const {data}=await supabaseAdmin.from('app_settings').select('value').eq('id','upgrade_tab_enabled').single();
        if(data?.value?.enabled!==undefined) freshTab = data.value.enabled;
      }catch{}
    }
    const now=Date.now();
    if(cache && (now-cacheTime)<TTL){
      const hasEnabled=cache.some(p=>p.enabled);
      const effectiveTab = freshTab!==null ? freshTab : tabCache;
      console.log('[upgrade-plans] CACHE hit, freshTab:', freshTab, 'effective:', effectiveTab);
      return res.json({success:true, plans:cache.filter(p=>p.enabled), tabEnabled: effectiveTab && hasEnabled, _cache:true});
    }
    const result=await getPlans(false);
    cache=result.plans; tabCache=result.tabEnabled; cacheTime=now;
    if(freshTab!==null) tabCache = freshTab;
    const hasEnabled=cache.some(p=>p.enabled);
    console.log('[upgrade-plans] FRESH, tabEnabled:', tabCache);
    res.json({success:true, plans:cache, tabEnabled:tabCache&&hasEnabled, _cache:false});
  }catch(e){ 
    console.error('[upgrade-plans] error', e.message);
    res.json({success:true, plans:DEFAULT_PLANS, tabEnabled:true}); 
  }
});

router.get('/admin/upgrade-plans', async (req,res)=>{
  try{
    const result=await getPlans(true);
    res.json({success:true, plans:result.plans, tabEnabled:result.tabEnabled, _admin:true, supabase:!!supabaseAdmin});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

router.post('/admin/upgrade-plans', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const {plans, tabEnabled, deletedKeys}=req.body;
    if(!Array.isArray(plans)) return res.status(400).json({success:false, message:'plans must be array'});
    for(let p of plans){
      const {error}=await supabaseAdmin.from('upgrade_plans').upsert({
        key:p.key, label:p.label, months:parseInt(p.months)||1, price:parseInt(p.price)||0,
        enabled:!!p.enabled, is_custom:!!p.is_custom, sort_order:parseInt(p.sort_order)||0,
      },{onConflict:'key'});
      if(error) console.error('[admin/upgrade-plans] upsert error', error.message);
    }
    if(Array.isArray(deletedKeys)){
      for(let k of deletedKeys) {
        const {error}=await supabaseAdmin.from('upgrade_plans').delete().eq('key',k).eq('is_custom',true);
        if(error) console.error('[admin/upgrade-plans] delete error', error.message);
      }
    }
    if(typeof tabEnabled==='boolean'){
      const {error}=await supabaseAdmin.from('app_settings').upsert({id:'upgrade_tab_enabled', value:{enabled:tabEnabled}},{onConflict:'id'});
      if(error) console.error('[admin/upgrade-plans] tab save error', error.message);
      else console.log('[admin/upgrade-plans] tabEnabled saved:', tabEnabled);
    }
    cache=null; cacheTime=0;
    console.log('[admin/upgrade-plans] Saved, cache cleared');
    res.json({success:true, tabEnabled});
  }catch(e){ console.error('[admin/upgrade-plans] fatal', e.message); res.status(500).json({success:false, message:e.message}); }
});

router.get('/admin/pending-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) {
      console.error('[pending-vip] supabaseAdmin NULL');
      return res.status(500).json({success:false, message:'supabaseAdmin NULL', users:[], count:0});
    }
    const {data, error}=await supabaseAdmin.from('vip_requests').select('*').eq('status','PENDING').order('created_at',{ascending:false}).limit(50);
    if(error){
      console.error('[pending-vip] error', error.message);
      return res.json({success:true, users:[], count:0, message:error.message, _error:true});
    }
    const mapped=(data||[]).map(u=>({
      id:u.id, email:u.email, fullName:u.full_name||u.email,
      requestVipTime:u.created_at, planKey:u.plan_key,
      amount:u.amount, content:u.content, created_at:u.created_at
    }));
    console.log(`[pending-vip] Found ${mapped.length} pending`);
    res.json({success:true, users:mapped, count:mapped.length});
  }catch(e){
    console.error('[pending-vip] fatal', e.message);
    res.status(500).json({success:false, message:e.message, users:[], count:0});
  }
});

router.post('/request-vip', async (req,res)=>{
  try{
    const {email, planKey, content}=req.body;
    console.log('[request-vip] Incoming', {email, planKey, content});
    if(!email||!planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});
    
    const plansRes=await getPlans(false);
    const plan=plansRes.plans.find(p=>p.key===planKey)||{price:0, label:planKey, months:1};

    if(!supabaseAdmin) {
      console.error('[request-vip] supabaseAdmin NULL - cannot insert');
      return res.status(500).json({success:false, message:'Backend chưa cấu hình Supabase SERVICE_ROLE_KEY - kiểm tra ENV'});
    }

    let fullName=email;
    try{
      const {data:user}=await supabaseAdmin.from('users').select('full_name').eq('email',email.toLowerCase()).single();
      if(user?.full_name) fullName=user.full_name;
    }catch{}

    console.log('[request-vip] Inserting vip_requests', {email: email.toLowerCase(), plan_key: planKey});
    const {data:inserted, error:insertError}=await supabaseAdmin.from('vip_requests').insert({
      email:email.toLowerCase(),
      full_name:fullName,
      plan_key:planKey,
      amount:plan.price,
      content:content||`nang cap ${email} ${planKey}`,
      status:'PENDING'
    }).select().single();

    if(insertError){
      console.error('[request-vip] insert vip_requests error', insertError.message, insertError.code);
    } else {
      console.log('[request-vip] Inserted vip_requests id:', inserted?.id);
    }

    try{
      const payload = {
        vip_status:'PENDING',
        request_vip_time:new Date().toISOString(),
        request_plan_key:planKey,
        request_amount: plan.price,
        request_content: content||`nang cap ${email} ${planKey}`,
        updated_at:new Date().toISOString()
      };
      console.log('[request-vip] Updating users', payload);
      const { error: userErr } = await supabaseAdmin.from('users').update(payload).eq('email',email.toLowerCase());
      if(userErr) console.error('[request-vip] users update error', userErr.message);
      else console.log('[request-vip] users updated OK');
    }catch(e){
      console.error('[request-vip] users update exception', e.message);
    }

    try{
      const {sendTelegram}=require('../services/telegram');
      if(sendTelegram){
        await sendTelegram(`🔔 Yêu cầu VIP mới\n👤 ${email} (${fullName})\n📦 ${plan.label} - ${plan.months} tháng - ${plan.price.toLocaleString('vi-VN')}đ`);
      }
    }catch(e){ console.warn('[telegram]', e.message); }

    res.json({success:true, message:'Đã gửi yêu cầu, chờ admin duyệt', requestId:inserted?.id, _debug: insertError ? insertError.message : 'ok'});
  }catch(e){
    console.error('[request-vip] fatal', e.message, e.stack);
    res.status(500).json({success:false, message:e.message});
  }
});

router.post('/admin/approve-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const {email, requestId, months}=req.body;
    if(!email && !requestId) return res.status(400).json({success:false, message:'Thiếu email hoặc requestId'});
    let targetEmail=email;
    let monthsToAdd=parseInt(months)||0;
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
    const {error:userError}=await supabaseAdmin.from('users').update({
      is_vip:true, vip_status:'APPROVED', expired_date:expireDate.toISOString(), updated_at:new Date().toISOString()
    }).eq('email',targetEmail.toLowerCase());
    if(userError) console.warn('[approve-vip] user update error', userError.message);
    if(requestId){
      await supabaseAdmin.from('vip_requests').update({status:'APPROVED', updated_at:new Date().toISOString()}).eq('id',requestId);
    }else{
      await supabaseAdmin.from('vip_requests').update({status:'APPROVED', updated_at:new Date().toISOString()}).eq('email',targetEmail.toLowerCase()).eq('status','PENDING');
    }
    console.log(`[approve-vip] Approved ${targetEmail} for ${monthsToAdd} months`);
    res.json({success:true, message:`Đã duyệt VIP ${monthsToAdd} tháng cho ${targetEmail}`, expiredDate:expireDate.toISOString()});
  }catch(e){
    console.error('[approve-vip]', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

router.post('/admin/reject-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
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

router.get('/payment-config', async (req, res) => {
  try {
    console.log('[payment-config] GET public, supabaseAdmin:', !!supabaseAdmin);
    if (!supabaseAdmin) {
      console.warn('[payment-config] supabaseAdmin NULL, returning default');
      return res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' }, _mock:true });
    }
    const { data, error } = await supabaseAdmin.from('payment_configs').select('*').eq('id','default').single();
    if(error){
      console.error('[payment-config] fetch error', error.message);
      return res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' }, _error:error.message });
    }
    if (!data) {
      console.warn('[payment-config] No data, returning default');
      return res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
    }
    console.log('[payment-config] Found config', data.bank_id);
    res.json({ success: true, config: data });
  } catch (e) {
    console.error('[payment-config] fatal', e.message);
    res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' }, _exception:e.message });
  }
});

router.get('/admin/payment-config', async (req, res) => {
  try {
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { data, error } = await supabaseAdmin.from('payment_configs').select('*').eq('id','default').single();
    if(error) console.error('[admin/payment-config] error', error.message);
    res.json({ success: true, config: data || { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/admin/payment-config', async (req, res) => {
  try {
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
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
    console.log(`[payment-config] Updated to ${payload.bank_id} - ${payload.account_number}`);
    res.json({ success: true, config: payload });
  } catch (e) {
    console.error('[payment-config] save error', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports=router;
