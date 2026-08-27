const config = require('../config');

async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || config.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[Telegram] Skipped - no token/chat_id', { envToken: !!process.env.TELEGRAM_BOT_TOKEN, cfgToken: !!config.TELEGRAM_BOT_TOKEN, envChat: !!process.env.TELEGRAM_CHAT_ID, cfgChat: !!config.TELEGRAM_CHAT_ID });
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    const data = await res.json().catch(()=>({}));
    if (!data.ok) console.warn('[Telegram] Failed', JSON.stringify(data).slice(0,800));
    else console.log('[Telegram] Sent OK to', chatId);
    return data.ok;
  } catch (e) {
    console.error('[Telegram] Error', e.message);
    return false;
  }
}

// Alias để tương thích với code cũ gọi sendTelegram
async function sendTelegram(message){ return sendTelegramNotification(message); }

module.exports = { sendTelegramNotification, sendTelegram };
