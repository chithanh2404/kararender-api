const express = require('express');
const router = express.Router();
const { sendTelegramNotification } = require('../services/telegram');

// Rate limit chống spam - 1 IP 10 lần / phút
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.first > 60 * 1000) {
    rateLimitMap.set(ip, { count: 1, first: now });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

/**
 * POST /api/download/notify
 * Body: { os: 'windows' | 'mac' | 'android' | 'linux', downloadUrl, userEmail, userAgent, pageUrl }
 */
router.post('/notify', async (req, res) => {
  try {
    const { os, downloadUrl, userEmail, userAgent, pageUrl } = req.body;

    if (!os || !['windows', 'mac', 'android', 'linux'].includes(os.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid OS' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || 'unknown';

    if (!checkRateLimit(ip)) {
      return res.status(429).json({ success: false, message: 'Too many requests' });
    }

    const osEmoji = {
      windows: '🪟',
      mac: '🍎',
      android: '🤖',
      linux: '🐧'
    };

    const osLower = os.toLowerCase();
    const timeVN = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const message = `
${osEmoji[osLower] || '📥'} <b>KaraRender - Có người bấm TẢI APP</b>

<b>Hệ điều hành:</b> ${os.toUpperCase()}
<b>Link:</b> ${downloadUrl || 'Chưa có link (Sắp ra mắt)'}
<b>User:</b> ${userEmail || 'Khách (chưa đăng nhập)'}
<b>IP:</b> ${ip}
<b>Thời gian:</b> ${timeVN}
<b>Trang:</b> ${pageUrl || ''}

<b>User-Agent:</b>
<code>${(userAgent || req.headers['user-agent'] || '').substring(0, 400)}</code>
`.trim();

    // Gửi không await để response nhanh cho client
    sendTelegramNotification(message).catch(e => console.error('[DownloadNotify] telegram error', e));

    return res.json({ success: true });
  } catch (err) {
    console.error('[DownloadNotify] error', err);
    return res.status(500).json({ success: false });
  }
});

/**
 * GET /api/download/notify/test - test bot nhanh
 */
router.get('/notify/test', async (req, res) => {
  const testMsg = `🧪 <b>Test Download Notify</b>\nThời gian: ${new Date().toLocaleString('vi-VN')}`;
  await sendTelegramNotification(testMsg);
  res.json({ success: true, message: 'Test sent to Telegram' });
});

module.exports = router;
