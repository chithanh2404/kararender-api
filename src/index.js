require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('./config');
const { domainGuard } = require('./middleware/domainGuard');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
const PORT = config.PORT;
app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));

const protectedActions = ['getFonts','getFontBase64','getEffects','getSecureRenderModule','getRenderEngine','kara-render-engine','saveUsageStats','getStyleList','getStyleContent','registerUser','logUserAccess'];
app.use(domainGuard(protectedActions));

// Existing API routes
app.use('/api/secure-render', require('./routes/secureRender'));
app.use('/api/auth', rateLimit({ max: 20, windowMs: 3600000, keyPrefix: 'otp' }), require('./routes/auth'));
app.use('/api', require('./routes/content'));

// Seed admin
async function seedAdmin() {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) return;
    const adminEmail = (process.env.ADMIN_EMAIL || 'chithanh2404@gmail.com').toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin123@';
    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', adminEmail).maybeSingle();
    if (existing) { console.log(`[SEED] Admin ${adminEmail} exists`); return; }
    const hash = await bcrypt.hash(adminPass, 10);
    await supabaseAdmin.from('users').insert({ email: adminEmail, password_hash: hash, full_name: 'Lâm Chí Thành', is_vip: true, created_at: new Date().toISOString() });
    console.log(`[SEED] Created admin ${adminEmail}`);
  } catch (e) { console.error('[SEED]', e.message); }
}
seedAdmin();

function decodeOldToken(t) {
  try {
    if (!t) return null;
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

// ========== ADMIN DASHBOARD HTML ==========
const adminHTML = `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KaraRender Admin</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
</head>
<body class="bg-[#0b1020] text-slate-200 min-h-screen">
<div class="max-w-7xl mx-auto p-4 md:p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-black flex items-center gap-2"><span class="material-symbols-outlined text-amber-400">admin_panel_settings</span> KaraRender Admin v3.5</h1>
    <div class="flex gap-2">
      <input id="adminEmail" placeholder="admin email để xác thực" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm w-64" value="chithanh2404@gmail.com"/>
      <button onclick="loadAll()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-bold">Tải dữ liệu</button>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
    <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-4"><div class="text-xs text-slate-400 uppercase">Tổng Users</div><div id="statUsers" class="text-2xl font-black mt-1">-</div></div>
    <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-4"><div class="text-xs text-slate-400 uppercase">VIP / Admin</div><div id="statVip" class="text-2xl font-black mt-1">-</div></div>
    <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-4"><div class="text-xs text-slate-400 uppercase">Feedbacks</div><div id="statFeedback" class="text-2xl font-black mt-1">-</div></div>
    <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-4"><div class="text-xs text-slate-400 uppercase">Usage Logs</div><div id="statUsage" class="text-2xl font-black mt-1">-</div></div>
  </div>

  <div class="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
    <h3 class="font-bold text-amber-400 mb-2 flex items-center gap-2"><span class="material-symbols-outlined">drive_folder_upload</span> Import Users từ Google Drive</h3>
    <p class="text-xs text-slate-400 mb-3">Cần cấu hình <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> và <code>USERS_FOLDER_ID</code> trong Render Environment. Tool sẽ đọc tất cả file JSON trong folder Users cũ và import vào Supabase, tự hash lại mật khẩu nếu cần.</p>
    <div class="flex gap-2">
      <button onclick="importDrive()" id="btnImport" class="bg-amber-600 hover:bg-amber-700 px-4 py-2 rounded-lg text-sm font-bold">🚀 Import từ Drive ngay</button>
      <span id="importStatus" class="text-xs py-2"></span>
    </div>
    <div id="importLog" class="mt-3 text-xs font-mono bg-black/30 rounded p-2 max-h-60 overflow-auto hidden"></div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div class="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-700 flex justify-between items-center"><h2 class="font-bold">👥 Users (1000 mới nhất)</h2><input id="searchUser" placeholder="Tìm email..." class="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs w-40" oninput="filterUsers()"/></div>
      <div class="overflow-auto max-h-[600px]"><table class="w-full text-xs"><thead class="sticky top-0 bg-slate-900 text-slate-400"><tr><th class="p-2 text-left">Email</th><th class="p-2">Tên</th><th class="p-2">VIP</th><th class="p-2">Ngày tạo</th><th class="p-2">Action</th></tr></thead><tbody id="usersBody"></tbody></table></div>
    </div>
    <div class="space-y-6">
      <div class="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-700 font-bold">💬 Feedbacks mới</div>
        <div id="feedbackList" class="p-3 space-y-2 max-h-[300px] overflow-auto text-xs"></div>
      </div>
      <div class="bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-700 font-bold">📊 Usage Logs mới</div>
        <div id="usageList" class="p-3 space-y-1 max-h-[300px] overflow-auto text-[11px] font-mono"></div>
      </div>
    </div>
  </div>
</div>
<script>
let allUsers = [];
async function api(path, method='GET', body=null){
  const adminEmail = document.getElementById('adminEmail').value.trim();
  const opts = { method, headers: { 'Content-Type': 'application/json', 'x-admin-email': adminEmail } };
  if (body) opts.body = JSON.stringify({ ...body, adminEmail });
  const url = path + (path.includes('?') ? '&' : '?') + 'adminEmail=' + encodeURIComponent(adminEmail);
  const res = await fetch(url, opts);
  return res.json();
}
async function loadAll(){
  try {
    const users = await api('/api/admin/users');
    const feedbacks = await api('/api/admin/feedbacks');
    const usage = await api('/api/admin/usage');
    if (Array.isArray(users)) {
      allUsers = users;
      document.getElementById('statUsers').textContent = users.length;
      document.getElementById('statVip').textContent = users.filter(u=>u.is_vip).length;
      renderUsers(users);
    }
    if (Array.isArray(feedbacks)) {
      document.getElementById('statFeedback').textContent = feedbacks.length;
      document.getElementById('feedbackList').innerHTML = feedbacks.slice(0,50).map(f => \`<div class="bg-slate-900 p-2 rounded"><div class="text-slate-400">\${f.email||'Ẩn danh'} - \${new Date(f.created_at).toLocaleString('vi-VN')}</div><div class="mt-1">\${(f.message||'').slice(0,300)}</div></div>\`).join('') || '<div class="text-slate-500">Chưa có feedback</div>';
    }
    if (Array.isArray(usage)) {
      document.getElementById('statUsage').textContent = usage.length;
      document.getElementById('usageList').innerHTML = usage.slice(0,100).map(u => \`<div>\${new Date(u.created_at).toLocaleTimeString()} - \${u.ip||''} - \${JSON.stringify(u.data||{}).slice(0,120)}</div>\`).join('');
    }
  } catch(e){ alert('Lỗi: ' + e.message); }
}
function renderUsers(users){
  const body = document.getElementById('usersBody');
  body.innerHTML = users.map(u => \`
    <tr class="border-b border-slate-800 hover:bg-slate-800/50">
      <td class="p-2 truncate max-w-[180px]">\${u.email}</td>
      <td class="p-2">\${u.full_name||''}</td>
      <td class="p-2 text-center">\${u.is_vip ? '👑' : ''}</td>
      <td class="p-2">\${new Date(u.created_at).toLocaleDateString()}</td>
      <td class="p-2"><button onclick="toggleVip('\${u.email}', \${!u.is_vip})" class="px-2 py-1 rounded \${u.is_vip ? 'bg-slate-700' : 'bg-amber-600'} text-[10px]">\${u.is_vip ? 'Hủy VIP' : 'Duyệt VIP'}</button></td>
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
  log.classList.remove('hidden'); log.textContent = '';
  try {
    const res = await api('/api/admin/import-drive-users', 'POST', {});
    status.textContent = res.message || 'Xong';
    log.textContent = JSON.stringify(res, null, 2);
    if (res.imported) loadAll();
  } catch(e){ status.textContent = 'Lỗi: ' + e.message; }
  btn.disabled = false; btn.textContent = '🚀 Import từ Drive ngay';
}
loadAll();
</script>
</body>
</html>
`;

app.get('/admin', (req, res) => res.type('html').send(adminHTML));

// Admin API
app.get('/api/admin/users', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('users').select('id,email,full_name,is_vip,created_at,last_login_at').order('created_at', { ascending: false }).limit(2000);
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/feedbacks', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('feedbacks').select('*').order('created_at', { ascending: false }).limit(200);
    res.json(data || []);
  } catch (e) { res.json([]); }
});
app.get('/api/admin/usage', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { data } = await supabaseAdmin.from('usage_stats').select('*').order('created_at', { ascending: false }).limit(200);
    res.json(data || []);
  } catch (e) { res.json([]); }
});
app.post('/api/admin/approve-vip', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { email, action } = req.body;
    const isVip = action === 'approve';
    await supabaseAdmin.from('users').update({ is_vip: isVip }).eq('email', (email||'').toLowerCase());
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// Import from Drive
app.post('/api/admin/import-drive-users', async (req, res) => {
  const adminEmail = (req.body.adminEmail || req.query.adminEmail || '').toLowerCase();
  const allowedAdmins = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'chithanh2404@gmail.com').toLowerCase().split(',').map(s=>s.trim());
  if (allowedAdmins.length && !allowedAdmins.includes(adminEmail)) {
    return res.status(403).json({ status: 'error', message: 'Không có quyền admin: ' + adminEmail });
  }

  try {
    const { supabaseAdmin } = require('./services/supabase');
    const { listFilesInFolder, getFileContentAsString } = require('./services/drive');
    const folderId = process.env.USERS_FOLDER_ID;
    if (!folderId) return res.json({ status: 'error', message: 'Chưa cấu hình USERS_FOLDER_ID trong Environment. Hãy thêm ID folder Users trên Drive vào Render.' });

    const files = await listFilesInFolder(folderId);
    if (!files.length) return res.json({ status: 'error', message: 'Không tìm thấy file nào trong folder Users. Kiểm tra GOOGLE_SERVICE_ACCOUNT_JSON và USERS_FOLDER_ID.', files: [] });

    let imported = 0, skipped = 0, errors = [];
    for (const f of files) {
      try {
        const content = await getFileContentAsString(f.id);
        if (!content) { skipped++; continue; }
        let obj;
        try { obj = JSON.parse(content); } catch { continue; }
        const email = (obj.email || obj.Email || f.name.replace('.json','')).toLowerCase().trim();
        if (!email || !email.includes('@')) { skipped++; continue; }

        const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (existing) { skipped++; continue; }

        let passwordHash = obj.password_hash || obj.passwordHash || obj.hash || '';
        const plainPassword = obj.password || obj.pass || obj.password_plain || '';

        if (!passwordHash && plainPassword) {
          passwordHash = await bcrypt.hash(plainPassword, 10);
        } else if (passwordHash && passwordHash.length < 50) {
          // Nếu hash cũ không phải bcrypt, hash lại
          try {
            // Thử coi như plain
            passwordHash = await bcrypt.hash(passwordHash, 10);
          } catch {}
        } else if (!passwordHash) {
          // Tạo mật khẩu ngẫu nhiên, user sẽ dùng OTP để đổi
          passwordHash = await bcrypt.hash('Temp1234@' + Math.random().toString(36).slice(2), 10);
        }

        const fullName = obj.fullName || obj.full_name || obj.name || email;
        const isVip = !!(obj.isVip || obj.is_vip || obj.role === 'VIP' || obj.role === 'ADMIN');

        await supabaseAdmin.from('users').insert({
          email,
          password_hash: passwordHash,
          full_name: fullName,
          is_vip: isVip,
          created_at: obj.created_at || obj.createdAt || new Date().toISOString()
        });
        imported++;
      } catch (e) {
        errors.push({ file: f.name, error: e.message });
      }
    }

    res.json({ status: 'success', message: `Import xong: ${imported} imported, ${skipped} skipped (đã tồn tại)`, imported, skipped, totalFiles: files.length, errors: errors.slice(0,20) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message, stack: e.stack });
  }
});

// Legacy /exec full (v3.0)
app.all('/exec', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const action = params.action || params.mod;
  const callback = params.callback;
  console.log(`[LEGACY] action=${action}`);

  const sendJSONP = (obj) => {
    if (callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(obj)})`);
    else res.json(obj);
  };
  const sendText = (txt) => {
    if (callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(txt)})`);
    else res.type('text/plain').send(txt);
  };

  try {
    const { supabaseAdmin } = require('./services/supabase');

    switch (action) {
      case 'verify': {
        const payload = decodeOldToken(params.token || params.t || '');
        if (!payload) return sendJSONP({ success: false, message: 'Token không hợp lệ' });
        return sendJSONP({ success: true, valid: true, token: params.token, user: { email: payload.email, fullName: payload.fullName || payload.full_name, role: payload.role || 'USER', isVip: payload.isVip || payload.is_vip, is_vip: payload.isVip || payload.is_vip, expiredDate: payload.expiredDate, isAdmin: payload.role === 'ADMIN' } });
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
        try { const { sendTelegramNotification } = require('./services/telegram'); await sendTelegramNotification(`🔑 OTP ${email}: ${otp}`); } catch {}
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
        let payload = {};
        try { payload = JSON.parse(params.data||'{}'); } catch { payload = params; }
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
        const isVip = (params.action||'') === 'approve';
        await supabaseAdmin.from('users').update({ is_vip: isVip }).eq('email', (params.email||'').toLowerCase());
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
        let js = '';
        try {
          const p = path.join(__dirname, '../secure-render-engine.js');
          if (fs.existsSync(p)) js = fs.readFileSync(p, 'utf-8');
        } catch {}
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
    const cb = (req.query.callback || req.body?.callback);
    const obj = { success: false, message: e.message };
    if (cb) res.type('application/javascript').send(`${cb}(${JSON.stringify(obj)})`);
    else res.json(obj);
  }
});

app.get('/', (req, res) => res.json({ status: 'KaraRender API v3.5 ADMIN+IMPORT', uptime: process.uptime() }));
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`🚀 KaraRender v3.5 ADMIN listening on ${PORT}`));
