const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../services/supabase');
const config = require('../config');
const { sendTelegramNotification } = require('../services/telegram');
const { otpLimitByIP, otpLimitByEmail } = require('../middleware/rateLimit_fixed');

const router = express.Router();

function createJWT(payload) {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });
}

// ===== MIDDLEWARE QUAN TRỌNG: CHECK EMAIL TỒN TẠI TRƯỚC KHI GỬI OTP =====
async function checkEmailExistsSupabase(req, res, next) {
  try {
    const emailRaw = req.body?.email || '';
    const email = String(emailRaw).toLowerCase().trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, msg: 'Email không hợp lệ' });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, msg: 'Supabase chưa cấu hình' });
    }

    // BƯỚC CHỐNG SPAM: Kiểm tra email có trong users không
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id,email')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      console.error('[checkEmail] supabase error', error.message);
      return res.status(500).json({ success: false, msg: 'Lỗi kiểm tra email' });
    }

    if (!user) {
      // DỪNG TẠI ĐÂY - Không tạo OTP, không gửi mail
      console.log(`[OTP Block] Email không tồn tại: ${email} - IP: ${req.ip}`);
      return res.status(404).json({ success: false, msg: 'Email này không tồn tại trong hệ thống' });
    }

    req.foundUser = user;
    req.normalizedEmail = email;
    next();
  } catch (e) {
    console.error('checkEmailExists error', e);
    return res.status(500).json({ success: false, msg: e.message });
  }
}

// POST /api/auth/register - giữ nguyên
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, msg: 'Thiếu email/password' });

    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, msg: 'Supabase chưa cấu hình' });
    }

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

// POST /api/auth/login - giữ nguyên
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

// POST /api/auth/send-otp - ĐÃ FIX CHỐNG SPAM
router.post('/send-otp',
  otpLimitByIP,               // 1. Chặn IP quét 20/h trước để đỡ tốn DB
  checkEmailExistsSupabase,   // 2. CHECK TỒN TẠI - Không có thì dừng luôn, không gửi
  otpLimitByEmail,            // 3. Chỉ khi email tồn tại mới tính limit 5/h
  async (req, res) => {
    try {
      const email = req.normalizedEmail; // đã được chuẩn hóa từ middleware
      const user = req.foundUser;

      // Cooldown 60s chống bấm liên tục 1 email
      const { data: recent } = await supabaseAdmin
        .from('otps')
        .select('created_at')
        .eq('email', email)
        .gt('created_at', new Date(Date.now() - 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (recent) {
        return res.status(429).json({ success: false, msg: 'Vui lòng đợi 60s trước khi yêu cầu lại' });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // Chỉ khi email TỒN TẠI mới upsert OTP
      const { error: upsertErr } = await supabaseAdmin.from('otps').upsert({
        email: email,
        otp,
        expires_at: expiresAt,
        created_at: new Date().toISOString()
      }, { onConflict: 'email' });

      if (upsertErr) throw upsertErr;

      // Gửi thông báo - chỉ gửi khi email thật
      await sendTelegramNotification(`🔑 <b>OTP Request (Đã check DB)</b>\n📧 ${email}\n🔢 OTP: ${otp} (5 phút)\n👤 ID: ${user.id}\n🌐 IP: ${req.ip}`);

      // TODO: Thay bằng hàm sendOTPEmailViaAppsScript của bạn nếu muốn gửi mail thật
      // await sendOTPEmailViaAppsScript(email, otp, '', req.ip, 'forgot');

      console.log(`[OTP OK] Đã gửi OTP cho ${email}`);

      // Production thì KHÔNG trả OTP về client
      const isDev = process.env.NODE_ENV !== 'production';
      res.json({ 
        success: true, 
        message: 'OTP đã gửi tới email của bạn',
        ...(isDev ? { debug_otp: otp } : {})
      });
    } catch (e) {
      console.error('send-otp error', e);
      res.status(500).json({ success: false, msg: e.message });
    }
  }
);

// POST /api/auth/verify-and-reset - giữ nguyên
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
