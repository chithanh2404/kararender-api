const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../services/supabase');
const config = require('../config');
const { sendTelegramNotification } = require('../services/telegram');

const router = express.Router();

// Helper tạo JWT riêng nếu cần giữ tương thích cũ
function createJWT(payload) {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, msg: 'Thiếu email/password' });

    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, msg: 'Supabase chưa cấu hình' });
    }

    // Kiểm tra user tồn tại
    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existing) return res.json({ success: false, msg: 'Email đã tồn tại' });

    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabaseAdmin.from('users').insert({
      email: email.toLowerCase(),
      password_hash: hash,
      full_name: fullName || email,
      is_vip: false,
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;

    await sendTelegramNotification(`✅ <b>Đăng ký mới</b>\n📧 ${email}\n👤 ${fullName}\n🌐 ${req.headers.origin || req.headers.referer || 'unknown'}`);

    res.json({ success: true, user: { id: data.id, email: data.email, fullName: data.full_name } });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ success: false, msg: e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!supabaseAdmin) return res.status(500).json({ success: false, msg: 'Supabase chưa cấu hình' });

    const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('email', email.toLowerCase()).single();
    if (error || !user) return res.json({ success: false, msg: 'Email không tồn tại' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.json({ success: false, msg: 'Sai mật khẩu' });

    const token = createJWT({ id: user.id, email: user.email, is_vip: user.is_vip });

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, fullName: user.full_name, isVip: user.is_vip }
    });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ success: false, msg: e.message });
  }
});

// POST /api/auth/send-otp - dùng Supabase hoặc tự tạo OTP lưu trong bảng otps
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Thiếu email' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    if (supabaseAdmin) {
      await supabaseAdmin.from('otps').upsert({
        email: email.toLowerCase(),
        otp,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      }, { onConflict: 'email' });

      // Gửi email OTP qua Supabase Auth hoặc dịch vụ email của bạn
      // Ở đây ví dụ gửi qua Supabase Auth signInWithOtp nếu dùng email
      // Hoặc gửi qua Telegram/Email service
    }

    await sendTelegramNotification(`🔑 <b>OTP Request</b>\n📧 ${email}\n🔢 OTP: ${otp} (5 phút)`);

    // QUAN TRỌNG: production thì KHÔNG trả OTP về client, chỉ log
    res.json({ success: true, message: 'OTP đã gửi', debug_otp: otp });
  } catch (e) {
    console.error('send-otp error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/verify-and-reset
router.post('/verify-and-reset', async (req, res) => {
  try {
    const { email, otp, newPass } = req.body;
    if (!email || !otp || !newPass) return res.status(400).json({ success: false, msg: 'Thiếu dữ liệu' });

    const { data: row } = await supabaseAdmin.from('otps').select('*').eq('email', email.toLowerCase()).single();
    if (!row) return res.json({ success: false, msg: 'OTP không tồn tại' });
    if (row.otp !== otp) return res.json({ success: false, msg: 'OTP sai' });
    if (new Date(row.expires_at) < new Date()) return res.json({ success: false, msg: 'OTP hết hạn' });

    const hash = await bcrypt.hash(newPass, 10);
    await supabaseAdmin.from('users').update({ password_hash: hash }).eq('email', email.toLowerCase());
    await supabaseAdmin.from('otps').delete().eq('email', email.toLowerCase());

    res.json({ success: true, msg: 'Đổi mật khẩu thành công' });
  } catch (e) {
    console.error('verify-reset error', e);
    res.status(500).json({ success: false, msg: e.message });
  }
});

module.exports = router;
