const express = require('express');
const { supabaseAdmin } = require('../services/supabase');
const { listFilesInFolder, getFileContentAsString } = require('../services/drive');
const config = require('../config');

const router = express.Router();

// GET /api/fonts
router.get('/fonts', async (req, res) => {
  try {
    // Ưu tiên Supabase Storage bucket 'fonts' nếu có
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin.storage.from('fonts').list();
      if (!error && data && data.length > 0) {
        const fonts = data.filter(f => /\.(ttf|otf|woff2)$/i.test(f.name)).map(f => ({
          name: f.name.replace(/\.[^/.]+$/, ''),
          url: `${config.SUPABASE_URL}/storage/v1/object/public/fonts/${f.name}`
        }));
        if (fonts.length) return res.json(fonts);
      }
    }
    // Fallback Drive cũ
    const files = await listFilesInFolder(config.DRIVE.FONTS_FOLDER_ID);
    const fonts = files.filter(f => /\.(ttf|otf|woff2)$/i.test(f.name)).map(f => ({
      name: f.name.replace(/\.[^/.]+$/, ''),
      url: `https://drive.google.com/uc?export=download&id=${f.id}`,
      id: f.id
    }));
    res.json(fonts);
  } catch (e) {
    console.error('getFonts error', e);
    res.json([]);
  }
});

// GET /api/effects
router.get('/effects', async (req, res) => {
  try {
    if (config.DRIVE.EFFECTS_FILE_ID) {
      const content = await getFileContentAsString(config.DRIVE.EFFECTS_FILE_ID);
      if (content) return res.json(JSON.parse(content));
    }
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from('app_data').select('content').eq('key', 'effects').single();
      if (data) return res.json(data.content);
    }
    res.json({});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lang/:code
router.get('/lang/:code', async (req, res) => {
  const code = req.params.code;
  try {
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin.from('languages').select('data').eq('code', code).single();
      if (data) return res.json({ status: 'success', data: data.data });
    }
    const files = await listFilesInFolder(config.DRIVE.LANGUAGES_FOLDER_ID);
    const file = files.find(f => f.name === `${code}.json`);
    if (file) {
      const content = await getFileContentAsString(file.id);
      return res.json({ status: 'success', data: JSON.parse(content) });
    }
    res.status(404).json({ status: 'error', message: 'Không tìm thấy file ngôn ngữ' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// GET /api/styles
router.get('/styles', async (req, res) => {
  try {
    const files = await listFilesInFolder(config.DRIVE.STYLE_FOLDER_ID);
    const list = files.filter(f => /\.(json|html|htm)$/i.test(f.name)).map(f => f.name);
    res.json(list);
  } catch (e) {
    res.json([]);
  }
});

// GET /api/styles/:fileName
router.get('/styles/:fileName', async (req, res) => {
  try {
    const files = await listFilesInFolder(config.DRIVE.STYLE_FOLDER_ID);
    const file = files.find(f => f.name === req.params.fileName);
    if (!file) return res.status(404).json(null);
    const content = await getFileContentAsString(file.id);
    if (file.name.toLowerCase().endsWith('.json')) {
      try { return res.json(JSON.parse(content)); } catch { return res.type('text/plain').send(content); }
    }
    return res.json({ type: 'html', fileName: file.name, content, raw: content });
  } catch (e) {
    res.status(500).json(null);
  }
});

// POST /api/feedback
router.post('/feedback', async (req, res) => {
  try {
    const data = req.body;
    if (supabaseAdmin) {
      await supabaseAdmin.from('feedbacks').insert({
        email: data.email,
        message: data.message,
        rating: data.rating || null,
        created_at: new Date().toISOString(),
        domain: req.headers.origin || ''
      });
    }
    const { sendTelegramNotification } = require('../services/telegram');
    await sendTelegramNotification(`💬 <b>Feedback mới</b>\n📧 ${data.email}\n📝 ${data.message?.slice(0,500)}`);
    res.json({ status: 'success', message: 'Cảm ơn bạn đã góp ý!' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// POST /api/usage-stats - thay cho saveUsageStats
router.post('/usage-stats', async (req, res) => {
  try {
    if (supabaseAdmin) {
      await supabaseAdmin.from('usage_stats').insert({
        data: req.body,
        created_at: new Date().toISOString(),
        ip: req.ip
      });
    }
    res.json({ success: true });
  } catch (e) {
    res.json({ success: true, warning: e.message });
  }
});

module.exports = router;
