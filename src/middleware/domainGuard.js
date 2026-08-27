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
  // also check strict list with www
  const raw = normalizeHost(domainStr);
  for (const allowedStrict of config.ALLOWED_HOSTS_STRICT) {
    if (raw === normalizeHost(allowedStrict)) return true;
  }
  return false;
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

function checkCorsGuard(req) {
  const client = getClientDomainFromRequest(req);
  const source = client.origin || client.domain || client.fullUrl || req.headers.origin || req.headers.referer || '';
  if (!source) {
    // Cho phép nếu gọi trực tiếp từ server-to-server (không có origin) nhưng action không nhạy cảm
    return { blocked: false, source: 'direct/no-origin', client, allowed: true, isDirect: true };
  }
  const allowed = isAllowedDomain(source);
  return { blocked: !allowed, source, client, allowed, fullUrl: client.fullUrl };
}

function domainGuard(protectedActions = []) {
  return (req, res, next) => {
    const action = req.query.action || req.query.mod || req.body?.action || '';
    const guard = checkCorsGuard(req);
    req.domainGuard = guard;

    if (protectedActions.includes(action) && guard.blocked && !guard.isDirect) {
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

module.exports = { domainGuard, checkCorsGuard, isAllowedDomain, getClientDomainFromRequest };
