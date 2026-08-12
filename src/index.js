require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('./config');

const app = express();
const PORT = config.PORT;
app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));

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

const adminHTML = `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KaraRender Admin v3.8 - Final Import</title>
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
  <h1 style="font-size:22px;font-weight:900;margin-bottom:16px">👑 KaraRender Admin v3.8 - Final (4 folders shared)</h1>
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <input id="adminEmail" value="chithanh2404@gmail.com" style="width:240px"/>
    <button class="btn" onclick="loadAll()">Tải dữ liệu</button>
    <button class="btn" style="background:#334155" onclick="checkDebug()">Debug Env</button>
  </div>
  <div id="debugBox" class="card" style="display:none;margin-bottom:16px"></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
    <div class="card"><div style="font-size:11px;color:#94a3b8">Users</div><div id="statUsers" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Fonts</div><div id="statFonts" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Effects</div><div id="statEffects" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Languages</div><div id="statLang" style="font-size:24px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Secure Module</div><div id="statSecure" style="font-size:24px;font-weight:900">-</div></div>
  </div>

  <div class="grid2" style="margin-bottom:20px">
    <div class="card" style="border-color:#f59e0b;background:rgba(245,158,11,0.08)">
      <h3 style="color:#fbbf24">📁 Users (đã xong)</h3>
      <button class="btn btn-amber" onclick="importDrive('users')">Import Users lại</button><span id="statusUsers" style="font-size:11px;margin-left:8px"></span>
      <pre id="logUsers" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:200px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#10b981;background:rgba(16,185,129,0.08)">
      <h3 style="color:#34d399">🔤 Fonts: 1IfRLJMWIsDdyVQTFf_jNz3L3i-2G7vKH</h3>
      <p style="font-size:11px;color:#94a3b8">Folder bạn share, có ~? files .ttf</p>
      <button class="btn btn-emerald" onclick="importDrive('fonts')">Import Fonts → Supabase Storage</button><span id="statusFonts" style="font-size:11px;margin-left:8px"></span>
      <pre id="logFonts" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#8b5cf6;background:rgba(139,92,246,0.08)">
      <h3 style="color:#a78bfa">✨ Effects: 19fwzMKXMkdpX-4tNPCfbyAqywo0zYmwC</h3>
      <p style="font-size:11px;color:#94a3b8">Folder Karaoke Effects bạn share, sẽ gộp tất cả JSON thành 1</p>
      <button class="btn btn-violet" onclick="importDrive('effects')">Import Effects Folder</button><span id="statusEffects" style="font-size:11px;margin-left:8px"></span>
      <pre id="logEffects" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:250px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#06b6d4;background:rgba(6,182,214,0.08)">
      <h3 style="color:#22d3ee">🌐 Languages & Secure Render</h3>
      <p style="font-size:11px;color:#94a3b8">Languages: 1mdXYIMIQiOXeMg3uWIaEeRnrNOoijUNp<br/>Secure: 1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button class="btn" style="background:#0891b2" onclick="importDrive('languages')">Import Languages</button>
        <button class="btn" style="background:#0891b2" onclick="importDrive('secure')">Import Secure Module</button>
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
let allUsers=[];
async function api(path, method='GET', body=null){
  const adminEmail=document.getElementById('adminEmail').value.trim();
  const opts={method, headers:{'Content-Type':'application/json','x-admin-email':adminEmail}};
  if(body) opts.body=JSON.stringify({...body, adminEmail});
  const url=path+(path.includes('?')?'&':'?')+'adminEmail='+encodeURIComponent(adminEmail);
  const res=await fetch(url, opts);
  const txt=await res.text();
  try{ return JSON.parse(txt); } catch{ return { raw: txt }; }
}
async function checkDebug(){
  const box=document.getElementById('debugBox'); box.style.display='block'; box.innerHTML='Checking...';
  try{ const data=await api('/api/admin/debug'); box.innerHTML='<pre style="white-space:pre-wrap;font-size:11px">'+JSON.stringify(data,null,2)+'</pre>'; }catch(e){ box.innerHTML='Lỗi: '+e.message; }
}
async function loadAll(){
  try{
    const users=await api('/api/admin/users');
    if(Array.isArray(users)){ allUsers=users; document.getElementById('statUsers').textContent=users.length; document.getElementById('usersBody').innerHTML=users.slice(0,20).map(u=>\`<tr><td>\${u.email}</td><td>\${u.full_name||''}</td><td>\${u.is_vip?'👑':''}</td><td>\${u.created_at?new Date(u.created_at).toLocaleDateString():''}</td></tr>\`).join(''); }
    const fonts=await api('/api/admin/stats/fonts'); if(fonts.count!==undefined) document.getElementById('statFonts').textContent=fonts.count;
    const effects=await api('/api/admin/stats/effects'); document.getElementById('statEffects').textContent=effects.exists?'OK ('+(effects.keys||0)+' keys)':'-';
    const langs=await api('/api/admin/stats/languages'); document.getElementById('statLang').textContent=langs.count||'-';
    const sec=await api('/api/admin/stats/secure'); document.getElementById('statSecure').textContent=sec.exists? (sec.length+' chars') : '-';
  }catch(e){ alert(e.message); }
}
async function importDrive(type){
  const mapBtn={users:'btnImportUsers',fonts:'btnImportFonts',effects:'btnImportEffects'}; // others use other
  const statusId={users:'statusUsers',fonts:'statusFonts',effects:'statusEffects',languages:'statusOther',secure:'statusOther'}[type]||'statusOther';
  const logId={users:'logUsers',fonts:'logFonts',effects:'logEffects',languages:'logOther',secure:'logOther'}[type]||'logOther';
  const btn=document.querySelector(\`button[onclick="importDrive('\${type}')"]\`);
  const status=document.getElementById(statusId), log=document.getElementById(logId);
  if(btn) { btn.disabled=true; btn.textContent='Đang import...'; }
  status.textContent='Đang xử lý...'; log.style.display='block'; log.textContent='Bắt đầu...';
  try{
    const endpoint={users:'/api/admin/import-drive-users',fonts:'/api/admin/import-fonts',effects:'/api/admin/import-effects-v2',languages:'/api/admin/import-languages',secure:'/api/admin/import-secure'}[type];
    const res=await api(endpoint,'POST',{});
    status.textContent=res.message||'Xong'; log.textContent=JSON.stringify(res,null,2);
    loadAll();
  }catch(e){ status.textContent='Lỗi: '+e.message; }
  if(btn) { btn.disabled=false; btn.textContent=btn.textContent.replace('Đang import...','Import lại'); }
}
loadAll();
</script>
</body>
</html>
`;

app.get('/admin', (req, res) => res.type('html').send(adminHTML));

app.get('/api/admin/debug', async (req, res) => {
  const { supabaseAdmin } = (() => { try { return require('./services/supabase'); } catch { return { supabaseAdmin: null }; } })();
  let usersCount=0, fontsCount=0, effectsInfo={ exists:false }, langCount=0, secureInfo={ exists:false };
  let driveOk=false, driveFiles={};
  try {
    if (supabaseAdmin) {
      const { count } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
      usersCount=count||0;
      const { data: fonts } = await supabaseAdmin.storage.from('fonts').list();
      fontsCount=fonts?fonts.length:0;
      const { data: eff } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle();
      effectsInfo={ exists: !!eff, keys: eff ? Object.keys(eff.content||{}).length : 0 };
      const { count: lc } = await supabaseAdmin.from('languages').select('*', { count: 'exact', head: true });
      langCount=lc||0;
      try { const fs=require('fs'), path=require('path'); const p=path.join(__dirname,'../secure-render-engine.js'); if(require('fs').existsSync(p)) secureInfo={ exists:true, length: fs.readFileSync(p,'utf-8').length }; } catch {}
    }
  } catch {}
  try {
    const { getDriveClient, listFilesInFolder } = require('./services/drive');
    const drive=getDriveClient();
    if (drive) {
      driveOk=true;
      const ids={
        USERS_FOLDER_ID: process.env.USERS_FOLDER_ID,
        FONTS_FOLDER_ID: process.env.FONTS_FOLDER_ID || '1IfRLJMWIsDdyVQTFf_jNz3L3i-2G7vKH',
        LANGUAGES_FOLDER_ID: process.env.LANGUAGES_FOLDER_ID || '1mdXYIMIQiOXeMg3uWIaEeRnrNOoijUNp',
        SECURE_RENDER_FOLDER_ID: process.env.SECURE_RENDER_FOLDER_ID || '1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP',
        EFFECTS_FOLDER_ID: process.env.EFFECTS_FOLDER_ID || process.env.EFFECTS_FILE_ID || '19fwzMKXMkdpX-4tNPCfbyAqywo0zYmwC',
        STYLE_FOLDER_ID: process.env.STYLE_FOLDER_ID
      };
      for (const k in ids) {
        if (ids[k]) {
          try { const files=await listFilesInFolder(ids[k]); driveFiles[k]=files.length; } catch { driveFiles[k]=-1; }
        }
      }
    }
  } catch {}
  res.json({
    version: 'v3.8 final',
    env: {
      USERS_FOLDER_ID: process.env.USERS_FOLDER_ID || 'NOT SET',
      FONTS_FOLDER_ID: process.env.FONTS_FOLDER_ID || '1IfRLJMWIsDdyVQTFf_jNz3L3i-2G7vKH (default)',
      LANGUAGES_FOLDER_ID: process.env.LANGUAGES_FOLDER_ID || '1mdXYIMIQiOXeMg3uWIaEeRnrNOoijUNp (default)',
      SECURE_RENDER_FOLDER_ID: process.env.SECURE_RENDER_FOLDER_ID || '1clt2d5FB3Y9VPJcSk9sxHnqcc_GBDPiP (default)',
      EFFECTS_FOLDER_ID: process.env.EFFECTS_FOLDER_ID || process.env.EFFECTS_FILE_ID || '19fwzMKXMkdpX-4tNPCfbyAqywo0zYmwC (default)',
      GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    },
    supabase: { usersCount, fontsCount, effectsInfo, langCount, secureInfo },
    drive: { ok: driveOk, files: driveFiles }
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
    const { data } = await supabaseAdmin.storage.from('fonts').list();
    res.json({ count: data?data.length:0 });
  }catch{ res.json({ count:0 }); }
});
app.get('/api/admin/stats/effects', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle();
    res.json({ exists: !!data, keys: data?Object.keys(data.content||{}).length:0 });
  }catch{ res.json({ exists:false }); }
});
app.get('/api/admin/stats/languages', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { count } = await supabaseAdmin.from('languages').select('*',{count:'exact',head:true});
    res.json({ count: count||0 });
  }catch{ res.json({ count:0 }); }
});
app.get('/api/admin/stats/secure', async (req,res)=>{
  try{
    const fs=require('fs'), path=require('path');
    const p=path.join(__dirname,'../secure-render-engine.js');
    if(fs.existsSync(p)) res.json({ exists:true, length: fs.readFileSync(p,'utf-8').length });
    else res.json({ exists:false });
  }catch{ res.json({ exists:false }); }
});
app.get('/api/admin/feedbacks', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('feedbacks').select('*').order('created_at',{ascending:false}).limit(200);
    res.json(data||[]);
  }catch{ res.json([]); }
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
    const { listFilesInFolder, getFileContent } = require('./services/drive');
    const folderId=process.env.FONTS_FOLDER_ID || '1IfRLJMWIsDdyVQTFf_jNz3L3i-2G7vKH';
    const files=await listFilesInFolder(folderId);
    const fontFiles=files.filter(f=>/\\.(ttf|otf|woff2|TTF|OTF)$/i.test(f.name));
    if(!fontFiles.length) return res.json({ status:'error', message:`Folder có ${files.length} file nhưng không có font`, totalFiles: files.length, sample: files.slice(0,10).map(f=>f.name) });
    try{ await supabaseAdmin.storage.createBucket('fonts',{ public:true }); }catch{}
    let imported=0, skipped=0, errors=[];
    for(const f of fontFiles){
      try{
        const { data: existing } = await supabaseAdmin.storage.from('fonts').list();
        if(existing && existing.find(x=>x.name===f.name)){ skipped++; continue; }
        const content=await getFileContent(f.id);
        if(!content) { errors.push(f.name+': no content'); continue; }
        let buffer;
        if(Buffer.isBuffer(content)) buffer=content;
        else if(content instanceof Uint8Array) buffer=Buffer.from(content);
        else buffer=Buffer.from(content);
        const { error } = await supabaseAdmin.storage.from('fonts').upload(f.name, buffer, { contentType: f.name.endsWith('.woff2')?'font/woff2':'font/ttf', upsert:false });
        if(error){
          if(error.message.includes('exists')||error.message.includes('Duplicate')) skipped++;
          else errors.push(f.name+': '+error.message);
        } else imported++;
      }catch(e){ errors.push(f.name+': '+e.message); }
    }
    res.json({ status:'success', message:`Import fonts: ${imported} imported, ${skipped} đã có, ${errors.length} lỗi`, imported, skipped, totalFiles: fontFiles.length, errors: errors.slice(0,10) });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

app.post('/api/admin/import-effects-v2', async (req,res)=>{
  try{
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    // Hỗ trợ cả EFFECTS_FILE_ID (file) và EFFECTS_FOLDER_ID (folder)
    const folderId = process.env.EFFECTS_FOLDER_ID || process.env.EFFECTS_FILE_ID || '19fwzMKXMkdpX-4tNPCfbyAqywo0zYmwC';
    console.log('[import-effects] folderId/fileId:', folderId);
    let merged = {};
    let files = [];
    // Thử list như folder
    try { files = await listFilesInFolder(folderId); } catch {}
    if (files && files.length > 0) {
      // Đây là folder, đọc tất cả JSON bên trong
      console.log(`[import-effects] Found ${files.length} files in effects folder`);
      for (const f of files) {
        if (!f.name.endsWith('.json')) continue;
        try {
          const content = await getFileContentAsString(f.id);
          if (!content) continue;
          const json = JSON.parse(content);
          // Gộp: nếu json có key wipe/fade/visualizer thì gộp, nếu không thì gộp trực tiếp
          if (json.wipe || json.fade || json.visualizer) {
            merged = { ...merged, ...json };
            if (json.wipe) merged.wipe = { ...(merged.wipe||{}), ...json.wipe };
            if (json.fade) merged.fade = { ...(merged.fade||{}), ...json.fade };
            if (json.visualizer) merged.visualizer = { ...(merged.visualizer||{}), ...json.visualizer };
          } else {
            merged = { ...merged, ...json };
          }
        } catch (e) { console.log('Parse effect file failed', f.name, e.message); }
      }
    } else {
      // Thử như file đơn
      console.log('[import-effects] No files listed, trying as single file ID');
      const content = await getFileContentAsString(folderId);
      if (content) {
        try { merged = JSON.parse(content); } catch (e) { return res.json({ status:'error', message:'File effects không phải JSON: '+e.message }); }
      } else {
        return res.json({ status:'error', message:'Không đọc được EFFECTS folder/file. Kiểm tra ID và quyền share.' });
      }
    }
    if (!Object.keys(merged).length) return res.json({ status:'error', message:'Không tìm thấy effects JSON nào trong folder', files: files.map(f=>f.name) });
    await supabaseAdmin.from('app_data').upsert({ key:'effects', content: merged, updated_at: new Date().toISOString() }, { onConflict:'key' });
    res.json({ status:'success', message:`Import effects xong: ${Object.keys(merged).length} top keys, wipe:${Object.keys(merged.wipe||{}).length}, fade:${Object.keys(merged.fade||{}).length}, visualizer:${Object.keys(merged.visualizer||{}).length}`, keys: Object.keys(merged), sampleWipe: Object.keys(merged.wipe||{}).slice(0,10) });
  }catch(e){ res.status(500).json({ status:'error', message:e.message, stack:e.stack }); }
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
    if(!target) return res.json({ status:'error', message:'Không tìm thấy secure-render-engine.js trong folder', files: files.map(f=>f.name) });
    const content=await getFileContentAsString(target.id);
    const fs=require('fs'), path=require('path');
    const dest=path.join(__dirname,'../secure-render-engine.js');
    fs.writeFileSync(dest, content, 'utf-8');
    res.json({ status:'success', message:`Đã tải secure module (${content.length} chars) và lưu vào server.`, length: content.length, file: target.name });
  }catch(e){ res.status(500).json({ status:'error', message:e.message }); }
});

// Legacy exec (keep)
app.all('/exec', async (req,res)=>{
  const params={ ...req.query, ...req.body };
  const action=params.action||params.mod;
  const callback=params.callback;
  const sendJSONP=(obj)=>{ if(callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(obj)})`); else res.json(obj); };
  const sendText=(txt)=>{ if(callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(txt)})`); else res.type('text/plain').send(txt); };
  try{
    const { supabaseAdmin } = require('./services/supabase');
    switch(action){
      case 'verify':{ const p=decodeOldToken(params.token||''); if(!p) return sendJSONP({ success:false }); return sendJSONP({ success:true, valid:true, token:params.token, user:{ email:p.email, fullName:p.fullName||p.full_name, role:p.role||'USER', isVip:p.isVip||p.is_vip, is_vip:p.isVip||p.is_vip, isAdmin:p.role==='ADMIN' } }); }
      case 'login':{
        const email=(params.email||'').toLowerCase().trim();
        const { data: user } = await supabaseAdmin.from('users').select('*').eq('email',email).single();
        if(!user) return sendJSONP({ success:false, msg:'Email không tồn tại' });
        const ok=await bcrypt.compare(params.password||'', user.password_hash);
        if(!ok) return sendJSONP({ success:false, msg:'Sai mật khẩu' });
        return sendJSONP({ success:true, token:createOldStyleToken(user), user:{ email:user.email, fullName:user.full_name, full_name:user.full_name, role:user.is_vip?'ADMIN':'USER', isVip:!!user.is_vip, is_vip:!!user.is_vip, isAdmin:!!user.is_vip, expiredDate: new Date(Date.now()+365*24*60*60*1000).toISOString() } });
      }
      case 'registerUser':{
        const email=(params.email||'').toLowerCase().trim();
        const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email',email).maybeSingle();
        if(ex) return sendJSONP({ success:false, msg:'Email đã tồn tại' });
        const hash=await bcrypt.hash(params.password||'',10);
        await supabaseAdmin.from('users').insert({ email, password_hash:hash, full_name:params.fullName||email, is_vip:false, created_at:new Date().toISOString() });
        return sendJSONP({ success:true, msg:'Đăng ký thành công!' });
      }
      case 'getLang':{
        try{ const { data } = await supabaseAdmin.from('languages').select('data').eq('code',params.lang||'vi').maybeSingle(); if(data&&data.data) return sendJSONP({ status:'success', success:true, data:data.data }); }catch{}
        return sendJSONP({ status:'success', success:true, data:{} });
      }
      case 'getFonts':{
        try{
          const { data } = await supabaseAdmin.storage.from('fonts').list();
          if(data&&data.length){
            const fonts=data.filter(f=>/\\.(ttf|otf|woff2)$/i.test(f.name)).map(f=>({ name:f.name.replace(/\\.[^/.]+$/,''), url:`${config.SUPABASE_URL}/storage/v1/object/public/fonts/${f.name}` }));
            if(fonts.length) return sendJSONP(fonts);
          }
        }catch{}
        return sendJSONP([]);
      }
      case 'getEffects':{
        try{ const { data } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle(); if(data&&data.content) return sendJSONP({ status:'success', success:true, data:data.content }); }catch{}
        return sendJSONP({ status:'success', success:true, data:{} });
      }
      default: return sendJSONP({ success:true, data:{} });
    }
  }catch(e){ const cb=req.query.callback||req.body?.callback; const obj={ success:false, message:e.message }; if(cb) res.type('application/javascript').send(`${cb}(${JSON.stringify(obj)})`); else res.json(obj); }
});

app.get('/', (req,res)=>res.json({ status:'KaraRender API v3.8 FINAL', uptime:process.uptime() }));
app.get('/health',(req,res)=>res.json({ ok:true, version:'3.8' }));
app.listen(PORT,()=>console.log(`🚀 KaraRender v3.8 FINAL listening on ${PORT}`));
