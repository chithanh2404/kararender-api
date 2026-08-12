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

app.use('/api/secure-render', require('./routes/secureRender'));
app.use('/api/auth', rateLimit({ max: 20, windowMs: 3600000, keyPrefix: 'otp' }), require('./routes/auth'));
app.use('/api', require('./routes/content'));
app.use('/api/admin', require('./routes/admin'));

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
    const { error } = await supabaseAdmin.from('users').insert({ email: adminEmail, password_hash: hash, full_name: 'Lâm Chí Thành', is_vip: true, created_at: new Date().toISOString() });
    if (!error) console.log(`[SEED] Created admin ${adminEmail} / ${adminPass}`);
  } catch (e) { console.error('[SEED] error', e.message); }
}
seedAdmin();

function decodeOldToken(tokenStr) {
  try {
    if (!tokenStr) return null;
    let t = decodeURIComponent(tokenStr);
    t = t.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4 !== 0) t += '=';
    const jsonStr = Buffer.from(t, 'base64').toString('utf-8');
    const obj = JSON.parse(jsonStr);
    if (obj.payload) return obj.payload;
    if (obj.email) return obj;
    return obj;
  } catch { return null; }
}
function createOldStyleToken(payload) {
  const data = {
    payload: {
      email: payload.email,
      fullName: payload.full_name || payload.fullName || payload.email,
      full_name: payload.full_name || payload.fullName,
      role: payload.is_vip ? 'ADMIN' : (payload.role || 'USER'),
      bandName: '',
      isVip: !!payload.is_vip,
      is_vip: !!payload.is_vip,
      expiredDate: new Date(Date.now() + 365*24*60*60*1000).toISOString(),
      id: payload.id
    },
    signature: crypto.createHash('sha256').update(JSON.stringify(payload) + config.JWT_SECRET).digest('hex')
  };
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

app.all('/exec', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const action = params.action || params.mod;
  const callback = params.callback;
  console.log(`[LEGACY] action=${action} from ${params.domain || req.headers.origin}`);

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
        const token = params.token || params.t || '';
        const payload = decodeOldToken(token);
        if (!payload) return sendJSONP({ success: false, valid: false, message: 'Token không hợp lệ' });
        return sendJSONP({
          success: true, valid: true, token,
          user: {
            email: payload.email,
            fullName: payload.fullName || payload.full_name || payload.email,
            full_name: payload.fullName || payload.full_name,
            role: payload.role || (payload.isVip ? 'ADMIN' : 'USER'),
            isVip: payload.isVip || payload.is_vip || false,
            is_vip: payload.isVip || payload.is_vip || false,
            expiredDate: payload.expiredDate,
            isAdmin: (payload.role === 'ADMIN')
          }
        });
      }

      case 'login': {
        const email = (params.email || '').toLowerCase().trim();
        const password = params.password || '';
        if (!email || !password) return sendJSONP({ success: false, msg: 'Thiếu email/password' });
        if (!supabaseAdmin) return sendJSONP({ success: false, msg: 'Supabase chưa cấu hình' });
        const { data: user } = await supabaseAdmin.from('users').select('*').eq('email', email).single();
        if (!user) return sendJSONP({ success: false, msg: 'Email không tồn tại' });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return sendJSONP({ success: false, msg: 'Sai mật khẩu' });
        await supabaseAdmin.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
        const token = createOldStyleToken(user);
        return sendJSONP({
          success: true, token,
          user: {
            id: user.id, email: user.email,
            fullName: user.full_name || user.email,
            full_name: user.full_name,
            role: user.is_vip ? 'ADMIN' : 'USER',
            isVip: !!user.is_vip, is_vip: !!user.is_vip, isAdmin: !!user.is_vip,
            expiredDate: new Date(Date.now() + 365*24*60*60*1000).toISOString()
          }
        });
      }

      case 'registerUser':
      case 'register': {
        const email = (params.email || '').toLowerCase().trim();
        const password = params.password || '';
        const fullName = params.fullName || params.full_name || params.fullName || email;
        if (!email || !password) return sendJSONP({ success: false, msg: 'Thiếu email/password' });
        if (!email.includes('@')) return sendJSONP({ success: false, msg: 'Email không hợp lệ' });
        const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (existing) return sendJSONP({ success: false, msg: 'Email đã tồn tại' });
        const hash = await bcrypt.hash(password, 10);
        const { data, error } = await supabaseAdmin.from('users').insert({ email, password_hash: hash, full_name: fullName, is_vip: false, created_at: new Date().toISOString() }).select().single();
        if (error) return sendJSONP({ success: false, msg: error.message });
        try { const { sendTelegramNotification } = require('./services/telegram'); await sendTelegramNotification(`✅ <b>Đăng ký mới</b>\n📧 ${email}\n👤 ${fullName}`); } catch {}
        return sendJSONP({ success: true, status: 'success', msg: 'Đăng ký thành công!', message: 'Đăng ký thành công!' });
      }

      case 'sendOTP':
      case 'sendOtp': {
        const email = (params.email || '').toLowerCase().trim();
        if (!email) return sendJSONP('❌ Thiếu email');
        const { data: user } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (!user) return sendJSONP('❌ Email không tồn tại!');
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await supabaseAdmin.from('otps').upsert({ email, otp, expires_at: expiresAt, created_at: new Date().toISOString() }, { onConflict: 'email' });
        try { const { sendTelegramNotification } = require('./services/telegram'); await sendTelegramNotification(`🔑 <b>OTP</b> ${email}\nOTP: ${otp}`); } catch {}
        // Trả về chuỗi để frontend cũ check includes "Mã OTP"
        return sendJSONP(`Mã OTP đã được gửi tới email ${email}. OTP (debug): ${otp} - hiệu lực 5 phút`);
      }

      case 'verifyAndResetPassword':
      case 'verifyOtp': {
        const email = (params.email || '').toLowerCase().trim();
        const otp = params.otp || '';
        const newPass = params.newPass || params.newPassword || '';
        if (!email || !otp || !newPass) return sendJSONP({ success: false, msg: 'Thiếu dữ liệu' });
        const { data: row } = await supabaseAdmin.from('otps').select('*').eq('email', email).single();
        if (!row) return sendJSONP({ success: false, msg: 'OTP không tồn tại' });
        if (row.otp !== otp) return sendJSONP({ success: false, msg: 'OTP sai' });
        if (new Date(row.expires_at) < new Date()) return sendJSONP({ success: false, msg: 'OTP hết hạn' });
        const hash = await bcrypt.hash(newPass, 10);
        await supabaseAdmin.from('users').update({ password_hash: hash }).eq('email', email);
        await supabaseAdmin.from('otps').delete().eq('email', email);
        return sendJSONP({ success: true, status: 'success', msg: 'Đổi mật khẩu thành công!' });
      }

      case 'updateProfile':
      case 'updateUserProfileFields': {
        const email = (params.email || '').toLowerCase().trim();
        const fullName = params.fullName || params.full_name || '';
        const oldPassword = params.oldPassword || params.old_password || '';
        const newPassword = params.newPassword || params.new_password || '';
        if (!email || !oldPassword) return sendJSONP({ success: false, message: 'Thiếu email hoặc mật khẩu cũ' });
        const { data: user } = await supabaseAdmin.from('users').select('*').eq('email', email).single();
        if (!user) return sendJSONP({ success: false, message: 'Tài khoản không tồn tại' });
        const ok = await bcrypt.compare(oldPassword, user.password_hash);
        if (!ok) return sendJSONP({ success: false, message: 'Mật khẩu cũ không đúng' });
        let upd = {};
        if (fullName) upd.full_name = fullName;
        if (newPassword) upd.password_hash = await bcrypt.hash(newPassword, 10);
        if (Object.keys(upd).length) await supabaseAdmin.from('users').update(upd).eq('id', user.id);
        const { data: updated } = await supabaseAdmin.from('users').select('*').eq('id', user.id).single();
        const newToken = createOldStyleToken(updated);
        return sendJSONP({ success: true, status: 'success', message: 'Cập nhật thành công', newToken, token: newToken });
      }

      case 'saveFeedback': {
        let payload = {};
        try { payload = JSON.parse(params.data || '{}'); } catch { payload = params; }
        if (supabaseAdmin) await supabaseAdmin.from('feedbacks').insert({ email: payload.email || params.email, message: payload.message || params.message || JSON.stringify(payload), rating: payload.rating || null, created_at: new Date().toISOString(), domain: params.domain || req.headers.origin || '' });
        try { const { sendTelegramNotification } = require('./services/telegram'); await sendTelegramNotification(`💬 <b>Feedback</b> ${payload.email}\n${(payload.message||'').slice(0,500)}`); } catch {}
        return sendJSONP({ status: 'success', success: true, message: 'Cảm ơn bạn đã góp ý!' });
      }

      case 'requestVip':
      case 'requestUpgradeVipServer': {
        const email = (params.email || '').toLowerCase().trim();
        if (supabaseAdmin && email) {
          // Lưu yêu cầu vào feedbacks để admin thấy
          await supabaseAdmin.from('feedbacks').insert({ email, message: 'Yêu cầu nâng cấp VIP', rating: 5, created_at: new Date().toISOString(), domain: 'vip-request' });
        }
        try { const { sendTelegramNotification } = require('./services/telegram'); await sendTelegramNotification(`💎 <b>Yêu cầu VIP</b>\n📧 ${email}\n⏰ ${new Date().toLocaleString('vi-VN')}`); } catch {}
        return sendJSONP({ success: true, status: 'success', message: 'Đã gửi yêu cầu VIP' });
      }

      case 'getAllUsers':
      case 'getAllUsersJsonFromServer': {
        const reqEmail = (params.email || params.currentUserEmail || '').toLowerCase().trim();
        if (!supabaseAdmin) return sendJSONP({ status: 'error', message: 'Supabase chưa cấu hình' });
        // Check admin
        if (reqEmail) {
          const { data: reqUser } = await supabaseAdmin.from('users').select('*').eq('email', reqEmail).maybeSingle();
          if (!reqUser || !reqUser.is_vip) return sendJSONP({ status: 'error', message: 'Bạn không có quyền truy cập!' });
        }
        const { data: users } = await supabaseAdmin.from('users').select('id,email,full_name,is_vip,created_at,last_login_at').order('created_at', { ascending: false }).limit(1000);
        const mapped = (users || []).map(u => ({
          email: u.email,
          fullName: u.full_name,
          full_name: u.full_name,
          role: u.is_vip ? 'ADMIN' : 'USER',
          isVip: !!u.is_vip,
          requestVip: null,
          requestVipTime: u.created_at
        }));
        return sendJSONP({ status: 'success', success: true, data: mapped });
      }

      case 'handleAdminApprovalServer':
      case 'adminVipAction': {
        const email = (params.email || '').toLowerCase().trim();
        const actionType = params.action || params.type || '';
        if (!email) return sendJSONP({ status: 'error', message: 'Thiếu email' });
        if (!supabaseAdmin) return sendJSONP({ status: 'error', message: 'Supabase chưa cấu hình' });
        if (actionType === 'approve') {
          await supabaseAdmin.from('users').update({ is_vip: true }).eq('email', email);
          return sendJSONP({ status: 'success', success: true, message: `Đã duyệt VIP cho ${email}` });
        } else {
          await supabaseAdmin.from('users').update({ is_vip: false }).eq('email', email);
          return sendJSONP({ status: 'success', success: true, message: `Đã từ chối VIP ${email}` });
        }
      }

      case 'getLang': {
        const langCode = params.lang || params.code || 'vi';
        try {
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('languages').select('data').eq('code', langCode).maybeSingle();
            if (data && data.data) return sendJSONP({ status: 'success', success: true, data: data.data });
          }
        } catch {}
        return sendJSONP({ status: 'success', success: true, data: {}, lang: langCode, fallback: true });
      }

      case 'getFonts': {
        try {
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.storage.from('fonts').list();
            if (data && data.length) {
              const fonts = data.filter(f => /\.(ttf|otf|woff2)$/i.test(f.name)).map(f => ({ name: f.name.replace(/\.[^/.]+$/, ''), url: `${config.SUPABASE_URL}/storage/v1/object/public/fonts/${f.name}` }));
              if (fonts.length) return sendJSONP(fonts);
            }
          }
        } catch {}
        return sendJSONP([]);
      }

      case 'getFontBase64': {
        const fileId = params.fileId || params.id || '';
        if (!fileId) return sendJSONP('');
        try {
          const { getFileContentAsString } = require('./services/drive');
          const { google } = require('googleapis');
          const drive = (() => {
            try {
              let creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : null;
              if (!creds) return null;
              const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
              return google.drive({ version: 'v3', auth });
            } catch { return null; }
          })();
          if (drive) {
            const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
            const b64 = Buffer.from(res.data).toString('base64');
            const mime = fileId.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
            return sendText(`data:${mime};base64,${b64}`);
          }
        } catch (e) { console.log('getFontBase64 error', e.message); }
        return sendJSONP('');
      }

      case 'getEffects': {
        return sendJSONP({ status: 'success', success: true, data: {} });
      }
      case 'getStyleList': {
        return sendJSONP([]);
      }
      case 'getStyleContent': {
        return sendJSONP({ type: 'html', content: '<div></div>' });
      }

      case 'getSecureRenderModule':
      case 'kara-render-engine':
      case 'getRenderEngine': {
        try {
          const fs = require('fs');
          const path = require('path');
          const { xorEncodeToBase64 } = require('./services/xor');
          let jsContent = null;
          try {
            const p1 = path.join(__dirname, '../secure-render-engine.js');
            const p2 = path.join(__dirname, '../../secure-render-engine.js');
            const p3 = path.join(__dirname, '../secure-render-engine.html');
            if (fs.existsSync(p1)) jsContent = fs.readFileSync(p1, 'utf-8');
            else if (fs.existsSync(p2)) jsContent = fs.readFileSync(p2, 'utf-8');
            else if (fs.existsSync(p3)) {
              let html = fs.readFileSync(p3, 'utf-8');
              const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
              jsContent = m && m[1] ? m[1] : html;
            }
          } catch {}
          if (!jsContent || jsContent.length < 50) {
            jsContent = `console.log('[KaraRender] Secure render placeholder v3.0 - please upload secure-render-engine.js'); window.karaRenderEngineLoaded=true; window.KaraSecureRender={render:function(t){return t;}};`;
          }
          const ts = params.t || Date.now();
          const xorKey = config.SECURE_XOR_SALT + '_' + ts.toString();
          const b64 = xorEncodeToBase64(jsContent, xorKey).replace(/\r?\n/g,'').trim();
          return sendText(b64);
        } catch (e) {
          return sendText('');
        }
      }

      case 'saveUsageStats':
      case 'logUserAccess': {
        try {
          if (supabaseAdmin) {
            let d = {};
            try { d = JSON.parse(decodeURIComponent(params.data || '{}')); } catch { d = params; }
            await supabaseAdmin.from('usage_stats').insert({ data: d, created_at: new Date().toISOString(), ip: req.ip || params.ip || '' });
          }
        } catch {}
        return sendJSONP({ status: 'success', success: true });
      }

      default: {
        console.log(`[LEGACY] Unknown action ${action} -> return empty success`);
        return sendJSONP({ status: 'success', success: true, data: {}, action });
      }
    }
  } catch (e) {
    console.error('[LEGACY] error', e);
    const sendJSONP = (obj) => {
      if (params.callback) res.type('application/javascript').send(`${params.callback}(${JSON.stringify(obj)})`);
      else res.json(obj);
    };
    return sendJSONP({ status: 'error', success: false, message: e.toString() });
  }
});

app.get('/', (req, res) => res.json({ status: 'KaraRender API v3.0 FULL MIGRATED', uptime: process.uptime(), endpoints: ['/exec?action=login','/exec?action=registerUser','/exec?action=sendOTP','/exec?action=verifyAndResetPassword','/exec?action=getFonts','/exec?action=getFontBase64','/exec?action=getEffects','/exec?action=getSecureRenderModule'] }));
app.get('/health', (req, res) => res.json({ ok: true, version: '3.0' }));

app.listen(PORT, () => console.log(`🚀 KaraRender backend v3.0 FULL listening on port ${PORT}`));
