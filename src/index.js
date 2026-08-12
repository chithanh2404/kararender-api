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
function xorDecodeFromBase64(b64, key) {
  try {
    const xored = Buffer.from(b64, 'base64');
    const keyBytes = Buffer.from(key, 'utf-8');
    const decoded = Buffer.alloc(xored.length);
    for (let i = 0; i < xored.length; i++) decoded[i] = xored[i] ^ (keyBytes[i % keyBytes.length] & 0xFF);
    return decoded.toString('utf-8');
  } catch { return null; }
}

// SECURE v5.1 FULL - ~700 lines - Client tự gỡ khi xuất xong, không auto 5 phút
// Server giữ RAM cache lâu hơn (30 phút) hoặc cho đến khi client báo xong, không tự xóa sau 5 phút
let cachedModuleInRAM = null;
let cacheTimeInRAM = 0;
const RAM_CACHE_TTL = 30 * 60 * 1000; // 30 phút - giữ lâu hơn, client tự gỡ phía client, server không auto xóa 5 phút

function loadRealModuleFromDiskForInit() {
  try {
    const fs = require('fs');
    const path = require('path');
    const possiblePaths = [
      '/mnt/data/secure-render-engine_4.js',
      '/mnt/data/secure-render-engine.js',
      path.join(__dirname, '../secure-render-engine_4.js'),
      path.join(__dirname, '../../secure-render-engine_4.js'),
      path.join(__dirname, 'secure-render-engine_4.js')
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        if (content.length > 10000 && content.includes('KaraSecureRender')) {
          console.log('[Secure-v5.1-FULL] Found real module at', p, 'length', content.length);
          return content;
        }
      }
    }
  } catch {}
  return null;
}

async function getSecureRenderModuleContent_V51() {
  // 1. RAM cache - giữ 30 phút, không auto xóa 5 phút, để client tự gỡ phía client
  if (cachedModuleInRAM && Date.now() - cacheTimeInRAM < RAM_CACHE_TTL) {
    console.log('[Secure-v5.1-FULL] RAM cache hit, length', cachedModuleInRAM.length, 'age', Math.round((Date.now()-cacheTimeInRAM)/1000)+'s - Client sẽ tự gỡ khi xuất xong');
    return cachedModuleInRAM;
  } else if (cachedModuleInRAM) {
    console.log('[Secure-v5.1-FULL] RAM cache expired after 30min, clearing');
    cachedModuleInRAM = null;
  }
  
  // 2. Try disk real file (uploaded)
  const realFromDisk = loadRealModuleFromDiskForInit();
  if (realFromDisk) {
    console.log('[Secure-v5.1-FULL] Using real module from disk, length', realFromDisk.length, '- RAM 30min, client tự gỡ khi xong');
    cachedModuleInRAM = realFromDisk;
    cacheTimeInRAM = Date.now();
    // Không auto xóa sau 5 phút nữa, giữ 30 phút để client tự gỡ
    return realFromDisk;
  }
  
  // 3. Fetch from Drive
  try {
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.SECURE_RENDER_FOLDER_ID || '1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP';
    const files = await listFilesInFolder(folderId);
    const target = files.find(f => f.name === 'secure-render-engine_4.js' || f.name === 'secure-render-engine.js' || f.name.includes('secure-render'));
    if (!target) {
      console.log('[Secure-v5.1-FULL] No file in Drive');
      return null;
    }
    const content = await getFileContentAsString(target.id);
    if (!content || content.length < 1000) {
      console.log('[Secure-v5.1-FULL] Drive content too small', content?.length);
      return null;
    }
    console.log('[Secure-v5.1-FULL] Loaded from Drive', target.name, content.length, 'RAM 30min, client tự gỡ');
    cachedModuleInRAM = content;
    cacheTimeInRAM = Date.now();
    return content;
  } catch (e) {
    console.log('[Secure-v5.1-FULL] Drive error', e.message);
    return null;
  }
}

const adminHTML = `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin v5.1 FULL - 700 lines - Client tự gỡ khi xuất xong</title>
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
  <h1 style="font-size:22px;font-weight:900;margin-bottom:16px">👑 Admin v5.1 FULL - 700 dòng - Client tự gỡ khi xuất xong, không auto 5 phút</h1>
  <div style="background:#065f46;border:1px solid #10b981;border-radius:8px;padding:12px;margin-bottom:16px">
    <b>Thay đổi v5.1:</b> Server giữ module trong RAM 30 phút (thay vì 5 phút), không tự xóa. Client tự gỡ (revoke blob URL, remove script tag) khi xuất xong video. Bảo mật: module chỉ tồn tại ở client trong lúc render.
  </div>
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <input id="adminEmail" value="chithanh2404@gmail.com" style="width:240px"/>
    <button class="btn" onclick="loadAll()">Tải dữ liệu</button>
    <button class="btn" style="background:#334155" onclick="checkDebug()">Debug Real Module 152kb</button>
    <button class="btn" style="background:#059669" onclick="testTelegram()">Test Telegram</button>
  </div>
  <div id="debugBox" class="card" style="display:none;margin-bottom:16px"></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
    <div class="card"><div style="font-size:11px;color:#94a3b8">Users</div><div id="statUsers" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Fonts</div><div id="statFonts" style="font-size:24px;font-weight:900">-</div><div style="font-size:10px;color:#64748b">Phải 593</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Effects</div><div id="statEffects" style="font-size:24px;font-weight:900">-</div><div style="font-size:10px;color:#a78bfa">24 wipe + 2 fade + 32 viz</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Secure Real Module</div><div id="statSecure" style="font-size:12px;font-weight:700">-</div><div style="font-size:10px;color:#10b981">152kb, RAM 30min, client tự gỡ</div></div>
  </div>

  <div class="grid2" style="margin-bottom:20px">
    <div class="card" style="border-color:#10b981;background:rgba(16,185,129,0.08)">
      <h3 style="color:#34d399">🔤 Fonts: 593 files (Fix pagination 1000)</h3>
      <button class="btn btn-emerald" onclick="importDrive('fonts')">Import Fonts → Supabase</button><span id="statusFonts" style="font-size:11px;margin-left:8px"></span>
      <pre id="logFonts" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#8b5cf6;background:rgba(139,92,246,0.08)">
      <h3 style="color:#a78bfa">✨ Effects (24 wipe + 2 fade + 32 visualizer)</h3>
      <button class="btn btn-violet" onclick="importDrive('effects')">Import Effects Folder</button><span id="statusEffects" style="font-size:11px;margin-left:8px"></span>
      <pre id="logEffects" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#f59e0b;background:rgba(245,158,11,0.08)">
      <h3 style="color:#fbbf24">📁 Users (Import từ Drive)</h3>
      <button class="btn btn-amber" onclick="importDrive('users')">Import Users</button><span id="statusUsers" style="font-size:11px;margin-left:8px"></span>
      <pre id="logUsers" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:200px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#06b6d4;background:rgba(6,182,214,0.08)">
      <h3 style="color:#22d3ee">🔒 Secure Real Module 152kb (Client tự gỡ)</h3>
      <p style="font-size:11px;color:#67e8f9">Server RAM 30min, không auto 5 phút. Client tự revoke blob URL khi xuất xong.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button class="btn" style="background:#0891b2" onclick="importDrive('languages')">Import Languages</button>
        <button class="btn" style="background:#7c3aed" onclick="importDrive('secure')">Verify Real Module 152kb (RAM 30min)</button>
      </div>
      <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" style="background:#334155" onclick="testNoOrigin()">Test No-Origin (403)</button>
        <button class="btn" style="background:#059669" onclick="testSecureModule()">Test Real Module 152kb</button>
        <button class="btn" style="background:#d97706" onclick="testTelegram()">Test Telegram</button>
        <button class="btn" style="background:#dc2626" onclick="clearSecureCache()">Clear RAM Cache (Client tự gỡ xong)</button>
      </div>
      <span id="statusOther" style="font-size:11px"></span>
      <pre id="logOther" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
  </div>

  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid #334155"><b>👥 Users preview (20 mới nhất)</b></div>
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
    document.getElementById('statSecure').textContent = data.secureModule ? (data.secureModule.exists ? '✅ RAM '+data.secureModule.length+' chars' : '❌ Chưa có') : '-';
  }catch(e){ box.innerHTML='Lỗi: '+e.message; }
}
async function loadAll(){
  try{
    const users=await api('/api/admin/users');
    if(Array.isArray(users)){ document.getElementById('statUsers').textContent=users.length; document.getElementById('usersBody').innerHTML=users.slice(0,20).map(u=>\`<tr><td>\${u.email}</td><td>\${u.full_name||''}</td><td>\${u.is_vip?'👑':''}</td><td>\${u.created_at?new Date(u.created_at).toLocaleDateString():''}</td></tr>\`).join(''); }
    const fonts=await api('/api/admin/stats/fonts'); if(fonts.count!==undefined) document.getElementById('statFonts').textContent=fonts.count;
    const effects=await api('/api/admin/stats/effects'); document.getElementById('statEffects').textContent=effects.exists? 'OK ('+(effects.wipe||0)+' wipe)':'-';
  }catch(e){ console.error(e); }
}
async function importDrive(type){
  const statusId={users:'statusUsers',fonts:'statusFonts',effects:'statusEffects',languages:'statusOther',secure:'statusOther'}[type]||'statusOther';
  const logId={users:'logUsers',fonts:'logFonts',effects:'logEffects',languages:'logOther',secure:'logOther'}[type]||'logOther';
  const status=document.getElementById(statusId), log=document.getElementById(logId);
  status.textContent='Đang xử lý...'; log.style.display='block'; log.textContent='Bắt đầu...';
  try{
    const endpoint={users:'/api/admin/import-drive-users',fonts:'/api/admin/import-fonts',effects:'/api/admin/import-effects-v2',languages:'/api/admin/import-languages',secure:'/api/admin/import-secure'}[type];
    const res=await api(endpoint,'POST',{});
    status.textContent=res.message||'Xong'; log.textContent=JSON.stringify(res,null,2);
    loadAll(); checkDebug();
  }catch(e){ status.textContent='Lỗi: '+e.message; }
}
async function testNoOrigin(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Đang test no-origin...';
  try{ const res=await fetch('/exec?action=getEffects&callback=test'); const txt=await res.text(); log.textContent='Status: '+res.status+' (phải 403)\\n'+txt.slice(0,800); }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function testSecureModule(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Đang test real module 152kb (RAM 30min, client tự gỡ)...';
  try{
    const ts=Date.now();
    const raw=location.hostname+'|'+ts+'|test';
    const tk=btoa(raw).replace(/=+$/,'');
    const url='/exec?action=getSecureRenderModule&callback=test&t='+ts+'&tk='+encodeURIComponent(tk)+'&origin='+encodeURIComponent(location.hostname);
    const res=await fetch(url, { headers: { 'Origin': 'https://kararender.com', 'Referer': 'https://kararender.com/' } });
    const txt=await res.text();
    log.textContent='Status: '+res.status+'\\nLength: '+txt.length+'\\nFirst 200:\\n'+txt.slice(0,200)+'\\n\\nPhải ~206k chars, RAM 30min, client tự gỡ khi xuất xong.';
  }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function testTelegram(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Đang gửi test Telegram...';
  try{ const res=await api('/api/admin/test-telegram','POST',{}); log.textContent=JSON.stringify(res,null,2); }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function clearSecureCache(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Đang clear RAM cache (client đã xuất xong tự gỡ)...';
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
  let usersCount=0, fontsCount=0, effectsInfo={ exists:false }, langCount=0, secureInfo={ exists:false, security:'RAM 30min, client tự gỡ' };
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
      effectsInfo={ exists: !!eff, keys: eff ? Object.keys(eff.content||{}).length : 0, wipe: eff ? Object.keys(eff.content?.wipe||{}).length : 0 };
      const { count: lc } = await supabaseAdmin.from('languages').select('*', { count: 'exact', head: true });
      langCount=lc||0;
    }
    if (cachedModuleInRAM) {
      secureInfo = { exists:true, length: cachedModuleInRAM.length, source:'RAM cache (real module 152kb)', expiresIn: Math.round((RAM_CACHE_TTL - (Date.now() - cacheTimeInRAM))/1000)+'s', hasKaraSecureRender: cachedModuleInRAM.includes('KaraSecureRender'), security:'RAM 30min, client tự gỡ khi xuất xong, không auto 5 phút' };
    } else {
      const real = loadRealModuleFromDiskForInit();
      if (real) {
        secureInfo = { exists:false, hasRealFileOnDisk:true, length: real.length, source:'Found real file /mnt/data/secure-render-engine_4.js', hasKaraSecureRender: real.includes('KaraSecureRender'), security:'RAM 30min, client tự gỡ' };
      } else {
        secureInfo = { exists:false, source:'No RAM cache - will fetch from Drive', security:'RAM 30min, client tự gỡ, không auto 5 phút' };
      }
    }
    try {
      const { listFilesInFolder } = require('./services/drive');
      const folderId = process.env.SECURE_RENDER_FOLDER_ID || '1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP';
      const files = await listFilesInFolder(folderId);
      secureInfo.driveFiles = files.map(f=>f.name);
    } catch (e) { secureInfo.driveError = e.message; }
  } catch (e) { secureInfo.error = e.message; }
  
  res.json({
    version: 'v5.1 FULL - 700 lines - Real Module 152kb + Client tự gỡ khi xuất xong, không auto 5 phút',
    config: { ALLOWED_HOSTS: config.ALLOWED_HOSTS, SECURE_RENDER_FOLDER_ID: process.env.SECURE_RENDER_FOLDER_ID || '1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP', TELEGRAM: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID), RAM_CACHE_TTL: RAM_CACHE_TTL/1000+'s' },
    secureModule: secureInfo,
    supabase: { usersCount, fontsCount, effectsInfo, langCount },
    securityPolicy: 'Server RAM 30min, client tự gỡ (revoke blob URL, remove script) khi xuất xong video, không auto xóa 5 phút'
  });
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
    res.json({ exists: !!data, keys: data?Object.keys(data.content||{}).length:0, wipe: data?Object.keys(data.content?.wipe||{}).length:0 });
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
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
      return res.json({ status:'error', message:'Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID', token: !!config.TELEGRAM_BOT_TOKEN, chatId: !!config.TELEGRAM_CHAT_ID });
    }
    await sendTelegramNotification(`🔔 <b>Test Telegram v5.1 FULL</b>\n⏰ ${new Date().toLocaleString('vi-VN')}\n✅ Client tự gỡ khi xuất xong, không auto 5 phút`);
    res.json({ status:'success', message:'Đã gửi test Telegram!' });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/clear-secure-cache', async (req,res)=>{
  try{
    const hadCache = !!cachedModuleInRAM;
    const length = cachedModuleInRAM?.length || 0;
    cachedModuleInRAM = null;
    cacheTimeInRAM = 0;
    console.log('[Secure-v5.1-FULL] Manual clear RAM cache by admin/client, had', length, 'chars');
    await sendTelegramNotification(`🧹 <b>Clear Secure Cache</b>\n📦 ${hadCache ? length+' chars cleared' : 'No cache'} - Client đã xuất xong tự gỡ`);
    res.json({ status:'success', message: hadCache ? `Đã xóa RAM cache ${length} chars - Client tự gỡ khi xuất xong` : 'Không có cache', hadCache, length });
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
    res.json({ status:'success', message:`Import users: ${imported} imported, ${skipped} skipped`, imported, skipped, totalFiles: files.length });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-fonts', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder } = require('./services/drive');
    const folderId=process.env.FONTS_FOLDER_ID || '1IfRLJMWIsDdyVQTFf_jNz3L3i-2G7vKH';
    const files=await listFilesInFolder(folderId);
    const fontFiles=files.filter(f => /\.(ttf|otf|woff2|woff)$/i.test(f.name));
    if(!fontFiles.length) return res.json({ status:'error', message:`Folder có ${files.length} file nhưng không có font`, totalFiles: files.length, sample: files.slice(0,10).map(f=>f.name) });
    try{ await supabaseAdmin.storage.createBucket('fonts',{ public:true }); }catch{}
    let imported=0, skipped=0, errors=[];
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
        const { error } = await supabaseAdmin.storage.from('fonts').upload(f.name, buffer, { contentType: f.name.toLowerCase().endsWith('.woff2')?'font/woff2':'font/ttf', upsert:false });
        if(error){
          if(error.message.includes('exists')||error.message.includes('Duplicate')||error.message.includes('already')) skipped++;
          else errors.push(f.name+': '+error.message);
        } else imported++;
      }catch(e){ errors.push(f.name+': '+e.message); }
    }
    await sendTelegramNotification(`🔤 Import Fonts: ${imported} mới, ${skipped} đã có`);
    res.json({ status:'success', message:`Import fonts: ${imported} imported, ${skipped} đã có, ${errors.length} lỗi`, imported, skipped, totalFiles: fontFiles.length, errors: errors.slice(0,10) });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-effects-v2', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.EFFECTS_FOLDER_ID || process.env.EFFECTS_FILE_ID || '19fwzMKXMkdpX-4tNPCfbyAqywo0zYmwC';
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
    if(!Object.keys(merged).length) return res.json({ status:'error', message:'Không tìm thấy effects JSON', files: files.map(f=>f.name) });
    await supabaseAdmin.from('app_data').upsert({ key:'effects', content: merged, updated_at: new Date().toISOString() }, { onConflict:'key' });
    await sendTelegramNotification(`✨ Import Effects: Wipe ${Object.keys(merged.wipe||{}).length}, Fade ${Object.keys(merged.fade||{}).length}`);
    res.json({ status:'success', message:`Import effects: ${Object.keys(merged).length} keys, wipe:${Object.keys(merged.wipe||{}).length}, fade:${Object.keys(merged.fade||{}).length}`, keys: Object.keys(merged) });
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
      const content=await getFileContentAsString(f.id);
      if(!content) continue;
      try{
        const data=JSON.parse(content);
        const code=f.name.replace('.json','');
        await supabaseAdmin.from('languages').upsert({ code, data, updated_at: new Date().toISOString() }, { onConflict:'code' });
        imported++;
      }catch{}
    }
    res.json({ status:'success', message:`Import languages: ${imported}/${jsonFiles.length}`, imported, totalFiles: jsonFiles.length });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-secure', async (req,res)=>{
  try{
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId=process.env.SECURE_RENDER_FOLDER_ID || '1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP';
    const files=await listFilesInFolder(folderId);
    const target=files.find(f=>f.name==='secure-render-engine_4.js' || f.name==='secure-render-engine.js' || f.name.includes('secure-render'));
    if(!target) return res.json({ status:'error', message:'Không tìm thấy secure-render-engine.js', files: files.map(f=>f.name), security:'RAM 30min, client tự gỡ' });
    const content=await getFileContentAsString(target.id);
    if (!content || content.length < 1000) return res.json({ status:'error', message:'File rỗng hoặc quá nhỏ', length: content?.length||0, security:'RAM 30min' });
    try {
      const fs=require('fs'), path=require('path');
      const p1=path.join(__dirname,'../secure-render-engine.js');
      const p2=path.join(__dirname,'../../secure-render-engine.js');
      if (fs.existsSync(p1)) fs.unlinkSync(p1);
      if (fs.existsSync(p2)) fs.unlinkSync(p2);
      console.log('[Secure-v5.1-FULL] Deleted old local files for security');
    } catch {}
    cachedModuleInRAM = content;
    cacheTimeInRAM = Date.now();
    // Không auto xóa sau 5 phút, giữ 30 phút để client tự gỡ khi xuất xong
    await sendTelegramNotification(`🔒 Verify Secure v5.1 FULL: ${target.name} (${content.length} chars) - RAM 30min, client tự gỡ khi xuất xong`);
    res.json({ status:'success', message:`Đã verify secure module (${content.length} chars) - RAM 30min, client tự gỡ khi xuất xong video`, length: content.length, file: target.name, security:'RAM 30min, client tự gỡ, không auto 5 phút' });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

// LEGACY /exec with FULL + CLIENT TỰ GỠ
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

  const protectedActions = ['getFonts','getFontBase64','getEffects','getSecureRenderModule','getRenderEngine','kara-render-engine','saveUsageStats','getStyleList','getStyleContent','registerUser','logUserAccess','getLang','getlang'];
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
      case 'getLang':
      case 'getlang': {
        try{
          const langCode = (params.lang || 'vi').toLowerCase();
          console.log('[getLang v5.1 FIX] Request lang:', langCode, 'from', params.domain || params.origin);
          let langData = null;
          
          // 1. Supabase languages table
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('languages').select('data').eq('code', langCode).maybeSingle();
            if (data && data.data) {
              langData = data.data;
              console.log('[getLang v5.1 FIX] Found in Supabase', langCode, Object.keys(langData).length+' keys');
            }
          }
          
          // 2. Drive fallback
          if (!langData) {
            try {
              const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
              const folderId = process.env.LANGUAGES_FOLDER_ID || '1mdXYIMIQiOXeMg3uWIaEeRnrNOoijUNp';
              const files = await listFilesInFolder(folderId);
              const target = files.find(f => f.name.toLowerCase() === langCode+'.json');
              if (target) {
                const content = await getFileContentAsString(target.id);
                if (content) {
                  langData = JSON.parse(content);
                  console.log('[getLang v5.1 FIX] Found in Drive', langCode);
                }
              }
            } catch(e) { console.log('[getLang v5.1 FIX] Drive error', e.message); }
          }
          
          // FIX: Trả về đúng format theme cũ cần: {status:success, data:{...}}
          if (langData) {
            return sendJSONP({ status: 'success', success: true, data: langData });
          } else {
            console.log('[getLang v5.1 FIX] Not found', langCode, 'returning empty success');
            return sendJSONP({ status: 'success', success: true, data: {} });
          }
        }catch(e){
          console.error('[getLang v5.1 FIX] Exception', e);
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
            const { data, error } = await supabaseAdmin.storage.from('fonts').list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } });
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
          const jsContent = await getSecureRenderModuleContent_V51();
          if (!jsContent) {
            return res.type('text/plain').status(404).send('ERROR_MODULE_NOT_FOUND: secure-render-engine not found in Drive. Check folder ID');
          }
          if (!jsContent.includes('KaraSecureRender')) {
            return res.type('text/plain').status(500).send('ERROR_MODULE_INVALID: No KaraSecureRender, length '+jsContent.length);
          }
          console.log('[getSecureRenderModule-v5.1-FULL] Serving REAL module', jsContent.length, 't:', params.t, '- RAM 30min, client tự gỡ khi xuất xong');
          const xorKey = config.SECURE_XOR_SALT + '_' + (params.t || Date.now()).toString();
          const b64 = xorEncodeToBase64(jsContent, xorKey).replace(/\r?\n/g,'').trim();
          res.setHeader('X-Security-Policy', 'RAM 30min, client self-remove when export done, no auto 5min');
          res.setHeader('X-Client-Cleanup', 'Client must revoke blob URL and remove script tag when export done');
          return sendText(b64);
        }catch(e){ 
          console.error('[Secure-v5.1-FULL] error', e);
          return res.type('text/plain').status(500).send('ERROR_EXCEPTION: '+e.message); 
        }
      }
      case 'clearSecureModuleCache': {
        // Client gọi khi xuất xong video để tự gỡ
        const hadCache = !!cachedModuleInRAM;
        const length = cachedModuleInRAM?.length || 0;
        // Không xóa server cache ngay, chỉ log là client đã tự gỡ phía client
        console.log('[Secure-v5.1-FULL] Client báo đã xuất xong và tự gỡ module phía client, server giữ RAM 30min');
        return sendJSONP({ success:true, message:'Client đã tự gỡ module phía client (revoke blob URL), server giữ RAM 30min', hadCache, length, security:'Client self-remove' });
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
        sendTelegramNotification(`🔐 Login: ${email}`).catch(()=>{});
        return sendJSONP({ success:true, token:createOldStyleToken(user), user:{ email:user.email, fullName:user.full_name, role:user.is_vip?'ADMIN':'USER', isVip:!!user.is_vip } });
      }
      case 'registerUser':
      case 'register': {
        const email=(params.email||'').toLowerCase().trim();
        const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email',email).maybeSingle();
        if(ex) return sendJSONP({ success:false, msg:'Email đã tồn tại' });
        const hash=await bcrypt.hash(params.password||'',10);
        await supabaseAdmin.from('users').insert({ email, password_hash:hash, full_name:params.fullName||email, is_vip:false, created_at:new Date().toISOString() });
        sendTelegramNotification(`✅ Đăng ký: ${email}`).catch(()=>{});
        return sendJSONP({ success:true, msg:'Đăng ký thành công!' });
      }
      case 'saveUsageStats':
      case 'logUserAccess': {
        try{ if(supabaseAdmin) await supabaseAdmin.from('usage_stats').insert({ data: params, created_at: new Date().toISOString(), ip: req.ip }); }catch{}
        return sendJSONP({ success:true });
      }
      default: return sendJSONP({ success:true, data:{} });
    }
  } catch(e){
    const cb=req.query.callback||req.body?.callback;
    const obj={ success:false, message:e.message };
    if(cb) res.type('application/javascript').send(`${cb}(${JSON.stringify(obj)})`);
    else res.json(obj);
  }
});

app.get('/api/secure-render', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, Referer');
  const guard = checkCorsGuardStrict(req);
  if (guard.blocked && !req.query.tk) {
    return res.type('text/plain').status(403).send('ERROR_DOMAIN_BLOCKED: '+guard.source);
  }
  try {
    const jsContent = await getSecureRenderModuleContent_V51();
    if (!jsContent) return res.type('text/plain').status(404).send('ERROR_MODULE_NOT_FOUND');
    const ts = req.query.t || Date.now();
    const xorKey = config.SECURE_XOR_SALT + '_' + ts.toString();
    const b64 = xorEncodeToBase64(jsContent, xorKey).replace(/\r?\n/g,'').trim();
    res.type('text/plain').send(b64);
  } catch (e) {
    res.type('text/plain').status(500).send('ERROR_EXCEPTION: '+e.message);
  }
});

app.get('/', (req,res)=>res.json({ status:'KaraRender API v5.1 FULL - 700 lines - Client tự gỡ khi xuất xong, không auto 5 phút', uptime:process.uptime(), security:'Server RAM 30min, client self-remove' }));
app.get('/health',(req,res)=>res.json({ ok:true, version:'5.1 FULL - Client tự gỡ', lines:700, security:'Server RAM 30min, client self-remove when export done, no auto 5min' }));
app.listen(PORT,()=>console.log(`🚀 KaraRender v5.1 FULL (700 lines, Client tự gỡ khi xuất xong, không auto 5 phút) listening on ${PORT}`));
