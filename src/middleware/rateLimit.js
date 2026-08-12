// Simple in-memory rate limit cho OTP - thay bằng Redis khi scale
const buckets = new Map();

function rateLimit({ windowMs = 3600000, max = 20, keyPrefix = 'rl' }) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { count: 1, start: now };
      buckets.set(key, entry);
      return next();
    }
    if (entry.count >= max) {
      const callback = req.query.callback;
      const msg = '❌ IP của bạn đã gửi quá nhiều yêu cầu. Vui lòng đợi 1 giờ!';
      if (callback) {
        return res.type('application/javascript').send(`${callback}('${msg}')`);
      }
      return res.status(429).json({ error: msg });
    }
    entry.count++;
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now - v.start > 3600000) buckets.delete(k);
  }
}, 60000);

module.exports = { rateLimit };
