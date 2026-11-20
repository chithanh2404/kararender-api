// routes/usdt-config.js - Nút gạt BẬT/TẮT USDT giống Dodo / Lemon
// Mount ở index.js TRƯỚC router USDT cũ:
//   const usdtConfigRouter = require('./routes/usdt-config');
//   app.use('/api', usdtConfigRouter); // <- phải đặt TRƯỚC route USDT cũ để chặn được
// -> GET  /api/admin/usdt-config
// -> POST /api/admin/usdt-config  { enabled: true/false }
// -> GET  /api/payment/usdt/config
// -> GATE: GET  /api/payment/usdt-wallets  -> TẮT thì trả wallets: [] (frontend tự ẩn nút)
// -> GATE: POST /api/payment/usdt/create|scan|verify -> TẮT thì 403
// Admin vẫn xem được /api/admin/usdt-wallets để bật lại, không bị chặn.

const express = require('express');
const router = express.Router();

function getSupabaseAdmin() {
  try { return require('../services/supabase').supabaseAdmin; }
  catch { try { return require('./../services/supabase').supabaseAdmin; } catch { return null; } }
}

// Mặc định BẬT (true) nếu chưa có dòng usdt_enabled trong app_settings,
// để giữ đúng hành vi cũ: USDT hiện khi còn ví active. Admin gạt TẮT 1 lần là lưu lại.
async function getUsdtEnabled() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return true;
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('id', 'usdt_enabled').single();
    if (!data?.value) return true;
    // value có thể là { enabled: true } hoặc { enabled: false }
    // Nếu value là boolean trực tiếp thì dùng luôn
    if (typeof data.value === 'boolean') return data.value;
    if (typeof data.value.enabled === 'boolean') return data.value.enabled;
    return true;
  } catch { return true; }
}

// ===== GET /api/admin/usdt-config =====
router.get('/admin/usdt-config', async (req, res) => {
  const enabled = await getUsdtEnabled();
  res.json({ success: true, enabled, configured: true });
});

// ===== POST /api/admin/usdt-config =====
router.post('/admin/usdt-config', express.json(), async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Supabase not configured' });
    const value = {
      enabled: !!req.body?.enabled,
      updated_at: new Date().toISOString(),
      updated_by: (req.headers['x-user-email'] || '').toLowerCase(),
    };
    const { error } = await supabaseAdmin.from('app_settings').upsert({ id: 'usdt_enabled', value }, { onConflict: 'id' });
    if (error) throw error;
    return res.json({ success: true, value, enabled: value.enabled, message: `Đã ${value.enabled ? 'BẬT' : 'TẮT'} USDT` });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ===== GET /api/payment/usdt/config - cho frontend kiểm tra trước khi hiện nút =====
router.get('/payment/usdt/config', async (req, res) => {
  const enabled = await getUsdtEnabled();
  res.json({ success: true, enabled, configured: true, timestamp: new Date().toISOString() });
});

// ===== GATE: chặn user khi admin TẮT - giống Dodo: TẮT là ẩn cho TẤT CẢ, kể cả admin/whitelist =====
// Đặt TRƯỚC route USDT cũ. Nếu BẬT thì next() để route cũ chạy tiếp.
router.get('/payment/usdt-wallets', async (req, res, next) => {
  const enabled = await getUsdtEnabled();
  if (!enabled) {
    return res.json({ success: true, enabled: false, wallets: [], message: 'USDT đang tắt trong admin' });
  }
  return next();
});

router.post('/payment/usdt/create', async (req, res, next) => {
  const enabled = await getUsdtEnabled();
  if (!enabled) return res.status(403).json({ success: false, enabled: false, message: 'USDT đang tắt' });
  return next();
});

router.post('/payment/usdt/scan', async (req, res, next) => {
  const enabled = await getUsdtEnabled();
  if (!enabled) return res.status(403).json({ success: false, enabled: false, message: 'USDT đang tắt' });
  return next();
});

router.post('/payment/usdt/verify', async (req, res, next) => {
  const enabled = await getUsdtEnabled();
  if (!enabled) return res.status(403).json({ success: false, enabled: false, message: 'USDT đang tắt' });
  return next();
});

module.exports = router;
module.exports.getUsdtEnabled = getUsdtEnabled;
