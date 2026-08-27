const express = require('express');
const { supabaseAdmin } = require('../services/supabase');
const { sendTelegramNotification } = require('../services/telegram');
const router = express.Router();

// Middleware kiểm tra admin - đơn giản: check email trong env
function isAdmin(req, res, next) {
  const adminEmails = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s=>s.trim());
  const email = (req.headers['x-admin-email'] || req.body?.adminEmail || req.query?.adminEmail || '').toLowerCase();
  if (adminEmails.length && !adminEmails.includes(email)) {
    return res.status(403).json({ status: 'error', message: 'Không có quyền admin' });
  }
  next();
}

router.get('/users', isAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('users').select('id,email,full_name,is_vip,created_at').order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/approve-vip', isAdmin, async (req, res) => {
  try {
    const { email, action } = req.body;
    if (!email) return res.status(400).json({ status: 'error', message: 'Thiếu email' });
    const isVip = action === 'approve';
    const { error } = await supabaseAdmin.from('users').update({ is_vip: isVip }).eq('email', email.toLowerCase());
    if (error) throw error;
    await sendTelegramNotification(`${isVip ? '✅ Duyệt VIP' : '❌ Từ chối VIP'} cho ${email}`);
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
