// middleware/rateLimit.js - NÂNG CẤP từ file của bạn
// Chặn spam OTP theo cả IP + Email, chỉ chạy SAU khi đã check email tồn tại

const buckets = new Map();

/**
 * @param {Object} options
 * @param {number} options.windowMs - thời gian cửa sổ (ms)
 * @param {number} options.max - số request tối đa
 * @param {Function} options.keyGenerator - hàm tạo key từ req (để chặn theo email/ip)
 * @param {string} options.keyPrefix - prefix cho key
 * @param {string} options.message - thông báo khi bị chặn
 */
function rateLimit({ windowMs = 60 * 60 * 1000, max = 5, keyGenerator, keyPrefix = 'rl', message }) {
  return (req, res, next) => {
    const defaultIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const keyValue = keyGenerator ? keyGenerator(req) : defaultIp;
    const key = `${keyPrefix}:${keyValue}`;
    
    const now = Date.now();
    let entry = buckets.get(key);

    if (!entry || now - entry.start > windowMs) {
      entry = { count: 1, start: now };
      buckets.set(key, entry);
      return next();
    }

    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      
      const callback = req.query.callback;
      const msg = message || `Quá nhiều yêu cầu. Vui lòng thử lại sau ${retryAfter}s`;
      
      if (callback) {
        return res.type('application/javascript').send(`${callback}('${msg}')`);
      }
      return res.status(429).json({ error: msg, retryAfter });
    }

    entry.count++;
    next();
  };
}

// 2 limiter riêng biệt cho OTP
const otpLimitByEmail = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 5, // 1 email chỉ được xin OTP 5 lần / giờ
  keyPrefix: 'otp_email',
  keyGenerator: (req) => req.normalizedEmail || req.body?.email?.toLowerCase().trim(),
  message: '❌ Email này đã yêu cầu OTP quá nhiều lần. Vui lòng đợi 1 giờ!'
});

const otpLimitByIP = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 20, // 1 IP chỉ được xin 20 lần / giờ (chặn dò email)
  keyPrefix: 'otp_ip',
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown',
  message: '❌ IP của bạn đã gửi quá nhiều yêu cầu. Vui lòng đợi 1 giờ!'
});

// Dọn dẹp memory mỗi phút
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now - v.start > 3600000) buckets.delete(k);
  }
}, 60000);

module.exports = { rateLimit, otpLimitByEmail, otpLimitByIP };
