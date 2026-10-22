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

// FIX TELEGRAM - gửi trực tiếp, không phụ thuộc services/telegram - V2 có retry và log rõ
async function sendTelegramDirect(message){
  try{
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if(!token || !chatId){
      console.warn('[Telegram Direct] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID - token:', !!token, 'chat:', !!chatId);
      return false;
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    for(let attempt=1; attempt<=2; attempt++){
      try{
        const res = await fetch(url, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ chat_id: chatId, text: message, parse_mode:'HTML' })
        });
        const data = await res.json().catch(()=>({}));
        if(data.ok){
          console.log(`[Telegram Direct] Sent OK attempt ${attempt}`);
          return true;
        } else {
          console.warn(`[Telegram Direct] API fail attempt ${attempt}`, JSON.stringify(data).slice(0,800));
        }
      }catch(e){
        console.warn(`[Telegram Direct] fetch error attempt ${attempt}`, e.message);
      }
      if(attempt<2) await new Promise(r=>setTimeout(r, 1000));
    }
    return false;
  }catch(e){
    console.error('[Telegram Direct] Error', e.message);
    return false;
  }
}

// Helper gửi AUTO DUYỆT VIP - dùng chung
async function sendAutoVipTelegram({email, fullName, planKey, months, amount, content, expireDate}){
  try{
    const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const expireVN = expireDate ? expireDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'N/A';
    const msg = `✅🤖 <b>AUTO DUYỆT VIP - KARARENDER</b> 🤖✅
━━━━━━━━━━━━━━━━━━━━━━
👤 <b>Email:</b> ${email}
👤 <b>Tên:</b> ${fullName||email}
💳 <b>Gói:</b> ${planKey} (${months} tháng)
💰 <b>Số tiền:</b> ${Number(amount||0).toLocaleString('vi-VN')}đ
📝 <b>Nội dung:</b> <code>${content||'N/A'}</code>
📅 <b>Hạn dùng:</b> ${expireVN}
⏰ <b>Thời gian:</b> ${timeVN}
━━━━━━━━━━━━━━━━━━━━━━
🤖 Hệ thống tự động duyệt qua webhook ngân hàng!`;
    const ok = await sendTelegramDirect(msg);
    console.log('[AUTO VIP Telegram] sent:', ok, 'for', email);
    return ok;
  }catch(e){
    console.warn('[AUTO VIP Telegram] error', e.message);
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
    let list = data||[];
    // FIX: Đồng bộ với users - nếu users đã REJECTED thì vip_requests cũng phải REJECTED
    if(list.length>0){
      const emails = [...new Set(list.map(r=>r.email.toLowerCase()))];
      const {data: usersData} = await supabaseAdmin.from('users').select('email,vip_status').in('email', emails);
      const rejectedEmails = new Set((usersData||[]).filter(u=>u.vip_status==='REJECTED').map(u=>u.email.toLowerCase()));
      if(rejectedEmails.size>0){
        const toFix = list.filter(r=>rejectedEmails.has(r.email.toLowerCase()));
        console.log(`[pending-vip] Auto fixing ${toFix.length} orphan PENDING where users REJECTED`, [...rejectedEmails]);
        for(const r of toFix){
          await supabaseAdmin.from('vip_requests').update({status:'REJECTED', reason:'auto_sync_users_rejected', updated_at:new Date().toISOString()}).eq('id', r.id);
        }
        list = list.filter(r=>!rejectedEmails.has(r.email.toLowerCase()));
      }
    }
    const mapped=list.map(u=>({
      id:u.id, email:u.email, fullName:u.full_name||u.email,
      requestVipTime:u.created_at, planKey:u.plan_key,
      amount:u.amount, content:u.content, created_at:u.created_at
    }));
    console.log(`[pending-vip] Found ${mapped.length} pending (after sync)`);
    res.json({success:true, users:mapped, count:mapped.length});
  }catch(e){
    console.error('[pending-vip] fatal', e.message);
    res.status(500).json({success:false, message:e.message, users:[], count:0});
  }
});

// ===== THỐNG KÊ NẠP VIP - ADMIN DASHBOARD =====
router.get('/admin/vip-stats', async (req,res)=>{
  try{
    if(!supabaseAdmin){
      return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    }
    // Lấy tất cả vip_requests APPROVED (đã nạp thành công)
    const {data: allData, error} = await supabaseAdmin.from('vip_requests').select('email, full_name, amount, plan_key, created_at, updated_at, status').eq('status','APPROVED').order('created_at',{ascending:false}).limit(1000);
    if(error){
      console.error('[vip-stats] error', error.message);
      return res.status(500).json({success:false, message:error.message});
    }
    const records = allData||[];
    
    // Helper lấy ngày VN YYYY-MM-DD
    const getVNDateStr = (d)=>{
      try{
        return new Date(d).toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
      }catch{ return new Date(d).toISOString().slice(0,10); }
    };
    const getVNMonthStr = (d)=>{
      try{
        const dt = new Date(d);
        const y = dt.toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh', year:'numeric'});
        const m = dt.toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh', month:'2-digit'});
        // en-CA returns YYYY-MM-DD, so extract
        const full = dt.toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
        return full.slice(0,7); // YYYY-MM
      }catch{
        return new Date(d).toISOString().slice(0,7);
      }
    };
    
    const nowVNStr = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
    const nowMonthStr = nowVNStr.slice(0,7);
    
    // Tổng hôm nay
    let todayTotal = 0, todayCount = 0;
    // Tổng tháng này
    let monthTotal = 0, monthCount = 0;
    // Tổng tất cả
    let totalAll = 0;
    
    // Theo user
    const userMap = new Map(); // email -> {email, full_name, total, count}
    
    // Theo ngày 30 ngày
    const dailyMap = new Map(); // YYYY-MM-DD -> total
    // Tạo 30 ngày gần nhất
    const last30Days = [];
    for(let i=29; i>=0; i--){
      const d = new Date();
      d.setDate(d.getDate() - i);
      const vnStr = getVNDateStr(d);
      last30Days.push(vnStr);
      dailyMap.set(vnStr, 0);
    }
    
    for(const r of records){
      const amt = parseInt(r.amount)||0;
      const dateStr = getVNDateStr(r.created_at);
      const monthStr = dateStr.slice(0,7);
      
      totalAll += amt;
      
      // hôm nay
      if(dateStr === nowVNStr){
        todayTotal += amt;
        todayCount++;
      }
      // tháng này
      if(monthStr === nowMonthStr){
        monthTotal += amt;
        monthCount++;
      }
      // user
      const key = (r.email||'').toLowerCase();
      if(key){
        if(!userMap.has(key)){
          userMap.set(key, {email: r.email, full_name: r.full_name||r.email, total:0, count:0, last_date: r.created_at});
        }
        const u = userMap.get(key);
        u.total += amt;
        u.count++;
        if(new Date(r.created_at) > new Date(u.last_date)) u.last_date = r.created_at;
      }
      // daily 30 ngày
      if(dailyMap.has(dateStr)){
        dailyMap.set(dateStr, (dailyMap.get(dateStr)||0) + amt);
      }
    }
    
    // Tính trung bình
    const avgPerTransaction = records.length ? Math.round(totalAll / records.length) : 0;
    const avgPerDay = last30Days.length ? Math.round(totalAll / 30) : 0; // trung bình 30 ngày
    // trung bình theo ngày có giao dịch
    const daysWithData = [...dailyMap.values()].filter(v=>v>0).length;
    const avgPerActiveDay = daysWithData ? Math.round(totalAll / daysWithData) : 0;
    
    // Top user theo tổng nạp
    const topUsers = [...userMap.values()].sort((a,b)=>b.total - a.total).slice(0,50);
    
    // Biểu đồ 30 ngày
    const chartData = last30Days.map(date=>{
      return {date, total: dailyMap.get(date)||0};
    });
    
    // Tổng theo gói
    const planMap = new Map();
    for(const r of records){
      const k = r.plan_key||'unknown';
      if(!planMap.has(k)) planMap.set(k, {plan_key:k, total:0, count:0});
      const p = planMap.get(k);
      p.total += parseInt(r.amount)||0;
      p.count++;
    }
    const byPlan = [...planMap.values()].sort((a,b)=>b.total-a.total);
    
    res.json({
      success:true,
      today: {total: todayTotal, count: todayCount, date: nowVNStr},
      month: {total: monthTotal, count: monthCount, month: nowMonthStr},
      total: {total: totalAll, count: records.length},
      avg: {perTransaction: avgPerTransaction, perDay: avgPerDay, perActiveDay: avgPerActiveDay, daysWithData},
      topUsers,
      chart: chartData,
      byPlan,
      last30Days,
      _count: records.length
    });
  }catch(e){
    console.error('[vip-stats] fatal', e.message, e.stack);
    res.status(500).json({success:false, message:e.message});
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

    // CHECK DUPLICATE: Chặn double-click tạo 2 PENDING như peterbui791123@gmail.com
    try{
      const tenMinAgo = new Date(Date.now() - 10*60*1000).toISOString();
      const {data: existingPending} = await supabaseAdmin.from('vip_requests')
        .select('id, created_at, plan_key, amount')
        .eq('email', email.toLowerCase())
        .eq('status','PENDING')
        .eq('plan_key', planKey)
        .gte('created_at', tenMinAgo)
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle();
      
      if(existingPending){
        console.log(`[request-vip] Duplicate detected, return existing PENDING ${existingPending.id} for ${email} created ${existingPending.created_at}`);
        return res.json({success:true, message:'Đã có yêu cầu chờ duyệt, vui lòng quét QR hiện tại', requestId: existingPending.id, _duplicate:true});
      }
    }catch(e){
      console.warn('[request-vip] duplicate check error', e.message);
    }

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

    // TELEGRAM CHI TIẾT - BẢN NÂNG CẤP ĐẦY ĐỦ
    try{
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.headers['x-real-ip'] || 'unknown';
      const domain = req.headers.origin || req.headers.referer || 'unknown';
      const origin = req.headers.origin || 'unknown';
      const referer = req.headers.referer || 'unknown';
      const ua = req.headers['user-agent'] || 'unknown';
      const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

      const detailedMsg = `💥💎🚀 <b>YÊU CẦU NÂNG CẤP VIP - KARARENDER</b> 🚀💎💥
━━━━━━━━━━━━━━━━━━━━━━
👤 <b>Khách hàng:</b> ${fullName}
📧 <b>Email:</b> ${email}
🆔 <b>User:</b> <code>${email}</code>

💳 <b>GÓI NÂNG CẤP:</b>
├─ <b>Mã gói:</b> ${planKey}
├─ <b>Tên gói:</b> ${plan.label}
├─ <b>Thời hạn:</b> ${plan.months} tháng
└─ <b>Giá:</b> ${plan.price.toLocaleString('vi-VN')}đ

📝 <b>Nội dung CK:</b> <code>${content||'N/A'}</code>
💰 <b>Số tiền:</b> ${plan.price.toLocaleString('vi-VN')}đ

🌐 <b>THÔNG TIN TRUY CẬP:</b>
├─ <b>Domain:</b> ${domain}
├─ <b>Origin:</b> ${origin}
├─ <b>Referer:</b> ${referer}
├─ <b>IP:</b> ${ip}
└─ <b>Browser:</b> ${ua.slice(0,220)}

⏰ <b>Thời gian:</b> ${timeVN}
🆔 <b>Request ID:</b> <code>${inserted?.id||'N/A'}</code>
━━━━━━━━━━━━━━━━━━━━━━
⚡ Hệ thống tự động duyệt khi đã nhận đủ tiền!`;

      await sendTelegramDirect(detailedMsg); // FIX: chỉ gửi 1 lần, bỏ duplicate
    }catch(e){ console.warn('[telegram detailed]', e.message); }

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
    
    // ===== THÊM THÔNG BÁO TELEGRAM KHI DUYỆT VIP THÀNH CÔNG =====
    try{
      const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const expireVN = expireDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const approveMsg = `✅🎉 <b>DUYỆT VIP THÀNH CÔNG - KARARENDER</b> 🎉✅
━━━━━━━━━━━━━━━━━━━━━━
👤 <b>Email:</b> ${targetEmail}
💳 <b>Gói:</b> ${monthsToAdd} tháng
📅 <b>Hạn dùng:</b> ${expireVN}
⏰ <b>Thời gian duyệt:</b> ${timeVN}
🆔 <b>Request ID:</b> <code>${requestId||'N/A'}</code>
━━━━━━━━━━━━━━━━━━━━━━
✨ User đã được kích hoạt VIP thành công!`;

      await sendTelegramDirect(approveMsg);
      console.log('[approve-vip] Telegram sent for', targetEmail);
    }catch(e){ console.warn('[approve-vip] telegram error', e.message); }
    
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


// ====== USDT WALLET ROTATION FIX - COPY VÀO routes/upgrade.js ======
// Thay thế toàn bộ đoạn từ const USDT_NETWORKS đến hết router.post('/payment/usdt/create'...)

const USDT_NETWORKS = {
  'TRC20': { name: 'TRON (TRC20)', symbol: 'TRC20', chain: 'tron', explorer: 'https://tronscan.org/#/address/' },
  'ERC20': { name: 'Ethereum (ERC20)', symbol: 'ERC20', chain: 'eth', explorer: 'https://etherscan.io/address/' },
  'BEP20': { name: 'BSC (BEP20)', symbol: 'BEP20', chain: 'bsc', explorer: 'https://bscscan.com/address/' },
  'POLYGON': { name: 'Polygon', symbol: 'POLYGON', chain: 'polygon', explorer: 'https://polygonscan.com/address/' },
  'ARBITRUM': { name: 'Arbitrum', symbol: 'ARBITRUM', chain: 'arbitrum', explorer: 'https://arbiscan.io/address/' },
  'SOL': { name: 'Solana', symbol: 'SOL', chain: 'sol', explorer: 'https://solscan.io/account/' }
};

const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || '7CIT8VTPA3VFB1KYEPK3FQDTA8NBK71YGT';
const USDT_BEP20_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

// ===== FIX MISSING: GIÁ USDT REALTIME - THÊM VÀO ĐÂY =====
let __cachedVndPrice = { value: 26000, ts: 0 };
let __cachedUsdPrice = { value: 1.0, ts: 0 };

async function getUsdtVndPrice(){
  const now = Date.now();
  if(__cachedVndPrice.ts && now - __cachedVndPrice.ts < 60*1000){
    return __cachedVndPrice.value;
  }
  // Thử CoinGecko VND
  try{
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=vnd', { signal: AbortSignal.timeout(5000) });
    if(r.ok){
      const j = await r.json();
      if(j.tether?.vnd && j.tether.vnd > 1000){
        __cachedVndPrice = { value: Math.round(j.tether.vnd), ts: now };
        console.log('[getUsdtVndPrice] CoinGecko VND', __cachedVndPrice.value);
        return __cachedVndPrice.value;
      }
    }
  }catch(e){ console.warn('[getUsdtVndPrice] coingecko fail', e.message); }
  // Fallback Binance P2P không public, dùng USDT/VNST hoặc fixed
  try{
    const r2 = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTUSD', { signal: AbortSignal.timeout(5000) });
    if(r2.ok){
      // nếu lấy được USD, nhân với tỷ giá USD/VND ~ 26100
      const j2 = await r2.json();
      if(j2.price){
        const usdPrice = parseFloat(j2.price);
        const vnd = Math.round(usdPrice * 26100);
        if(vnd>20000){
          __cachedVndPrice = { value: vnd, ts: now };
          return vnd;
        }
      }
    }
  }catch(e){}
  // Fallback cứng để không bao giờ crash 500
  return __cachedVndPrice.value || 26000;
}

async function getUsdtPriceUsd(){
  const now = Date.now();
  if(__cachedUsdPrice.ts && now - __cachedUsdPrice.ts < 60*1000){
    return __cachedUsdPrice.value;
  }
  try{
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
    if(r.ok){
      const j = await r.json();
      if(j.tether?.usd){
        __cachedUsdPrice = { value: j.tether.usd, ts: now };
        return j.tether.usd;
      }
    }
  }catch(e){}
  return 1.0;
}
// ===== END FIX MISSING =====



// ====== CONFIG XOAY VÒNG ======
const WALLET_BUSY_MINUTES = 30; // ví bận trong 30 phút
const WALLET_LOCK_MS = 8000; // lock tạm 8s chống race condition khi 2 người cùng request

// In-memory lock để chống 2 request cùng lúc lấy cùng 1 ví
const walletLocks = new Map(); // walletId -> expire timestamp
function isWalletLocked(walletId){
  const exp = walletLocks.get(walletId);
  if(!exp) return false;
  if(Date.now() > exp){ walletLocks.delete(walletId); return false; }
  return true;
}
function lockWallet(walletId){
  walletLocks.set(walletId, Date.now() + WALLET_LOCK_MS);
}
function unlockWallet(walletId){
  walletLocks.delete(walletId);
}
// dọn lock hết hạn mỗi phút
setInterval(()=>{
  const now = Date.now();
  for(const [id, exp] of walletLocks.entries()){
    if(now > exp) walletLocks.delete(id);
  }
}, 60*1000);

// ====== CORE: Lấy danh sách ví rảnh ======
async function getWalletRotationStatus(){
  if(!supabaseAdmin) return { all: [], free: [], busy: [], busyDetails: [] };
  
  // 1. Lấy tất cả ví active
  const { data: allWallets, error: wErr } = await supabaseAdmin
    .from('usdt_wallets')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  
  if(wErr || !allWallets || allWallets.length===0){
    console.warn('[USDT Rotation] No active wallets', wErr?.message);
    return { all: [], free: [], busy: [], busyDetails: [] };
  }

  // 2. Lấy các request PENDING trong 30 phút qua có chứa USDT
  const cutoff = new Date(Date.now() - WALLET_BUSY_MINUTES*60*1000).toISOString();
  const { data: pendings, error: pErr } = await supabaseAdmin
    .from('vip_requests')
    .select('id, email, content, created_at, plan_key')
    .eq('status','PENDING')
    .gte('created_at', cutoff)
    .ilike('content','%usdt%')
    .order('created_at', { ascending: true });

  if(pErr){
    console.warn('[USDT Rotation] query pending error', pErr.message);
    // nếu lỗi query thì coi như tất cả rảnh để không block user
    return { all: allWallets, free: allWallets, busy: [], busyDetails: [], pendings: [] };
  }

  // 3. Xác định ví nào đang bận
  // Content hiện tại lưu dạng: "usdt email plan network usdtAmount ... | wallet:0xABC... | walletId:xxx | ..."
  // Ta sẽ parse linh hoạt: chứa address, hoặc slice 10 ký tự đầu, hoặc walletId
  const busyMap = new Map(); // walletId -> { pending, busyUntil }

  for(const wallet of allWallets){
    const addrLower = (wallet.address||'').toLowerCase();
    const addrShort = addrLower.slice(0, 10); // vì code cũ lưu slice(0,10)
    const addrShort2 = addrLower.slice(-8);
    const idLower = String(wallet.id).toLowerCase();
    
    for(const p of (pendings||[])){
      const contentLower = (p.content||'').toLowerCase();
      // Check nhiều pattern để tương thích code cũ và mới
      const isMatch = 
        contentLower.includes(addrLower) ||
        (addrShort && contentLower.includes(addrShort)) ||
        contentLower.includes(`wallet:${addrShort}`) ||
        contentLower.includes(`walletid:${idLower}`) ||
        contentLower.includes(`wallet_id:${idLower}`) ||
        contentLower.includes(`wallet ${idLower}`) ||
        contentLower.includes(idLower) && contentLower.includes('wallet');
      
      if(isMatch){
        const created = new Date(p.created_at);
        const busyUntil = new Date(created.getTime() + WALLET_BUSY_MINUTES*60*1000);
        // Nếu đã có trong busyMap thì giữ cái mới nhất
        if(!busyMap.has(wallet.id) || new Date(busyMap.get(wallet.id).pending.created_at) < created){
          busyMap.set(wallet.id, { wallet, pending: p, busyUntil });
        }
        break; // ví này đã bận, không cần check pending khác
      }
    }
  }

  // 4. Lọc ví rảnh: không bận + không bị lock tạm
  const busyList = Array.from(busyMap.values());
  const busyIds = new Set(busyMap.keys());
  const freeWallets = allWallets.filter(w => !busyIds.has(w.id) && !isWalletLocked(w.id));
  const lockedWallets = allWallets.filter(w => isWalletLocked(w.id) && !busyIds.has(w.id));

  // 5. Sắp xếp free wallets theo round-robin: ví nào lâu không dùng nhất lên đầu
  // Lấy last_used từ lịch sử vip_requests (kể cả APPROVED) để fairness
  try{
    // Query last used cho từng ví free
    const lastUsedMap = new Map();
    for(const w of freeWallets){
      const { data: last } = await supabaseAdmin
        .from('vip_requests')
        .select('created_at')
        .ilike('content', `%${w.address.slice(0,10)}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lastUsedMap.set(w.id, last ? new Date(last.created_at).getTime() : 0); // 0 = chưa từng dùng -> ưu tiên
    }
    freeWallets.sort((a,b)=> (lastUsedMap.get(a.id)||0) - (lastUsedMap.get(b.id)||0));
  }catch(e){
    console.warn('[USDT Rotation] sort error', e.message);
  }

  return {
    all: allWallets,
    free: freeWallets,
    busy: allWallets.filter(w=>busyIds.has(w.id)),
    busyDetails: busyList,
    locked: lockedWallets,
    pendings: pendings||[]
  };
}

// ====== API: Public list wallets kèm trạng thái bận/rảnh ======
router.get('/payment/usdt-wallets', async (req,res)=>{
  try{
    if(!supabaseAdmin){
      return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    }
    const rotation = await getWalletRotationStatus();
    
    // Trả về thêm is_busy, busy_until để frontend hiển thị nếu cần
    const walletsWithStatus = rotation.all.map(w=>{
      const busyInfo = rotation.busyDetails.find(b=>b.wallet.id===w.id);
      return {
        ...w,
        is_busy: !!busyInfo || isWalletLocked(w.id),
        busy_until: busyInfo ? busyInfo.busyUntil.toISOString() : (isWalletLocked(w.id) ? new Date(Date.now()+WALLET_LOCK_MS).toISOString() : null),
        busy_by: busyInfo ? busyInfo.pending.email : null,
        is_locked: isWalletLocked(w.id)
      };
    });

    // Chỉ trả ví rảnh cho public? Hiện tại trả hết để debug, frontend sẽ tự chọn rảnh
    // Nếu muốn chỉ trả ví rảnh: wallets: walletsWithStatus.filter(w=>!w.is_busy)
    res.json({
      success:true, 
      wallets: walletsWithStatus.filter(w=>!w.is_busy || true), // giữ tất cả, frontend lọc
      freeWallets: walletsWithStatus.filter(w=>!w.is_busy),
      busyWallets: walletsWithStatus.filter(w=>w.is_busy),
      networks: USDT_NETWORKS,
      _rotation: {
        total: rotation.all.length,
        free: rotation.free.length,
        busy: rotation.busy.length,
        busyMinutes: WALLET_BUSY_MINUTES
      }
    });
  }catch(e){
    console.error('[usdt-wallets public] error', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

router.get('/admin/usdt-wallets', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const rotation = await getWalletRotationStatus();
    const { data, error } = await supabaseAdmin.from('usdt_wallets').select('*').order('created_at',{ascending:false});
    if(error){
      console.warn('[admin/usdt-wallets] error', error.message);
      return res.json({success:true, wallets:[], _needCreateTable:true, message:'Bảng usdt_wallets chưa tồn tại, cần tạo trong Supabase', networks: USDT_NETWORKS});
    }
    // gắn thêm trạng thái busy cho admin
    const enriched = (data||[]).map(w=>{
      const busyInfo = rotation.busyDetails.find(b=>b.wallet.id===w.id);
      return {
        ...w,
        is_busy: !!busyInfo,
        busy_until: busyInfo?.busyUntil?.toISOString() || null,
        busy_by: busyInfo?.pending?.email || null,
        pending_id: busyInfo?.pending?.id || null,
        is_locked: isWalletLocked(w.id)
      };
    });
    const bscKey = process.env.BSCSCAN_API_KEY || BSCSCAN_API_KEY;
    const masked = bscKey ? (bscKey.slice(0,4) + '...' + bscKey.slice(-4)) : 'CHƯA CẤU HÌNH';
    const fromEnv = !!process.env.BSCSCAN_API_KEY;
    res.json({success:true, wallets: enriched, networks: USDT_NETWORKS, _rotation: { total: rotation.all.length, free: rotation.free.length, busy: rotation.busy.length }, _bscscan: { masked, fromEnv, keyLength: bscKey?.length||0, isDefault: bscKey === '7CIT8VTPA3VFB1KYEPK3FQDTA8NBK71YGT' }});
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});

// ===== ADMIN: Thêm / Sửa ví USDT - FIX 404 =====
router.post('/admin/usdt-wallets', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { id, network, address, label, is_active } = req.body || {};
    if(!network || !address){
      return res.status(400).json({success:false, message:'Thiếu network hoặc address'});
    }
    const cleanAddr = address.trim();
    if(cleanAddr.length < 20){
      return res.status(400).json({success:false, message:'Địa chỉ ví quá ngắn'});
    }
    if(!USDT_NETWORKS[network]){
      return res.status(400).json({success:false, message:'Network không hợp lệ: '+network});
    }
    if(id){
      const { data, error } = await supabaseAdmin.from('usdt_wallets').update({
        network: network,
        address: cleanAddr,
        label: label || null,
        is_active: is_active !== false,
        updated_at: new Date().toISOString()
      }).eq('id', id).select().single();
      if(error){
        console.error('[admin/usdt-wallets POST update] error', error.message);
        return res.status(500).json({success:false, message:error.message});
      }
      console.log(`[admin/usdt-wallets] Updated wallet ${id} ${network} ${cleanAddr.slice(0,10)}...`);
      return res.json({success:true, wallet: data, message:'Đã cập nhật ví'});
    } else {
      const { data: existing } = await supabaseAdmin.from('usdt_wallets').select('id').eq('address', cleanAddr).eq('network', network).maybeSingle();
      if(existing){
        return res.status(400).json({success:false, message:'Ví này đã tồn tại trong hệ thống'});
      }
      const { data, error } = await supabaseAdmin.from('usdt_wallets').insert({
        network: network,
        address: cleanAddr,
        label: label || `${network} Wallet`,
        is_active: is_active !== false
      }).select().single();
      if(error){
        console.error('[admin/usdt-wallets POST insert] error', error.message);
        return res.status(500).json({success:false, message:error.message});
      }
      console.log(`[admin/usdt-wallets] Created wallet ${data.id} ${network} ${cleanAddr.slice(0,10)}...`);
      return res.json({success:true, wallet: data, message:'Đã thêm ví mới'});
    }
  }catch(e){
    console.error('[admin/usdt-wallets POST] fatal', e.message, e.stack);
    res.status(500).json({success:false, message:e.message});
  }
});

// ===== ADMIN: Xóa ví USDT - FIX 404 =====
router.delete('/admin/usdt-wallets/:id', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const walletId = req.params.id;
    const rotation = await getWalletRotationStatus();
    const busy = rotation.busyDetails.find(b=>b.wallet.id===walletId);
    if(busy){
      return res.status(400).json({success:false, message:`Ví đang bận - có yêu cầu PENDING của ${busy.pending.email} trong 30 phút, không thể xóa. Hãy giải phóng trước.`});
    }
    const { error } = await supabaseAdmin.from('usdt_wallets').delete().eq('id', walletId);
    if(error){
      console.error('[admin/usdt-wallets DELETE] error', error.message);
      return res.status(500).json({success:false, message:error.message});
    }
    unlockWallet(walletId);
    console.log(`[admin/usdt-wallets] Deleted wallet ${walletId}`);
    return res.json({success:true, message:'Đã xóa ví'});
  }catch(e){
    console.error('[admin/usdt-wallets DELETE] fatal', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

// ====== ADMIN: Giải phóng ví bận (force release) ======
router.post('/admin/usdt-wallets/:id/release', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const walletId = req.params.id;
    // Tìm ví
    const { data: wallet } = await supabaseAdmin.from('usdt_wallets').select('*').eq('id', walletId).maybeSingle();
    if(!wallet) return res.status(404).json({success:false, message:'Không tìm thấy ví'});

    // Tìm các pending đang giữ ví này trong 30p
    const cutoff = new Date(Date.now() - WALLET_BUSY_MINUTES*60*1000).toISOString();
    const { data: pendings } = await supabaseAdmin.from('vip_requests')
      .select('id, email, content, created_at')
      .eq('status','PENDING')
      .gte('created_at', cutoff)
      .ilike('content','%usdt%');

    let releasedCount = 0;
    if(pendings && pendings.length>0){
      const addrLower = wallet.address.toLowerCase();
      const addrShort = addrLower.slice(0,10);
      const toReject = pendings.filter(p=>{
        const c = (p.content||'').toLowerCase();
        return c.includes(addrLower) || c.includes(addrShort) || c.includes(`walletid:${String(walletId).toLowerCase()}`);
      });
      for(const p of toReject){
        await supabaseAdmin.from('vip_requests').update({
          status:'REJECTED',
          reason:'admin_force_release_wallet',
          updated_at: new Date().toISOString(),
          content: (p.content||'') + ` | force_released_by_admin_at:${new Date().toISOString()} | wallet:${wallet.address}`
        }).eq('id', p.id);
        releasedCount++;
      }
    }
    // Xóa lock nếu có
    unlockWallet(walletId);
    console.log(`[USDT Release] Wallet ${walletId} released ${releasedCount} pendings`);
    res.json({success:true, released: releasedCount, walletId});
  }catch(e){
    console.error('[usdt release] error', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

router.post('/admin/cancel-vip-request', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { requestId, reason } = req.body||{};
    if(!requestId) return res.status(400).json({success:false, message:'Thiếu requestId'});
    await supabaseAdmin.from('vip_requests').update({
      status:'REJECTED',
      reason: reason||'admin_cancel',
      updated_at: new Date().toISOString()
    }).eq('id', requestId);
    // Cố gắng unlock ví liên quan
    try{
      const { data: reqData } = await supabaseAdmin.from('vip_requests').select('content').eq('id', requestId).maybeSingle();
      if(reqData?.content){
        const m = reqData.content.match(/walletId:([a-f0-9\-]+)/i);
        if(m) unlockWallet(m[1]);
      }
    }catch{}
    res.json({success:true});
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});


// ====== API: CREATE USDT PAYMENT VỚI XOAY VÒNG ======
router.post('/payment/usdt/create', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { email, planKey, network, walletId } = req.body;
    if(!email || !planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});
    
    const plansRes = await getPlans(false);
    const plan = plansRes.plans.find(p=>p.key===planKey)||{price:0, label:planKey, months:1, key:planKey};
    
    // 1. Check duplicate cho chính email này trong 10 phút qua -> trả lại ví cũ nếu còn pending
    try{
      const tenMinAgo = new Date(Date.now() - 10*60*1000).toISOString();
      const { data: existingPending } = await supabaseAdmin.from('vip_requests')
        .select('id, created_at, plan_key, amount, content')
        .eq('email', email.toLowerCase())
        .eq('status','PENDING')
        .eq('plan_key', planKey)
        .ilike('content','%usdt%')
        .gte('created_at', tenMinAgo)
        .order('created_at',{ascending:false})
        .limit(1)
        .maybeSingle();
      
      if(existingPending){
        // Parse lại wallet từ content để trả đúng ví đang pending
        let existingWallet = null;
        const contentLower = (existingPending.content||'').toLowerCase();
        const rotationForDup = await getWalletRotationStatus();
        for(const w of rotationForDup.all){
          if(contentLower.includes(w.address.toLowerCase()) || contentLower.includes(w.address.slice(0,10).toLowerCase())){
            existingWallet = w;
            break;
          }
        }
        // Nếu không parse được thì lấy ví đầu tiên active (fallback)
        if(!existingWallet){
          const { data: fallback } = await supabaseAdmin.from('usdt_wallets').select('*').eq('is_active', true).order('created_at',{ascending:true}).limit(1).maybeSingle();
          existingWallet = fallback;
        }

        if(existingWallet){
          const vndPriceDup = await getUsdtVndPrice();
          const usdPriceDup = await getUsdtPriceUsd();
          const usdtAmountDup = parseFloat((plan.price / vndPriceDup).toFixed(4));
          console.log(`[usdt/create] Duplicate detected for ${email}, return existing ${existingPending.id} wallet ${existingWallet.address.slice(0,10)}...`);
          return res.json({
            success:true,
            requestId: existingPending.id,
            _duplicate:true,
            _rotation: { reason: 'existing_pending_within_10m' },
            wallet: {
              id: existingWallet.id,
              network: existingWallet.network,
              address: existingWallet.address,
              label: existingWallet.label,
              explorer: USDT_NETWORKS[existingWallet.network]?.explorer + existingWallet.address
            },
            plan: { key: plan.key, label: plan.label, months: plan.months, priceVND: plan.price, priceUSDT: usdtAmountDup },
            amount: { vnd: plan.price, usdt: usdtAmountDup, vndPerUsdt: vndPriceDup, usdPerUsdt: usdPriceDup },
            content: existingPending.content
          });
        }
      }
    }catch(e){ console.warn('[usdt/create] duplicate check error', e.message); }

    // 2. Lấy trạng thái xoay vòng ví
    const rotation = await getWalletRotationStatus();

    if(!rotation.all || rotation.all.length===0){
      return res.status(400).json({success:false, message:'Chưa cấu hình ví USDT nào. Admin cần thêm ví BEP20 trong Dashboard tab USDT.'});
    }

    // 3. Chọn ví
    let wallet = null;
    
    // Nếu client cố tình gửi walletId -> kiểm tra xem ví đó có đang bận không
    if(walletId){
      const requested = rotation.all.find(w=>String(w.id)===String(walletId));
      if(requested){
        const isBusy = rotation.busy.some(b=>b.id===requested.id) || isWalletLocked(requested.id);
        if(isBusy){
          // Nếu ví yêu cầu đang bận, tự động chuyển sang ví rảnh (theo yêu cầu xoay vòng)
          console.log(`[usdt/create] Requested wallet ${walletId} is busy, auto rotate to free wallet`);
          if(rotation.free.length>0){
            wallet = rotation.free[0];
          }else{
            const nextFreeIn = rotation.busyDetails.length>0 ? Math.min(...rotation.busyDetails.map(b=> b.busyUntil.getTime() - Date.now())) : 0;
            return res.status(409).json({
              success:false, 
              message:`Ví ${requested.label||requested.address.slice(0,10)}... đang bận. Tất cả ${rotation.all.length} ví đều bận. Vui lòng thử lại sau ${Math.ceil(nextFreeIn/60000)} phút.`,
              code:'ALL_WALLETS_BUSY',
              busyDetails: rotation.busyDetails.map(b=>({ walletId: b.wallet.id, address: b.wallet.address, busyUntil: b.busyUntil, email: b.pending.email })),
              nextAvailableInMs: nextFreeIn
            });
          }
        }else{
          wallet = requested;
        }
      }
    }
    
    // Nếu chưa có ví (không gửi walletId hoặc ví yêu cầu bận) -> lấy ví rảnh theo xoay vòng
    if(!wallet){
      if(network){
        // Lọc theo network yêu cầu
        const freeByNetwork = rotation.free.filter(w=>w.network===network);
        if(freeByNetwork.length>0){
          wallet = freeByNetwork[0];
        }else{
          // Nếu không còn ví rảnh cho network đó, thử network khác hoặc báo bận
          const busyByNetwork = rotation.busy.filter(w=>w.network===network);
          if(busyByNetwork.length>0 && rotation.free.length===0){
            const nextFreeIn = rotation.busyDetails.filter(b=>b.wallet.network===network).reduce((min,b)=> Math.min(min, b.busyUntil.getTime()-Date.now()), Infinity);
            return res.status(409).json({
              success:false,
              message:`Tất cả ví ${network} đang bận (${busyByNetwork.length} ví). Vui lòng thử lại sau ${Math.ceil(nextFreeIn/60000)} phút hoặc chọn mạng khác.`,
              code:'NETWORK_WALLETS_BUSY',
              network,
              freeWallets: rotation.free
            });
          }
          wallet = rotation.free[0] || null;
        }
      }else{
        // Mặc định ưu tiên BEP20 rảnh
        const freeBep20 = rotation.free.filter(w=>w.network==='BEP20');
        wallet = (freeBep20.length>0 ? freeBep20[0] : rotation.free[0]) || null;
      }
    }

    // 4. Nếu không còn ví rảnh nào
    if(!wallet){
      const nextFreeIn = rotation.busyDetails.length>0 ? Math.min(...rotation.busyDetails.map(b=> b.busyUntil.getTime() - Date.now())) : WALLET_BUSY_MINUTES*60*1000;
      return res.status(409).json({
        success:false,
        message:`Tất cả ${rotation.all.length} ví USDT đang bận. Ví 1 sẽ rảnh sau ${Math.ceil(nextFreeIn/60000)} phút. Vui lòng thử lại sau.`,
        code:'ALL_WALLETS_BUSY',
        totalWallets: rotation.all.length,
        busyCount: rotation.busy.length,
        freeCount: 0,
        nextAvailableInMs: nextFreeIn,
        busyDetails: rotation.busyDetails.map(b=>({
          walletId: b.wallet.id,
          label: b.wallet.label,
          address: b.wallet.address.slice(0,10)+'...',
          network: b.wallet.network,
          busyUntil: b.busyUntil,
          email: b.pending.email,
          pendingId: b.pending.id
        }))
      });
    }

    // 5. Lock ví tạm thời chống race condition
    lockWallet(wallet.id);

    // 6. Tính giá
    const vndPrice = await getUsdtVndPrice();
    const usdPrice = await getUsdtPriceUsd();
    const usdtAmount = parseFloat((plan.price / vndPrice).toFixed(4));
    
    let fullName = email;
    try{
      const {data:user} = await supabaseAdmin.from('users').select('full_name').eq('email', email.toLowerCase()).single();
      if(user?.full_name) fullName = user.full_name;
    }catch{}

    // 7. Tạo content mới có đủ thông tin để rotation parse được (quan trọng!)
    const content = `usdt ${email} ${planKey} ${wallet.network} ${usdtAmount}USDT rate:${vndPrice} walletId:${wallet.id} wallet:${wallet.address} wallet_label:${wallet.label||''}`;

    try{
      const {data: reqData, error: reqErr} = await supabaseAdmin.from('vip_requests').insert({
        email: email.toLowerCase(),
        full_name: fullName,
        plan_key: planKey,
        amount: plan.price,
        content: content + ` | tx:pending | expected:${usdtAmount}USDT | rotation:free=${rotation.free.length},busy=${rotation.busy.length}`,
        status: 'PENDING'
      }).select().single();
      
      if(reqErr){
        unlockWallet(wallet.id);
        console.error('[usdt/create] insert error', reqErr.message);
        return res.status(500).json({success:false, message:reqErr.message});
      }

      // Gửi Telegram
      try{
        const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const msg = `💸 <b>YÊU CẦU USDT - XOAY VÒNG VÍ</b> 💸
━━━━━━━━━━━━━━
👤 <b>Email:</b> ${email}
👤 <b>Tên:</b> ${fullName}
💳 <b>Gói:</b> ${planKey} (${plan.months} tháng)
💰 <b>VND:</b> ${plan.price.toLocaleString('vi-VN')}đ
💵 <b>USDT:</b> ${usdtAmount} USDT (BEP20)
💱 <b>Tỷ giá:</b> ${vndPrice.toLocaleString('vi-VN')} VND/USDT
🌐 <b>Mạng:</b> ${wallet.network}
👛 <b>Ví được chọn (xoay vòng):</b> <code>${wallet.address}</code>
🏷️ <b>Nhãn:</b> ${wallet.label||'N/A'} (ID: ${wallet.id})
📊 <b>Trạng thái xoay:</b> ${rotation.free.length+1} ví tổng, ${rotation.busy.length} đang bận, ${rotation.free.length} rảnh trước khi chọn
📝 <b>Nội dung:</b> <code>${content}</code>
⏰ <b>Thời gian:</b> ${timeVN}
🆔 <b>Request ID:</b> <code>${reqData?.id||'N/A'}</code>
⏳ <b>Ví bận trong:</b> ${WALLET_BUSY_MINUTES} phút
━━━━━━━━━━━━━━
⚠️ User sẽ chuyển USDT BEP20 và hệ thống tự quét BSCScan`;
        await sendTelegramDirect(msg);
      }catch(e){ console.warn('[usdt/create] telegram error', e.message); }
      
      // Giữ lock thêm 5s để chắc chắn request đã commit
      setTimeout(()=>unlockWallet(wallet.id), 5000);

      res.json({
        success:true,
        requestId: reqData?.id,
        wallet: {
          id: wallet.id,
          network: wallet.network,
          address: wallet.address,
          label: wallet.label,
          explorer: USDT_NETWORKS[wallet.network]?.explorer + wallet.address
        },
        plan: {
          key: plan.key,
          label: plan.label,
          months: plan.months,
          priceVND: plan.price,
          priceUSDT: usdtAmount
        },
        amount: {
          vnd: plan.price,
          usdt: usdtAmount,
          vndPerUsdt: vndPrice,
          usdPerUsdt: usdPrice
        },
        content: content,
        _rotation: {
          total: rotation.all.length,
          freeBefore: rotation.free.length,
          busyBefore: rotation.busy.length,
          selectedWalletId: wallet.id,
          busyMinutes: WALLET_BUSY_MINUTES
        }
      });

    }catch(insertErr){
      unlockWallet(wallet.id);
      throw insertErr;
    }
    
  }catch(e){
    console.error('[usdt/create] fatal', e.message, e.stack);
    res.status(500).json({success:false, message:e.message});
  }
});





async function fetchBscScanWithFallback(url, label){
  try{
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(15000), 
      headers: { 'User-Agent': 'KaraRender/1.0', 'Accept': 'application/json' } 
    });
    const raw = await res.text();
    if(raw.includes('<!DOCTYPE') || raw.includes('<html') || raw.includes('Just a moment') || raw.includes('cf-challenge')){
      return { blocked: true, raw: raw.slice(0,500) };
    }
    try{
      const data = JSON.parse(raw);
      return { blocked: false, data, raw };
    }catch(e){
      return { blocked: true, raw: raw.slice(0,500), error: e.message };
    }
  }catch(e){
    return { blocked: true, error: e.message };
  }
}

async function getLatestBscBlockNumber(rpcUrl){
  try{
    const res = await fetch(rpcUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0', id:1, method:'eth_blockNumber', params:[]}),
      signal: AbortSignal.timeout(8000)
    });
    const j = await res.json();
    if(j.result) return parseInt(j.result, 16);
  }catch(e){}
  return null;
}

async function scanViaRpcLogs(walletAddress, expectedUsdt, contract){
  const rpcUrls = [
    'https://bsc-dataseed.binance.org/',
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
    'https://bsc-dataseed3.binance.org/',
    'https://bsc-dataseed4.binance.org/',
    'https://bsc.publicnode.com',
    'https://binance.llamarpc.com',
    'https://rpc.ankr.com/bsc',
    'https://bsc.meowrpc.com'
  ];
  const walletLower = walletAddress.toLowerCase();
  const contractLower = contract.toLowerCase();
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const paddedTo = '0x000000000000000000000000' + walletLower.slice(2);
  const BLOCKS_3H = 6000; // tăng lên 6000 block ~5h
  
  for(const rpcUrl of rpcUrls){
    try{
      // lấy latest block
      let latestBlock = null;
      try{
        const resBlock = await fetch(rpcUrl, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({jsonrpc:'2.0', id:1, method:'eth_blockNumber', params:[]}),
          signal: AbortSignal.timeout(8000)
        });
        const jBlock = await resBlock.json();
        if(jBlock.result) latestBlock = parseInt(jBlock.result, 16);
      }catch(e){}
      
      if(!latestBlock){
        console.warn(`[RPC Logs ${rpcUrl}] cannot get latest block, try with latest tag`);
        // fallback vẫn thử với fromBlock = latest - BLOCKS_3H bằng tag latest
      }
      const fromBlockHex = latestBlock ? ('0x' + Math.max(0, latestBlock - BLOCKS_3H).toString(16)) : ('0x' + (0).toString(16));
      
      console.log(`[RPC Logs] Scanning ${rpcUrl} from ${fromBlockHex} to latest for wallet ${walletLower.slice(0,10)}...`);
      
      // Thử 2 kiểu: 1) filter theo contract + to, 2) chỉ filter theo to (bắt mọi token)
      const queries = [
        {
          label: 'USDT contract + to',
          params: { fromBlock: fromBlockHex, toBlock: 'latest', address: contract, topics: [transferTopic, null, paddedTo] }
        },
        {
          label: 'Any token to wallet',
          params: { fromBlock: fromBlockHex, toBlock: 'latest', topics: [transferTopic, null, paddedTo] }
        }
      ];
      
      for(const q of queries){
        try{
          const res = await fetch(rpcUrl, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getLogs', params:[q.params] }),
            signal: AbortSignal.timeout(15000)
          });
          const json = await res.json();
          if(!json.result || !Array.isArray(json.result)){
            console.warn(`[RPC Logs ${rpcUrl} ${q.label}] no result`, JSON.stringify(json).slice(0,300));
            continue;
          }
          const logs = json.result;
          console.log(`[RPC Logs ${rpcUrl} ${q.label}] Found ${logs.length} Transfer logs to wallet in last ~5h`);
          
          if(logs.length === 0) continue;
          
          // Lọc theo contract nếu query any token
          let filteredLogs = logs;
          if(q.label.includes('Any token')){
            filteredLogs = logs.filter(l=> l.address?.toLowerCase() === contractLower);
            console.log(`[RPC Logs ${rpcUrl} ${q.label}] After USDT filter: ${filteredLogs.length} logs`);
          }
          
          const candidates = [];
          for(const log of filteredLogs){
            try{
              const value = parseInt(log.data, 16) / 1e18;
              // log chi tiết để debug
              console.log(`[RPC Logs] Log value ${value} tx ${log.transactionHash?.slice(0,10)} from ${log.topics[1]?.slice(0,10)}... to ${log.topics[2]?.slice(0,10)}...`);
              if(value >= expectedUsdt * 0.80){ // nới lỏng 20% cho MEXC
                candidates.push({ log, value });
              }
            }catch(e){}
          }
          
          if(candidates.length > 0){
            candidates.sort((a,b)=> parseInt(b.log.blockNumber,16) - parseInt(a.log.blockNumber,16));
            const best = candidates[0];
            const log = best.log;
            const value = best.value;
            const fromAddr = log.topics[1] ? '0x' + log.topics[1].slice(26) : 'unknown';
            const txHash = log.transactionHash;
            console.log(`[RPC Logs] ✅ Found tx ${txHash} value ${value} from ${fromAddr}`);
            return {
              found:true,
              value,
              from: fromAddr,
              to: walletAddress,
              tx: { hash: txHash, blockNumber: log.blockNumber, logIndex: log.logIndex },
              autoDetected:true,
              _source:'BSC RPC eth_getLogs ('+q.label+')',
              _rpcUrl: rpcUrl
            };
          }
        }catch(e){
          console.warn(`[RPC Logs ${rpcUrl} ${q.label}] error`, e.message);
          continue;
        }
      }
    }catch(e){
      console.warn(`[RPC Logs ${rpcUrl}] outer error`, e.message);
      continue;
    }
  }
  return { found:false, _source:'RPC Logs' };
}

async function verifyViaBscRpc(txHash, walletAddress, expectedUsdt, contract){
  try{
    const rpcUrls = [
      'https://bsc-dataseed.binance.org/',
      'https://bsc-dataseed1.binance.org/',
      'https://bsc-dataseed2.binance.org/',
      'https://bsc-dataseed3.binance.org/',
      'https://bsc-dataseed4.binance.org/',
      'https://bsc.publicnode.com',
      'https://binance.llamarpc.com',
      'https://rpc.ankr.com/bsc'
    ];
    const walletLower = walletAddress.toLowerCase();
    const contractLower = contract.toLowerCase();
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    
    for(const rpcUrl of rpcUrls){
      try{
        const res = await fetch(rpcUrl, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_getTransactionReceipt', params:[txHash] }),
          signal: AbortSignal.timeout(10000)
        });
        const json = await res.json();
        if(!json.result) continue;
        const receipt = json.result;
        if(receipt.status !== '0x1') {
          return { found:false, reason:`Tx ${txHash.slice(0,10)}... thất bại`, receipt };
        }
        const logs = receipt.logs || [];
        for(const log of logs){
          if(log.address?.toLowerCase() !== contractLower) continue;
          if(!log.topics || log.topics[0]?.toLowerCase() !== transferTopic) continue;
          if(!log.topics[2]) continue;
          const toAddr = '0x' + log.topics[2].slice(26);
          if(toAddr.toLowerCase() !== walletLower) continue;
          const value = parseInt(log.data, 16) / 1e18;
          if(value >= expectedUsdt * 0.90){
            return { found:true, value, from: log.topics[1] ? '0x'+log.topics[1].slice(26) : receipt.from, to: toAddr, txHash, _source:'BSC RPC direct', rpcUrl };
          } else {
            return { found:false, reason:`Số tiền không đủ. Nhận ${value} USDT, yêu cầu ${expectedUsdt} USDT`, value, _source:'BSC RPC direct' };
          }
        }
      }catch(e){ continue; }
    }
    return { found:false, reason:'Không tìm thấy log Transfer USDT đến ví này trong receipt', _source:'BSC RPC' };
  }catch(e){
    return { found:false, error:e.message, _source:'BSC RPC error' };
  }
}

async function scanBscForUsdtPayment(walletAddress, expectedUsdt, txHashFilter=null){
  const apiKey = process.env.BSCSCAN_API_KEY || BSCSCAN_API_KEY;
  const etherscanKey = process.env.ETHERSCAN_API_KEY || apiKey;
  const contract = USDT_BEP20_CONTRACT;
  const walletLower = walletAddress.toLowerCase();
  
  // 1. Nếu có txHash -> ưu tiên RPC receipt trước (chính xác nhất)
  if(txHashFilter){
    console.log(`[BSCScan] Verify via RPC receipt first for ${txHashFilter.slice(0,15)}...`);
    const rpcResult = await verifyViaBscRpc(txHashFilter, walletAddress, expectedUsdt, contract);
    if(rpcResult.found){
      return { ...rpcResult, tx: { hash: txHashFilter }, from: rpcResult.from, to: rpcResult.to };
    }
    console.log(`[BSCScan] RPC receipt không tìm thấy, thử tiếp logs và API: ${rpcResult.reason}`);
  }
  
  // 2. AUTO SCAN: Thử quét trực tiếp bằng RPC eth_getLogs TRƯỚC - không phụ thuộc BSCScan, không bị Cloudflare
  if(!txHashFilter){
    console.log(`[BSCScan] Auto scan via RPC eth_getLogs first for ${walletAddress.slice(0,10)}... expected ${expectedUsdt}`);
    const rpcLogsResult = await scanViaRpcLogs(walletAddress, expectedUsdt, contract);
    if(rpcLogsResult.found){
      console.log(`[BSCScan] Auto scan SUCCESS via RPC Logs: ${rpcLogsResult.tx.hash} value ${rpcLogsResult.value}`);
      return rpcLogsResult;
    }
    console.log(`[BSCScan] RPC Logs không tìm thấy, fallback sang BSCScan API...`);
  }
  
  // 3. Fallback sang BSCScan API (cho trường hợp RPC lag)
  const endpoints = [
    {
      label: 'BSCScan.com',
      url: `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${contract}&address=${walletAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`
    },
    {
      label: 'Etherscan V2 (BSC)',
      url: `https://api.etherscan.io/v2/api?chainid=56&module=account&action=tokentx&contractaddress=${contract}&address=${walletAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${etherscanKey}`
    },
    {
      label: 'Blockscout',
      url: `https://api.blockscout.com/bnb/api?module=account&action=tokentx&contractaddress=${contract}&address=${walletAddress}`
    }
  ];
  
  let htmlBlockedCount = 0;
  let lastResult = null;
  
  for(const ep of endpoints){
    console.log(`[BSCScan] Trying ${ep.label} for ${walletAddress.slice(0,10)}...`);
    const result = await fetchBscScanWithFallback(ep.url, ep.label);
    
    if(result.blocked){
      htmlBlockedCount++;
      if(htmlBlockedCount < endpoints.length){
        await new Promise(r=>setTimeout(r, 500));
        continue;
      }
    } else {
      const data = result.data;
      if(!data || data.status !== '1' || !Array.isArray(data.result)){
        if((data?.message||'').toLowerCase().includes('no transactions found')){
          if(txHashFilter) continue;
          return { found:false, reason:'Chưa tìm thấy giao dịch USDT nào khớp trong 3 giờ gần nhất', recentCount: 0, _empty:true, _source: ep.label };
        }
        if(txHashFilter) continue;
        if(data?.status !== '1') continue;
      }
      
      let txs = data.result;
      console.log(`[BSCScan ${ep.label}] Got ${txs.length} txs`);
      
      if(txHashFilter){
        const cleanFilter = txHashFilter.toLowerCase().trim();
        const tx = txs.find(t=> t.hash && t.hash.toLowerCase() === cleanFilter);
        if(tx){
          const toMatch = tx.to?.toLowerCase() === walletLower;
          if(!toMatch) return { found:false, reason:`Tx gửi đến ${tx.to} không phải ví ${walletAddress}`, _source: ep.label };
          const value = parseFloat(tx.value) / 1e18;
          if(value < expectedUsdt * 0.90) return { found:false, reason:`Số tiền không đủ. Nhận ${value} USDT`, tx, value, _source: ep.label };
          return { found:true, tx, value, from: tx.from, to: tx.to, _source: ep.label };
        } else {
          continue;
        }
      }
      
      const threeHoursAgo = Math.floor(Date.now()/1000) - 180*60;
      const candidates = txs.filter(t=>{
        const toMatch = t.to?.toLowerCase() === walletLower;
        const timeMatch = parseInt(t.timeStamp) >= threeHoursAgo;
        const value = parseFloat(t.value) / 1e18;
        const amountMatch = value >= expectedUsdt * 0.80;
        return toMatch && timeMatch && amountMatch;
      });
      
      if(candidates.length>0){
        const tx = candidates[0];
        const value = parseFloat(tx.value) / 1e18;
        return { found:true, tx, value, from: tx.from, to: tx.to, autoDetected:true, _source: ep.label };
      }
      lastResult = { recentCount: txs.length };
    }
  }
  
  if(txHashFilter){
    const rpcFinal = await verifyViaBscRpc(txHashFilter, walletAddress, expectedUsdt, contract);
    if(rpcFinal.found) return { ...rpcFinal, tx:{hash:txHashFilter} };
    return { found:false, reason: `Không tìm thấy TxHash trên tất cả nguồn. Ví nhận ${walletAddress} có khớp với To trong BSCScan không?`, _source:'All sources' };
  }
  
  if(htmlBlockedCount >= endpoints.length){
    return { found:false, reason:'BSCScan bị chặn Cloudflare, RPC Logs cũng không tìm thấy. Hãy đợi 1-2 phút cho block confirm hoặc nhập TxHash để duyệt ngay.', _html:true, _allBlocked:true };
  }
  
  return { found:false, reason:'Chưa tìm thấy giao dịch USDT nào khớp trong 3 giờ gần nhất. Đã quét trực tiếp node BSC và 3 explorer. Nếu vừa chuyển, đợi 1-2 phút cho node đồng bộ.', recentCount: lastResult?.recentCount||0, _empty:true };
}


router.post('/payment/usdt/verify', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { email, requestId, txHash, walletId } = req.body;
    
    let targetReq = null;
    if(requestId){
      const {data} = await supabaseAdmin.from('vip_requests').select('*').eq('id', requestId).single();
      targetReq = data;
    }else if(email){
      const {data} = await supabaseAdmin.from('vip_requests').select('*').eq('email', email.toLowerCase()).eq('status','PENDING').ilike('content','%usdt%').order('created_at',{ascending:false}).limit(1).maybeSingle();
      targetReq = data;
    }
    
    if(!targetReq){
      return res.status(400).json({success:false, message:'Không tìm thấy yêu cầu USDT PENDING'});
    }
    
    if(txHash){
      const cleanHash = txHash.trim();
      const {data: existingTx} = await supabaseAdmin.from('vip_requests').select('id').ilike('content', `%${cleanHash}%`).eq('status','APPROVED').limit(1);
      if(existingTx && existingTx.length>0){
        return res.status(400).json({success:false, message:'TxHash này đã được sử dụng trước đó!'});
      }
    }
    
    let wallet = null;
    if(walletId){
      const {data} = await supabaseAdmin.from('usdt_wallets').select('*').eq('id', walletId).maybeSingle();
      wallet = data;
    }
    if(!wallet){
      const {data} = await supabaseAdmin.from('usdt_wallets').select('*').eq('network','BEP20').eq('is_active', true).limit(1).maybeSingle();
      if(data) wallet = data;
      else {
        const {data: anyWallet} = await supabaseAdmin.from('usdt_wallets').select('*').eq('is_active', true).limit(1).maybeSingle();
        wallet = anyWallet;
      }
    }
    
    if(!wallet){
      return res.status(400).json({success:false, message:'Không tìm thấy ví USDT BEP20'});
    }
    
    let expectedUsdt = 0;
    try{
      const match = targetReq.content?.match(/([0-9.]+)USDT/);
      if(match) expectedUsdt = parseFloat(match[1]);
    }catch{}
    if(!expectedUsdt){
      const plansRes = await getPlans(true);
      const plan = plansRes.plans.find(p=>p.key===targetReq.plan_key);
      const vndPrice = await getUsdtVndPrice();
      expectedUsdt = parseFloat(((plan?.price||targetReq.amount||0) / vndPrice).toFixed(4));
    }
    
    const cleanHash = txHash ? txHash.trim() : null;
    const scanResult = await scanBscForUsdtPayment(wallet.address, expectedUsdt, cleanHash);
    
    if(!scanResult.found){
      if(cleanHash){
        await supabaseAdmin.from('vip_requests').update({
          content: `${targetReq.content} | tx:${cleanHash} | scan_fail:${scanResult.reason||scanResult.error} | wallet:${wallet.address}`,
          updated_at: new Date().toISOString()
        }).eq('id', targetReq.id);
      }
      return res.json({
        success:false,
        verified:false,
        message: scanResult.reason || scanResult.error || 'Chưa tìm thấy giao dịch khớp trên BSCScan',
        scanResult,
        expected: expectedUsdt,
        wallet: wallet.address
      });
    }
    
    const tx = scanResult.tx;
    const received = scanResult.value;
    const fromAddr = scanResult.from;
    const finalTxHash = tx.hash;
    
    const {data: dupCheck} = await supabaseAdmin.from('vip_requests').select('id').ilike('content', `%${finalTxHash}%`).eq('status','APPROVED').limit(1);
    if(dupCheck && dupCheck.length>0){
      return res.status(400).json({success:false, message:'Giao dịch này đã được dùng để duyệt VIP trước đó!'});
    }
    
    const plansRes = await getPlans(true);
    const plan = plansRes.plans.find(p=>p.key===targetReq.plan_key);
    const months = plan?.months || 1;
    const expireDate = new Date();
    expireDate.setMonth(expireDate.getMonth() + months);
    
    await supabaseAdmin.from('users').update({
      is_vip:true, vip_status:'APPROVED',
      expired_date: expireDate.toISOString(),
      updated_at: new Date().toISOString()
    }).eq('email', targetReq.email.toLowerCase());
    
    await supabaseAdmin.from('vip_requests').update({
      status:'APPROVED',
      content: `${targetReq.content} | tx:${finalTxHash} | verified:${received}USDT BEP20 | from:${fromAddr} | auto:BSCScan`,
      updated_at: new Date().toISOString()
    }).eq('id', targetReq.id);
    
    try{
      const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const msg = `✅🌍 <b>AUTO DUYỆT VIP - USDT BEP20 (BSCScan)</b> 🌍✅
━━━━━━━━━━━━━━
👤 <b>Email:</b> ${targetReq.email}
💳 <b>Gói:</b> ${targetReq.plan_key} (${months} tháng)
💵 <b>USDT:</b> ${received} USDT (BEP20)
💰 <b>Expected:</b> ${expectedUsdt} USDT
🔗 <b>TxHash:</b> <code>${finalTxHash}</code>
👛 <b>Từ:</b> <code>${fromAddr?.slice(0,10)}...${fromAddr?.slice(-6)}</code>
👛 <b>Đến:</b> <code>${wallet.address.slice(0,10)}...${wallet.address.slice(-6)}</code>
📅 <b>Hạn:</b> ${expireDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
⏰ <b>Thời gian:</b> ${timeVN}
🔍 <b>Scan:</b> ${scanResult.autoDetected ? 'Auto phát hiện 15p' : 'Verify TxHash'}
━━━━━━━━━━━━━━
🤖 Auto duyệt qua BSCScan!`;
      await sendTelegramDirect(msg);
    }catch(e){}
    
    return res.json({
      success:true,
      verified:true,
      autoApproved:true,
      message:`Đã xác minh và auto duyệt VIP ${months} tháng! Nhận ${received} USDT`,
      tx: { hash: finalTxHash, from: fromAddr, to: wallet.address, value: received },
      expireDate: expireDate.toISOString(),
      expected: expectedUsdt,
      received
    });
    
  }catch(e){
    console.error('[usdt/verify] fatal', e.message, e.stack);
    res.status(500).json({success:false, message:e.message});
  }
});

router.post('/payment/usdt/scan', async (req,res)=>{
  try{
    const { email, requestId, walletId } = req.body;
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    
    let targetReq = null;
    if(requestId){
      const {data} = await supabaseAdmin.from('vip_requests').select('*').eq('id', requestId).single();
      targetReq = data;
    }else if(email){
      const {data} = await supabaseAdmin.from('vip_requests').select('*').eq('email', email.toLowerCase()).eq('status','PENDING').ilike('content','%usdt%').order('created_at',{ascending:false}).limit(1).maybeSingle();
      targetReq = data;
    }
    if(!targetReq) return res.json({success:false, found:false, message:'Không có PENDING USDT'});
    
    let wallet = null;
    if(walletId){
      const {data} = await supabaseAdmin.from('usdt_wallets').select('*').eq('id', walletId).maybeSingle();
      wallet = data;
    }
    if(!wallet){
      const {data} = await supabaseAdmin.from('usdt_wallets').select('*').eq('network','BEP20').eq('is_active', true).limit(1).maybeSingle();
      wallet = data;
    }
    if(!wallet) return res.json({success:false, message:'Chưa có ví BEP20'});
    
    let expectedUsdt = 0;
    try{
      const m = targetReq.content?.match(/([0-9.]+)USDT/);
      if(m) expectedUsdt = parseFloat(m[1]);
    }catch{}
    if(!expectedUsdt){
      const plansRes = await getPlans(true);
      const plan = plansRes.plans.find(p=>p.key===targetReq.plan_key);
      const vndPrice = await getUsdtVndPrice();
      expectedUsdt = parseFloat(((plan?.price||targetReq.amount||0) / vndPrice).toFixed(4));
    }
    
    const scanResult = await scanBscForUsdtPayment(wallet.address, expectedUsdt, null);
    if(!scanResult.found){
      return res.json({success:true, found:false, message: scanResult.reason, expected: expectedUsdt});
    }
    
    const tx = scanResult.tx;
    const received = scanResult.value;
    const fromAddr = scanResult.from;
    const finalTxHash = tx.hash;
    
    const {data: dupCheck} = await supabaseAdmin.from('vip_requests').select('id').ilike('content', `%${finalTxHash}%`).eq('status','APPROVED').limit(1);
    if(dupCheck && dupCheck.length>0){
      return res.json({success:false, message:'Giao dịch này đã được dùng trước đó'});
    }
    
    const plansRes = await getPlans(true);
    const plan = plansRes.plans.find(p=>p.key===targetReq.plan_key);
    const months = plan?.months || 1;
    const expireDate = new Date();
    expireDate.setMonth(expireDate.getMonth() + months);
    
    await supabaseAdmin.from('users').update({
      is_vip:true, vip_status:'APPROVED',
      expired_date: expireDate.toISOString(),
      updated_at: new Date().toISOString()
    }).eq('email', targetReq.email.toLowerCase());
    
    await supabaseAdmin.from('vip_requests').update({
      status:'APPROVED',
      content: `${targetReq.content} | tx:${finalTxHash} | autoScan:${received}USDT | from:${fromAddr}`,
      updated_at: new Date().toISOString()
    }).eq('id', targetReq.id);
    
    try{
      const msg = `✅🌍 <b>AUTO DUYỆT VIP - USDT AUTO SCAN</b> 🌍✅
👤 ${targetReq.email} - ${targetReq.plan_key} (${months} tháng)
💵 ${received} USDT BEP20
🔗 ${finalTxHash}`;
      await sendTelegramDirect(msg);
    }catch{}
    
    return res.json({success:true, found:true, autoApproved:true, tx: {hash: finalTxHash, value: received, from: fromAddr}, expireDate: expireDate.toISOString()});
    
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});



// ===== TRIAL 3 LẦN - LOGIC CHUẨN V13b =====
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
      const {data:user} = await supabaseAdmin.from('users').select('is_vip, trial_used').eq('email', email).single();
      if(user){ isVip=!!user.is_vip; trialUsed=user.trial_used||0; }
    }catch{}
    let tabEnabled=true;
    try{
      const {data:tab} = await supabaseAdmin.from('app_settings').select('value').eq('id','upgrade_tab_enabled').single();
      if(tab?.value?.enabled!==undefined) tabEnabled=!!tab.value.enabled;
    }catch{}
    const canFull = isVip || !tabEnabled || trialUsed < TRIAL_LIMIT;
    const limited = !isVip && tabEnabled && trialUsed >= TRIAL_LIMIT;
    res.json({ success:true, isVip, trialUsed, trialLimit:TRIAL_LIMIT, tabEnabled, canFull, limited, remaining: Math.max(0, TRIAL_LIMIT - trialUsed), email, _v13b:true });
  }catch(e){
    res.json({success:true, isVip:false, trialUsed:0, trialLimit:TRIAL_LIMIT, tabEnabled:true, canFull:true, limited:false, remaining:TRIAL_LIMIT, _error:e.message});
  }
});

router.post('/trial-consume', async (req,res)=>{
  try{
    const email = (req.body.email || req.headers['x-user-email'] || '').toLowerCase().trim();
    if(!email) return res.status(400).json({success:false, message:'Thiếu email'});
    if(!supabaseAdmin) return res.json({success:true, _mock:true});
    const {data:user} = await supabaseAdmin.from('users').select('is_vip, trial_used').eq('email', email).single();
    if(user?.is_vip) return res.json({success:true, isVip:true, trialUsed:user.trial_used||0, remaining:TRIAL_LIMIT, limited:false, trialLimit:TRIAL_LIMIT});
    const newCount = (user?.trial_used || 0) + 1;
    await supabaseAdmin.from('users').update({trial_used:newCount, updated_at:new Date().toISOString()}).eq('email', email);
    res.json({ success:true, trialUsed:newCount, remaining: Math.max(0, TRIAL_LIMIT - newCount), limited: newCount >= TRIAL_LIMIT, trialLimit:TRIAL_LIMIT, _v13b:true });
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});


// ===== CANCEL VIP - CHỜ FRONTEND 10P MỚI REJECTED =====
router.post('/cancel-vip', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { email, requestId, reason } = req.body || {};
    const headerEmail = (req.headers['x-user-email'] || '').toLowerCase().trim();
    const targetEmail = (email || headerEmail || '').toLowerCase().trim();
    if(!targetEmail) return res.status(400).json({success:false, message:'Missing email'});
    if(requestId){
      await supabaseAdmin.from('vip_requests').update({ status:'REJECTED', reason: reason || 'frontend_timeout_10m', updated_at:new Date().toISOString() }).eq('id', requestId);
    }else{
      await supabaseAdmin.from('vip_requests').update({ status:'REJECTED', reason: reason || 'frontend_timeout_10m', updated_at:new Date().toISOString() }).eq('email', targetEmail).eq('status','PENDING');
    }
    await supabaseAdmin.from('users').update({ vip_status:'REJECTED', updated_at:new Date().toISOString() }).eq('email', targetEmail);
    console.log(`[cancel-vip] Frontend timeout REJECTED ${targetEmail}`);
    return res.json({ success:true });
  }catch(e){ return res.status(500).json({success:false, message:e.message}); }
});

router.post('/request-vip/cancel', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { email, requestId, reason } = req.body || {};
    const targetEmail = (email || '').toLowerCase().trim();
    if(!targetEmail) return res.status(400).json({success:false, message:'Missing email'});
    await supabaseAdmin.from('vip_requests').update({ status:'REJECTED', reason: reason || 'frontend_timeout_10m', updated_at:new Date().toISOString() }).eq('email', targetEmail).eq('status','PENDING');
    await supabaseAdmin.from('users').update({ vip_status:'REJECTED', updated_at:new Date().toISOString() }).eq('email', targetEmail);
    return res.json({ success:true });
  }catch(e){ return res.status(500).json({success:false, message:e.message}); }
});

router.post('/vip/cancel', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { email, reason } = req.body || {};
    const targetEmail = (email || '').toLowerCase().trim();
    if(!targetEmail) return res.status(400).json({success:false, message:'Missing email'});
    await supabaseAdmin.from('vip_requests').update({ status:'REJECTED', reason: reason || 'frontend_timeout_10m', updated_at:new Date().toISOString() }).eq('email', targetEmail).eq('status','PENDING');
    await supabaseAdmin.from('users').update({ vip_status:'REJECTED', updated_at:new Date().toISOString() }).eq('email', targetEmail);
    return res.json({ success:true });
  }catch(e){ return res.status(500).json({success:false, message:e.message}); }
});

module.exports=router;
