require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { domainGuard } = require('./middleware/domainGuard');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
const PORT = config.PORT;

app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const corsOptions = {
  origin: (origin, callback) => callback(null, true),
  credentials: true
};
app.use(cors(corsOptions));

const protectedActions = ['getFonts','getFontBase64','getEffects','getSecureRenderModule','getRenderEngine','kara-render-engine','saveUsageStats','getStyleList','getStyleContent','registerUser','logUserAccess'];
app.use(domainGuard(protectedActions));

app.use('/api/secure-render', require('./routes/secureRender'));
app.use('/api/auth', rateLimit({ max: 20, windowMs: 3600000, keyPrefix: 'otp' }), require('./routes/auth'));
app.use('/api', require('./routes/content'));
app.use('/api/admin', require('./routes/admin'));

// ========== AUTO SEED ADMIN ON STARTUP ==========
async function seedAdmin() {
  try {
    const { supabaseAdmin } = require('./services/supabase');
    if (!supabaseAdmin) {
      console.log('[SEED] Supabase not configured, skip seed');
      return;
    }
    const adminEmail = (process.env.ADMIN_EMAIL || 'chithanh2404@gmail.com').toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin123@';

    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', adminEmail).maybeSingle();
    if (existing) {
      console.log(`[SEED] Admin ${adminEmail} already exists`);
      return;
    }
    const hash = await bcrypt.hash(adminPass, 10);
    const { error } = await supabaseAdmin.from('users').insert({
      email: adminEmail,
      password_hash: hash,
      full_name: 'Lâm Chí Thành',
      is_vip: true,
      created_at: new Date().toISOString()
    });
    if (error) console.error('[SEED] Insert error', error.message);
    else console.log(`[SEED] Created admin ${adminEmail} / password: ${adminPass}`);
  } catch (e) {
    console.error('[SEED] error', e.message);
  }
}
seedAdmin();

// Helper decode old token
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
  } catch (e) {
    return null;
  }
}

function createOldStyleToken(payload) {
  // Tạo token kiểu cũ: base64({payload, signature})
  // signature đơn giản là hash ngẫu nhiên để frontend chấp nhận, không cần verify nghiêm ngặt trong giai đoạn migration
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
    signature: require('crypto').createHash('sha256').update(JSON.stringify(payload) + config.JWT_SECRET).digest('hex')
  };
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

// Legacy /exec
app.all('/exec', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const action = params.action || params.mod;
  const callback = params.callback;
  console.log(`[LEGACY] action=${action}`);

  const sendJSONP = (obj) => {
    if (callback) res.type('application/javascript').send(`${callback}(${JSON.stringify(obj)})`);
    else res.json(obj);
  };

  try {
    const { supabaseAdmin } = require('./services/supabase');

    switch (action) {
      case 'verify': {
        const token = params.token || params.t || '';
        const payload = decodeOldToken(token);
        if (!payload) return sendJSONP({ success: false, valid: false, message: 'Token không hợp lệ' });
        return sendJSONP({
          success: true,
          valid: true,
          token: token,
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

        const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('email', email).single();
        if (error || !user) {
          console.log(`[login] user not found ${email}`);
          return sendJSONP({ success: false, msg: 'Email không tồn tại' });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
          console.log(`[login] wrong password ${email}`);
          return sendJSONP({ success: false, msg: 'Sai mật khẩu' });
        }

        await supabaseAdmin.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);

        const token = createOldStyleToken(user);
        return sendJSONP({
          success: true,
          token: token,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.full_name || user.email,
            full_name: user.full_name,
            role: user.is_vip ? 'ADMIN' : 'USER',
            isVip: !!user.is_vip,
            is_vip: !!user.is_vip,
            isAdmin: !!user.is_vip,
            expiredDate: new Date(Date.now() + 365*24*60*60*1000).toISOString()
          }
        });
      }

      case 'registerUser':
      case 'register': {
        const email = (params.email || '').toLowerCase().trim();
        const password = params.password || '';
        const fullName = params.fullName || params.full_name || email;
        if (!email || !password) return sendJSONP({ success: false, msg: 'Thiếu email/password' });

        const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
        if (existing) return sendJSONP({ success: false, msg: 'Email đã tồn tại' });

        const hash = await bcrypt.hash(password, 10);
        const { data, error } = await supabaseAdmin.from('users').insert({
          email, password_hash: hash, full_name: fullName, is_vip: false, created_at: new Date().toISOString()
        }).select().single();
        if (error) return sendJSONP({ success: false, msg: error.message });
        return sendJSONP({ success: true, msg: 'Đăng ký thành công!', user: { id: data.id, email: data.email } });
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
        return sendJSONP([]);
      }
      case 'getEffects': {
        return sendJSONP({ status: 'success', data: {} });
      }
      case 'getStyleList': {
        return sendJSONP([]);
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

        let updateData = {};
        if (fullName) updateData.full_name = fullName;
        if (newPassword) {
          updateData.password_hash = await bcrypt.hash(newPassword, 10);
        }

        if (Object.keys(updateData).length > 0) {
          const { error } = await supabaseAdmin.from('users').update(updateData).eq('id', user.id);
          if (error) return sendJSONP({ success: false, message: error.message });
        }

        const { data: updatedUser } = await supabaseAdmin.from('users').select('*').eq('id', user.id).single();
        const newToken = createOldStyleToken(updatedUser);
        return sendJSONP({ success: true, status: 'success', message: 'Cập nhật thành công', newToken: newToken, token: newToken });
      }

      case 'requestVip':
      case 'requestUpgradeVipServer': {
        const email = (params.email || '').toLowerCase().trim();
        if (email) {
          try {
            const { sendTelegramNotification } = require('./services/telegram');
            await sendTelegramNotification(`💎 <b>Yêu cầu VIP</b>\n📧 ${email}\n⏰ ${new Date().toLocaleString('vi-VN')}`);
          } catch {}
        }
        return sendJSONP({ success: true, status: 'success', message: 'Đã gửi yêu cầu VIP' });
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
            if (fs.existsSync(p1)) jsContent = fs.readFileSync(p1, 'utf-8');
            else if (fs.existsSync(p2)) jsContent = fs.readFileSync(p2, 'utf-8');
          } catch {}
          if (!jsContent || jsContent.length < 50) {
            jsContent = `console.log('[KaraRender] Secure render placeholder v2.2'); window.karaRenderEngineLoaded=true;`;
          }
          const ts = params.t || Date.now();
          const xorKey = config.SECURE_XOR_SALT + '_' + ts.toString();
          const b64 = xorEncodeToBase64(jsContent, xorKey).replace(/\r?\n/g,'').trim();
          if (callback) return res.type('application/javascript').send(`${callback}(${JSON.stringify(b64)})`);
          return res.type('text/plain').send(b64);
        } catch (e) {
          if (callback) return res.type('application/javascript').send(`${callback}(${JSON.stringify('')})`);
          return res.type('text/plain').send('');
        }
      }
      case 'saveUsageStats':
      case 'logUserAccess': {
        return sendJSONP({ status: 'success', success: true });
      }
      default: {
        console.log(`[LEGACY] Unknown action ${action}`);
        return sendJSONP({ status: 'success', success: true, data: {}, action });
      }
    }
  } catch (e) {
    console.error('[LEGACY] error', e);
    return sendJSONP({ status: 'error', success: false, message: e.toString() });
  }
});

app.get('/', (req, res) => res.json({ status: 'KaraRender API v2.2 - login fixed', uptime: process.uptime() }));
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`🚀 KaraRender backend v2.2 listening on port ${PORT}`));
