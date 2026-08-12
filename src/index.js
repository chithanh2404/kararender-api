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
  console.log('[CONFIG] ALLOWED_HOSTS default:', config.ALLOWED_HOSTS);
}

const app = express();
const PORT = config.PORT;
app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));

// Telegram notification helper - FIXED v4.4
async function sendTelegramNotification(message) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.log('[Telegram] Skipped - no token/chat_id. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Render env');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
    const data = await res.json();
    if (!data.ok) console.warn('[Telegram] Failed', JSON.stringify(data));
    else console.log('[Telegram] Sent:', message.slice(0,80));
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
    return { blocked: true, source: 'no-origin', allowed: false, reason: 'Missing origin/referer - blocked by strict policy' };
  }
  const allowed = isAllowedDomain(source);
  return { blocked: !allowed, source, allowed };
}

const adminHTML = `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin v4.4 FULL - Telegram Fixed</title>
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
  <h1 style="font-size:22px;font-weight:900;margin-bottom:16px">👑 Admin v4.4 FULL - Telegram + 593 Fonts + Block No-Origin</h1>
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <input id="adminEmail" value="chithanh2404@gmail.com" style="width:240px"/>
    <button class="btn" onclick="loadAll()">Tải dữ liệu</button>
    <button class="btn" style="background:#334155" onclick="checkDebug()">Debug Env + Telegram</button>
    <button class="btn" style="background:#059669" onclick="testTelegram()">Test Telegram</button>
  </div>
  <div id="debugBox" class="card" style="display:none;margin-bottom:16px"></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
    <div class="card"><div style="font-size:11px;color:#94a3b8">Users</div><div id="statUsers" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Fonts</div><div id="statFonts" style="font-size:24px;font-weight:900">-</div><div style="font-size:10px;color:#64748b">Phải hiện 593</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Effects</div><div id="statEffects" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Telegram</div><div id="statTelegram" style="font-size:14px;font-weight:700">-</div></div>
  </div>

  <div class="grid2" style="margin-bottom:20px">
    <div class="card" style="border-color:#10b981;background:rgba(16,185,129,0.08)">
      <h3 style="color:#34d399">🔤 Fonts (593)</h3>
      <button class="btn btn-emerald" onclick="importDrive('fonts')">Import Fonts</button><span id="statusFonts" style="font-size:11px;margin-left:8px"></span>
      <pre id="logFonts" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#8b5cf6;background:rgba(139,92,246,0.08)">
      <h3 style="color:#a78bfa">✨ Effects</h3>
      <button class="btn btn-violet" onclick="importDrive('effects')">Import Effects</button><span id="statusEffects" style="font-size:11px;margin-left:8px"></span>
      <pre id="logEffects" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#f59e0b;background:rgba(245,158,11,0.08)">
      <h3 style="color:#fbbf24">📁 Users</h3>
      <button class="btn btn-amber" onclick="importDrive('users')">Import Users</button><span id="statusUsers" style="font-size:11px;margin-left:8px"></span>
      <pre id="logUsers" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:200px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#06b6d4;background:rgba(6,182,214,0.08)">
      <h3 style="color:#22d3ee">🔔 Telegram + Guard Test</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button class="btn" style="background:#0891b2" onclick="importDrive('languages')">Import Languages</button>
        <button class="btn" style="background:#0891b2" onclick="importDrive('secure')">Import Secure</button>
      </div>
      <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" style="background:#334155" onclick="testNoOrigin()">Test No-Origin (phải 403)</button>
        <button class="btn" style="background:#059669" onclick="testWithOrigin()">Test Origin kararender.com (200)</button>
        <button class="btn" style="background:#d97706" onclick="testTelegram()">Test Telegram Now</button>
      </div>
      <span id="statusOther" style="font-size:11px"></span>
      <pre id="logOther" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
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
    document.getElementById('statTelegram').textContent = data.telegram ? (data.telegram.ok ? '✅ Configured' : '❌ '+data.telegram.reason) : '-';
  }catch(e){ box.innerHTML='Lỗi: '+e.message; }
}
async function loadAll(){
  try{
    const users=await api('/api/admin/users');
    if(Array.isArray(users)) document.getElementById('statUsers').textContent=users.length;
    const fonts=await api('/api/admin/stats/fonts'); if(fonts.count!==undefined) document.getElementById('statFonts').textContent=fonts.count;
    const effects=await api('/api/admin/stats/effects'); document.getElementById('statEffects').textContent=effects.exists? 'OK ('+(effects.wipe||0)+' wipe)':'-';
  }catch(e){}
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
    loadAll();
  }catch(e){ status.textContent='Lỗi: '+e.message; }
}
async function testNoOrigin(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Đang test no-origin...';
  try{
    const res=await fetch('/exec?action=getEffects&callback=test');
    const txt=await res.text();
    log.textContent='Status: '+res.status+' (phải 403)\\n'+txt.slice(0,800);
  }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function testWithOrigin(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Đang test với origin...';
  try{
    const res=await fetch('/exec?action=getEffects&callback=test', { headers: { 'Origin': 'https://kararender.com', 'Referer': 'https://kararender.com/' } });
    const txt=await res.text();
    log.textContent='Status: '+res.status+' (phải 200)\\n'+txt.slice(0,800);
  }catch(e){ log.textContent='Lỗi: '+e.message; }
}
async function testTelegram(){
  const log=document.getElementById('logOther'); log.style.display='block'; log.textContent='Đang gửi test Telegram...';
  try{
    const res=await api('/api/admin/test-telegram','POST',{});
    log.textContent=JSON.stringify(res,null,2);
  }catch(e){ log.textContent='Lỗi: '+e.message; }
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
  let usersCount=0, fontsCount=0, effectsInfo={ exists:false }, driveFiles={};
  let telegramStatus = { ok: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID), token: !!config.TELEGRAM_BOT_TOKEN, chatId: !!config.TELEGRAM_CHAT_ID };
  if (!telegramStatus.ok) {
    telegramStatus.reason = !config.TELEGRAM_BOT_TOKEN ? 'Thiếu TELEGRAM_BOT_TOKEN' : 'Thiếu TELEGRAM_CHAT_ID';
  }
  let guard = checkCorsGuardStrict(req);
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
    }
  } catch {}
  res.json({
    version: 'v4.4 FULL - Telegram Fixed',
    config: { ALLOWED_HOSTS: config.ALLOWED_HOSTS, TELEGRAM_BOT_TOKEN: !!config.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: !!config.TELEGRAM_CHAT_ID },
    telegram: telegramStatus,
    currentRequest: { origin: req.headers.origin||'', referer: req.headers.referer||'', guard },
    supabase: { usersCount, fontsCount, effectsInfo },
    policy: 'No origin -> blocked, Telegram enabled'
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

// Telegram test endpoint
app.post('/api/admin/test-telegram', async (req,res)=>{
  try{
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
      return res.json({ status:'error', message:'Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID', token: !!config.TELEGRAM_BOT_TOKEN, chatId: !!config.TELEGRAM_CHAT_ID });
    }
    await sendTelegramNotification(`🔔 <b>Test Telegram từ KaraRender Admin v4.4</b>\n⏰ ${new Date().toLocaleString('vi-VN')}\n✅ Bot hoạt động bình thường!`);
    res.json({ status:'success', message:'Đã gửi tin nhắn test Telegram, kiểm tra bot của bạn!' });
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
        // Telegram for new imported user (optional, skip to avoid spam)
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
    await sendTelegramNotification(`🔤 <b>Import Fonts xong</b>\n✅ ${imported} mới, ⏭️ ${skipped} đã có, ❌ ${errors.length} lỗi\n📁 Tổng trong folder: ${fontFiles.length}`);
    res.json({ status:'success', message:`Import fonts: ${imported} imported, ${skipped} đã có, ${errors.length} lỗi`, imported, skipped, totalFiles: fontFiles.length, errors: errors.slice(0,10) });
  }catch(e){ res.status(500).json({ status:'error', message:e.message, stack:e.stack }); }
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
    await sendTelegramNotification(`✨ <b>Import Effects xong</b>\n🎨 Wipe: ${Object.keys(merged.wipe||{}).length}, Fade: ${Object.keys(merged.fade||{}).length}, Visualizer: ${Object.keys(merged.visualizer||{}).length}`);
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
    const target=files.find(f=>f.name==='secure-render-engine.js' || f.name==='secure-render-engine.html' || f.name.includes('secure-render'));
    if(!target) return res.json({ status:'error', message:'Không tìm thấy secure-render-engine.js', files: files.map(f=>f.name) });
    const content=await getFileContentAsString(target.id);
    const fs=require('fs'), path=require('path');
    const dest=path.join(__dirname,'../secure-render-engine.js');
    fs.writeFileSync(dest, content, 'utf-8');
    await sendTelegramNotification(`🔒 <b>Import Secure Module xong</b>\n📄 ${target.name} (${content.length} chars)`);
    res.json({ status:'success', message:`Đã tải secure module (${content.length} chars)`, length: content.length, file: target.name });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

// LEGACY /exec with STRICT guard + Telegram
app.all('/exec', async (req, res) => {
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

  const protectedActions = ['getFonts','getFontBase64','getEffects','getSecureRenderModule','getRenderEngine','kara-render-engine','saveUsageStats','getStyleList','getStyleContent','registerUser','logUserAccess'];
  if (protectedActions.includes(action)) {
    const guard = checkCorsGuardStrict(req);
    if (guard.blocked) {
      console.warn(`[GUARD-STRICT] Blocked ${action} - ${guard.reason}`);
      const result = { success: false, error: 'Domain not allowed - Missing origin', blocked: true, reason: guard.reason, allowedHosts: config.ALLOWED_HOSTS };
      if (callback) return res.type('application/javascript').send(`${callback}(${JSON.stringify(result)})`);
      return res.status(403).json(result);
    }
  }

  try {
    const { supabaseAdmin } = require('./services/supabase');
    switch (action) {
      case 'verify': {
        const payload = decodeOldToken(params.token||'');
        if (!payload) return sendJSONP({ success: false, message: 'Token không hợp lệ' });
        return sendJSONP({ success: true, valid: true, token: params.token, user: { email: payload.email, fullName: payload.fullName||payload.full_name, role: payload.role||'USER', isVip: payload.isVip||payload.is_vip, is_vip: payload.isVip||payload.is_vip } });
      }
      case 'login': {
        const email=(params.email||'').toLowerCase().trim();
        const { data: user } = await supabaseAdmin.from('users').select('*').eq('email',email).single();
        if(!user) return sendJSONP({ success:false, msg:'Email không tồn tại' });
        const ok=await bcrypt.compare(params.password||'', user.password_hash);
        if(!ok) return sendJSONP({ success:false, msg:'Sai mật khẩu' });
        await supabaseAdmin.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
        // Telegram login
        sendTelegramNotification(`🔐 <b>Login</b>\n📧 ${email}\n🌐 ${req.headers.origin || req.headers.referer || 'unknown'}`).catch(()=>{});
        return sendJSONP({ success:true, token:createOldStyleToken(user), user:{ email:user.email, fullName:user.full_name, full_name:user.full_name, role:user.is_vip?'ADMIN':'USER', isVip:!!user.is_vip, is_vip:!!user.is_vip, isAdmin:!!user.is_vip, expiredDate: new Date(Date.now()+365*24*60*60*1000).toISOString() } });
      }
      case 'registerUser':
      case 'register': {
        const email=(params.email||'').toLowerCase().trim();
        const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email',email).maybeSingle();
        if(ex) return sendJSONP({ success:false, msg:'Email đã tồn tại' });
        const hash=await bcrypt.hash(params.password||'',10);
        await supabaseAdmin.from('users').insert({ email, password_hash:hash, full_name:params.fullName||email, is_vip:false, created_at:new Date().toISOString() });
        // Telegram new register
        sendTelegramNotification(`✅ <b>Đăng ký mới</b>\n📧 ${email}\n👤 ${params.fullName||''}\n🌐 ${req.headers.origin || req.headers.referer || 'unknown'}`).catch(()=>{});
        return sendJSONP({ success:true, msg:'Đăng ký thành công!' });
      }
      case 'sendOTP': {
        const email=(params.email||'').toLowerCase().trim();
        const otp = Math.floor(100000+Math.random()*900000).toString();
        const expiresAt = new Date(Date.now()+5*60*1000).toISOString();
        try {
          await supabaseAdmin.from('otps').upsert({ email, otp, expires_at: expiresAt, created_at: new Date().toISOString() }, { onConflict:'email' });
        } catch {}
        await sendTelegramNotification(`🔑 <b>OTP Request</b>\n📧 ${email}\n🔢 OTP: ${otp} (5 phút)\n🌐 ${req.headers.origin || ''}`);
        return sendJSONP(`Mã OTP đã được gửi tới email ${email}. OTP (debug): ${otp}`);
      }
      case 'saveFeedback': {
        let payload={}; try{ payload=JSON.parse(params.data||'{}'); }catch{ payload=params; }
        try{
          if(supabaseAdmin) await supabaseAdmin.from('feedbacks').insert({ email: payload.email, message: payload.message||JSON.stringify(payload), created_at: new Date().toISOString(), domain: params.domain||'' });
        }catch{}
        await sendTelegramNotification(`💬 <b>Feedback mới</b>\n📧 ${payload.email||'unknown'}\n📝 ${ (payload.message||'').slice(0,500)}\n🌐 ${params.domain||req.headers.origin||''}`);
        return sendJSONP({ status:'success', success:true });
      }
      case 'requestVip': {
        try{
          if(supabaseAdmin) await supabaseAdmin.from('feedbacks').insert({ email: params.email, message: 'Yêu cầu VIP', created_at: new Date().toISOString(), domain: 'vip-request' });
        }catch{}
        await sendTelegramNotification(`👑 <b>Yêu cầu VIP</b>\n📧 ${params.email}\n🌐 ${req.headers.origin||''}`);
        return sendJSONP({ success:true });
      }
      case 'adminVipAction': {
        try{
          await supabaseAdmin.from('users').update({ is_vip: (params.action||'')==='approve' }).eq('email', (params.email||'').toLowerCase());
          await sendTelegramNotification(`${(params.action||'')==='approve' ? '✅ Duyệt VIP' : '❌ Từ chối VIP'} cho ${params.email} - bởi ${params.adminEmail||'admin'}`);
        }catch{}
        return sendJSONP({ status:'success' });
      }
      case 'getLang': {
        try{ const { data } = await supabaseAdmin.from('languages').select('data').eq('code',params.lang||'vi').maybeSingle(); if(data&&data.data) return sendJSONP({ status:'success', success:true, data:data.data }); }catch{}
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
        }catch(e){ console.log('getFonts error', e.message); }
        return sendJSONP([]);
      }
      case 'getEffects': {
        try{
          const { data } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle();
          if(data&&data.content){
            return sendJSONP({ status:'success', success:true, data:data.content });
          }
        }catch(e){ console.log('getEffects error', e.message); }
        return sendJSONP({ status:'success', success:true, data:{} });
      }
      case 'getSecureRenderModule':
      case 'kara-render-engine':
      case 'getRenderEngine': {
        try{
          const fs=require('fs'), path=require('path'), { xorEncodeToBase64 } = require('./services/xor');
          let js=''; try{ const p=path.join(__dirname,'../secure-render-engine.js'); if(fs.existsSync(p)) js=fs.readFileSync(p,'utf-8'); }catch{}
          if(!js) js='window.karaRenderEngineLoaded=true;';
          const b64=xorEncodeToBase64(js, config.SECURE_XOR_SALT + '_' + (params.t||Date.now())).replace(/\r?\n/g,'').trim();
          return sendText(b64);
        }catch{ return sendText(''); }
      }
      case 'saveUsageStats':
      case 'logUserAccess': {
        try{ if(supabaseAdmin) await supabaseAdmin.from('usage_stats').insert({ data: params, created_at: new Date().toISOString(), ip: req.ip }); }catch{}
        return sendJSONP({ success:true });
      }
      default: return sendJSONP({ success:true, data:{} });
    }
  } catch(e){
    console.error('[LEGACY]', e);
    const cb=req.query.callback||req.body?.callback;
    const obj={ success:false, message:e.message };
    if(cb) res.type('application/javascript').send(`${cb}(${JSON.stringify(obj)})`);
    else res.json(obj);
  }
});

app.get('/', (req,res)=>res.json({ status:'KaraRender API v4.4 FULL - Telegram Fixed', uptime:process.uptime(), allowedHosts: config.ALLOWED_HOSTS, telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) }));
app.get('/health',(req,res)=>res.json({ ok:true, version:'4.4 FULL Telegram', allowedHosts: config.ALLOWED_HOSTS, telegram: !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) }));
app.listen(PORT,()=>console.log(`🚀 KaraRender v4.4 FULL Telegram listening on ${PORT}, allowed:`, config.ALLOWED_HOSTS, 'telegram:', !!(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID)));
