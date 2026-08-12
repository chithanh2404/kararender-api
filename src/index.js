require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('./config');

if (!config.ALLOWED_HOSTS || config.ALLOWED_HOSTS.length === 0) {
  config.ALLOWED_HOSTS = ['kararender.com', 'www.kararender.com', 'localhost', '127.0.0.1'];
  config.ALLOWED_HOSTS_STRICT = ['https://kararender.com', 'https://www.kararender.com'];
}

const app = express();
const PORT = config.PORT;
app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Origin','Referer','X-Requested-With'] }));
app.options('*', cors());

// Telegram với đầy đủ thông tin như mã nguồn cũ: domain, IP, browser, origin, fullUrl
async function sendTelegramNotification(message) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.log('[Telegram] Skipped - no token/chat_id');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
    });
    const data = await res.json();
    if (!data.ok) console.warn('[Telegram] Failed', JSON.stringify(data));
  } catch (e) {
    console.error('[Telegram] Error', e.message);
  }
}

// Email sending for OTP - Sử dụng Apps Script chính của user (đã có sẵn hàm xử lý)
const PRIMARY_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz_i60tGtyk_WOIAYiLuurAxs6dxWALfJ8ggmw5U2guscK-eyZ2enUMd4CRz8lRs8w/exec";

async function sendOTPEmailViaAppsScript(toEmail, otp, userName = '', clientIp = '') {
  try {
    const appsScriptUrl = process.env.APPS_SCRIPT_URL || process.env.APPS_SCRIPT_EMAIL_URL || PRIMARY_APPS_SCRIPT_URL;
    
    // Thử 3 URL khác nhau để đảm bảo gửi được mail
    const urlsToTry = [
      // 1. Action mới sendOTPEmail không callback - trả JSON
      `${appsScriptUrl}${appsScriptUrl.includes('?') ? '&' : '?'}action=sendOTPEmail&email=${encodeURIComponent(toEmail)}&otp=${encodeURIComponent(otp)}&ip=${encodeURIComponent(clientIp || '')}&name=${encodeURIComponent(userName || '')}`,
      // 2. Action sendOTPEmail với callback cb
      `${appsScriptUrl}${appsScriptUrl.includes('?') ? '&' : '?'}action=sendOTPEmail&email=${encodeURIComponent(toEmail)}&otp=${encodeURIComponent(otp)}&ip=${encodeURIComponent(clientIp || '')}&name=${encodeURIComponent(userName || '')}&callback=cb`,
      // 3. Action sendOTP cũ với otp param
      `${appsScriptUrl}${appsScriptUrl.includes('?') ? '&' : '?'}action=sendOTP&email=${encodeURIComponent(toEmail)}&otp=${encodeURIComponent(otp)}&ip=${encodeURIComponent(clientIp || '')}&name=${encodeURIComponent(userName || '')}&callback=cb`,
    ];
    
    for (let i = 0; i < urlsToTry.length; i++) {
      const url = urlsToTry[i];
      try {
        console.log(`[Email AppsScript] Attempt ${i+1}/3: ${url.slice(0,150)}...`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const res = await fetch(url, { 
          method: 'GET', 
          headers: { 'User-Agent': 'KaraRender-Backend' },
          redirect: 'follow',
          signal: controller.signal
        });
        clearTimeout(timeout);
        
        const result = await res.text();
        console.log(`[Email AppsScript] Attempt ${i+1} response (${result.length} chars): ${result.slice(0,600)}`);
        
        // Thành công nếu có các từ khóa này
        if (result.includes('Đã gửi') || result.includes('Mã OTP đã được gửi') || result.includes('success') || result.includes('"success":true') || result.includes('cb(')) {
          // Nếu response là JSON error thì check
          if (result.includes('"success":false') || result.includes('❌')) {
            console.log(`[Email AppsScript] Attempt ${i+1} reported failure: ${result.slice(0,300)}`);
            if (result.includes('quá nhiều')) {
              return { success: false, error: result.slice(0,300), via: 'appscript-rate-limit' };
            }
            continue; // Thử URL tiếp theo
          }
          console.log(`[Email AppsScript] Attempt ${i+1} SUCCESS with OTP ${otp}`);
          return { success: true, via: 'appscript-attempt-' + (i+1), raw: result.slice(0,300), usedOtp: otp };
        }
      } catch (e) {
        console.log(`[Email AppsScript] Attempt ${i+1} exception: ${e.message}`);
        continue;
      }
    }
    
    console.log('[Email AppsScript] All 3 attempts failed');
    return { success: false, error: 'All Apps Script attempts failed - no email sent', via: 'appscript-all-failed' };
  } catch (e) {
    console.error('[Email AppsScript] Fatal error', e.message);
    return { success: false, error: e.message, via: 'appscript-fatal' };
  }
}


async function sendOTPEmail(toEmail, otp, userName = '') {
  try {
    const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
    let emailPort = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587');
    const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
    const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS || process.env.EMAIL_PASSWORD;
    const emailFrom = process.env.EMAIL_FROM || emailUser || 'noreply@kararender.com';
    
    // Thử Apps Script trước nếu có cấu hình (đề xuất của user - tránh Render block SMTP)
    const appsScriptUrl = process.env.APPS_SCRIPT_URL || process.env.APPS_SCRIPT_EMAIL_URL;
    if (appsScriptUrl) {
      console.log('[Email] Trying Apps Script MailApp first (user suggestion)');
      const appsResult = await sendOTPEmailViaAppsScript(toEmail, otp, userName);
      if (appsResult.success) {
        console.log('[Email] Sent via Apps Script MailApp successfully');
        return appsResult;
      }
      console.log('[Email] Apps Script failed, fallback to Nodemailer SMTP');
    }
    
    if (!emailHost || !emailUser || !emailPass) {
      console.log('[Email] Skipped - no SMTP config, trying Apps Script fallback');
      // Thử Apps Script nếu chưa thử
      if (!appsScriptUrl) {
        return { success: false, reason: 'No SMTP config and no AppsScript URL' };
      }
      return await sendOTPEmailViaAppsScript(toEmail, otp, userName);
    }

    const nodemailer = require('nodemailer');

    const configs = [
      {
        host: emailHost,
        port: 587,
        secure: false,
        auth: { user: emailUser, pass: emailPass },
        tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      },
      {
        host: emailHost,
        port: 465,
        secure: true,
        auth: { user: emailUser, pass: emailPass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      }
    ];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      try {
        console.log(`[Email] Trying config ${i+1}: ${cfg.host}:${cfg.port} secure=${cfg.secure}`);
        const transporter = nodemailer.createTransport(cfg);
        
        await transporter.verify().catch(e => {
          console.log(`[Email] Verify failed for ${cfg.port}:`, e.message);
          throw e;
        });

        const mailOptions = {
          from: emailFrom.includes('<') ? emailFrom : `"KaraRender" <${emailFrom}>`,
          to: toEmail,
          subject: `Mã OTP KaraRender - ${otp}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
              <div style="background: white; padding: 30px; border-radius: 10px;">
                <h1 style="color: #2563eb; text-align: center;">KaraRender</h1>
                <h2>Xin chào ${userName || toEmail},</h2>
                <p>Bạn vừa yêu cầu mã OTP để xác thực tài khoản KaraRender.</p>
                <div style="background: #f0f7ff; border: 2px dashed #2563eb; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                  <p style="margin: 0; color: #666; font-size: 14px;">Mã OTP của bạn là:</p>
                  <p style="margin: 10px 0; font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 5px;">${otp}</p>
                  <p style="margin: 0; color: #999; font-size: 12px;">Mã có hiệu lực trong 5 phút</p>
                </div>
                <p style="color: #666; font-size: 14px;">Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này.</p>
              </div>
            </div>
          `,
          text: `KaraRender - Mã OTP của bạn là: ${otp}. Mã có hiệu lực trong 5 phút.`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[Email] OTP sent via port ${cfg.port} to`, toEmail, 'messageId:', info.messageId);
        return { success: true, messageId: info.messageId, port: cfg.port, via: 'smtp' };
      } catch (e) {
        console.log(`[Email] Config ${cfg.port} failed:`, e.message);
        if (i === configs.length - 1) {
          // Thử Apps Script fallback cuối cùng
          if (appsScriptUrl) {
            console.log('[Email] All SMTP failed, trying Apps Script final fallback');
            const appsResult = await sendOTPEmailViaAppsScript(toEmail, otp, userName);
            if (appsResult.success) return appsResult;
          }
          return { success: false, error: e.message, debugOtp: otp };
        }
        continue;
      }
    }

    return { success: false, error: 'All SMTP configs failed' };
  } catch (e) {
    console.error('[Email] Send OTP error', e.message);
    return { success: false, error: e.message };
  }
}

function getClientInfo(req) {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const origin = req.headers.origin || req.headers.referer || req.body?.origin || req.query?.origin || 'unknown';
    const domain = req.body?.domain || req.query?.domain || req.headers.origin || 'unknown';
    const fullUrl = req.body?.fullUrl || req.query?.fullUrl || req.headers.referer || 'unknown';
    const browser = userAgent.length > 200 ? userAgent.slice(0,200)+'...' : userAgent;
    return { ip, userAgent, origin, domain, fullUrl, browser };
  } catch {
    return { ip: 'unknown', userAgent: 'unknown', origin: 'unknown', domain: 'unknown', fullUrl: 'unknown', browser: 'unknown' };
  }
}

function getClientInfoFull(req) {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const origin = req.headers.origin || req.headers.referer || req.body?.origin || req.query?.origin || 'unknown';
    const domain = req.body?.domain || req.query?.domain || req.headers.origin || req.headers.referer || 'unknown';
    const fullUrl = req.body?.fullUrl || req.query?.fullUrl || req.headers.referer || 'unknown';
    const referer = req.headers.referer || 'unknown';
    const uaLower = userAgent.toLowerCase();
    let device = 'Desktop';
    let deviceIcon = '💻';
    if (/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(uaLower)) {
      device = 'Mobile';
      deviceIcon = '📱';
      if (/ipad|tablet/i.test(uaLower)) {
        device = 'Tablet';
        deviceIcon = '📲';
      }
    }
    let os = 'Unknown';
    if (uaLower.includes('windows')) os = 'Windows';
    else if (uaLower.includes('mac os') || uaLower.includes('macintosh')) os = 'macOS';
    else if (uaLower.includes('linux')) os = 'Linux';
    else if (uaLower.includes('android')) os = 'Android';
    else if (uaLower.includes('iphone') || uaLower.includes('ipad')) os = 'iOS';
    let browser = 'Unknown';
    if (uaLower.includes('chrome') && !uaLower.includes('edg') && !uaLower.includes('opr')) browser = 'Chrome';
    else if (uaLower.includes('firefox')) browser = 'Firefox';
    else if (uaLower.includes('safari') && !uaLower.includes('chrome')) browser = 'Safari';
    else if (uaLower.includes('edg')) browser = 'Edge';
    else if (uaLower.includes('opr') || uaLower.includes('opera')) browser = 'Opera';
    else if (uaLower.includes('coc_coc')) browser = 'Cốc Cốc';
    return { ip, userAgent, origin, domain, fullUrl, referer, device, deviceIcon, os, browser, browserFull: userAgent.slice(0,400) };
  } catch {
    return { ip: 'unknown', userAgent: 'unknown', origin: 'unknown', domain: 'unknown', fullUrl: 'unknown', referer: 'unknown', device: 'Unknown', deviceIcon: '❓', os: 'Unknown', browser: 'Unknown', browserFull: 'unknown' };
  }
}

function getUserInfoFromRequest(req, params) {
  try {
    let email = params.email || params.userEmail || params.user_email || '';
    let fullName = params.fullName || params.full_name || params.name || params.userName || '';
    const token = params.token || params.tk || req.headers['authorization']?.replace('Bearer ', '') || '';
    if (token && !email) {
      try {
        let s = decodeURIComponent(token).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4 !== 0) s += '=';
        const obj = JSON.parse(Buffer.from(s, 'base64').toString('utf-8'));
        const payload = obj.payload || obj;
        if (payload) {
          email = payload.email || email;
          fullName = payload.fullName || payload.full_name || fullName;
        }
      } catch {}
    }
    if (params.data) {
      try {
        let decoded = '';
        try { decoded = decodeURIComponent(params.data); } catch { decoded = params.data; }
        const parsed = JSON.parse(decoded);
        if (parsed && parsed.userInfo) {
          email = parsed.userInfo.email || email;
          fullName = parsed.userInfo.fullName || fullName;
        }
      } catch {}
    }
    if (!email) { email = req.body?.email || req.query?.email || ''; }
    if (!fullName) { fullName = req.body?.fullName || req.query?.fullName || req.body?.name || ''; }
    return { email: email || 'Chưa đăng nhập', fullName: fullName || 'Khách' };
  } catch {
    return { email: 'Unknown', fullName: 'Unknown' };
  }
}

async function seedAdmin() {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) return;
    const adminEmail = (process.env.ADMIN_EMAIL || 'chithanh2404@gmail.com').toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin123@';
    const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email', adminEmail).maybeSingle();
    if (ex) return;
    const hash = await bcrypt.hash(adminPass, 10);
    await supabaseAdmin.from('users').insert({ email: adminEmail, password_hash: hash, full_name: 'Lâm Chí Thành', is_vip: true, created_at: new Date().toISOString() });
  } catch {}
}
seedAdmin();

function decodeOldToken(t) {
  try {
    let s = decodeURIComponent(t).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4 !== 0) s += '=';
    const obj = JSON.parse(Buffer.from(s, 'base64').toString('utf-8'));
    return obj.payload || obj;
  } catch { return null; }
}
function createOldStyleToken(p) {
  const data = {
    payload: {
      email: p.email,
      fullName: p.full_name || p.fullName || p.email,
      full_name: p.full_name || p.fullName,
      role: p.is_vip ? 'ADMIN' : 'USER',
      isVip: !!p.is_vip, is_vip: !!p.is_vip,
      expiredDate: new Date(Date.now() + 365*24*60*60*1000).toISOString(),
      id: p.id
    },
    signature: crypto.createHash('sha256').update(JSON.stringify(p) + config.JWT_SECRET).digest('hex')
  };
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

function normalizeHost(hostStr) {
  if (!hostStr) return '';
  let d = hostStr.toString().toLowerCase().trim();
  d = d.replace(/^https?:\/\//, '').split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  return d.replace(/^www\./,'');
}
function isAllowedDomain(domainStr) {
  if (!domainStr) return false;
  const d = normalizeHost(domainStr);
  for (const allowed of config.ALLOWED_HOSTS) {
    if (d === normalizeHost(allowed)) return true;
  }
  return false;
}
function getClientDomainFromRequest(req) {
  try {
    const p = { ...req.query, ...req.body };
    let origin = (p.origin || p.domain || p.referer || p.fullUrl || req.headers.referer || req.headers.origin || '').toString().toLowerCase().trim();
    if (!origin && req.headers.referer) {
      const m = req.headers.referer.match(/https?:\/\/([^\/\?#]+)/i);
      if (m && m[1]) origin = m[1].toLowerCase();
    }
    if (!origin && req.headers.origin) origin = req.headers.origin.toLowerCase();
    return { origin };
  } catch { return { origin: '' }; }
}
function checkCorsGuardStrict(req) {
  const client = getClientDomainFromRequest(req);
  const source = client.origin || '';
  if (!source) {
    const hasTk = !!(req.query.tk || req.body?.tk);
    if (hasTk) {
      console.log('[Guard] Allowing no-origin with tk for secure module');
      return { blocked: false, source: 'no-origin-with-tk', allowed: true, isDirect: true };
    }
    return { blocked: true, source: 'no-origin', allowed: false, reason: 'Missing origin/referer - blocked' };
  }
  const allowed = isAllowedDomain(source);
  return { blocked: !allowed, source, allowed };
}

function xorEncodeToBase64(str, key) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const keyBytes = encoder.encode(key);
    const xored = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      xored[i] = data[i] ^ (keyBytes[i % keyBytes.length] & 0xFF);
    }
    return Buffer.from(xored).toString('base64');
  } catch (e) {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
}

// Dropbox Direct Link - Fix 404 + Load nhanh
const DROPBOX_DIRECT_URL = process.env.DROPBOX_SECURE_RENDER_URL || 'https://www.dropbox.com/scl/fi/ard6fub7mz2iwx13pzext/secure-render-engine.js?rlkey=rop089i97tp6vl9snemekf64d&st=sr8btyzq&dl=1';
const DROPBOX_DIRECT_URL_ALT = 'https://dl.dropboxusercontent.com/scl/fi/ard6fub7mz2iwx13pzext/secure-render-engine.js?rlkey=rop089i97tp6vl9snemekf64d&st=sr8btyzq&dl=1';

async function fetchFromDropboxDirect() {
  const urls = [DROPBOX_DIRECT_URL, DROPBOX_DIRECT_URL_ALT];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET', cache: 'no-store', headers: { 'User-Agent': 'KaraRender/5.5' } });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 1000) continue;
      if (!text.includes('KaraSecureRender') && !text.includes('vmX')) continue;
      console.log('[Secure-v5.5-Dropbox] Success', url.slice(0,60)+'...', 'length', text.length);
      return text;
    } catch (e) {
      console.log('[Secure-v5.5-Dropbox] Error', e.message);
    }
  }
  return null;
}

let cachedModuleInRAM = null;
let cacheTimeInRAM = 0;
const RAM_CACHE_TTL = 30 * 60 * 1000;

function loadRealModuleFromDiskForInit() {
  try {
    const fs = require('fs');
    const path = require('path');
    const possiblePaths = [
      '/mnt/data/secure-render-engine_4.js',
      '/mnt/data/secure-render-engine.js',
      path.join(__dirname, '../secure-render-engine_4.js'),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        if (content.length > 10000 && content.includes('KaraSecureRender')) return content;
      }
    }
  } catch {}
  return null;
}

async function getSecureRenderModuleContent_V55() {
  if (cachedModuleInRAM && Date.now() - cacheTimeInRAM < RAM_CACHE_TTL) {
    console.log('[Secure-v5.5] RAM cache hit, length', cachedModuleInRAM.length);
    return cachedModuleInRAM;
  }
  const dropboxContent = await fetchFromDropboxDirect();
  if (dropboxContent) {
    console.log('[Secure-v5.5] Using Dropbox direct, length', dropboxContent.length, '- RAM 30min, client tự gỡ');
    cachedModuleInRAM = dropboxContent;
    cacheTimeInRAM = Date.now();
    return dropboxContent;
  }
  const realFromDisk = loadRealModuleFromDiskForInit();
  if (realFromDisk) {
    cachedModuleInRAM = realFromDisk;
    cacheTimeInRAM = Date.now();
    return realFromDisk;
  }
  try {
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.SECURE_RENDER_FOLDER_ID || '1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP';
    const files = await listFilesInFolder(folderId);
    const target = files.find(f => f.name === 'secure-render-engine_4.js' || f.name.includes('secure-render'));
    if (target) {
      const content = await getFileContentAsString(target.id);
      if (content && content.length > 1000) {
        cachedModuleInRAM = content;
        cacheTimeInRAM = Date.now();
        return content;
      }
    }
  } catch {}
  return cachedModuleInRAM;
}

const adminHTML = `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin v5.5 FULL - Feedback + Telegram Full Info + Dropbox + 800 lines</title>
<style>
*{box-sizing:border-box} body{font-family:Inter,system-ui,sans-serif;background:#0b1020;color:#e2e8f0;margin:0}
.card{background:rgba(30,41,59,0.5);border:1px solid #334155;border-radius:12px;padding:16px}
.btn{background:#2563eb;color:white;border:0;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px}
.btn:hover{background:#1d4ed8} .btn-amber{background:#d97706} .btn-emerald{background:#059669} .btn-violet{background:#7c3aed}
table{width:100%;border-collapse:collapse} th{color:#94a3b8;font-size:11px;text-transform:uppercase;padding:8px;text-align:left;background:#0f172a;position:sticky;top:0} td{padding:8px;border-bottom:1px solid #1e293b;font-size:12px}
input{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 12px;color:white;font-size:13px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:900px){ .grid2{grid-template-columns:1fr} }
</style>
</head>
<body>
<div style="max-width:1300px;margin:0 auto;padding:20px">
  <h1 style="font-size:22px;font-weight:900;margin-bottom:16px">👑 Admin v5.5 FULL - Feedback + Telegram Full Info + Dropbox + 800 dòng - Client tự gỡ</h1>
  <div style="background:#065f46;border:1px solid #10b981;border-radius:8px;padding:12px;margin-bottom:16px">
    <b>Fix v5.5:</b> Thêm lại saveFeedback, requestVip, sendOTP bị thiếu trong index_1.js. Telegram giờ có đầy đủ domain, IP, browser, origin, fullUrl như mã nguồn cũ.
  </div>
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <input id="adminEmail" value="chithanh2404@gmail.com" style="width:240px"/>
    <button class="btn" onclick="loadAll()">Tải dữ liệu</button>
    <button class="btn" style="background:#334155" onclick="checkDebug()">Debug Full</button>
    <button class="btn" style="background:#059669" onclick="testTelegramFull()">Test Telegram Full Info</button>
  </div>
  <div id="debugBox" class="card" style="display:none;margin-bottom:16px"></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
    <div class="card"><div style="font-size:11px;color:#94a3b8">Users</div><div id="statUsers" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Fonts</div><div id="statFonts" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Effects</div><div id="statEffects" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Languages</div><div id="statLangs" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Secure</div><div id="statSecure" style="font-size:12px;font-weight:700">-</div><div style="font-size:10px;color:#10b981">Dropbox direct, client tự gỡ</div></div>
  </div>

  <div class="grid2" style="margin-bottom:20px">
    <div class="card" style="border-color:#10b981;background:rgba(16,185,129,0.08)">
      <h3 style="color:#34d399">🔤 Fonts 593 + Effects + Languages</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-emerald" onclick="importDrive('fonts')">Import Fonts</button>
        <button class="btn btn-violet" onclick="importDrive('effects')">Import Effects</button>
        <button class="btn btn-amber" onclick="importDrive('languages')">Import Languages</button>
      </div>
      <span id="statusFonts" style="font-size:11px;margin-left:8px"></span>
      <pre id="logFonts" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#f59e0b;background:rgba(245,158,11,0.08)">
      <h3 style="color:#fbbf24">💬 Feedback + VIP + Users (Fix không gửi được)</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-amber" onclick="importDrive('users')">Import Users</button>
        <button class="btn" style="background:#f59e0b" onclick="testFeedback()">Test Feedback</button>
        <button class="btn" style="background:#059669" onclick="testTelegramFull()">Test Telegram Full Info</button>
      </div>
      <span id="statusUsers" style="font-size:11px;margin-left:8px"></span>
      <pre id="logUsers" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#06b6d4;background:rgba(6,182,214,0.08)">
      <h3 style="color:#22d3ee">🔒 Secure Dropbox Direct + Telegram Full</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" style="background:#7c3aed" onclick="importDrive('secure')">Verify Secure Dropbox</button>
        <button class="btn" style="background:#059669" onclick="testSecureModule()">Test Secure</button>
        <button class="btn" style="background:#dc2626" onclick="clearSecureCache()">Clear RAM Cache</button>
      </div>
      <span id="statusOther" style="font-size:11px"></span>
      <pre id="logOther" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
  </div>

  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid #334155"><b>👥 Users preview</b></div>
    <div style="overflow:auto;max-height:300px"><table><thead><tr><th>Email</th><th>Tên</th><th>VIP</th><th>Ngày</th></tr></thead><tbody id="usersBody"></tbody></table></div>
  </div>
</div>
<script>
async function api(path, method='GET', body=null){
  const adminEmail=document.getElementById('adminEmail').value.trim();
  const opts={method, headers:{'Content-Type':'application/json','x-admin-email':adminEmail}};
  if(body) opts.body=JSON.stringify({...body, adminEmail});
  const url=path+(path.includes('?')?'&':'?')+'adminEmail='+encodeURIComponent(adminEmail);
  const res=await fetch(url, opts);
  const txt=await res.text();
  try{ return JSON.parse(txt); } catch{ return { raw: txt, status: res.status }; }
}
async function checkDebug(){
  const box=document.getElementById('debugBox'); box.style.display='block'; box.innerHTML='Checking...';
  try{ const data=await api('/api/admin/debug'); box.innerHTML='<pre style="white-space:pre-wrap;font-size:11px">'+JSON.stringify(data,null,2)+'</pre>'; 
    document.getElementById('statSecure').textContent = data.secureModule ? (data.secureModule.exists ? '✅ RAM '+data.secureModule.length : '❌') : '-';
    document.getElementById('statLangs').textContent = data.supabase ? data.supabase.langCount+' langs' : '-';
  }catch(e){ box.innerHTML='Lỗi: '+e.message; }
}
async function loadAll(){
  try{
    const users=await api('/api/admin/users');
    if(Array.isArray(users)){ document.getElementById('statUsers').textContent=users.length; document.getElementById('usersBody').innerHTML=users.slice(0,20).map(u=>\`<tr><td>\${u.email}</td><td>\${u.full_name||''}</td><td>\${u.is_vip?'👑':''}</td><td>\${u.created_at?new Date(u.created_at).toLocaleDateString():''}</td></tr>\`).join(''); }
    const fonts=await api('/api/admin/stats/fonts'); if(fonts.count!==undefined) document.getElementById('statFonts').textContent=fonts.count;
    const effects=await api('/api/admin/stats/effects'); document.getElementById('statEffects').textContent=effects.exists? 'OK':'-';
    const langs=await api('/api/admin/stats/languages'); document.getElementById('statLangs').textContent=langs.count+' langs';
  }catch(e){}
}
async function importDrive(type){
  const statusId={users:'statusUsers',fonts:'statusFonts',effects:'statusFonts',languages:'statusFonts',secure:'statusOther'}[type]||'statusOther';
  const logId={users:'logUsers',fonts:'logFonts',effects:'logFonts',languages:'logFonts',secure:'logOther'}[type]||'logOther';
  const status=document.getElementById(statusId), log=document.getElementById(logId);
  status.textContent='Đang xử lý...'; log.style.display='block'; log.textContent='Bắt đầu...';
  try{
    const endpoint={users:'/api/admin/import-drive-users',fonts:'/api/admin/import-fonts',effects:'/api/admin/import-effects-v2',languages:'/api/admin/import-languages',secure:'/api/admin/import-secure'}[type];
    const res=await api(endpoint,'POST',{});
    status.textContent=res.message||'Xong'; log.textContent=JSON.stringify(res,null,2);
    loadAll(); checkDebug();
  }catch(e){ status.textContent='Lỗi: '+e.message; }
}
async function testFeedback(){
  const log=document.getElementById('logUsers'); log.style.display='block'; log.textContent='Testing feedback...';
  try{
    const payload={ email:'test@kararender.com', message:'Test feedback từ admin v5.5 FULL - Telegram full info', rating:5 };
    const res=await fetch('/exec?action=saveFeedback&callback=test&domain=kararender.com&origin=https://kararender.com&fullUrl=https://kararender.com/', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ data: JSON.stringify(payload), domain:'kararender.com', origin:'https://kararender.com', fullUrl:'https://kararender.com/' })
    });
    const txt=await res.text();
    log.textContent='Status: '+res.status+'\\n'+txt.slice(0,1000)+'\\n\\nPhải có status:success';
  }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function testTelegramFull(){
  const log=document.getElementById('logUsers'); log.style.display='block'; log.textContent='Testing Telegram full info...';
  try{ const res=await api('/api/admin/test-telegram-full','POST',{}); log.textContent=JSON.stringify(res,null,2); }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function testSecureModule(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Testing secure Dropbox...';
  try{
    const ts=Date.now();
    const raw=location.hostname+'|'+ts+'|test';
    const tk=btoa(raw).replace(/=+$/,'');
    const url='/exec?action=getSecureRenderModule&callback=test&t='+ts+'&tk='+encodeURIComponent(tk)+'&origin='+encodeURIComponent(location.hostname);
    const res=await fetch(url, { headers: { 'Origin': 'https://kararender.com', 'Referer': 'https://kararender.com/' } });
    const txt=await res.text();
    log.textContent='Status: '+res.status+'\\nLength: '+txt.length+'\\n'+txt.slice(0,500);
  }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function clearSecureCache(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Clearing...';
  try{ const res=await api('/api/admin/clear-secure-cache','POST',{}); log.textContent=JSON.stringify(res,null,2); checkDebug(); }catch(e){ log.textContent='Lỗi: '+e.message; }
}
loadAll();
checkDebug();
</script>
</body>
</html>
`;

app.get('/admin', (req, res) => res.type('html').send(adminHTML));

app.get('/api/admin/debug', async (req, res) => {
  const { supabaseAdmin } = (() => { try { return require('./services/supabase'); } catch { return { supabaseAdmin: null }; } })();
  let usersCount=0, fontsCount=0, effectsInfo={ exists:false }, langCount=0, secureInfo={ exists:false };
  try {
    if (supabaseAdmin) {
      const { count } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
      usersCount=count||0;
      let allFiles = [];
      let offset = 0;
      const limit = 1000;
      while (true) {
        const { data, error } = await supabaseAdmin.storage.from('fonts').list('', { limit, offset });
        if (error || !data || data.length===0) break;
        allFiles = allFiles.concat(data);
        if (data.length < limit) break;
        offset += limit;
      }
      fontsCount = allFiles.length;
      const { data: eff } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle();
      effectsInfo={ exists: !!eff, wipe: eff ? Object.keys(eff.content?.wipe||{}).length : 0 };
      const { count: lc } = await supabaseAdmin.from('languages').select('*', { count: 'exact', head: true });
      langCount=lc||0;
    }
    if (cachedModuleInRAM) {
      secureInfo = { exists:true, length: cachedModuleInRAM.length, hasKara: cachedModuleInRAM.includes('KaraSecureRender'), source:'Dropbox Direct Link', dropboxUrl: DROPBOX_DIRECT_URL };
    } else {
      secureInfo = { exists:false, source:'Dropbox Direct Link', dropboxUrl: DROPBOX_DIRECT_URL, note:'Sẽ fetch từ Dropbox khi có request' };
    }
  } catch (e) { secureInfo.error = e.message; }
  res.json({ version: 'v5.5 FULL - Feedback + Telegram Full Info + Dropbox + Client tự gỡ - 850 lines', secureModule: secureInfo, supabase: { usersCount, fontsCount, effectsInfo, langCount } });
});

app.get('/api/admin/users', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('users').select('id,email,full_name,is_vip,created_at').order('created_at',{ascending:false}).limit(2000);
    res.json(data||[]);
  }catch(e){ res.status(500).json({ error:e.message }); }
});
app.get('/api/admin/stats/fonts', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    let allFiles = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin.storage.from('fonts').list('', { limit, offset });
      if (error || !data || data.length===0) break;
      allFiles = allFiles.concat(data);
      if (data.length < limit) break;
      offset += limit;
    }
    res.json({ count: allFiles.length });
  }catch{ res.json({ count:0 }); }
});
app.get('/api/admin/stats/effects', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle();
    res.json({ exists: !!data, wipe: data?Object.keys(data.content?.wipe||{}).length:0 });
  }catch{ res.json({ exists:false }); }
});
app.get('/api/admin/stats/languages', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { count } = await supabaseAdmin.from('languages').select('*',{count:'exact',head:true});
    res.json({ count: count||0 });
  }catch{ res.json({ count:0 }); }
});

app.post('/api/admin/test-telegram', async (req,res)=>{
  try{
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return res.json({ status:'error', message:'Chưa cấu hình Telegram' });
    await sendTelegramNotification(`🔔 Test Telegram v5.5 FULL`);
    res.json({ status:'success', message:'Đã gửi!' });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/test-telegram-full', async (req,res)=>{
  try{
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return res.json({ status:'error', message:'Chưa cấu hình Telegram', token: !!config.TELEGRAM_BOT_TOKEN, chatId: !!config.TELEGRAM_CHAT_ID });
    const info = getClientInfo(req);
    const message = `🔔 <b>Test Telegram Full Info v5.5 FULL</b>
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}
🌐 <b>Domain:</b> ${info.domain}
🔗 <b>Origin:</b> ${info.origin}
📄 <b>Full URL:</b> ${info.fullUrl}
📍 <b>IP:</b> ${info.ip}
🖥️ <b>Browser:</b> ${info.browser.slice(0,300)}
📧 <b>Admin:</b> ${req.body?.adminEmail || req.query?.adminEmail || 'unknown'}
✅ <b>Chức năng:</b> Feedback, VIP, Login, Register đã fix với full info như mã nguồn cũ`;
    await sendTelegramNotification(message);
    res.json({ status:'success', message:'Đã gửi test Telegram full info!', info });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/clear-secure-cache', async (req,res)=>{
  try{
    const hadCache = !!cachedModuleInRAM;
    const length = cachedModuleInRAM?.length || 0;
    cachedModuleInRAM = null;
    cacheTimeInRAM = 0;
    res.json({ status:'success', message: hadCache ? `Đã xóa RAM cache ${length} chars` : 'Không có cache', hadCache, length });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-drive-users', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId=process.env.USERS_FOLDER_ID;
    if(!folderId) return res.json({ status:'error', message:'Chưa cấu hình USERS_FOLDER_ID' });
    const files=await listFilesInFolder(folderId);
    let imported=0, skipped=0;
    for(const f of files){
      try{
        const content=await getFileContentAsString(f.id);
        if(!content) { skipped++; continue; }
        let obj; try{ obj=JSON.parse(content); }catch{ skipped++; continue; }
        const email=(obj.email||f.name.replace('.json','')).toLowerCase().trim();
        if(!email.includes('@')) { skipped++; continue; }
        const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email',email).maybeSingle();
        if(ex){ skipped++; continue; }
        let hash=obj.password_hash||'';
        if(!hash && obj.password) hash=await bcrypt.hash(obj.password,10);
        else if(!hash) hash=await bcrypt.hash('Temp'+Math.random().toString(36).slice(2),10);
        else if(hash.length<50) hash=await bcrypt.hash(hash,10);
        await supabaseAdmin.from('users').insert({ email, password_hash: hash, full_name: obj.fullName||obj.full_name||email, is_vip: !!(obj.isVip||obj.role==='ADMIN'), created_at: obj.created_at||new Date().toISOString() });
        imported++;
      }catch{}
    }
    res.json({ status:'success', message:`Import users: ${imported} imported`, imported, skipped });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-fonts', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder } = require('./services/drive');
    const folderId=process.env.FONTS_FOLDER_ID || '1IfRLJMWIsDdyVQTFf_jNz3L3i-2G7vKH';
    const files=await listFilesInFolder(folderId);
    const fontFiles=files.filter(f => /\.(ttf|otf|woff2|woff)$/i.test(f.name));
    if(!fontFiles.length) return res.json({ status:'error', message:`Không có font` });
    try{ await supabaseAdmin.storage.createBucket('fonts',{ public:true }); }catch{}
    let imported=0, skipped=0;
    for(const f of fontFiles){
      try{
        let exists = false;
        let offset = 0;
        while (true) {
          const { data } = await supabaseAdmin.storage.from('fonts').list('', { limit: 1000, offset });
          if (!data || data.length===0) break;
          if (data.find(x=>x.name===f.name)) { exists=true; break; }
          if (data.length < 1000) break;
          offset+=1000;
        }
        if(exists){ skipped++; continue; }
        const { getDriveClient } = require('./services/drive');
        const drive = getDriveClient();
        const res2 = await drive.files.get({ fileId: f.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res2.data);
        await supabaseAdmin.storage.from('fonts').upload(f.name, buffer, { contentType: 'font/ttf', upsert:false });
        imported++;
      }catch{}
    }
    res.json({ status:'success', message:`Import fonts: ${imported}`, imported, skipped });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-effects-v2', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.EFFECTS_FOLDER_ID || '19fwzMKXMkdpX-4tNPCfbyAqywo0zYmwC';
    let merged={};
    let files=[];
    try { files = await listFilesInFolder(folderId); } catch {}
    if (files && files.length>0) {
      for(const f of files){
        if(!f.name.endsWith('.json')) continue;
        try{
          const content=await getFileContentAsString(f.id);
          if(!content) continue;
          const json=JSON.parse(content);
          if(json.wipe||json.fade||json.visualizer){
            merged={ ...merged, ...json };
            if(json.wipe) merged.wipe={ ...(merged.wipe||{}), ...json.wipe };
            if(json.fade) merged.fade={ ...(merged.fade||{}), ...json.fade };
            if(json.visualizer) merged.visualizer={ ...(merged.visualizer||{}), ...json.visualizer };
          } else {
            merged={ ...merged, ...json };
          }
        }catch{}
      }
    } else {
      const content=await getFileContentAsString(folderId);
      if(content) merged=JSON.parse(content);
    }
    if(!Object.keys(merged).length) return res.json({ status:'error', message:'Không tìm thấy effects' });
    await supabaseAdmin.from('app_data').upsert({ key:'effects', content: merged, updated_at: new Date().toISOString() }, { onConflict:'key' });
    res.json({ status:'success', message:`Import effects: wipe:${Object.keys(merged.wipe||{}).length}` });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-languages', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId=process.env.LANGUAGES_FOLDER_ID || '1mdXYIMIQiOXeMg3uWIaEeRnrNOoijUNp';
    const files=await listFilesInFolder(folderId);
    const jsonFiles=files.filter(f=>f.name.endsWith('.json'));
    let imported=0;
    for(const f of jsonFiles){
      try{
        const content=await getFileContentAsString(f.id);
        if(!content) continue;
        const data=JSON.parse(content);
        const code=f.name.replace('.json','');
        await supabaseAdmin.from('languages').upsert({ code, data, updated_at: new Date().toISOString() }, { onConflict:'code' });
        imported++;
      }catch{}
    }
    res.json({ status:'success', message:`Import languages: ${imported}/${jsonFiles.length}`, imported });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-secure', async (req,res)=>{
  try{
    const content = await fetchFromDropboxDirect();
    if (!content) return res.json({ status:'error', message:'Failed to fetch from Dropbox direct link' });
    cachedModuleInRAM = content;
    cacheTimeInRAM = Date.now();
    res.json({ status:'success', message:`Verified ${content.length} chars from Dropbox - RAM 30min, client tự gỡ`, length: content.length, hasKara: content.includes('KaraSecureRender'), source:'Dropbox Direct' });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

// FULL - Mọi chức năng hoạt động + Telegram full info như mã nguồn cũ
app.all('/exec', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, Referer, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const params = { ...req.query, ...req.body };
  const action = params.action || params.mod;
  const callback = params.callback;

  const sendJSONP = (obj) => {
    if (callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(obj)})`);
    else res.json(obj);
  };
  const sendText = (txt) => {
    if (callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(txt)})`);
    else res.type('text/plain').send(txt);
  };

  const protectedActions = ['getFonts','getFontBase64','getEffects','getSecureRenderModule','getRenderEngine','kara-render-engine','getLang','getStyleList','getStyleContent'];
  if (protectedActions.includes(action)) {
    const guard = checkCorsGuardStrict(req);
    if (guard.blocked) {
      const result = { success: false, error: 'Domain not allowed', blocked: true, reason: guard.reason, allowedHosts: config.ALLOWED_HOSTS };
      if (callback) return res.type('application/javascript').send(`${callback}(${JSON.stringify(result)})`);
      return res.status(403).json(result);
    }
  }

  try {
    const { supabaseAdmin } = require('./services/supabase');
    switch (action) {
      case 'getLang': {
        try{
          const langCode = (params.lang || 'vi').toLowerCase();
          let langData = null;
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('languages').select('data').eq('code', langCode).maybeSingle();
            if (data && data.data) langData = data.data;
          }
          if (!langData) {
            try {
              const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
              const folderId = process.env.LANGUAGES_FOLDER_ID || '1mdXYIMIQiOXeMg3uWIaEeRnrNOoijUNp';
              const files = await listFilesInFolder(folderId);
              const target = files.find(f => f.name.toLowerCase() === langCode+'.json');
              if (target) {
                const content = await getFileContentAsString(target.id);
                if (content) langData = JSON.parse(content);
              }
            } catch(e) {}
          }
          if (langData) {
            return sendJSONP({ status: 'success', success: true, data: langData });
          } else {
            return sendJSONP({ status: 'success', success: true, data: {} });
          }
        }catch(e){
          return sendJSONP({ status: 'success', success: true, data: {} });
        }
      }
      case 'getEffects': {
        try{
          const { data } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle();
          if(data&&data.content) return sendJSONP({ status:'success', success:true, data:data.content });
        }catch{}
        return sendJSONP({ status:'success', success:true, data:{} });
      }
      case 'getFonts': {
        try{
          let allFiles = [];
          let offset = 0;
          const limit = 1000;
          while (true) {
            const { data, error } = await supabaseAdmin.storage.from('fonts').list('', { limit, offset });
            if (error || !data || data.length===0) break;
            allFiles = allFiles.concat(data);
            if (data.length < limit) break;
            offset += limit;
          }
          if(allFiles.length){
            const fonts=allFiles.filter(f=> /\.(ttf|otf|woff2|woff)$/i.test(f.name)).map(f=>({ name:f.name.replace(/\.[^/.]+$/,''), url: `${config.SUPABASE_URL}/storage/v1/object/public/fonts/${f.name}` }));
            if(fonts.length) return sendJSONP(fonts);
          }
        }catch{}
        return sendJSONP([]);
      }
      case 'getSecureRenderModule':
      case 'kara-render-engine':
      case 'getRenderEngine': {
        try{
          const jsContent = await getSecureRenderModuleContent_V55();
          if (!jsContent) {
            return res.type('text/plain').status(404).send('ERROR_MODULE_NOT_FOUND: Failed to fetch from Dropbox direct link');
          }
          if (!jsContent.includes('KaraSecureRender')) {
            return res.type('text/plain').status(500).send('ERROR_MODULE_INVALID: No KaraSecureRender, length '+jsContent.length);
          }
          console.log('[Secure-v5.5-Dropbox] Serving module', jsContent.length);
          const xorKey = config.SECURE_XOR_SALT + '_' + (params.t || Date.now()).toString();
          const b64 = xorEncodeToBase64(jsContent, xorKey).replace(/\r?\n/g,'').trim();
          res.setHeader('X-Source', 'Dropbox Direct Link');
          return sendText(b64);
        }catch(e){ 
          return res.type('text/plain').status(500).send('ERROR_EXCEPTION: '+e.message); 
        }
      }
      case 'getStyleList': {
        try{
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('app_data').select('content').eq('key','styles').maybeSingle();
            if (data && data.content) return sendJSONP(data.content);
          }
          return sendJSONP([]);
        }catch{ return sendJSONP([]); }
      }
      case 'verify': {
        const payload = decodeOldToken(params.token||'');
        if (!payload) return sendJSONP({ success: false, message: 'Token không hợp lệ' });
        return sendJSONP({ success: true, valid: true, token: params.token, user: { email: payload.email, fullName: payload.fullName||payload.full_name, role: payload.role||'USER', isVip: payload.isVip||payload.is_vip } });
      }
      case 'login': {
        const email=(params.email||'').toLowerCase().trim();
        const { data: user } = await supabaseAdmin.from('users').select('*').eq('email',email).single();
        if(!user) return sendJSONP({ success:false, msg:'Email không tồn tại' });
        const ok=await bcrypt.compare(params.password||'', user.password_hash);
        if(!ok) return sendJSONP({ success:false, msg:'Sai mật khẩu' });
        await supabaseAdmin.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
        // Telegram full info như mã nguồn cũ
        const info = getClientInfo(req);
        await sendTelegramNotification(`🔐 <b>Đăng nhập</b>
📧 <b>Email:</b> ${email}
👤 <b>Tên:</b> ${user.full_name || email}
👑 <b>VIP:</b> ${user.is_vip ? 'Có' : 'Không'}
🌐 <b>Domain:</b> ${info.domain}
🔗 <b>Origin:</b> ${info.origin}
📄 <b>Full URL:</b> ${info.fullUrl}
📍 <b>IP:</b> ${info.ip}
🖥️ <b>Browser:</b> ${info.browser.slice(0,300)}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`).catch(()=>{});
        return sendJSONP({ success:true, token:createOldStyleToken(user), user:{ email:user.email, fullName:user.full_name, role:user.is_vip?'ADMIN':'USER', isVip:!!user.is_vip } });
      }
      case 'registerUser':
      case 'register': {
        const email=(params.email||'').toLowerCase().trim();
        const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email',email).maybeSingle();
        if(ex) return sendJSONP({ success:false, msg:'Email đã tồn tại' });
        const hash=await bcrypt.hash(params.password||'',10);
        await supabaseAdmin.from('users').insert({ email, password_hash:hash, full_name:params.fullName||email, is_vip:false, created_at:new Date().toISOString() });
        const info = getClientInfo(req);
        await sendTelegramNotification(`✅ <b>Đăng ký mới</b>
📧 <b>Email:</b> ${email}
👤 <b>Tên:</b> ${params.fullName||email}
🌐 <b>Domain:</b> ${info.domain}
🔗 <b>Origin:</b> ${info.origin}
📄 <b>Full URL:</b> ${info.fullUrl}
📍 <b>IP:</b> ${info.ip}
🖥️ <b>Browser:</b> ${info.browser.slice(0,300)}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`).catch(()=>{});
        return sendJSONP({ success:true, msg:'Đăng ký thành công!' });
      }
      case 'saveFeedback': {
        let payload={}; 
        try{ 
          payload=JSON.parse(params.data||'{}'); 
        }catch{ 
          payload=params; 
        }
        // Hỗ trợ cả 2 format: payload trực tiếp hoặc nested trong data
        const email = payload.email || params.email || 'unknown';
        const message = payload.message || params.message || JSON.stringify(payload).slice(0,500);
        const rating = payload.rating || null;
        try{
          if(supabaseAdmin) {
            await supabaseAdmin.from('feedbacks').insert({ 
              email: email, 
              message: message, 
              rating: rating,
              created_at: new Date().toISOString(), 
              domain: params.domain||req.headers.origin||'',
              ip: req.ip || req.headers['x-forwarded-for'] || ''
            });
          }
        }catch(e){ console.log('saveFeedback DB error', e.message); }
        // Telegram full info như mã nguồn cũ
        const info = getClientInfo(req);
        await sendTelegramNotification(`💬 <b>Feedback mới</b>
📧 <b>Email:</b> ${email}
📝 <b>Nội dung:</b> ${message.slice(0,800)}
⭐ <b>Rating:</b> ${rating || 'N/A'}
🌐 <b>Domain:</b> ${info.domain}
🔗 <b>Origin:</b> ${info.origin}
📄 <b>Full URL:</b> ${info.fullUrl}
📍 <b>IP:</b> ${info.ip}
🖥️ <b>Browser:</b> ${info.browser.slice(0,300)}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`).catch(()=>{});
        return sendJSONP({ status:'success', success:true, message: 'Cảm ơn bạn đã góp ý!' });
      }
      case 'requestVip':
      case 'requestUpgradeVip': {
        const email = (params.email||'').toLowerCase();
        try{
          if(supabaseAdmin) await supabaseAdmin.from('feedbacks').insert({ email: email, message: 'Yêu cầu VIP', created_at: new Date().toISOString(), domain: 'vip-request' });
        }catch{}
        const info = getClientInfo(req);
        await sendTelegramNotification(`👑 <b>Yêu cầu VIP</b>
📧 <b>Email:</b> ${email}
🌐 <b>Domain:</b> ${info.domain}
🔗 <b>Origin:</b> ${info.origin}
📄 <b>Full URL:</b> ${info.fullUrl}
📍 <b>IP:</b> ${info.ip}
🖥️ <b>Browser:</b> ${info.browser.slice(0,300)}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`).catch(()=>{});
        return sendJSONP({ success:true, message:'Đã gửi yêu cầu VIP!' });
      }
                  case 'sendOTP': {
        const email=(params.email||'').toLowerCase().trim();
        if (!email || !email.includes('@')) return sendJSONP('❌ Email không hợp lệ');
        const otp = Math.floor(100000+Math.random()*900000).toString();
        const expiresAt = new Date(Date.now()+5*60*1000).toISOString();
        try {
          // Lưu OTP vào Supabase - là nguồn duy nhất để verify
          await supabaseAdmin.from('otps').upsert({ email, otp, expires_at: expiresAt, created_at: new Date().toISOString() }, { onConflict:'email' });
          console.log(`[OTP] Saved ${otp} for ${email} to Supabase`);
        } catch (e) { console.log('OTP save error', e.message); }
        const info = getClientInfoFull(req);
        const userInfo = getUserInfoFromRequest(req, params);
        
        // FIX 1: Toast gọn - trả về string trực tiếp, không phải object JSON
        // Trước: sendJSONP({success:true, message:"..."}) → frontend JSON.stringify → hiện cả {"success":true,"message":...}
        // Sau: sendJSONP("Mã OTP đã được gửi...") → frontend hiện gọn
        sendJSONP(`Mã OTP đã được gửi tới email ${email}. Vui lòng kiểm tra hộp thư (cả spam).`);

        // FIX 2: OTP đồng nhất - Gửi đúng OTP này (807781) qua Apps Script, không để Apps Script tự sinh OTP mới (570810)
        // Apps Script sẽ nhận otp param và dùng luôn, lưu vào cache của nó
        (async () => {
          try {
            const emailResult = await sendOTPEmailViaAppsScript(email, otp, params.fullName || userInfo.fullName || '', info.ip);
            await sendTelegramNotification(`🔑 <b>OTP Request</b>
👤 <b>User:</b> ${userInfo.fullName} - ${email}
📧 <b>Email:</b> ${email}
🔢 <b>OTP:</b> ${otp} (5 phút) - ${emailResult.success ? 'Đã gửi mail ✅ via Apps Script' : 'Chưa gửi mail ⚠️: ' + (emailResult.error||'')}
🌐 <b>Domain:</b> ${info.domain}
🔗 <b>Origin:</b> ${info.origin}
📍 <b>IP:</b> ${info.ip}
${info.deviceIcon} <b>Thiết bị:</b> ${info.device} - ${info.os}
🌐 <b>Browser:</b> ${info.browser}
⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`).catch(()=>{});
          } catch (e) {
            console.log('Background OTP email/telegram error', e.message);
          }
        })();
        
        return;
      }
      case 'verifyOTP': {
        const email=(params.email||'').toLowerCase().trim();
        const otp=(params.otp||'').trim();
        try {
          const { data } = await supabaseAdmin.from('otps').select('*').eq('email',email).single();
          if (!data) return sendJSONP({ success:false, msg:'OTP không tồn tại hoặc đã hết hạn' });
          if (data.otp !== otp) return sendJSONP({ success:false, msg:'Mã OTP không đúng' });
          if (new Date(data.expires_at) < new Date()) return sendJSONP({ success:false, msg:'Mã OTP đã hết hạn' });
          await supabaseAdmin.from('otps').delete().eq('email',email);
          return sendJSONP({ success:true, msg:'Xác thực OTP thành công!' });
        } catch (e) {
          return sendJSONP({ success:false, msg:'Lỗi xác thực OTP: '+e.message });
        }
      }
      case 'clearSecureModuleCache': {
        return sendJSONP({ success:true, message:'Client đã tự gỡ module phía client, server giữ RAM 30min' });
      }
      case 'saveUsageStats':
      case 'logUserAccess': {
        // Logic ghi log khi có user xuất thành công video với đầy đủ thông tin từ collectExportData + giữ nguyên logic cũ
        let isExportLog = false;
        let exportDataParsed = null;
        let exportDataRaw = params.data || '';
        try {
          if (exportDataRaw) {
            let decoded = '';
            try { decoded = decodeURIComponent(exportDataRaw); } catch { decoded = exportDataRaw; }
            const parsed = JSON.parse(decoded);
            if (parsed && parsed.userInfo && parsed.features) {
              isExportLog = true;
              exportDataParsed = parsed;
              console.log('[Export Log] Detected export from collectExportData', parsed.userInfo?.email);
            }
          }
        } catch (e) { isExportLog = false; }

        try{ 
          if(supabaseAdmin) {
            await supabaseAdmin.from('usage_stats').insert({ 
              data: params, 
              created_at: new Date().toISOString(), 
              ip: req.ip, 
              domain: params.domain||'',
              is_export: isExportLog,
              export_data: exportDataParsed ? JSON.stringify(exportDataParsed) : null
            }); 
          }
        }catch(e){ console.log('usage_stats error', e.message); }
        
        try {
          const info = getClientInfoFull(req);
          const isBlocked = checkCorsGuardStrict(req).blocked;
          const blockedReason = checkCorsGuardStrict(req).reason || '';
          
          if (isExportLog && exportDataParsed) {
            const userInfo = exportDataParsed.userInfo || {};
            const features = exportDataParsed.features || {};
            await sendTelegramNotification(`🎬 <b>XUẤT VIDEO THÀNH CÔNG</b>
👤 <b>User:</b> ${userInfo.fullName || 'Unknown'} - ${userInfo.email || params.email || 'unknown'}
📧 <b>Email:</b> ${userInfo.email || 'unknown'}
📍 <b>IP (client):</b> ${userInfo.ip || info.ip}
📍 <b>IP (server):</b> ${info.ip}
${info.deviceIcon} <b>Thiết bị:</b> ${userInfo.device || info.device} - ${info.os}
🌐 <b>Browser:</b> ${info.browser}
🖥️ <b>User-Agent:</b> ${info.browserFull.slice(0,250)}

🎨 <b>Tính năng đã dùng:</b>
🔤 <b>Font:</b> ${features.fontFamily || 'Default'}
🎵 <b>Audio:</b> ${features.audioStatus || 'N/A'}
✨ <b>Wipe:</b> ${features.wipeEffect || 'None'}
📌 <b>Tiêu đề:</b> ${features.useTitle ? 'Có' : 'Không'}
⏱️ <b>Đếm ngược:</b> ${features.useCountdown ? 'Có' : 'Không'}
🖼️ <b>Logo:</b> ${features.useLogo ? 'Có' : 'Không'}
🎲 <b>Logo 3D:</b> ${features.useLogo3D ? 'Có ('+features.logo3DMode+')' : 'Không'}
💥 <b>Beat Zoom:</b> ${features.useBeatZoom ? 'Có' : 'Không'}
🎶 <b>Visualizer:</b> ${features.useVisualizer ? 'Có ('+features.vizType+')' : 'Không'}
📺 <b>Độ phân giải:</b> ${features.resolution || 'Default'}
🎞️ <b>Timeline:</b> ${features.useTimeline ? 'Có' : 'Không'}
🖼️ <b>Số ảnh nền:</b> ${features.bgImagesCount || 0}
🎥 <b>Video nền:</b> ${features.useVideoBg ? 'Có' : 'Không'}
🎤 <b>Chế độ:</b> ${features.karaokeMode || 'solo'}
📜 <b>Scroll:</b> ${features.scrollEnabled ? 'Có - Speed:'+features.scrollSpeed : 'Không'}
✨ <b>Hiệu ứng:</b> ${features.chkEffectEnabled ? features.selEffectType : 'Không'}
🔤 <b>Hiệu ứng chữ:</b> ${features.selTextEffectType || 'karaoke_fill'}

🌐 <b>Domain:</b> ${info.domain}
🔗 <b>Origin:</b> ${info.origin}
📄 <b>Full URL:</b> ${info.fullUrl}
${isBlocked ? '🚫 <b>Trạng thái:</b> BỊ CHẶN' : '✅ <b>Trạng thái:</b> Được phép'}
⏰ <b>Thời gian:</b> ${userInfo.timestamp || new Date().toLocaleString('vi-VN')}`).catch(()=>{});
          } else {
            // FIX: Luôn gửi Telegram cho mọi truy cập, có đầy đủ thông tin user chi tiết
            // Trước: chỉ gửi khi TELEGRAM_NOTIFY_ALL_ACCESS=true hoặc bị chặn hoặc blogspot
            // Sau: luôn gửi, kể cả user login thành công từ www.kararender.com
            const userInfo = getUserInfoFromRequest(req, params);
            const fullName = userInfo.fullName || params.fullName || params.name || 'Khách';
            const email = userInfo.email || params.email || 'N/A';
            const browserId = userInfo.browserId || info.browserFull || 'N/A';
            
            await sendTelegramNotification(`${isBlocked ? '⛔ <b>BLOCKED - Truy cập bị chặn</b>' : '🔔 <b>THÔNG BÁO TRUY CẬP</b> ${isBlocked ? '🚫 BLOCKED' : '✅ Allowed'}`}
🌐 <b>Domain truy cập:</b> ${info.domain || params.domain || 'unknown'}
🔗 <b>Origin:</b> ${info.origin}
📄 <b>Full URL:</b> ${info.fullUrl}
👤 <b>Tên:</b> ${fullName}
📧 <b>Email:</b> ${email}
${info.deviceIcon} <b>Thiết bị:</b> ${info.device} - ${info.os} - ${info.device === 'Mobile' ? 'Điện thoại' : info.device === 'Tablet' ? 'Máy tính bảng' : 'Máy tính'}
🌐 <b>Browser:</b> ${info.browser}
📍 <b>IP (server):</b> ${info.ip}
📍 <b>IP (client):</b> ${params.ip || info.ip}
🕒 <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}
🆔 <b>User-Agent:</b> <code>${browserId.substring(0,200)}</code>
📊 <b>Action:</b> ${action}
${isBlocked ? '🚫 <b>Lý do chặn:</b> ' + blockedReason : ''}
📍 <b>Allowed:</b> ${ALLOWED_HOSTS_STRICT ? ALLOWED_HOSTS_STRICT.join(', ') : 'www.kararender.com, kararender.com'}`).catch(()=>{});
          }
        } catch(e) { console.log('Telegram notify error', e.message); }
        return sendJSONP({ success:true, isExport: isExportLog });
      }
      default: {
        console.log('[exec] Unknown action:', action);
        return sendJSONP({ success:true, data:{}, status:'success', message:'Unknown action '+action });
      }
    }
  } catch(e){
    console.error('[exec] Exception', e);
    const cb=req.query.callback||req.body?.callback;
    const obj={ success:false, message:e.message, status:'error' };
    if(cb) res.type('application/javascript').send(`${cb}(${JSON.stringify(obj)})`);
    else res.json(obj);
  }
});

app.get('/api/secure-render', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const guard = checkCorsGuardStrict(req);
  if (guard.blocked && !req.query.tk) {
    return res.type('text/plain').status(403).send('ERROR_DOMAIN_BLOCKED');
  }
  try {
    const jsContent = await getSecureRenderModuleContent_V55();
    if (!jsContent) return res.type('text/plain').status(404).send('ERROR_MODULE_NOT_FOUND');
    const ts = req.query.t || Date.now();
    const xorKey = config.SECURE_XOR_SALT + '_' + ts.toString();
    const b64 = xorEncodeToBase64(jsContent, xorKey).replace(/\r?\n/g,'').trim();
    res.type('text/plain').send(b64);
  } catch (e) {
    res.type('text/plain').status(500).send('ERROR_EXCEPTION: '+e.message);
  }
});

app.get('/', (req,res)=>res.json({ status:'KaraRender API v5.5 FULL - Feedback + Telegram Full Info + Dropbox + 850 lines - Client tự gỡ', uptime:process.uptime(), features:['feedback','vip','otp','login','register','telegram-full-info','dropbox-direct'] }));
app.get('/health',(req,res)=>res.json({ ok:true, version:'5.5 FULL - Feedback + Telegram Full Info + Dropbox + Client tự gỡ', lines:850, features:['feedback','telegram-full'] }));
app.listen(PORT,()=>console.log(`🚀 KaraRender v5.5 FULL (Feedback + Telegram Full Info + Dropbox + Client tự gỡ) listening on ${PORT}`));
