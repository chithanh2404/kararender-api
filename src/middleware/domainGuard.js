const config = require('../config');

function normalizeHost(hostStr) {
  if (!hostStr) return '';
  let d = hostStr.toString().toLowerCase().trim();
  d = d.replace(/^https?:\/\//, '').split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  return d;
}

function isAllowedDomain(domainStr) {
  if (!domainStr) return false;
  const d = normalizeHost(domainStr).replace(/^www\./,'');
  for (const allowed of config.ALLOWED_HOSTS) {
    if (d === allowed) return true;
    if (d === allowed.replace(/^www\./,'')) return true;
  }
  const raw = normalizeHost(domainStr);
  for (const allowedStrict of config.ALLOWED_HOSTS_STRICT) {
    if (raw === normalizeHost(allowedStrict)) return true;
  }
  return false;
}

// ===== BẢO MẬT: Verify tk chứa allowed domain + timestamp mới =====
function verifyTk(tk) {
  if (!tk) return { valid: false, reason: 'no tk' };
  try {
    const raw = Buffer.from(tk.toString(), 'base64').toString('utf8'); // domain|ts|random
    const parts = raw.split('|');
    if (parts.length < 2) return { valid: false, reason: 'invalid tk format' };
    const domainInTk = parts[0];
    const tsStr = parts[1];
    let ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return { valid: false, reason: 'invalid ts' };
    // hỗ trợ cả ms và seconds
    const tsMs = ts > 1e12 ? ts : ts * 1000;
    const now = Date.now();
    const diff = Math.abs(now - tsMs);
    if (diff > 5 * 60 * 1000) { // 5 phút
      return { valid: false, reason: `tk expired diff ${diff}ms` };
    }
    if (!isAllowedDomain(domainInTk)) {
      return { valid: false, reason: `domainInTk not allowed: ${domainInTk}` };
    }
    return { valid: true, domainInTk, ts };
  } catch (e) {
    return { valid: false, reason: 'tk decode error: ' + e.message };
  }
}

function getClientDomainFromRequest(req) {
  try {
    const p = { ...req.query, ...req.body };
    let origin = (p.origin || p.domain || p.referer || p.fullUrl || req.headers.referer || req.headers.origin || '').toString().toLowerCase().trim();
    let fullUrl = (p.fullUrl || p.href || p.url || p.origin || p.referer || '').toString().trim();
    let domain = (p.domain || p.hostname || '').toString().toLowerCase().trim();

    if (!origin && p.referer) {
      try {
        const m = p.referer.toString().match(/https?:\/\/([^\/\?#]+)/i);
        if (m && m[1]) origin = m[1].toLowerCase();
      } catch {}
    }
    if (!origin && domain) origin = domain;
    if (!origin && req.headers.referer) {
      const m = req.headers.referer.match(/https?:\/\/([^\/]+)/i);
      if (m) origin = m[1];
    }
    return { origin, fullUrl, domain, raw: p };
  } catch {
    return { origin: '', fullUrl: '', domain: '', raw: {} };
  }
}

// ===== BẢO MẬT: Check desktop secret (chỉ có trong main process Electron) =====
function isSecureDesktopRequest(req) {
  const desktopHeader = req.headers['x-kara-desktop'];
  const secretHeader = req.headers['x-kara-desktop-secret'];
  const expectedSecret = config.DESKTOP_SECRET || process.env.DESKTOP_SECRET || 'KaraDesktop_2026_Secure_v2';
  
  // Phải có cả 2 header và secret khớp
  if (desktopHeader === '1' && secretHeader === expectedSecret) {
    // Thêm check tk hợp lệ
    const tk = req.query.tk || req.body?.tk;
    const tkCheck = verifyTk(tk);
    if (tkCheck.valid) {
      console.log(`[GUARD] Secure desktop request allowed, tk domain: ${tkCheck.domainInTk}`);
      return true;
    }
    console.warn(`[GUARD] Desktop header ok but tk invalid: ${tkCheck.reason}`);
  }
  return false;
}

function checkCorsGuard(req) {
  const client = getClientDomainFromRequest(req);
  const source = client.origin || client.domain || client.fullUrl || req.headers.origin || req.headers.referer || '';
  
  // BẢO MẬT: Cho phép desktop nếu có secret + tk hợp lệ, KHÔNG cần thêm 127.0.0.1 vào allowedHosts
  if (isSecureDesktopRequest(req)) {
    return { blocked: false, source: 'secure-desktop', client, allowed: true, isDesktop: true };
  }

  if (!source) {
    // Cho phép nếu có tk hợp lệ (không có origin nhưng tk chứa allowed domain)
    const tk = req.query.tk || req.body?.tk;
    const tkCheck = verifyTk(tk);
    if (tkCheck.valid) {
      console.log(`[GUARD] Allowing no-origin with valid tk: ${tkCheck.domainInTk}`);
      return { blocked: false, source: 'no-origin-with-valid-tk', client, allowed: true, isDirect: true, tkCheck };
    }
    return { blocked: false, source: 'direct/no-origin', client, allowed: true, isDirect: true };
  }
  const allowed = isAllowedDomain(source);
  return { blocked: !allowed, source, client, allowed, fullUrl: client.fullUrl };
}

function checkCorsGuardStrict(req) {
  // BẢO MẬT: Desktop bypass an toàn
  if (isSecureDesktopRequest(req)) {
    return { blocked: false, source: 'secure-desktop', allowed: true, isDesktop: true };
  }

  const client = getClientDomainFromRequest(req);
  const source = client.origin || '';
  if (!source) {
    const tk = req.query.tk || req.body?.tk;
    const tkCheck = verifyTk(tk);
    if (tkCheck.valid) {
      console.log('[Guard Strict] Allowing no-origin with valid tk for secure module');
      return { blocked: false, source: 'no-origin-with-valid-tk', allowed: true, isDirect: true, tkCheck };
    }
    return { blocked: true, source: 'no-origin', allowed: false, reason: 'Missing origin/referer - blocked' };
  }
  const allowed = isAllowedDomain(source);
  return { blocked: !allowed, source, allowed, reason: allowed ? '' : `Domain ${source} not in allowed list` };
}

function domainGuard(protectedActions = []) {
  return (req, res, next) => {
    const action = req.query.action || req.query.mod || req.body?.action || '';
    const guard = checkCorsGuard(req);
    req.domainGuard = guard;

    if (protectedActions.includes(action) && guard.blocked && !guard.isDirect && !guard.isDesktop) {
      console.warn(`[GUARD] Blocked ${action} from ${guard.source}`);
      const callback = req.query.callback;
      const result = { success: false, error: 'Domain not allowed', domain: guard.source, blocked: true, allowedHosts: config.ALLOWED_HOSTS_STRICT };
      if (callback) {
        if (callback.toLowerCase().includes('console.log')) {
          return res.type('application/javascript').send(`/* blocked: ${guard.source} */`);
        }
        return res.type('application/javascript').send(`${callback}(${JSON.stringify(result)})`);
      }
      return res.status(403).json(result);
    }
    next();
  };
}

module.exports = { domainGuard, checkCorsGuard, checkCorsGuardStrict, isAllowedDomain, getClientDomainFromRequest, verifyTk, isSecureDesktopRequest };
