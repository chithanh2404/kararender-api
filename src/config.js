require('dotenv').config();

const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map(s => s.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,''))
  .filter(Boolean);

const ALLOWED_HOSTS_STRICT = (process.env.ALLOWED_HOSTS || '').split(',').map(s=>s.trim()).filter(Boolean);

module.exports = {
  PORT: process.env.PORT || 8080,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  JWT_SECRET: process.env.JWT_SECRET || 'change_me',
  SECURE_XOR_SALT: process.env.SECURE_XOR_SALT || 'KaraRender_2026_XOR_Salt_!@#_V2',
  SECURE_TOKEN_MAX_AGE_MS: parseInt(process.env.SECURE_TOKEN_MAX_AGE_MS || '86400000',10),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  ALLOWED_HOSTS,
  ALLOWED_HOSTS_STRICT,
  DRIVE: {
    LANGUAGES_FOLDER_ID: process.env.LANGUAGES_FOLDER_ID,
    SECURE_RENDER_FOLDER_ID: process.env.SECURE_RENDER_FOLDER_ID,
    FONTS_FOLDER_ID: process.env.FONTS_FOLDER_ID,
    EFFECTS_FILE_ID: process.env.EFFECTS_FILE_ID,
    STYLE_FOLDER_ID: process.env.STYLE_FOLDER_ID,
    USERS_FOLDER_ID: process.env.USERS_FOLDER_ID,
  }
};
