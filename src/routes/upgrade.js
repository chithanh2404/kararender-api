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


// ===== USDT WALLETS - QUẢN TRỊ ADMIN =====
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

let usdtPriceCache = { price: 0, time: 0 };
async function getUsdtVndPrice(){
  const now = Date.now();
  if(usdtPriceCache.price && (now - usdtPriceCache.time < 60000)){
    return usdtPriceCache.price;
  }
  try{
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=vnd', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if(data?.tether?.vnd){
      usdtPriceCache = { price: parseFloat(data.tether.vnd), time: now };
      console.log('[USDT Price] CoinGecko:', usdtPriceCache.price);
      return usdtPriceCache.price;
    }
  }catch(e){ console.warn('[USDT Price] CoinGecko fail', e.message); }
  try{
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTVND', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if(data?.price){
      usdtPriceCache = { price: parseFloat(data.price), time: now };
      console.log('[USDT Price] Binance:', usdtPriceCache.price);
      return usdtPriceCache.price;
    }
  }catch(e){ console.warn('[USDT Price] Binance fail', e.message); }
  const fallback = parseFloat(process.env.VND_TO_USDT_RATE || '26200');
  usdtPriceCache = { price: fallback, time: now };
  console.log('[USDT Price] Fallback:', fallback);
  return fallback;
}

async function getUsdtPriceUsd(){
  try{
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if(data?.tether?.usd) return data.tether.usd;
  }catch{}
  return 1;
}

router.get('/payment/usdt-wallets', async (req,res)=>{
  try{
    if(!supabaseAdmin){
      return res.json({success:true, wallets:[], _mock:true});
    }
    const {data, error} = await supabaseAdmin.from('usdt_wallets').select('*').eq('is_active',true).order('created_at',{ascending:true});
    if(error){
      console.warn('[usdt-wallets public] error', error.message);
      return res.json({success:true, wallets:[], _error:error.message});
    }
    res.json({success:true, wallets: data||[], networks: USDT_NETWORKS});
  }catch(e){
    res.status(500).json({success:false, message:e.message, wallets:[]});
  }
});

router.get('/admin/usdt-wallets', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const {data, error} = await supabaseAdmin.from('usdt_wallets').select('*').order('created_at',{ascending:false});
    if(error){
      console.warn('[admin/usdt-wallets] error', error.message);
      return res.json({success:true, wallets:[], _needCreateTable:true, message:'Bảng usdt_wallets chưa tồn tại, cần tạo trong Supabase', networks: USDT_NETWORKS});
    }
    res.json({success:true, wallets: data||[], networks: USDT_NETWORKS});
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});

router.post('/admin/usdt-wallets', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { id, network, address, label, is_active } = req.body;
    if(!network || !address){
      return res.status(400).json({success:false, message:'Thiếu network hoặc address'});
    }
    if(!USDT_NETWORKS[network]){
      return res.status(400).json({success:false, message:'Network không hợp lệ. Chọn: '+Object.keys(USDT_NETWORKS).join(', ')});
    }
    const addr = address.trim();
    if(addr.length < 20){
      return res.status(400).json({success:false, message:'Địa chỉ ví quá ngắn'});
    }
    let payload = {
      network: network.toUpperCase(),
      address: addr,
      label: (label||`${network} Wallet`).trim(),
      is_active: is_active !== false,
      updated_at: new Date().toISOString()
    };
    if(id){
      const {data, error} = await supabaseAdmin.from('usdt_wallets').update(payload).eq('id', id).select().single();
      if(error) throw error;
      console.log(`[usdt-wallets] Updated ${id} ${network} ${addr}`);
      return res.json({success:true, wallet: data});
    }else{
      payload.created_at = new Date().toISOString();
      const {data, error} = await supabaseAdmin.from('usdt_wallets').insert(payload).select().single();
      if(error) throw error;
      console.log(`[usdt-wallets] Created ${network} ${addr}`);
      return res.json({success:true, wallet: data});
    }
  }catch(e){
    console.error('[admin/usdt-wallets] save error', e.message);
    res.status(500).json({success:false, message:e.message});
  }
});

router.delete('/admin/usdt-wallets/:id', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const {id} = req.params;
    const {error} = await supabaseAdmin.from('usdt_wallets').delete().eq('id', id);
    if(error) throw error;
    console.log(`[usdt-wallets] Deleted ${id}`);
    res.json({success:true});
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});

router.get('/payment/usdt/price', async (req,res)=>{
  try{
    const vndPrice = await getUsdtVndPrice();
    const usdPrice = await getUsdtPriceUsd();
    res.json({success:true, vnd: vndPrice, usd: usdPrice, timestamp: new Date().toISOString(), source: 'coingecko/binance'});
  }catch(e){
    res.status(500).json({success:false, message:e.message, vnd: 26200, usd: 1});
  }
});

router.post('/payment/usdt/create', async (req,res)=>{
  try{
    if(!supabaseAdmin) return res.status(500).json({success:false, message:'supabaseAdmin NULL'});
    const { email, planKey, network, walletId } = req.body;
    if(!email || !planKey) return res.status(400).json({success:false, message:'Thiếu email hoặc planKey'});
    
    const plansRes = await getPlans(false);
    const plan = plansRes.plans.find(p=>p.key===planKey)||{price:0, label:planKey, months:1};
    
    let wallet = null;
    if(walletId){
      const {data} = await supabaseAdmin.from('usdt_wallets').select('*').eq('id', walletId).single();
      wallet = data;
    }else if(network){
      const {data} = await supabaseAdmin.from('usdt_wallets').select('*').eq('network', network).eq('is_active', true).limit(1).maybeSingle();
      wallet = data;
    }else{
      const {data: bep20} = await supabaseAdmin.from('usdt_wallets').select('*').eq('network','BEP20').eq('is_active', true).order('created_at',{ascending:true}).limit(1).maybeSingle();
      if(bep20) wallet = bep20;
      else {
        const {data} = await supabaseAdmin.from('usdt_wallets').select('*').eq('is_active', true).order('created_at',{ascending:true}).limit(1).maybeSingle();
        wallet = data;
      }
    }
    
    if(!wallet){
      return res.status(400).json({success:false, message:'Chưa cấu hình ví USDT nào. Admin cần thêm ví BEP20 trong Dashboard tab USDT.'});
    }
    
    const vndPrice = await getUsdtVndPrice();
    const usdPrice = await getUsdtPriceUsd();
    const usdtAmount = parseFloat((plan.price / vndPrice).toFixed(4));
    
    let fullName = email;
    try{
      const {data:user} = await supabaseAdmin.from('users').select('full_name').eq('email', email.toLowerCase()).single();
      if(user?.full_name) fullName = user.full_name;
    }catch{}
    
    try{
      const tenMinAgo = new Date(Date.now() - 10*60*1000).toISOString();
      const {data: existingPending} = await supabaseAdmin.from('vip_requests')
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
        console.log(`[usdt/create] Duplicate detected, return existing ${existingPending.id}`);
        return res.json({
          success:true,
          requestId: existingPending.id,
          _duplicate:true,
          wallet: {
            id: wallet.id,
            network: wallet.network,
            address: wallet.address,
            label: wallet.label,
            explorer: USDT_NETWORKS[wallet.network]?.explorer + wallet.address
          },
          plan: { key: plan.key, label: plan.label, months: plan.months, priceVND: plan.price, priceUSDT: usdtAmount },
          amount: { vnd: plan.price, usdt: usdtAmount, vndPerUsdt: vndPrice, usdPerUsdt: usdPrice },
          content: existingPending.content
        });
      }
    }catch(e){ console.warn('[usdt/create] duplicate check error', e.message); }
    
    const content = `usdt ${email} ${planKey} ${wallet.network} ${usdtAmount}USDT rate:${vndPrice}`;
    const {data: reqData, error: reqErr} = await supabaseAdmin.from('vip_requests').insert({
      email: email.toLowerCase(),
      full_name: fullName,
      plan_key: planKey,
      amount: plan.price,
      content: content + ` | wallet:${wallet.address.slice(0,10)}... | tx:pending | expected:${usdtAmount}USDT`,
      status: 'PENDING'
    }).select().single();
    
    if(reqErr){
      console.error('[usdt/create] insert error', reqErr.message);
      return res.status(500).json({success:false, message:reqErr.message});
    }
    
    try{
      const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const msg = `💸 <b>YÊU CẦU USDT - KARARENDER</b> 💸
━━━━━━━━━━━━━━
👤 <b>Email:</b> ${email}
👤 <b>Tên:</b> ${fullName}
💳 <b>Gói:</b> ${planKey} (${plan.months} tháng)
💰 <b>VND:</b> ${plan.price.toLocaleString('vi-VN')}đ
💵 <b>USDT:</b> ${usdtAmount} USDT (BEP20)
💱 <b>Tỷ giá:</b> ${vndPrice.toLocaleString('vi-VN')} VND/USDT
🌐 <b>Mạng:</b> ${wallet.network}
👛 <b>Ví:</b> <code>${wallet.address}</code>
📝 <b>Nội dung:</b> <code>${content}</code>
⏰ <b>Thời gian:</b> ${timeVN}
🆔 <b>Request ID:</b> <code>${reqData?.id||'N/A'}</code>
━━━━━━━━━━━━━━
⚠️ User sẽ chuyển USDT BEP20 và hệ thống tự quét BSCScan`;
      await sendTelegramDirect(msg);
    }catch(e){ console.warn('[usdt/create] telegram error', e.message); }
    
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
      content: content
    });
    
  }catch(e){
    console.error('[usdt/create] fatal', e.message, e.stack);
    res.status(500).json({success:false, message:e.message});
  }
});

async function scanBscForUsdtPayment(walletAddress, expectedUsdt, txHashFilter=null){
  const apiKey = BSCSCAN_API_KEY;
  const contract = USDT_BEP20_CONTRACT;
  try{
    const url = `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${contract}&address=${walletAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    
    if(data.status !== '1' || !data.result || !Array.isArray(data.result)){
      console.warn('[BSCScan] API error', data.message, JSON.stringify(data).slice(0,500));
      return { found:false, error: data.message || 'BSCScan API error', raw: data };
    }
    
    if(txHashFilter){
      const tx = data.result.find(t=> t.hash?.toLowerCase() === txHashFilter.toLowerCase());
      if(!tx){
        return { found:false, reason:'TxHash không tìm thấy trong 20 giao dịch gần nhất của ví này' };
      }
      if(tx.to?.toLowerCase() !== walletAddress.toLowerCase()){
        return { found:false, reason:`Tx này không gửi đến ví ${walletAddress}, mà đến ${tx.to}` };
      }
      const value = parseFloat(tx.value) / 1e18;
      const minRequired = expectedUsdt * 0.97;
      if(value < minRequired){
        return { found:false, reason:`Số tiền không đủ. Nhận ${value} USDT, yêu cầu tối thiểu ${minRequired} USDT (expected ${expectedUsdt})`, tx, value };
      }
      return { found:true, tx, value, from: tx.from, to: tx.to };
    }
    
    const fifteenMinAgo = Math.floor(Date.now()/1000) - 15*60;
    const candidates = data.result.filter(t=>{
      const toMatch = t.to?.toLowerCase() === walletAddress.toLowerCase();
      const timeMatch = parseInt(t.timeStamp) >= fifteenMinAgo;
      const value = parseFloat(t.value) / 1e18;
      const amountMatch = value >= expectedUsdt * 0.97;
      return toMatch && timeMatch && amountMatch;
    });
    
    if(candidates.length>0){
      const tx = candidates[0];
      const value = parseFloat(tx.value) / 1e18;
      return { found:true, tx, value, from: tx.from, to: tx.to, autoDetected:true };
    }
    
    return { found:false, reason:'Chưa tìm thấy giao dịch USDT nào khớp trong 15 phút gần nhất', recentCount: data.result.length };
    
  }catch(e){
    console.error('[BSCScan] fetch error', e.message);
    return { found:false, error: e.message };
  }
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
