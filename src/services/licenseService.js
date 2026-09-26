
import crypto from 'crypto';

const MASTER_KEY_B64 = process.env.THEME_SECRET_KEY; // LeGnRDCKjH...
// CHỈ CHO PHÉP 2 DOMAIN NÀY - theo yêu cầu của bạn
const ALLOWED_DOMAINS = [
  'kararender.com',
  'www.kararender.com',
  'chithanhmedia.blogspot.com',
  'www.chithanhmedia.blogspot.com'
];

export async function isDomainAllowed(domain) {
  const d = domain.toLowerCase().replace(/^www\./, '').split(':')[0];
  // Check exact match or subdomain
  const allowedNormalized = ALLOWED_DOMAINS.map(x => x.toLowerCase().replace(/^www\./, ''));
  if (allowedNormalized.includes(d)) return true;
  // Cho phép www variant
  if (ALLOWED_DOMAINS.map(x=>x.toLowerCase()).includes(d.toLowerCase())) return true;
  // Strict: chỉ 2 domain này
  return false;
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
    key: MASTER_KEY_B64,
    expiresAt: new Date(Date.now() + 24*60*60*1000).toISOString(),
    domain
  };
}

export async function getAllowedDomains() {
  return ALLOWED_DOMAINS;
}
