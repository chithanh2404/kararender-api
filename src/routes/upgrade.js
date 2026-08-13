// src/routes/upgrade.js - V13 FINAL MERGED V11 + TRIAL 3 LẦN CHUẨN
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_URL_NEW || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

console.log('[upgrade.js V13] ENV check - URL:', !!SUPABASE_URL, 'SERVICE_KEY:', !!SUPABASE_SERVICE_KEY, 'len:', SUPABASE_SERVICE_KEY?.length, 'ANON:', !!SUPABASE_ANON_KEY);
if(SUPABASE_SERVICE_KEY) console.log('[upgrade.js V13] SERVICE_KEY prefix:', SUPABASE_SERVICE_KEY.substring(0, 15));

let supabaseAdmin = null;
try {
  if(SUPABASE_URL && SUPABASE_SERVICE_KEY){
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    console.log('[upgrade.js V13] supabaseAdmin created SUCCESS');
  } else {
    console.error('[upgrade.js V13] Missing SUPABASE_URL or SERVICE_KEY');
  }
} catch(e){
  console.error('[upgrade.js V13] createClient failed', e.message);
}

const DEFAULT_PLANS = [
  { key: '1m', label: 'Gói 1 tháng', months: 1, price: 99000, enabled: true, is_custom: false, sort_order: 1 },
  { key: '3m', label: 'Gói 3 tháng', months: 3, price: 199000, enabled: true, is_custom: false, sort_order: 2 },
  { key: '6m', label: 'Gói 6 tháng', months: 6, price: 299000, enabled: true, is_custom: false, sort_order: 3 },
  { key: '12m', label: 'Gói 1 năm', months: 12, price: 499000, enabled: true, is_custom: false, sort_order: 4 },
];

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
    return {plans:data, tabEnabled};
  }catch(e){
    console.error('[getPlans] exception', e.message);
    return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled};
  }
}

router.get('/upgrade-plans', async (req,res)=>{
  try{
    const result=await getPlans(false);
    res.json({success:true, plans:result.plans, tabEnabled:result.tabEnabled, _cache:false, _v13:true, _count:result.plans.length});
  }catch(e){ res.json({success:true, plans:DEFAULT_PLANS, tabEnabled:true}); }
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
    res.json({success:true, tabEnabled});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

// ===== TRIAL 3 LẦN - LOGIC CHUẨN V13 =====
const TRIAL_LIMIT = 3;

router.get('/trial-status', async (req,res)=>{
  try{
    const email = (req.query.email || req.headers['x-user-email'] || '').toLowerCase().trim();
    if(!email){
      return res.json({success:true, isVip:false, trialUsed:0, trialLimit:TRIAL_LIMIT, tabEnabled:true, canFull:true, limited:false, remaining:TRIAL_LIMIT});
    }
    if(!supabaseAdmin){
      return res.json({success:true, isVip:false, trialUsed:0, trialLimit:TRIAL_LIMIT, tabEnabled:true, canFull:true, limited:false, remaining:TRIAL_LIMIT, _mock:true});
    }
    let isVip=false, trialUsed=0;
    try{
      const {data:user, error} = await supabaseAdmin.from('users').select('is_vip, trial_used').eq('email', email).single();
      if(!error && user){ isVip=!!user.is_vip; trialUsed=user.trial_used||0; }
    }catch(e){ console.warn('[trial-status] user fetch error', e.message); }
    
    let tabEnabled=true;
    try{
      const {data:tab} = await supabaseAdmin.from('app_settings').select('value').eq('id','upgrade_tab_enabled').single();
      if(tab?.value?.enabled!==undefined) tabEnabled=!!tab.value.enabled;
    }catch(e){ console.warn('[trial-status] tab fetch error', e.message); }
    
    const canFull = isVip || !tabEnabled || trialUsed < TRIAL_LIMIT;
    const limited = !isVip && tabEnabled && trialUsed >= TRIAL_LIMIT;
    
    console.log(`[trial-status] ${email} vip:${isVip} used:${trialUsed}/${TRIAL_LIMIT} tab:${tabEnabled} canFull:${canFull} limited:${limited}`);
    res.json({
      success:true, 
      isVip, 
      trialUsed, 
      trialLimit:TRIAL_LIMIT, 
      tabEnabled, 
      canFull, 
      limited, 
      remaining: Math.max(0, TRIAL_LIMIT - trialUsed),
      email
    });
  }catch(e){
    console.error('[trial-status] fatal', e.message);
    res.json({success:true, isVip:false, trialUsed:0, trialLimit:TRIAL_LIMIT, tabEnabled:true, canFull:true, limited:false, remaining:TRIAL_LIMIT, _error:e.message});
  }
});

router.post('/trial-consume', async (req,res)=>{
  try{
    const email = (req.body.email || req.headers['x-user-email'] || '').toLowerCase().trim();
    if(!email) return res.status(400).json({success:false, message:'Thiếu email'});
    if(!supabaseAdmin) return res.json({success:true, _mock:true});
    
    const {data:user, error:fetchErr} = await supabaseAdmin.from('users').select('is_vip, trial_used').eq('email', email).single();
    if(fetchErr) console.warn('[trial-consume] fetch user error', fetchErr.message);
    
    if(user?.is_vip){
      return res.json({success:true, isVip:true, trialUsed:user.trial_used||0, remaining:TRIAL_LIMIT, limited:false});
    }
    
    const newCount = (user?.trial_used || 0) + 1;
    const {error:updateErr} = await supabaseAdmin.from('users').update({trial_used:newCount, updated_at:new Date().toISOString()}).eq('email', email);
    if(updateErr) console.error('[trial-consume] update error', updateErr.message);
    else console.log(`[trial-consume] ${email} -> ${newCount}/${TRIAL_LIMIT}`);
    
    res.json({
      success:true, 
      trialUsed:newCount, 
      remaining: Math.max(0, TRIAL_LIMIT - newCount), 
      limited: newCount >= TRIAL_LIMIT,
      trialLimit:TRIAL_LIMIT
    });
  }catch(e){
    console.error('[trial-consume] fatal', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

// ===== CÁC ROUTE CŨ GIỮ NGUYÊN =====
router.get('/admin/pending-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL', users:[], count:0});
    const {data, error}=await supabaseAdmin.from('vip_requests').select('*').eq('status','PENDING').order('created_at',{ascending:false}).limit(50);
    if(error) return res.json({success:true, users:[], count:0, message:error.message, _error:true});
    const mapped=(data||[]).map(u=>({ id:u.id, email:u.email, fullName:u.full_name||u.email, requestVipTime:u.created_at, planKey:u.plan_key, amount:u.amount, content:u.content, created_at:u.created_at }));
    res.json({success:true, users:mapped, count:mapped.length});
  }catch(e){ res.status(500).json({success:false, message:e.message, users:[], count:0}); }
});

router.post('/request-vip', async (req,res)=>{
  try{
    const {email, planKey, content}=req.body;
    if(!email||!planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});
    const plansRes=await getPlans(false);
    const plan=plansRes.plans.find(p=>p.key===planKey)||{price:0, label:planKey, months:1};
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'Backend chưa cấu hình Supabase SERVICE_ROLE_KEY'});
    let fullName=email;
    try{ const {data:user}=await supabaseAdmin.from('users').select('full_name').eq('email',email.toLowerCase()).single(); if(user?.full_name) fullName=user.full_name; }catch{}
    const {data:inserted, error:insertError}=await supabaseAdmin.from('vip_requests').insert({ email:email.toLowerCase(), full_name:fullName, plan_key:planKey, amount:plan.price, content:content||`nang cap ${email} ${planKey}`, status:'PENDING' }).select().single();
    if(insertError) console.error('[request-vip] insert error', insertError.message);
    try{
      await supabaseAdmin.from('users').update({ vip_status:'PENDING', request_vip_time:new Date().toISOString(), request_plan_key:planKey, request_amount: plan.price, request_content: content||`nang cap ${email} ${planKey}`, updated_at:new Date().toISOString() }).eq('email',email.toLowerCase());
    }catch(e){ console.error('[request-vip] users update exception', e.message); }
    try{ const {sendTelegram}=require('../services/telegram'); if(sendTelegram) await sendTelegram(`🔔 Yêu cầu VIP mới\n👤 ${email} (${fullName})\n📦 ${plan.label} - ${plan.months} tháng - ${plan.price.toLocaleString('vi-VN')}đ`); }catch(e){ console.warn('[telegram]', e.message); }
    res.json({success:true, message:'Đã gửi yêu cầu, chờ admin duyệt', requestId:inserted?.id, _debug: insertError ? insertError.message : 'ok'});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

router.post('/admin/approve-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const {email, requestId, months}=req.body;
    if(!email && !requestId) return res.status(400).json({success:false, message:'Thiếu email hoặc requestId'});
    let targetEmail=email; let monthsToAdd=parseInt(months)||0;
    if(requestId){
      const {data:reqData}=await supabaseAdmin.from('vip_requests').select('*').eq('id',requestId).single();
      if(reqData){ targetEmail=reqData.email; if(!monthsToAdd){ const plans=await getPlans(true); const p=plans.plans.find(x=>x.key===reqData.plan_key); if(p) monthsToAdd=p.months; } }
    }
    if(!monthsToAdd) monthsToAdd=12;
    const expireDate=new Date(); expireDate.setMonth(expireDate.getMonth()+monthsToAdd);
    await supabaseAdmin.from('users').update({ is_vip:true, vip_status:'APPROVED', expired_date:expireDate.toISOString(), updated_at:new Date().toISOString() }).eq('email',targetEmail.toLowerCase());
    if(requestId) await supabaseAdmin.from('vip_requests').update({status:'APPROVED', updated_at:new Date().toISOString()}).eq('id',requestId);
    else await supabaseAdmin.from('vip_requests').update({status:'APPROVED', updated_at:new Date().toISOString()}).eq('email',targetEmail.toLowerCase()).eq('status','PENDING');
    res.json({success:true, message:`Đã duyệt VIP ${monthsToAdd} tháng cho ${targetEmail}`, expiredDate:expireDate.toISOString()});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

router.post('/admin/reject-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const {requestId, email}=req.body;
    if(requestId) await supabaseAdmin.from('vip_requests').update({status:'REJECTED', updated_at:new Date().toISOString()}).eq('id',requestId);
    else if(email) await supabaseAdmin.from('vip_requests').update({status:'REJECTED'}).eq('email',email.toLowerCase()).eq('status','PENDING');
    await supabaseAdmin.from('users').update({vip_status:'REJECTED', updated_at:new Date().toISOString()}).eq('email',(email||'').toLowerCase());
    res.json({success:true});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

router.get('/payment-config', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' }, _mock:true });
    const { data, error } = await supabaseAdmin.from('payment_configs').select('*').eq('id','default').single();
    if(error||!data) return res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
    res.json({ success: true, config: data });
  } catch (e) { res.json({ success: true, config: { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } }); }
});

router.get('/admin/payment-config', async (req, res) => {
  try {
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { data } = await supabaseAdmin.from('payment_configs').select('*').eq('id','default').single();
    res.json({ success: true, config: data || { bank_id: 'HDB', account_number: '0354563516', account_name: 'LOI NHAC SONG PRO' } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/admin/payment-config', async (req, res) => {
  try {
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { bank_id, account_number, account_name } = req.body;
    if (!bank_id || !account_number || !account_name) return res.status(400).json({ success: false, message: 'Thiếu thông tin ngân hàng' });
    const payload = { id: 'default', bank_id: bank_id.trim().toUpperCase(), account_number: account_number.trim(), account_name: account_name.trim(), updated_at: new Date().toISOString() };
    await supabaseAdmin.from('payment_configs').upsert(payload, { onConflict: 'id' });
    res.json({ success: true, config: payload });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports=router;
