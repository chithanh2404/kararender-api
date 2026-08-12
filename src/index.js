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

// Seed admin
async function seedAdmin() {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) { console.log('[SEED] no supabase'); return; }
    const adminEmail = (process.env.ADMIN_EMAIL || 'chithanh2404@gmail.com').toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin123@';
    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', adminEmail).maybeSingle();
    if (existing) { console.log(`[SEED] Admin exists ${adminEmail}`); return; }
    const hash = await bcrypt.hash(adminPass, 10);
    const { error } = await supabaseAdmin.from('users').insert({ email: adminEmail, password_hash: hash, full_name: 'Lâm Chí Thành', is_vip: true, created_at: new Date().toISOString() });
    if (error) console.error('[SEED] error', error.message); else console.log(`[SEED] Created ${adminEmail}`);
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
<title>KaraRender Admin v3.6</title>
<style>
*{box-sizing:border-box} body{font-family:Inter,system-ui,sans-serif;background:#0b1020;color:#e2e8f0;margin:0}
.card{background:rgba(30,41,59,0.5);border:1px solid #334155;border-radius:12px;padding:16px}
.btn{background:#2563eb;color:white;border:0;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px}
.btn:hover{background:#1d4ed8} .btn-amber{background:#d97706} .btn-amber:hover{background:#b45309}
table{width:100%;border-collapse:collapse} th{color:#94a3b8;font-size:11px;text-transform:uppercase;padding:8px;text-align:left;background:#0f172a;position:sticky;top:0} td{padding:8px;border-bottom:1px solid #1e293b;font-size:12px}
input{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 12px;color:white;font-size:13px}
.badge{font-size:10px;padding:2px 6px;border-radius:4px;font-weight:900}
</style>
</head>
<body>
<div style="max-width:1200px;margin:0 auto;padding:20px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
    <h1 style="font-size:24px;font-weight:900">👑 KaraRender Admin v3.6 <span style="font-size:12px;color:#94a3b8">FIXED</span></h1>
    <div style="display:flex;gap:8px">
      <input id="adminEmail" placeholder="admin email" style="width:240px" value="chithanh2404@gmail.com"/>
      <button class="btn" onclick="loadAll()">Tải dữ liệu</button>
      <button class="btn" style="background:#334155" onclick="checkDebug()">Debug</button>
    </div>
  </div>

  <div id="debugBox" style="display:none" class="card" style="margin-bottom:16px;background:#1e1b4b"></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px">
    <div class="card"><div style="font-size:11px;color:#94a3b8">Tổng Users</div><div id="statUsers" style="font-size:28px;font-weight:900">-</div><div id="statUsersSub" style="font-size:11px;color:#64748b"></div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">VIP / Admin</div><div id="statVip" style="font-size:28px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Feedbacks</div><div id="statFeedback" style="font-size:28px;font-weight:900">-</div></div>
    <div class="card"><div style="font-size:11px;color:#94a3b8">Usage Logs</div><div id="statUsage" style="font-size:28px;font-weight:900">-</div></div>
  </div>

  <div class="card" style="margin-bottom:20px;border-color:#f59e0b;background:rgba(245,158,11,0.1)">
    <h3 style="color:#fbbf24;font-weight:800;margin-bottom:8px">📁 Import Users từ Google Drive cũ</h3>
    <p style="font-size:12px;color:#94a3b8;margin-bottom:12px">Cần 2 biến trong Render: <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> và <code>USERS_FOLDER_ID</code>. Tool sẽ đọc tất cả file JSON trong folder và import vào Supabase.</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-amber" onclick="importDrive()" id="btnImport">🚀 Import từ Drive ngay</button>
      <span id="importStatus" style="font-size:12px"></span>
    </div>
    <pre id="importLog" style="margin-top:12px;background:#020617;padding:12px;border-radius:8px;max-height:300px;overflow:auto;display:none;font-size:11px;white-space:pre-wrap"></pre>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid #334155;display:flex;justify-content:space-between"><b>👥 Users (2000 mới nhất)</b><input id="searchUser" placeholder="Tìm email..." style="width:140px;padding:4px 8px;font-size:11px" oninput="filterUsers()"/></div>
      <div style="overflow:auto;max-height:600px"><table><thead><tr><th>Email</th><th>Tên</th><th>VIP</th><th>Ngày tạo</th><th>Action</th></tr></thead><tbody id="usersBody"><tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b">Chưa tải</td></tr></tbody></table></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:20px">
      <div class="card" style="padding:0;overflow:hidden"><div style="padding:12px 16px;border-bottom:1px solid #334155"><b>💬 Feedbacks mới</b></div><div id="feedbackList" style="padding:12px;max-height:280px;overflow:auto;font-size:12px">Chưa tải</div></div>
      <div class="card" style="padding:0;overflow:hidden"><div style="padding:12px 16px;border-bottom:1px solid #334155"><b>📊 Usage Logs mới</b></div><div id="usageList" style="padding:12px;max-height:280px;overflow:auto;font-family:monospace;font-size:11px">Chưa tải</div></div>
    </div>
  </div>
</div>
<script>
let allUsers = [];
async function api(path, method='GET', body=null){
  const adminEmail = document.getElementById('adminEmail').value.trim();
  const opts = { method, headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail } };
  if (body) opts.body = JSON.stringify({ ...body, adminEmail });
  const url = path + (path.includes('?')?'&':'?') + 'adminEmail=' + encodeURIComponent(adminEmail);
  console.log('Fetch', url);
  const res = await fetch(url, opts);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt, status: res.status }; }
}
async function checkDebug(){
  const box = document.getElementById('debugBox');
  box.style.display='block';
  box.innerHTML='Đang kiểm tra...';
  try {
    const data = await api('/api/admin/debug');
    box.innerHTML = '<b>Debug Info:</b><pre style="white-space:pre-wrap;font-size:11px;margin-top:8px">' + JSON.stringify(data, null, 2) + '</pre>';
  } catch(e){ box.innerHTML = 'Lỗi: ' + e.message; }
}
async function loadAll(){
  try {
    document.getElementById('usersBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px">Đang tải...</td></tr>';
    const users = await api('/api/admin/users');
    console.log('users', users);
    if (users.error) { document.getElementById('usersBody').innerHTML = '<tr><td colspan="5" style="color:#ef4444">Lỗi: ' + users.error + '</td></tr>'; return; }
    if (users.raw) { document.getElementById('usersBody').innerHTML = '<tr><td colspan="5" style="color:#ef4444">Lỗi raw: ' + users.raw.slice(0,500) + '</td></tr>'; return; }
    if (Array.isArray(users)) {
      allUsers = users;
      document.getElementById('statUsers').textContent = users.length;
      document.getElementById('statUsersSub').textContent = users.length ? 'Mới nhất: ' + (users[0]?.email||'') : '';
      document.getElementById('statVip').textContent = users.filter(u=>u.is_vip).length;
      renderUsers(users);
    } else {
      document.getElementById('usersBody').innerHTML = '<tr><td colspan="5">Không phải array: ' + JSON.stringify(users).slice(0,500) + '</td></tr>';
    }

    const feedbacks = await api('/api/admin/feedbacks');
    if (Array.isArray(feedbacks)) {
      document.getElementById('statFeedback').textContent = feedbacks.length;
      document.getElementById('feedbackList').innerHTML = feedbacks.slice(0,50).map(f => \`<div style="background:#0f172a;padding:8px;border-radius:6px;margin-bottom:6px"><div style="color:#94a3b8">\${f.email||'Ẩn danh'} - \${new Date(f.created_at).toLocaleString('vi-VN')}</div><div style="margin-top:4px">\${(f.message||'').slice(0,300)}</div></div>\`).join('') || 'Chưa có';
    }

    const usage = await api('/api/admin/usage');
    if (Array.isArray(usage)) {
      document.getElementById('statUsage').textContent = usage.length;
      document.getElementById('usageList').innerHTML = usage.slice(0,100).map(u => \`<div>\${new Date(u.created_at).toLocaleTimeString()} - \${u.ip||''} - \${JSON.stringify(u.data||{}).slice(0,120)}</div>\`).join('') || 'Chưa có';
    }
  } catch(e){ alert('Lỗi loadAll: ' + e.message); console.error(e); }
}
function renderUsers(users){
  const body = document.getElementById('usersBody');
  if (!users.length) { body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px">Trống - chưa có user nào hoặc chưa import</td></tr>'; return; }
  body.innerHTML = users.map(u => \`
    <tr>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">\${u.email}</td>
      <td>\${u.full_name||''}</td>
      <td style="text-align:center">\${u.is_vip ? '👑' : ''}</td>
      <td>\${u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}</td>
      <td><button onclick="toggleVip('\${u.email}', \${!u.is_vip})" style="padding:4px 8px;border-radius:4px;border:0;cursor:pointer;font-size:10px;background:\${u.is_vip ? '#334155' : '#d97706'};color:white">\${u.is_vip ? 'Hủy VIP' : 'Duyệt VIP'}</button></td>
    </tr>\`).join('');
}
function filterUsers(){
  const q = document.getElementById('searchUser').value.toLowerCase();
  renderUsers(allUsers.filter(u => u.email.toLowerCase().includes(q) || (u.full_name||'').toLowerCase().includes(q)));
}
async function toggleVip(email, isVip){
  if (!confirm((isVip?'Duyệt':'Hủy') + ' VIP cho ' + email + '?')) return;
  const res = await api('/api/admin/approve-vip', 'POST', { email, action: isVip?'approve':'reject' });
  if (res.status === 'success') loadAll(); else alert(res.message||'Lỗi');
}
async function importDrive(){
  const btn = document.getElementById('btnImport');
  const status = document.getElementById('importStatus');
  const log = document.getElementById('importLog');
  btn.disabled = true; btn.textContent = 'Đang import...';
  status.textContent = 'Đang đọc Drive...';
  log.style.display='block'; log.textContent = 'Đang xử lý...';
  try {
    const res = await api('/api/admin/import-drive-users', 'POST', {});
    status.textContent = res.message || 'Xong';
    log.textContent = JSON.stringify(res, null, 2);
    if (res.imported) loadAll();
  } catch(e){ status.textContent = 'Lỗi: ' + e.message; log.textContent = e.stack||e.message; }
  btn.disabled = false; btn.textContent = '🚀 Import từ Drive ngay';
}
loadAll();
</script>
</body>
</html>
`;

app.get('/admin', (req, res) => res.type('html').send(adminHTML));

app.get('/api/admin/debug', async (req, res) => {
  const { supabaseAdmin } = (() => { try { return require('./services/supabase'); } catch { return { supabaseAdmin: null }; } })();
  let supaOk = false, usersCount = 0, driveOk = false, driveFiles = 0;
  try {
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.from('users').select('id', { count: 'exact', head: true });
      if (!error) { supaOk = true; usersCount = data?.length || 0; }
      const { count } = await supabaseAdmin.from('users').select('*', { count: 'exact', head: true });
      usersCount = count || 0;
    }
  } catch (e) { }
  try {
    const { getDriveClient, listFilesInFolder } = require('./services/drive');
    const drive = getDriveClient();
    if (drive) {
      driveOk = true;
      if (process.env.USERS_FOLDER_ID) {
        const files = await listFilesInFolder(process.env.USERS_FOLDER_ID);
        driveFiles = files.length;
      }
    }
  } catch (e) { }

  res.json({
    version: 'v3.6 fixed',
    env: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      USERS_FOLDER_ID: process.env.USERS_FOLDER_ID || 'NOT SET',
      GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'NOT SET',
      ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'NOT SET',
      DRIVE: {
        USERS_FOLDER_ID: !!process.env.USERS_FOLDER_ID,
        FONTS_FOLDER_ID: !!process.env.FONTS_FOLDER_ID,
        SECURE_RENDER_FOLDER_ID: !!process.env.SECURE_RENDER_FOLDER_ID
      }
    },
    supabase: { ok: supaOk, usersCount },
    drive: { ok: driveOk, filesInUsersFolder: driveFiles }
  });
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase not configured - missing SUPABASE_URL or SERVICE_ROLE_KEY' });
    const { data, error } = await supabaseAdmin.from('users').select('id,email,full_name,is_vip,created_at,last_login_at').order('created_at', { ascending: false }).limit(2000);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message, stack: e.stack }); }
});
app.get('/api/admin/feedbacks', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) return res.json([]);
    const { data } = await supabaseAdmin.from('feedbacks').select('*').order('created_at', { ascending: false }).limit(200);
    res.json(data || []);
  } catch (e) { res.json([]); }
});
app.get('/api/admin/usage', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) return res.json([]);
    const { data } = await supabaseAdmin.from('usage_stats').select('*').order('created_at', { ascending: false }).limit(200);
    res.json(data || []);
  } catch (e) { res.json([]); }
});
app.post('/api/admin/approve-vip', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { email, action } = req.body;
    await supabaseAdmin.from('users').update({ is_vip: action === 'approve' }).eq('email', (email||'').toLowerCase());
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/api/admin/import-drive-users', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.USERS_FOLDER_ID;
    if (!folderId) return res.json({ status: 'error', message: 'Chưa cấu hình USERS_FOLDER_ID trong Environment' });
    const files = await listFilesInFolder(folderId);
    if (!files.length) return res.json({ status: 'error', message: 'Không tìm thấy file nào trong folder Users. Kiểm tra GOOGLE_SERVICE_ACCOUNT_JSON và quyền share folder.', totalFiles: 0 });
    let imported = 0, skipped = 0, errors = [];
    for (const f of files) {
      try {
        const content = await getFileContentAsString(f.id);
        if (!content) { skipped++; continue; }
        let obj; try { obj = JSON.parse(content); } catch { skipped++; continue; }
        const email = (obj.email || obj.Email || f.name.replace('.json','')).toLowerCase().trim();
        if (!email || !email.includes('@')) { skipped++; continue; }
        const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (existing) { skipped++; continue; }
        let hash = obj.password_hash || obj.passwordHash || '';
        const plain = obj.password || obj.pass || '';
        if (!hash && plain) hash = await bcrypt.hash(plain, 10);
        else if (!hash) hash = await bcrypt.hash('Temp' + Math.random().toString(36).slice(2), 10);
        else if (hash.length < 50) hash = await bcrypt.hash(hash, 10);
        const fullName = obj.fullName || obj.full_name || obj.name || email;
        const isVip = !!(obj.isVip || obj.is_vip || obj.role === 'VIP' || obj.role === 'ADMIN');
        await supabaseAdmin.from('users').insert({ email, password_hash: hash, full_name: fullName, is_vip: isVip, created_at: obj.created_at || new Date().toISOString() });
        imported++;
      } catch (e) { errors.push({ file: f.name, error: e.message }); }
    }
    res.json({ status: 'success', message: `Import xong: ${imported} imported, ${skipped} skipped`, imported, skipped, totalFiles: files.length, errors: errors.slice(0,20) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// Legacy exec (keep compatibility)
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
      case 'getLang': return sendJSONP({ status: 'success', success: true, data: {} });
      case 'getFonts': return sendJSONP([]);
      case 'getFontBase64': return sendJSONP('');
      case 'getEffects': return sendJSONP({ status: 'success', data: {} });
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

app.get('/', (req, res) => res.json({ status: 'KaraRender API v3.6 ADMIN FIXED', uptime: process.uptime() }));
app.get('/health', (req, res) => res.json({ ok: true, version: '3.6' }));

app.listen(PORT, () => console.log(`🚀 KaraRender v3.6 ADMIN FIXED listening on ${PORT}`));
