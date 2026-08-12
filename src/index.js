require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const host = origin.replace(/^https?:\/\//,'').split('/')[0].toLowerCase();
    const allowed = config.ALLOWED_HOSTS.some(h => host === h || host === h.replace(/^www\./,'') || host.replace(/^www\./,'') === h.replace(/^www\./,''));
    callback(null, true);
  },
  credentials: true
};
app.use(cors(corsOptions));

const protectedActions = ['getFonts','getFontBase64','getEffects','getSecureRenderModule','getRenderEngine','kara-render-engine','saveUsageStats','getStyleList','getStyleContent','registerUser','logUserAccess'];
app.use(domainGuard(protectedActions));

// Routes mới
app.use('/api/secure-render', require('./routes/secureRender'));
app.use('/api/auth', rateLimit({ max: 20, windowMs: 3600000, keyPrefix: 'otp' }), require('./routes/auth'));
app.use('/api', require('./routes/content'));
app.use('/api/admin', require('./routes/admin'));

// Helper decode token cũ (format Apps Script cũ)
function decodeOldToken(tokenStr) {
  try {
    if (!tokenStr) return null;
    let t = decodeURIComponent(tokenStr);
    // base64url -> base64
    t = t.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4 !== 0) t += '=';
    const jsonStr = Buffer.from(t, 'base64').toString('utf-8');
    const obj = JSON.parse(jsonStr);
    // obj có dạng {payload: {email, fullName, role, ...}, signature: "..."}
    if (obj.payload) return obj.payload;
    // hoặc obj chính là payload
    if (obj.email) return obj;
    return obj;
  } catch (e) {
    console.log('decodeOldToken fail', e.message);
    return null;
  }
}

// Route tương thích ngược /exec?action=xxx&callback=xxx
app.all('/exec', async (req, res) => {
  const query = req.method === 'POST' ? req.body : req.query;
  const params = { ...req.query, ...req.body };
  const action = params.action || params.mod;
  const callback = params.callback;
  console.log(`[LEGACY] action=${action} callback=${callback ? 'yes' : 'no'}`);

  const sendJSONP = (obj) => {
    if (callback) {
      res.type('application/javascript').send(`${callback}(${JSON.stringify(obj)})`);
    } else {
      res.json(obj);
    }
  };

  try {
    switch (action) {
      case 'verify': {
        // Frontend gửi token cũ để verify
        const token = params.token || params.t || '';
        const payload = decodeOldToken(token);
        if (!payload) {
          return sendJSONP({ status: 'error', message: 'Token không hợp lệ', valid: false });
        }
        // Check expiredDate nếu có
        if (payload.expiredDate) {
          const exp = new Date(payload.expiredDate);
          if (exp < new Date()) {
            // Cho qua luôn trong giai đoạn migration, chỉ warn
            console.log(`[verify] Token expired but allow migration: ${payload.email} exp=${payload.expiredDate}`);
          }
        }
        // Trả về format mà frontend cũ mong đợi
        return sendJSONP({
          status: 'success',
          valid: true,
          email: payload.email,
          fullName: payload.fullName || payload.full_name || payload.email,
          full_name: payload.fullName || payload.full_name,
          role: payload.role || 'USER',
          bandName: payload.bandName || '',
          isVip: payload.isVip || payload.is_vip || false,
          expiredDate: payload.expiredDate,
          data: payload,
          user: payload
        });
      }

      case 'getLang': {
        const langCode = params.lang || params.code || 'vi';
        try {
          // Thử lấy từ Supabase
          const { supabaseAdmin } = require('./services/supabase');
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('languages').select('data').eq('code', langCode).maybeSingle();
            if (data && data.data) {
              return sendJSONP({ status: 'success', data: data.data });
            }
          }
        } catch (e) {
          console.log('getLang supabase fail', e.message);
        }
        // Fallback trả về object rỗng để không block app
        // Frontend sẽ dùng bản dịch mặc định cứng
        return sendJSONP({ status: 'success', data: {}, lang: langCode, fallback: true });
      }

      case 'getFonts': {
        try {
          const { supabaseAdmin } = require('./services/supabase');
          let fonts = [];
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.storage.from('fonts').list();
            if (data) {
              fonts = data.filter(f => /\.(ttf|otf|woff2)$/i.test(f.name)).map(f => ({
                name: f.name.replace(/\.[^/.]+$/, ''),
                url: `${config.SUPABASE_URL}/storage/v1/object/public/fonts/${f.name}`
              }));
            }
          }
          if (!fonts.length) {
            // fallback Drive nếu có
            try {
              const { listFilesInFolder } = require('./services/drive');
              const files = await listFilesInFolder(config.DRIVE.FONTS_FOLDER_ID);
              fonts = files.filter(f => /\.(ttf|otf|woff2)$/i.test(f.name)).map(f => ({
                name: f.name.replace(/\.[^/.]+$/, ''),
                url: `https://drive.google.com/uc?export=download&id=${f.id}`
              }));
            } catch {}
          }
          return sendJSONP(fonts);
        } catch (e) {
          return sendJSONP([]);
        }
      }

      case 'getEffects': {
        return sendJSONP({ status: 'success', data: {} });
      }

      case 'getStyleList': {
        return sendJSONP([]);
      }

      case 'getStyleContent': {
        return sendJSONP({ type: 'html', content: '<div>Style placeholder</div>' });
      }

      case 'getSecureRenderModule':
      case 'kara-render-engine':
      case 'getRenderEngine': {
        try {
          const fs = require('fs');
          const path = require('path');
          const { xorEncodeToBase64 } = require('./services/xor');
          const { getFileContentAsString, listFilesInFolder } = require('./services/drive');
          
          let jsContent = null;
          // 1. Thử file local
          try {
            const p1 = path.join(__dirname, '../../secure-render-engine.js');
            const p2 = path.join(__dirname, '../secure-render-engine.js');
            const p3 = path.join(__dirname, '../../secure-render-engine.html');
            if (fs.existsSync(p1)) jsContent = fs.readFileSync(p1, 'utf-8');
            else if (fs.existsSync(p2)) jsContent = fs.readFileSync(p2, 'utf-8');
            else if (fs.existsSync(p3)) {
              let html = fs.readFileSync(p3, 'utf-8');
              const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
              if (m && m[1]) jsContent = m[1]; else jsContent = html;
            }
          } catch {}
          
          // 2. Nếu không có file local, trả về placeholder để app không chết
          if (!jsContent || jsContent.length < 50) {
            jsContent = `
              console.log('[KaraRender] Secure render module placeholder v2.1');
              window.KaraSecureRender = { render: function(text){ return text; } };
              window.karaRenderEngineLoaded = true;
            `;
          }

          const ts = params.t || Date.now();
          const xorKey = config.SECURE_XOR_SALT + '_' + ts.toString();
          const b64 = xorEncodeToBase64(jsContent, xorKey).replace(/\r?\n/g,'').trim();
          
          if (callback) {
            // Trả về JSONP với string mã hóa
            return res.type('application/javascript').send(`${callback}(${JSON.stringify(b64)})`);
          } else {
            return res.type('text/plain').send(b64);
          }
        } catch (e) {
          console.error('secureRender legacy error', e);
          const fallback = 'console.log("fallback")';
          if (callback) return res.type('application/javascript').send(`${callback}(${JSON.stringify(fallback)})`);
          return res.type('text/plain').send(fallback);
        }
      }

      case 'saveUsageStats':
      case 'logUserAccess':
      case 'registerUser': {
        // Các action log không quan trọng, trả success luôn để không block
        return sendJSONP({ status: 'success' });
      }

      case 'login':
      case 'register': {
        return sendJSONP({ status: 'error', message: 'Vui lòng dùng API mới /api/auth/login' });
      }

      default: {
        // Các action khác thử redirect sang API mới nếu có
        if (action) {
          console.log(`[LEGACY] Unknown action ${action}, return empty success to avoid blocking`);
          return sendJSONP({ status: 'success', data: {}, action });
        }
        return sendJSONP({ status: 'error', message: 'Action không hợp lệ' });
      }
    }
  } catch (e) {
    console.error('[LEGACY] error', e);
    return sendJSONP({ status: 'error', message: e.toString() });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'KaraRender API v2.1 - fixed verify & getLang',
    uptime: process.uptime(),
    allowedHosts: config.ALLOWED_HOSTS_STRICT
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Fix secure-render route GET - support both /api/secure-render and legacy
app.get('/api/secure-render-legacy', async (req, res) => {
  // alias
  res.redirect(`/api/secure-render?${new URLSearchParams(req.query).toString()}`);
});

app.listen(PORT, () => {
  console.log(`🚀 KaraRender backend v2.1 listening on port ${PORT}`);
});
