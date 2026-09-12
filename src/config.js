require('dotenv').config();

// ===== FIX BẢO MẬT: Không tự thêm localhost/127.0.0.1 vào ALLOWED_HOSTS =====
// Chỉ lấy từ env, và lọc bỏ localhost/127.0.0.1 nếu có để giữ bảo mật chặt chẽ
const rawAllowed = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOWED_HOSTS = rawAllowed
  .map(s => s.toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,''))
  .filter(h => h && !h.includes('127.0.0.1') && !h.includes('localhost') && h !== 'null') // BẢO MẬT: loại bỏ domain local
  .filter(Boolean);

const ALLOWED_HOSTS_STRICT = rawAllowed
  .map(s => s.trim())
  .filter(Boolean)
  .filter(h => {
    const lower = h.toLowerCase();
    return !lower.includes('127.0.0.1') && !lower.includes('localhost');
  });

// Nếu env rỗng thì dùng default CHẶT CHẼ - chỉ kararender.com, KHÔNG thêm localhost
const finalAllowed = ALLOWED_HOSTS.length > 0 ? ALLOWED_HOSTS : ['kararender.com', 'www.kararender.com'];
const finalAllowedStrict = ALLOWED_HOSTS_STRICT.length > 0 ? ALLOWED_HOSTS_STRICT : ['https://kararender.com', 'https://www.kararender.com'];

module.exports = {
  PORT: process.env.PORT || 8080,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  JWT_SECRET: process.env.JWT_SECRET || 'change_me',
  SECURE_XOR_SALT: process.env.SECURE_XOR_SALT || 'KaraRender_2026_XOR_Salt_!@#_V2',
  // BẢO MẬT: Secret cho Desktop - chỉ có trong main process Electron, không có trong web
  DESKTOP_SECRET: process.env.DESKTOP_SECRET || 'KaraDesktop_2026_Secure_v2',
  SECURE_TOKEN_MAX_AGE_MS: parseInt(process.env.SECURE_TOKEN_MAX_AGE_MS || '300000',10), // 5 phút thay vì 86400000 (1 ngày) để chống replay
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  ALLOWED_HOSTS: finalAllowed,
  ALLOWED_HOSTS_STRICT: finalAllowedStrict,
  DRIVE: {
    LANGUAGES_FOLDER_ID: process.env.LANGUAGES_FOLDER_ID,
    SECURE_RENDER_FOLDER_ID: process.env.SECURE_RENDER_FOLDER_ID,
    FONTS_FOLDER_ID: process.env.FONTS_FOLDER_ID,
    EFFECTS_FILE_ID: process.env.EFFECTS_FILE_ID,
    STYLE_FOLDER_ID: process.env.STYLE_FOLDER_ID,
    USERS_FOLDER_ID: process.env.USERS_FOLDER_ID,
  }
};
