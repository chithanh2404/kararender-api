require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { domainGuard } = require('./middleware/domainGuard');
const { rateLimit } = require('./middleware/rateLimit');

const app = express();
const PORT = config.PORT;

// Trust proxy cho Cloud Run
app.set('trust proxy', true);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS động theo whitelist
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // cho phép server-to-server
    const host = origin.replace(/^https?:\/\//,'').split('/')[0].toLowerCase();
    const allowed = config.ALLOWED_HOSTS.some(h => host === h || host === h.replace(/^www\./,'') || host.replace(/^www\./,'') === h.replace(/^www\./,''));
    if (allowed) callback(null, true);
    else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(null, true); // vẫn cho qua để domainGuard xử lý trả JSONP block, tránh lỗi CORS ở client cũ
    }
  },
  credentials: true
};
app.use(cors(corsOptions));

// Domain guard cho các action nhạy cảm (giữ nguyên logic cũ)
const protectedActions = ['getFonts','getFontBase64','getEffects','getSecureRenderModule','getRenderEngine','kara-render-engine','saveUsageStats','getStyleList','getStyleContent','registerUser','logUserAccess'];
app.use(domainGuard(protectedActions));

// Routes mới - REST chuẩn
app.use('/api/secure-render', require('./routes/secureRender'));
app.use('/api/auth', rateLimit({ max: 20, windowMs: 3600000, keyPrefix: 'otp' }), require('./routes/auth'));
app.use('/api', require('./routes/content'));
app.use('/api/admin', require('./routes/admin'));

// Route tương thích ngược với Apps Script cũ (JSONP) - giữ nguyên để Blogger cũ chạy được
// Client cũ gọi https://script.google.com/...?action=login&callback=xxx
// Giờ gọi https://your-cloud-run-url/exec?action=login&callback=xxx
app.get('/exec', async (req, res) => {
  const action = req.query.action || req.query.mod;
  const callback = req.query.callback;

  // Chuyển hướng sang handler mới
  let result = {};
  try {
    switch (action) {
      case 'getSecureRenderModule':
      case 'kara-render-engine':
      case 'getRenderEngine':
        return require('./routes/secureRender').handle ? 
          require('./routes/secureRender').handle(req,res) :
          res.redirect(`/api/secure-render?${new URLSearchParams(req.query).toString()}`);
      case 'getFonts':
        res.redirect('/api/fonts'); return;
      case 'getEffects':
        res.redirect('/api/effects'); return;
      case 'getLang':
        res.redirect(`/api/lang/${req.query.lang || 'vi'}`); return;
      case 'getStyleList':
        res.redirect('/api/styles'); return;
      case 'getStyleContent':
        res.redirect(`/api/styles/${req.query.fileName || req.query.name}`); return;
      default:
        result = { status: 'error', message: 'Action không hợp lệ - vui lòng dùng API mới /api/...' };
    }
  } catch (e) {
    result = { status: 'error', message: e.toString() };
  }

  if (callback) {
    return res.type('application/javascript').send(`${callback}(${JSON.stringify(result)})`);
  }
  res.json(result);
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'KaraRender API v2.0 - Supabase + Cloud Run',
    uptime: process.uptime(),
    allowedHosts: config.ALLOWED_HOSTS_STRICT,
    endpoints: ['/api/secure-render','/api/auth/login','/api/auth/register','/api/auth/send-otp','/api/fonts','/api/effects','/api/lang/:code','/api/styles']
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🚀 KaraRender backend listening on port ${PORT}`);
  console.log(`Allowed hosts: ${config.ALLOWED_HOSTS_STRICT.join(', ')}`);
});
