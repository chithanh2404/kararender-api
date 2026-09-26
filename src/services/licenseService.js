
import crypto from 'crypto';

// MASTER KEY - chỉ ở server, không bao giờ trả về client
const MASTER_KEY_B64 = process.env.THEME_SECRET_KEY || 'LeGnRDCKjHVclFfOlNckHM9xUjp3iLgYFjfDW4gLnac=';
const ALLOWED_DOMAINS = [
  'kararender.com',
  'www.kararender.com',
  'chithanhmedia.blogspot.com',
  'www.chithanhmedia.blogspot.com'
];

// Các URL gốc - sẽ được mã hóa ở server, chỉ trả về khi domain hợp lệ
const SECRET_URLS = {
  supabase: 'https://mbmnshwdaxltwfqiwdyx.supabase.co/storage/v1/object/public/kararender-app/s.js',
  api_base: 'https://kararender-api.onrender.com/api'
};

function parseAllowed() {
  const raw = process.env.ALLOWED_DOMAINS;
  if (raw) {
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  return ALLOWED_DOMAINS.map(s => s.toLowerCase());
}

export async function isDomainAllowed(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '').split(':')[0];
  const allowed = parseAllowed();

  for (const pattern of allowed) {
    const p = pattern.toLowerCase().replace(/^www\./, '');
    const pFull = pattern.toLowerCase();
    if (d === p || d === pFull) return true;
    if (d === pattern.toLowerCase()) return true;
  }

  return d.includes('kararender.com') || d.includes('chithanhmedia.blogspot.com');
}

export async function verifyDomainAndGetKey(domain, fullUrl) {
  const allowed = await isDomainAllowed(domain);
  console.log(`[License] Domain: ${domain} | Allowed: ${allowed} | FullUrl: ${fullUrl}`);

  if (!allowed) {
    return { allowed: false };
  }

  if (!MASTER_KEY_B64) {
    throw new Error('THEME_SECRET_KEY not set');
  }

  return {
    allowed: true,
    key: MASTER_KEY_B64, // Chỉ dùng nội bộ server, không trả về ở endpoint /config
    expiresAt: new Date(Date.now() + 24*60*60*1000).toISOString(),
    domain
  };
}

// Hàm giải mã server-side (nếu bạn lưu payload dạng mã hóa)
// Ở đây mình trả thẳng SECRET_URLS, nhưng nếu muốn, có thể mã hóa SECRET_URLS trong DB và giải mã ở đây
export async function getDecryptedConfig() {
  // Nếu SECRET_URLS đã là plain, trả luôn
  // Nếu bạn muốn lưu dạng mã hóa trong DB, giải mã ở đây bằng MASTER_KEY_B64
  return {
    supabaseUrl: SECRET_URLS.supabase,
    driveUrl: SECRET_URLS.drive_windows,
    apiBase: SECRET_URLS.api_base
  };
}

// Hàm decrypt AES-GCM nếu cần (khi payload lưu dạng mã hóa)
export async function decryptPayload(ivB64, cipherB64) {
  const key = Buffer.from(MASTER_KEY_B64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const cipher = Buffer.from(cipherB64, 'base64');
  // Node.js crypto AES-GCM
  // Tách tag (16 bytes cuối)
  const tag = cipher.subarray(cipher.length - 16);
  const encrypted = cipher.subarray(0, cipher.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, null, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function getAllowedDomains() {
  return parseAllowed();
}
