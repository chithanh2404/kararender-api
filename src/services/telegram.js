const config = require('../config');

async function sendTelegramNotification(message) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.log('[Telegram] Skipped - no token/chat_id');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      })
    });
    const data = await res.json();
    if (!data.ok) console.warn('[Telegram] Failed', data);
  } catch (e) {
    console.error('[Telegram] Error', e.message);
  }
}

module.exports = { sendTelegramNotification };
