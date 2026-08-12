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
    console.log(`[SEED] Created ${adminEmail}`);
  } catch (e) { console.error('[SEED]', e.message); }
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
<title>KaraRender Admin v3.7 - Full Import</title>
<style>
*{box-sizing:border-box} body{font-family:Inter,system-ui,sans-serif;background:#0b1020;color:#e2e8f0;margin:0}
.card{background:rgba(30,41,59,0.5);border:1px solid #334155;border-radius:12px;padding:16px}
.btn{background:#2563eb;color:white;border:0;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px}
.btn:hover{background:#1d4ed8} .btn-amber{background:#d97706} .btn-amber:hover{background:#b45309} .btn-emerald{background:#059669} .btn-emerald:hover{background:#047857}
table{width:100%;border-collapse:collapse} th{color:#94a3b8;font-size:11px;text-transform:uppercase;padding:8px;text-align:left;background:#0f172a;position:sticky;top:0} td{padding:8px;border-bottom:1px solid #1e293b;font-size:12px}
input{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 12px;color:white;font-size:13px}
.badge{font-size:10px;padding:2px 6px;border-radius:4px;font-weight:900}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:900px){ .grid2{grid-template-columns:1fr} }
</style>
</head>
<body>
<div style="max-width:1300px;margin:0 auto;padding:20px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
    <h1 style="font-size:22px;font-weight:900">👑 KaraRender Admin v3.7 - Full Import Fonts & Effects</h1>
    <div style="display:flex;gap:8px">
      <input id="adminEmail" placeholder="admin email" style="width:220px" value="chithanh2404@gmail.com"/>
      <button class="btn" onclick="loadAll()">Tải dữ liệu</button>
      <button class="btn" style="background:#334155" onclick="checkDebug()">Debug</button>
    </div>
  </div>

  <div id="debugBox" style="display:none" class="card" style="margin-bottom:16px"></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
    <div class="card"><div style="font-size:11px;color:#94a3b8">Tổng Users</div><div id="statUsers" style="font-size:26px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">VIP</div><div id="statVip" style="font-size:26px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Fonts (Supabase)</div><div id="statFonts" style="font-size:26px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Effects</div><div id="statEffects" style="font-size:26px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Feedbacks</div><div id="statFeedback" style="font-size:26px;font-weight:900">-</div></div>
  </div>

  <div class="grid2" style="margin-bottom:20px">
    <div class="card" style="border-color:#f59e0b;background:rgba(245,158,11,0.08)">
      <h3 style="color:#fbbf24;font-weight:800">📁 Import Users từ Drive</h3>
      <p style="font-size:11px;color:#94a3b8;margin:6px 0">Cần USERS_FOLDER_ID + GOOGLE_SERVICE_ACCOUNT_JSON</p>
      <button class="btn btn-amber" onclick="importDrive('users')" id="btnImportUsers">Import Users</button>
      <span id="statusUsers" style="font-size:11px;margin-left:8px"></span>
      <pre id="logUsers" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:200px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#10b981;background:rgba(16,185,129,0.08)">
      <h3 style="color:#34d399;font-weight:800">🔤 Import Fonts từ Drive → Supabase Storage</h3>
      <p style="font-size:11px;color:#94a3b8;margin:6px 0">Cần FONTS_FOLDER_ID. Sẽ upload .ttf/.otf/.woff2 lên bucket 'fonts' (public)</p>
      <button class="btn btn-emerald" onclick="importDrive('fonts')" id="btnImportFonts">Import Fonts</button>
      <span id="statusFonts" style="font-size:11px;margin-left:8px"></span>
      <pre id="logFonts" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:200px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#8b5cf6;background:rgba(139,92,246,0.08)">
      <h3 style="color:#a78bfa;font-weight:800">✨ Import Effects (wipeEffect + visualizer)</h3>
      <p style="font-size:11px;color:#94a3b8;margin:6px 0">Cần EFFECTS_FILE_ID (ID file JSON effects trên Drive)</p>
      <button class="btn" style="background:#7c3aed" onclick="importDrive('effects')" id="btnImportEffects">Import Effects</button>
      <span id="statusEffects" style="font-size:11px;margin-left:8px"></span>
      <pre id="logEffects" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:200px;overflow:auto;font-size:10px"></pre>
    </div>
    <div class="card" style="border-color:#06b6d4;background:rgba(6,182,214,0.08)">
      <h3 style="color:#22d3ee;font-weight:800">🎨 Import Languages & Styles & Secure Render</h3>
      <p style="font-size:11px;color:#94a3b8;margin:6px 0">Cần LANGUAGES_FOLDER_ID, STYLE_FOLDER_ID, SECURE_RENDER_FOLDER_ID</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" style="background:#0891b2" onclick="importDrive('languages')" id="btnImportLang">Import Languages</button>
        <button class="btn" style="background:#0891b2" onclick="importDrive('styles')" id="btnImportStyles">Import Styles</button>
        <button class="btn" style="background:#0891b2" onclick="importDrive('secure')" id="btnImportSecure">Import Secure Module</button>
      </div>
      <span id="statusOther" style="font-size:11px;margin-left:8px"></span>
      <pre id="logOther" style="display:none;margin-top:8px;background:#020617;padding:8px;border-radius:6px;max-height:200px;overflow:auto;font-size:10px"></pre>
    </div>
  </div>

  <div class="card" style="padding:0;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid #334155;display:flex;justify-content:space-between"><b>👥 Users (2000 mới nhất)</b><input id="searchUser" placeholder="Tìm email..." style="width:160px;padding:4px 8px;font-size:11px" oninput="filterUsers()"/></div>
    <div style="overflow:auto;max-height:400px"><table><thead><tr><th>Email</th><th>Tên</th><th>VIP</th><th>Ngày tạo</th><th>Action</th></tr></thead><tbody id="usersBody"><tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b">Chưa tải</td></tr></tbody></table></div>
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
  try{ return JSON.parse(txt); } catch{ return { raw: txt, status: res.status }; }
}
async function checkDebug(){
  const box=document.getElementById('debugBox');
  box.style.display='block'; box.innerHTML='Đang kiểm tra...';
  try{
    const data=await api('/api/admin/debug');
    box.innerHTML='<b>Debug Info:</b><pre style="white-space:pre-wrap;font-size:11px;margin-top:8px">'+JSON.stringify(data,null,2)+'</pre>';
  }catch(e){ box.innerHTML='Lỗi: '+e.message; }
}
async function loadAll(){
  try{
    document.getElementById('usersBody').innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px">Đang tải...</td></tr>';
    const users=await api('/api/admin/users');
    if(Array.isArray(users)){ allUsers=users; document.getElementById('statUsers').textContent=users.length; document.getElementById('statVip').textContent=users.filter(u=>u.is_vip).length; renderUsers(users); }
    else document.getElementById('usersBody').innerHTML='<tr><td colspan="5" style="color:#ef4444">'+JSON.stringify(users).slice(0,500)+'</td></tr>';

    const fonts=await api('/api/admin/stats/fonts');
    if(fonts.count!==undefined) document.getElementById('statFonts').textContent=fonts.count;
    const effects=await api('/api/admin/stats/effects');
    if(effects.exists!==undefined) document.getElementById('statEffects').textContent=effects.exists?'OK':'-';

    const feedbacks=await api('/api/admin/feedbacks');
    if(Array.isArray(feedbacks)) document.getElementById('statFeedback').textContent=feedbacks.length;
  }catch(e){ alert('Lỗi: '+e.message); }
}
function renderUsers(users){
  const body=document.getElementById('usersBody');
  if(!users.length){ body.innerHTML='<tr><td colspan="5" style="text-align:center;padding:20px">Trống</td></tr>'; return; }
  body.innerHTML=users.map(u=>\`<tr><td>\${u.email}</td><td>\${u.full_name||''}</td><td>\${u.is_vip?'👑':''}</td><td>\${u.created_at?new Date(u.created_at).toLocaleDateString():''}</td><td><button onclick="toggleVip('\${u.email}',\${!u.is_vip})" style="padding:4px 8px;border-radius:4px;border:0;cursor:pointer;font-size:10px;background:\${u.is_vip?'#334155':'#d97706'};color:white">\${u.is_vip?'Hủy VIP':'Duyệt VIP'}</button></td></tr>\`).join('');
}
function filterUsers(){ const q=document.getElementById('searchUser').value.toLowerCase(); renderUsers(allUsers.filter(u=>u.email.toLowerCase().includes(q)||(u.full_name||'').toLowerCase().includes(q))); }
async function toggleVip(email,isVip){ if(!confirm((isVip?'Duyệt':'Hủy')+' VIP '+email+'?'))return; const res=await api('/api/admin/approve-vip','POST',{email,action:isVip?'approve':'reject'}); if(res.status==='success') loadAll(); else alert(res.message||'Lỗi'); }
async function importDrive(type){
  const btnId={users:'btnImportUsers',fonts:'btnImportFonts',effects:'btnImportEffects',languages:'btnImportLang',styles:'btnImportStyles',secure:'btnImportSecure'}[type]||'btnImportUsers';
  const statusId={users:'statusUsers',fonts:'statusFonts',effects:'statusEffects',languages:'statusOther',styles:'statusOther',secure:'statusOther'}[type];
  const logId={users:'logUsers',fonts:'logFonts',effects:'logEffects',languages:'logOther',styles:'logOther',secure:'logOther'}[type];
  const btn=document.getElementById(btnId), status=document.getElementById(statusId), log=document.getElementById(logId);
  btn.disabled=true; const oldText=btn.textContent; btn.textContent='Đang import...'; status.textContent='Đang xử lý...'; log.style.display='block'; log.textContent='Bắt đầu...';
  try{
    const endpoint={users:'/api/admin/import-drive-users',fonts:'/api/admin/import-fonts',effects:'/api/admin/import-effects',languages:'/api/admin/import-languages',styles:'/api/admin/import-styles',secure:'/api/admin/import-secure'}[type];
    const res=await api(endpoint,'POST',{});
    status.textContent=res.message||'Xong'; log.textContent=JSON.stringify(res,null,2);
    if(res.imported||res.count) loadAll();
  }catch(e){ status.textContent='Lỗi: '+e.message; log.textContent=e.stack||e.message; }
  btn.disabled=false; btn.textContent=oldText;
}
loadAll();
</script>
</body>
</html>
`;

app.get('/admin', (req, res) => res.type('html').send(adminHTML));

app.get('/api/admin/debug', async (req, res) => {
  const { supabaseAdmin } = (() => { try { return require('./services/supabase'); } catch { return { supabaseAdmin: null }; } })();
  let usersCount = 0, fontsCount = 0, effectsExists = false;
  let driveOk = false, driveFiles = { users:0, fonts:0, styles:0, languages:0, secure:0 };
  try {
    if (supabaseAdmin) {
      const { count } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
      usersCount = count || 0;
      const { data: fonts } = await supabaseAdmin.storage.from('fonts').list();
      fontsCount = fonts ? fonts.length : 0;
      const { data: eff } = await supabaseAdmin.from('app_data').select('key').eq('key','effects').maybeSingle();
      effectsExists = !!eff;
    }
  } catch {}
  try {
    const { getDriveClient, listFilesInFolder } = require('./services/drive');
    const drive = getDriveClient();
    if (drive) {
      driveOk = true;
      const ids = { users: process.env.USERS_FOLDER_ID, fonts: process.env.FONTS_FOLDER_ID, styles: process.env.STYLE_FOLDER_ID, languages: process.env.LANGUAGES_FOLDER_ID, secure: process.env.SECURE_RENDER_FOLDER_ID };
      for (const k in ids) {
        if (ids[k]) {
          try { const files = await listFilesInFolder(ids[k]); driveFiles[k] = files.length; } catch { driveFiles[k] = -1; }
        }
      }
    }
  } catch {}
  res.json({
    version: 'v3.7 full import',
    env: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      USERS_FOLDER_ID: process.env.USERS_FOLDER_ID || 'NOT SET',
      FONTS_FOLDER_ID: process.env.FONTS_FOLDER_ID || 'NOT SET',
      EFFECTS_FILE_ID: process.env.EFFECTS_FILE_ID || 'NOT SET',
      STYLE_FOLDER_ID: process.env.STYLE_FOLDER_ID || 'NOT SET',
      LANGUAGES_FOLDER_ID: process.env.LANGUAGES_FOLDER_ID || 'NOT SET',
      SECURE_RENDER_FOLDER_ID: process.env.SECURE_RENDER_FOLDER_ID || 'NOT SET',
      GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'NOT SET'
    },
    supabase: { usersCount, fontsCount, effectsExists },
    drive: { ok: driveOk, files: driveFiles }
  });
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase not configured' });
    const { data, error } = await supabaseAdmin.from('users').select('id,email,full_name,is_vip,created_at').order('created_at',{ascending:false}).limit(2000);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data||[]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/stats/fonts', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.storage.from('fonts').list();
    res.json({ count: data ? data.length : 0 });
  } catch { res.json({ count: 0 }); }
});
app.get('/api/admin/stats/effects', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('app_data').select('key').eq('key','effects').maybeSingle();
    res.json({ exists: !!data });
  } catch { res.json({ exists: false }); }
});
app.get('/api/admin/feedbacks', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('feedbacks').select('*').order('created_at',{ascending:false}).limit(200);
    res.json(data||[]);
  } catch { res.json([]); }
});
app.get('/api/admin/usage', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('usage_stats').select('*').order('created_at',{ascending:false}).limit(200);
    res.json(data||[]);
  } catch { res.json([]); }
});
app.post('/api/admin/approve-vip', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    await supabaseAdmin.from('users').update({ is_vip: req.body.action==='approve' }).eq('email', (req.body.email||'').toLowerCase());
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/api/admin/import-drive-users', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.USERS_FOLDER_ID;
    if (!folderId) return res.json({ status: 'error', message: 'Chưa cấu hình USERS_FOLDER_ID' });
    const files = await listFilesInFolder(folderId);
    if (!files.length) return res.json({ status: 'error', message: 'Không tìm thấy file nào trong Users folder', totalFiles: 0 });
    let imported=0, skipped=0;
    for (const f of files) {
      try {
        const content = await getFileContentAsString(f.id);
        if (!content) { skipped++; continue; }
        let obj; try { obj = JSON.parse(content); } catch { skipped++; continue; }
        const email = (obj.email||f.name.replace('.json','')).toLowerCase().trim();
        if (!email.includes('@')) { skipped++; continue; }
        const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (ex) { skipped++; continue; }
        let hash = obj.password_hash||'';
        if (!hash && obj.password) hash = await bcrypt.hash(obj.password, 10);
        else if (!hash) hash = await bcrypt.hash('Temp'+Math.random().toString(36).slice(2), 10);
        else if (hash.length<50) hash = await bcrypt.hash(hash, 10);
        await supabaseAdmin.from('users').insert({ email, password_hash: hash, full_name: obj.fullName||obj.full_name||email, is_vip: !!(obj.isVip||obj.role==='VIP'||obj.role==='ADMIN'), created_at: obj.created_at||new Date().toISOString() });
        imported++;
      } catch {}
    }
    res.json({ status: 'success', message: `Import users xong: ${imported} imported, ${skipped} skipped`, imported, skipped, totalFiles: files.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/api/admin/import-fonts', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContent } = require('./services/drive');
    const folderId = process.env.FONTS_FOLDER_ID;
    if (!folderId) return res.json({ status: 'error', message: 'Chưa cấu hình FONTS_FOLDER_ID. Hãy lấy ID folder Fonts trên Drive.' });
    const files = await listFilesInFolder(folderId);
    const fontFiles = files.filter(f => /\\.(ttf|otf|woff2)$/i.test(f.name));
    if (!fontFiles.length) return res.json({ status: 'error', message: `Folder có ${files.length} file nhưng không có file font .ttf/.otf/.woff2`, totalFiles: files.length, sample: files.slice(0,5).map(f=>f.name) });

    // Đảm bảo bucket tồn tại
    try { await supabaseAdmin.storage.createBucket('fonts', { public: true }); } catch {}

    let imported=0, skipped=0, errors=[];
    for (const f of fontFiles) {
      try {
        const { data: existing } = await supabaseAdmin.storage.from('fonts').list();
        if (existing && existing.find(x=>x.name===f.name)) { skipped++; continue; }
        const content = await getFileContent(f.id);
        if (!content) { errors.push(f.name+': no content'); continue; }
        // content là arraybuffer hoặc object, chuyển thành Buffer
        let buffer;
        if (Buffer.isBuffer(content)) buffer = content;
        else if (content instanceof Uint8Array) buffer = Buffer.from(content);
        else if (typeof content === 'object' && content.data) buffer = Buffer.from(content.data);
        else buffer = Buffer.from(content);

        // Upload
        const { error } = await supabaseAdmin.storage.from('fonts').upload(f.name, buffer, { contentType: f.name.endsWith('.woff2') ? 'font/woff2' : 'font/ttf', upsert: false });
        if (error) {
          if (error.message.includes('exists') || error.message.includes('Duplicate')) skipped++;
          else errors.push(f.name+': '+error.message);
        } else imported++;
      } catch (e) { errors.push(f.name+': '+e.message); }
    }
    res.json({ status: 'success', message: `Import fonts xong: ${imported} imported, ${skipped} skipped (đã có), ${errors.length} lỗi`, imported, skipped, totalFiles: fontFiles.length, errors: errors.slice(0,10), sample: fontFiles.slice(0,5).map(f=>f.name) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message, stack: e.stack }); }
});

app.post('/api/admin/import-effects', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { getFileContentAsString } = require('./services/drive');
    const fileId = process.env.EFFECTS_FILE_ID;
    if (!fileId) return res.json({ status: 'error', message: 'Chưa cấu hình EFFECTS_FILE_ID (ID file JSON effects trên Drive)' });
    const content = await getFileContentAsString(fileId);
    if (!content) return res.json({ status: 'error', message: 'Không đọc được file EFFECTS_FILE_ID' });
    let json;
    try { json = JSON.parse(content); } catch (e) { return res.json({ status: 'error', message: 'File effects không phải JSON hợp lệ: '+e.message }); }
    // Lưu vào app_data
    await supabaseAdmin.from('app_data').upsert({ key: 'effects', content: json, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    res.json({ status: 'success', message: `Import effects xong: ${Object.keys(json.wipe||json.fade||json||{}).length} keys`, keys: Object.keys(json).slice(0,10) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/api/admin/import-languages', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.LANGUAGES_FOLDER_ID;
    if (!folderId) return res.json({ status: 'error', message: 'Chưa cấu hình LANGUAGES_FOLDER_ID' });
    const files = await listFilesInFolder(folderId);
    const jsonFiles = files.filter(f=>f.name.endsWith('.json'));
    let imported=0;
    for (const f of jsonFiles) {
      const content = await getFileContentAsString(f.id);
      if (!content) continue;
      try {
        const data = JSON.parse(content);
        const code = f.name.replace('.json','');
        await supabaseAdmin.from('languages').upsert({ code, data, updated_at: new Date().toISOString() }, { onConflict: 'code' });
        imported++;
      } catch {}
    }
    res.json({ status: 'success', message: `Import languages xong: ${imported}/${jsonFiles.length}`, imported, totalFiles: jsonFiles.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/api/admin/import-styles', async (req, res) => {
  try {
    const { listFilesInFolder } = require('./services/drive');
    const folderId = process.env.STYLE_FOLDER_ID;
    if (!folderId) return res.json({ status: 'error', message: 'Chưa cấu hình STYLE_FOLDER_ID' });
    const files = await listFilesInFolder(folderId);
    res.json({ status: 'success', message: `Found ${files.length} style files in Drive. Frontend hiện tại đang đọc trực tiếp từ Drive, nếu muốn migrate sang Supabase cần tạo bucket styles.`, files: files.map(f=>f.name).slice(0,20), totalFiles: files.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/api/admin/import-secure', async (req, res) => {
  try {
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.SECURE_RENDER_FOLDER_ID;
    if (!folderId) return res.json({ status: 'error', message: 'Chưa cấu hình SECURE_RENDER_FOLDER_ID' });
    const files = await listFilesInFolder(folderId);
    const target = files.find(f=>f.name==='secure-render-engine.js' || f.name==='secure-render-engine.html');
    if (!target) return res.json({ status: 'error', message: 'Không tìm thấy secure-render-engine.js trong folder', files: files.map(f=>f.name) });
    const content = await getFileContentAsString(target.id);
    // Lưu tạm vào /tmp để backend đọc (cần mount volume hoặc commit vào repo). Ở đây chỉ báo thành công, bạn cần copy file này vào repo gốc.
    const fs = require('fs'), path = require('path');
    const dest = path.join(__dirname, '../secure-render-engine.js');
    fs.writeFileSync(dest, content, 'utf-8');
    res.json({ status: 'success', message: `Đã tải secure-render-engine (${content.length} chars) và lưu vào ${dest}. Render sẽ dùng file này cho /api/secure-render`, length: content.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// Legacy exec
app.all('/exec', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const action = params.action || params.mod;
  const callback = params.callback;
  const sendJSONP = (obj) => { if (callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(obj)})`); else res.json(obj); };
  const sendText = (txt) => { if (callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(txt)})`); else res.type('text/plain').send(txt); };
  try {
    const { supabaseAdmin } = require('./services/supabase');
    switch (action) {
      case 'verify': {
        const payload = decodeOldToken(params.token||'');
        if (!payload) return sendJSONP({ success: false, message: 'Token không hợp lệ' });
        return sendJSONP({ success: true, valid: true, token: params.token, user: { email: payload.email, fullName: payload.fullName||payload.full_name, role: payload.role||'USER', isVip: payload.isVip||payload.is_vip, is_vip: payload.isVip||payload.is_vip, expiredDate: payload.expiredDate, isAdmin: payload.role==='ADMIN' } });
      }
      case 'login': {
        const email = (params.email||'').toLowerCase().trim();
        const { data: user } = await supabaseAdmin.from('users').select('*').eq('email', email).single();
        if (!user) return sendJSONP({ success: false, msg: 'Email không tồn tại' });
        const ok = await bcrypt.compare(params.password||'', user.password_hash);
        if (!ok) return sendJSONP({ success: false, msg: 'Sai mật khẩu' });
        await supabaseAdmin.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
        return sendJSONP({ success: true, token: createOldStyleToken(user), user: { id: user.id, email: user.email, fullName: user.full_name, full_name: user.full_name, role: user.is_vip?'ADMIN':'USER', isVip: !!user.is_vip, is_vip: !!user.is_vip, isAdmin: !!user.is_vip, expiredDate: new Date(Date.now()+365*24*60*60*1000).toISOString() } });
      }
      case 'registerUser':
      case 'register': {
        const email = (params.email||'').toLowerCase().trim();
        const { data: ex } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (ex) return sendJSONP({ success: false, msg: 'Email đã tồn tại' });
        const hash = await bcrypt.hash(params.password||'', 10);
        await supabaseAdmin.from('users').insert({ email, password_hash: hash, full_name: params.fullName||email, is_vip: false, created_at: new Date().toISOString() });
        return sendJSONP({ success: true, msg: 'Đăng ký thành công!' });
      }
      case 'sendOTP': {
        const email = (params.email||'').toLowerCase().trim();
        const { data: u } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (!u) return sendJSONP('❌ Email không tồn tại!');
        const otp = Math.floor(100000+Math.random()*900000).toString();
        await supabaseAdmin.from('otps').upsert({ email, otp, expires_at: new Date(Date.now()+5*60*1000).toISOString(), created_at: new Date().toISOString() }, { onConflict: 'email' });
        return sendJSONP(`Mã OTP đã được gửi tới email ${email}. OTP (debug): ${otp}`);
      }
      case 'verifyAndResetPassword': {
        const { data: row } = await supabaseAdmin.from('otps').select('*').eq('email', (params.email||'').toLowerCase()).single();
        if (!row || row.otp !== params.otp) return sendJSONP({ success: false, msg: 'OTP sai' });
        if (new Date(row.expires_at) < new Date()) return sendJSONP({ success: false, msg: 'OTP hết hạn' });
        await supabaseAdmin.from('users').update({ password_hash: await bcrypt.hash(params.newPass||'', 10) }).eq('email', (params.email||'').toLowerCase());
        await supabaseAdmin.from('otps').delete().eq('email', (params.email||'').toLowerCase());
        return sendJSONP({ success: true, msg: 'Đổi mật khẩu thành công!' });
      }
      case 'updateProfile': {
        const email = (params.email||'').toLowerCase().trim();
        const { data: user } = await supabaseAdmin.from('users').select('*').eq('email', email).single();
        if (!user) return sendJSONP({ success: false, message: 'Tài khoản không tồn tại' });
        const ok = await bcrypt.compare(params.oldPassword||'', user.password_hash);
        if (!ok) return sendJSONP({ success: false, message: 'Mật khẩu cũ không đúng' });
        let upd = {};
        if (params.fullName) upd.full_name = params.fullName;
        if (params.newPassword) upd.password_hash = await bcrypt.hash(params.newPassword, 10);
        if (Object.keys(upd).length) await supabaseAdmin.from('users').update(upd).eq('id', user.id);
        const { data: updated } = await supabaseAdmin.from('users').select('*').eq('id', user.id).single();
        return sendJSONP({ success: true, newToken: createOldStyleToken(updated), token: createOldStyleToken(updated) });
      }
      case 'saveFeedback': {
        let payload = {}; try { payload = JSON.parse(params.data||'{}'); } catch { payload = params; }
        if (supabaseAdmin) await supabaseAdmin.from('feedbacks').insert({ email: payload.email, message: payload.message||JSON.stringify(payload), created_at: new Date().toISOString(), domain: params.domain||'' });
        return sendJSONP({ status: 'success', success: true });
      }
      case 'requestVip': {
        if (supabaseAdmin) await supabaseAdmin.from('feedbacks').insert({ email: params.email, message: 'Yêu cầu VIP', created_at: new Date().toISOString(), domain: 'vip-request' });
        return sendJSONP({ success: true });
      }
      case 'getAllUsers': {
        const { data } = await supabaseAdmin.from('users').select('id,email,full_name,is_vip,created_at').order('created_at',{ascending:false}).limit(2000);
        return sendJSONP({ status: 'success', data: (data||[]).map(u=>({ email: u.email, fullName: u.full_name, full_name: u.full_name, role: u.is_vip?'ADMIN':'USER', isVip: !!u.is_vip })) });
      }
      case 'adminVipAction': {
        await supabaseAdmin.from('users').update({ is_vip: (params.action||'')==='approve' }).eq('email', (params.email||'').toLowerCase());
        return sendJSONP({ status: 'success' });
      }
      case 'getLang': {
        try {
          const { data } = await supabaseAdmin.from('languages').select('data').eq('code', params.lang||'vi').maybeSingle();
          if (data && data.data) return sendJSONP({ status: 'success', success: true, data: data.data });
        } catch {}
        return sendJSONP({ status: 'success', success: true, data: {} });
      }
      case 'getFonts': {
        try {
          const { data } = await supabaseAdmin.storage.from('fonts').list();
          if (data && data.length) {
            const fonts = data.filter(f=>/\\.(ttf|otf|woff2)$/i.test(f.name)).map(f=>({ name: f.name.replace(/\\.[^/.]+$/,''), url: `${config.SUPABASE_URL}/storage/v1/object/public/fonts/${f.name}` }));
            if (fonts.length) return sendJSONP(fonts);
          }
        } catch {}
        return sendJSONP([]);
      }
      case 'getFontBase64': {
        try {
          const { getDriveClient } = require('./services/drive');
          const { google } = require('googleapis');
          const drive = getDriveClient();
          if (drive && params.fileId) {
            const res = await drive.files.get({ fileId: params.fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
            const b64 = Buffer.from(res.data).toString('base64');
            const mime = params.fileId.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
            return sendText(`data:${mime};base64,${b64}`);
          }
        } catch {}
        return sendJSONP('');
      }
      case 'getEffects': {
        try {
          const { data } = await supabaseAdmin.from('app_data').select('content').eq('key','effects').maybeSingle();
          if (data && data.content) return sendJSONP({ status: 'success', success: true, data: data.content });
        } catch {}
        return sendJSONP({ status: 'success', success: true, data: {} });
      }
      case 'getStyleList': return sendJSONP([]);
      case 'getStyleContent': return sendJSONP({ type: 'html', content: '' });
      case 'getSecureRenderModule': {
        const fs = require('fs'), path = require('path'), { xorEncodeToBase64 } = require('./services/xor');
        let js = ''; try { const p = path.join(__dirname, '../secure-render-engine.js'); if (fs.existsSync(p)) js = fs.readFileSync(p, 'utf-8'); } catch {}
        if (!js) js = 'window.karaRenderEngineLoaded=true;';
        const b64 = xorEncodeToBase64(js, config.SECURE_XOR_SALT + '_' + (params.t||Date.now())).replace(/\r?\n/g,'').trim();
        return sendText(b64);
      }
      case 'saveUsageStats':
      case 'logUserAccess': {
        try { if (supabaseAdmin) await supabaseAdmin.from('usage_stats').insert({ data: params, created_at: new Date().toISOString(), ip: req.ip }); } catch {}
        return sendJSONP({ success: true });
      }
      default: return sendJSONP({ success: true, data: {} });
    }
  } catch (e) {
    console.error('[LEGACY]', e);
    const cb = req.query.callback || req.body?.callback;
    const obj = { success: false, message: e.message };
    if (cb) res.type('application/javascript').send(`${cb}(${JSON.stringify(obj)})`);
    else res.json(obj);
  }
});

app.get('/', (req, res) => res.json({ status: 'KaraRender API v3.7 FULL IMPORT', uptime: process.uptime() }));
app.get('/health', (req, res) => res.json({ ok: true, version: '3.7' }));

app.listen(PORT, () => console.log(`🚀 KaraRender v3.7 FULL IMPORT listening on ${PORT}`));
