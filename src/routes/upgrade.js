// src/routes/upgrade.js - V11 FULL 341 LINES - NO CACHE - Giữ nguyên logic V8, chỉ xóa cache
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// ĐỌC ENV TRỰC TIẾP, KHÔNG QUA config - FIX sb_secret keys mới
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_URL_NEW || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

console.log('[upgrade.js V11] ENV check - URL:', !!SUPABASE_URL, 'SERVICE_KEY:', !!SUPABASE_SERVICE_KEY, 'len:', SUPABASE_SERVICE_KEY?.length, 'ANON:', !!SUPABASE_ANON_KEY);
if(SUPABASE_SERVICE_KEY) console.log('[upgrade.js V11] SERVICE_KEY prefix:', SUPABASE_SERVICE_KEY.substring(0, 15));

let supabaseAdmin = null;
try {
  if(SUPABASE_URL && SUPABASE_SERVICE_KEY){
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log('[upgrade.js V11] supabaseAdmin created SUCCESS');
  } else {
    console.error('[upgrade.js V11] Missing SUPABASE_URL or SERVICE_KEY');
  }
} catch(e){
  console.error('[upgrade.js V11] createClient failed', e.message);
}

// FIX TELEGRAM - gửi trực tiếp, không phụ thuộc services/telegram
async function sendTelegramDirect(message){
  try{
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if(!token || !chatId){
      console.warn('[Telegram Direct] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return false;
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode:'HTML' })
    });
    const data = await res.json().catch(()=>({}));
    if(data.ok) console.log('[Telegram Direct] Sent OK');
    else console.warn('[Telegram Direct] API fail', JSON.stringify(data).slice(0,500));
    return data.ok;
  }catch(e){
    console.error('[Telegram Direct] Error', e.message);
    return false;
  }
}


const DEFAULT_PLANS = [
  { key: '1m', label: 'Gói 1 tháng', months: 1, price: 99000, enabled: true, is_custom: false, sort_order: 1 },
  { key: '3m', label: 'Gói 3 tháng', months: 3, price: 199000, enabled: true, is_custom: false, sort_order: 2 },
  { key: '6m', label: 'Gói 6 tháng', months: 6, price: 299000, enabled: true, is_custom: false, sort_order: 3 },
  { key: '12m', label: 'Gói 1 năm', months: 12, price: 499000, enabled: true, is_custom: false, sort_order: 4 },
];

// ĐÃ XÓA CACHE: let cache=null, cacheTime=0, tabCache=true, TTL=60*1000;

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
    console.log('[getPlans] Found', data.length, 'plans from DB (includeDisabled:', includeDisabled, ')', data.map(p=>p.key+':'+p.enabled));
    return {plans:data, tabEnabled};
  }catch(e){
    console.error('[getPlans] exception', e.message);
    return {plans: DEFAULT_PLANS.filter(p=>includeDisabled||p.enabled), tabEnabled};
  }
}

router.get('/upgrade-plans', async (req,res)=>{
  try{
    // V11: NO CACHE - luôn query fresh từ DB
    const result=await getPlans(false);
    console.log('[upgrade-plans] FRESH - NO CACHE, plans:', result.plans.length, 'tabEnabled:', result.tabEnabled, 'plans:', result.plans.map(p=>p.key+':'+p.enabled));
    res.json({success:true, plans:result.plans, tabEnabled:result.tabEnabled, _cache:false, _v11:true, _count:result.plans.length});
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
    console.log('[admin/upgrade-plans] Saved - NO CACHE needed');
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
      const {sendTelegramNotification: serviceTelegram, sendTelegram: serviceTelegram2}=require('../services/telegram');
      const sendTelegram = serviceTelegram || serviceTelegram2;
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


// ===== TRIAL 3 LẦN - LOGIC CHUẨN V13b - GIỮ NGUYÊN 349 DÒNG TRÊN, CHỈ THAY 2 ROUTE NÀY =====
const TRIAL_LIMIT = 3;

router.get('/trial-status', async (req,res)=>{
  try{
    const email = (req.query.email || req.headers['x-user-email'] || '').toLowerCase().trim();
    if(!email){
      console.log('[trial-status] no email, returning canFull true');
      return res.json({success:true, isVip:false, trialUsed:0, trialLimit:TRIAL_LIMIT, tabEnabled:true, canFull:true, limited:false, remaining:TRIAL_LIMIT});
    }
    if(!supabaseAdmin){
      console.warn('[trial-status] supabaseAdmin NULL');
      return res.json({success:true, isVip:false, trialUsed:0, trialLimit:TRIAL_LIMIT, tabEnabled:true, canFull:true, limited:false, remaining:TRIAL_LIMIT, _mock:true});
    }
    let isVip=false, trialUsed=0;
    try{
      const {data:user, error} = await supabaseAdmin.from('users').select('is_vip, trial_used').eq('email', email).single();
      if(error) console.warn('[trial-status] user fetch error', error.message);
      else if(user){ isVip=!!user.is_vip; trialUsed=user.trial_used||0; }
    }catch(e){ console.warn('[trial-status] user fetch exception', e.message); }
    
    let tabEnabled=true;
    try{
      const {data:tab, error:tabErr} = await supabaseAdmin.from('app_settings').select('value').eq('id','upgrade_tab_enabled').single();
      if(tabErr) console.warn('[trial-status] tab fetch error', tabErr.message);
      else if(tab?.value?.enabled!==undefined) tabEnabled=!!tab.value.enabled;
    }catch(e){ console.warn('[trial-status] tab fetch exception', e.message); }
    
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
      email,
      _v13b:true
    });
  }catch(e){
    console.error('[trial-status] fatal', e.message, e.stack);
    res.json({success:true, isVip:false, trialUsed:0, trialLimit:TRIAL_LIMIT, tabEnabled:true, canFull:true, limited:false, remaining:TRIAL_LIMIT, _error:e.message});
  }
});

router.post('/trial-consume', async (req,res)=>{
  try{
    const email = (req.body.email || req.headers['x-user-email'] || '').toLowerCase().trim();
    if(!email) return res.status(400).json({success:false, message:'Thiếu email'});
    if(!supabaseAdmin){
      console.error('[trial-consume] supabaseAdmin NULL');
      return res.json({success:true, _mock:true});
    }
    
    const {data:user, error:fetchErr} = await supabaseAdmin.from('users').select('is_vip, trial_used').eq('email', email).single();
    if(fetchErr) console.warn('[trial-consume] fetch user error', fetchErr.message);
    
    if(user?.is_vip){
      console.log(`[trial-consume] ${email} is VIP, skip`);
      return res.json({success:true, isVip:true, trialUsed:user.trial_used||0, remaining:TRIAL_LIMIT, limited:false, trialLimit:TRIAL_LIMIT});
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
      trialLimit:TRIAL_LIMIT,
      _v13b:true
    });
  }catch(e){
    console.error('[trial-consume] fatal', e.message, e.stack);
    res.status(500).json({success:false, message:e.message});
  }
});

module.exports=router;
