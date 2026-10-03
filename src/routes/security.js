
const express = require('express');
const router = express.Router();
const config = require('../config');

// Whitelist - chỉ 2 user này được phép mở DevTools
const SECURITY_WHITELIST = ['chithanh2404@gmail.com','thanhprowadia6@gmail.com','admin@kararender.com'];

async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || config.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
    const data = await res.json().catch(()=>({}));
    return data.ok;
  } catch (e) { return false; }
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

// POST /api/security/log
router.post('/log', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  try {
    const { event, email, url, domain, fullUrl, origin, userAgent, details, isWhitelisted, screen, windowSize } = req.body || {};
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const headerEmail = (req.headers['x-user-email']||'').toLowerCase().trim();
    const finalEmail = (email||headerEmail||'Chưa đăng nhập').toString().slice(0,200);
    const eventType = (event||'Unknown').toString().slice(0,100);

    const isWhite = SECURITY_WHITELIST.includes(finalEmail.toLowerCase()) || isWhitelisted===true;
    if(isWhite){
      console.log(`[Security] Whitelisted ${finalEmail} - ${eventType}`);
      return res.json({ success:true, whitelisted:true });
    }

    let fullInfo;
    try{ fullInfo=getClientInfoFull(req); }catch{ fullInfo={ ip:clientIp, device:'Unknown', os:'Unknown', browser:'Unknown', deviceIcon:'💻', browserFull:userAgent||'' }; }

    const message = `🚨 <b>CẢNH BÁO BẢO MẬT</b>
⚠️ <b>Sự kiện:</b> ${eventType}
📧 <b>Email:</b> ${finalEmail}
🌐 <b>Domain:</b> ${domain||fullInfo.domain||'unknown'}
🔗 <b>Origin:</b> ${origin||fullInfo.origin||'unknown'}
📄 <b>URL:</b> ${(fullUrl||url||fullInfo.fullUrl||'').slice(0,500)}
📍 <b>IP:</b> ${fullInfo.ip||clientIp}
${fullInfo.deviceIcon} <b>Thiết bị:</b> ${fullInfo.device} - ${fullInfo.os} - ${fullInfo.browser}
🖥️ <b>UA:</b> ${(userAgent||fullInfo.browserFull||'').slice(0,400)}
📏 <b>Screen:</b> ${screen||'unknown'} | Window: ${windowSize||'unknown'}
📝 <b>Chi tiết:</b> ${(details||'').slice(0,500)}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`;

    await sendTelegramNotification(message);
    return res.json({ success:true });
  } catch(e){
    console.error('[Security] error', e.message);
    return res.status(500).json({ success:false, error:e.message });
  }
});

module.exports = router;
