const express = require('express');
const router = express.Router();
const config = require('../config');

// FIX CORS cho security router - phải có trước mọi route
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, Referer, X-Requested-With, X-User-Email, X-Admin-Token, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// DevTools exception - được phép mở DevTools nhưng KHÔNG phải admin
const DEVTOOLS_EXCEPTION = ['chithanh2404@gmail.com','thanhprowadia6@gmail.com'].map(e=>e.toLowerCase());

async function isAdminFromDB(email){
  try{
    if(!email || !email.includes('@')) return false;
    const { supabaseAdmin } = require('../services/supabase');
    if(!supabaseAdmin) return false;
    const { data: user } = await supabaseAdmin.from('users').select('role, is_admin, email').eq('email', email.toLowerCase().trim()).maybeSingle();
    if(!user) return false;
    const role = (user.role||'').toString().toUpperCase();
    if(role === 'ADMIN') return true;
    if(user.is_admin === true) return true;
    return false;
  }catch(e){ return false; }
}

async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || config.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[Security] Missing TELEGRAM_BOT_TOKEN or CHAT_ID');
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
    const data = await res.json().catch(()=>({}));
    if(!data.ok) console.warn('[Security] Telegram API error', data);
    return data.ok;
  } catch (e) { 
    console.warn('[Security] Telegram send failed', e.message);
    return false; 
  }
}

function getClientInfoFull(req) {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const origin = req.headers.origin || req.headers.referer || req.body?.origin || 'unknown';
    const domain = req.body?.domain || req.query?.domain || req.headers.origin || 'unknown';
    const fullUrl = req.body?.fullUrl || req.query?.fullUrl || req.headers.referer || 'unknown';
    const uaLower = userAgent.toLowerCase();
    let device = 'Desktop', deviceIcon='💻';
    if(/mobile|android|iphone|ipad/i.test(uaLower)){ device='Mobile'; deviceIcon='📱'; }
    let os='Unknown';
    if(uaLower.includes('windows')) os='Windows';
    else if(uaLower.includes('mac')) os='macOS';
    else if(uaLower.includes('android')) os='Android';
    else if(uaLower.includes('iphone')||uaLower.includes('ipad')) os='iOS';
    let browser='Unknown';
    if(uaLower.includes('chrome')) browser='Chrome';
    else if(uaLower.includes('firefox')) browser='Firefox';
    else if(uaLower.includes('safari')) browser='Safari';
    else if(uaLower.includes('edg')) browser='Edge';
    return { ip, userAgent, origin, domain, fullUrl, device, deviceIcon, os, browser, browserFull: userAgent.slice(0,400) };
  } catch { return { ip:'unknown', device:'Unknown', deviceIcon:'❓', os:'Unknown', browser:'Unknown', browserFull:'unknown', domain:'unknown', origin:'unknown', fullUrl:'unknown' }; }
}

// OPTIONS preflight handler
router.options('/log', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email, Authorization');
  return res.status(200).end();
});

// POST /api/security/log
router.post('/log', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-User-Email, Authorization');
  try {
    if(!req.body || Object.keys(req.body).length===0){
      console.warn('[Security] Empty body - check if express.json() is before router. Headers:', req.headers['content-type'], 'Query:', req.query);
    }
    const { event, email, fullName, full_name, url, domain, fullUrl, origin, userAgent, details, screen, windowSize } = req.body || {};
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const headerEmail = (req.headers['x-user-email']||'').toLowerCase().trim();
    const finalEmail = (email||headerEmail||'Chưa đăng nhập').toString().slice(0,200);
    const finalFullName = (fullName || full_name || 'Khách').toString().slice(0,200);
    let eventType = (event || details || req.query?.event || 'Unknown').toString().slice(0,100);
    if(eventType === 'Unknown' && details && details.length>2){
      eventType = details.slice(0,100);
    }
    const emailLower = finalEmail.toLowerCase().trim();

    // Whitelist DevTools + ADMIN từ backend
    let isWhite = DEVTOOLS_EXCEPTION.includes(emailLower);
    let reason = isWhite ? 'DEVTOOLS_EXCEPTION' : '';
    if(!isWhite){
      isWhite = await isAdminFromDB(finalEmail);
      if(isWhite) reason = 'ADMIN_BACKEND';
    }

    if(isWhite){
      console.log(`[Security] Whitelisted (${reason}) ${finalEmail} - ${eventType}`);
      return res.json({ success:true, whitelisted:true, reason });
    }

    let fullInfo;
    try{ fullInfo=getClientInfoFull(req); }catch{ fullInfo={ ip:clientIp, device:'Unknown', os:'Unknown', browser:'Unknown', deviceIcon:'💻', browserFull:userAgent||'' }; }

    const isPunishEvent = eventType.includes('PUNISH') || eventType.includes('RELOAD');
    const alertIcon = isPunishEvent ? '💥🔥' : '🚨';
    const punishNote = isPunishEvent ? '\n🔄 <b>TRẠNG THÁI:</b> Đang reload liên tục chống xem source' : '';
    const message = `${alertIcon} <b>${isPunishEvent ? 'PUNISHMENT - RELOAD LIÊN TỤC' : 'CẢNH BÁO BẢO MẬT'}</b>
⚠️ <b>Sự kiện:</b> ${eventType}${punishNote}
📧 <b>Email:</b> ${finalEmail}
👤 <b>Tên:</b> ${finalFullName}
🌐 <b>Domain:</b> ${domain||fullInfo.domain||'unknown'}
🔗 <b>Origin:</b> ${origin||fullInfo.origin||'unknown'}
📄 <b>URL:</b> ${(fullUrl||url||fullInfo.fullUrl||'').slice(0,500)}
📍 <b>IP:</b> ${fullInfo.ip||clientIp}
${fullInfo.deviceIcon} <b>Thiết bị:</b> ${fullInfo.device} - ${fullInfo.os} - ${fullInfo.browser}
🖥️ <b>UA:</b> ${(userAgent||fullInfo.browserFull||'').slice(0,400)}
📏 <b>Màn hình:</b> ${screen||'unknown'} | Window: ${windowSize||'unknown'}
📝 <b>Chi tiết:</b> ${(details||'').slice(0,500)}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}${isPunishEvent ? '\n🛡️ <b>Bảo vệ:</b> Anti-DevTools + Continuous Reload active' : ''}`;

    const sent = await sendTelegramNotification(message);
    console.log(`[Security] ${eventType} - ${finalEmail} - IP ${fullInfo.ip} - Telegram: ${sent ? 'OK' : 'FAIL'}`);
    return res.json({ success:true, telegram: sent });
  } catch(e){
    console.error('[Security] error', e.message);
    return res.status(500).json({ success:false, error:e.message });
  }
});

module.exports = router;
