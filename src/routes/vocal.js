
// src/routes/vocal.js - Vocal Remover API - giữ stereo 100%, chạy trên OnRender
// Dùng Demucs qua Python hoặc ONNX Runtime Node
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET || 'vocal-remover';
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// Multer - lưu file tạm
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ hỗ trợ file audio'));
    }
  }
});

// Hàm tách vocal bằng Demucs Python (cần pip install demucs)
// Nếu OnRender RAM yếu, dùng segment nhỏ
async function separateWithDemucs(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const model = process.env.DEMUCS_MODEL || 'htdemucs_ft';
    // demucs --two-stems=vocals -n htdemucs_ft input.mp3 -o /tmp/output
    const args = [
      '-m', 'demucs.separate',
      '--two-stems=vocals',
      '-n', model,
      '-o', outputDir,
      inputPath
    ];
    
    console.log(`🤖 Chạy: python3 ${args.join(' ')}`);
    
    const proc = spawn('python3', args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); console.log(d.toString()); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); console.error(d.toString()); });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Demucs failed code ${code}: ${stderr}`));
      }
      // Tìm file output - demucs tạo thư mục: outputDir/htdemucs_ft/input_filename/{vocals.wav, no_vocals.wav}
      const fs = require('fs');
      const findWav = (dir) => {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const f of files) {
          const full = path.join(dir, f.name);
          if (f.isDirectory()) {
            const found = findWav(full);
            if (found) return found;
          } else if (f.name === 'vocals.wav' || f.name === 'no_vocals.wav') {
            // trả về thư mục chứa 2 file
            return path.dirname(full);
          }
        }
        return null;
      };
      
      try {
        const resultDir = findWav(outputDir);
        if (!resultDir) return reject(new Error('Không tìm thấy file output Demucs'));
        const vocalPath = path.join(resultDir, 'vocals.wav');
        const beatPath = path.join(resultDir, 'no_vocals.wav');
        resolve({ vocalPath, beatPath });
      } catch (e) {
        reject(e);
      }
    });
  });
}

router.post('/separate', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Chưa upload file' });
  }

  const tmpOutputDir = `/tmp/output_${uuidv4()}`;
  fs.mkdirSync(tmpOutputDir, { recursive: true });

  try {
    console.log(`📥 Nhận file: ${req.file.originalname} - ${req.file.size} bytes`);

    // Tách vocal - giữ stereo 100%
    const { vocalPath, beatPath } = await separateWithDemucs(req.file.path, tmpOutputDir);

    console.log(`✅ Đã tách xong: ${vocalPath}, ${beatPath}`);

    let vocalUrl = null;
    let beatUrl = null;

    if (supabase) {
      // Upload lên Supabase Storage - public bucket
      const vocalBuffer = fs.readFileSync(vocalPath);
      const beatBuffer = fs.readFileSync(beatPath);

      const vocalName = `vocal/${uuidv4()}_vocal.wav`;
      const beatName = `beat/${uuidv4()}_beat.wav`;

      const { error: err1 } = await supabase.storage.from(supabaseBucket).upload(vocalName, vocalBuffer, {
        contentType: 'audio/wav',
        upsert: true
      });
      if (err1) throw err1;

      const { error: err2 } = await supabase.storage.from(supabaseBucket).upload(beatName, beatBuffer, {
        contentType: 'audio/wav',
        upsert: true
      });
      if (err2) throw err2;

      const { data: vocalPublic } = supabase.storage.from(supabaseBucket).getPublicUrl(vocalName);
      const { data: beatPublic } = supabase.storage.from(supabaseBucket).getPublicUrl(beatName);

      vocalUrl = vocalPublic.publicUrl;
      beatUrl = beatPublic.publicUrl;

      console.log(`☁️ Uploaded Supabase: ${vocalUrl}, ${beatUrl}`);
    } else {
      // Nếu không có Supabase, lưu vào /tmp/vocal_outputs và trả URL download local
      const finalDir = '/tmp/vocal_outputs';
      fs.mkdirSync(finalDir, { recursive: true });
      const finalVocal = path.join(finalDir, `${uuidv4()}_vocal.wav`);
      const finalBeat = path.join(finalDir, `${uuidv4()}_beat.wav`);
      fs.copyFileSync(vocalPath, finalVocal);
      fs.copyFileSync(beatPath, finalBeat);

      const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
      vocalUrl = `${baseUrl}/api/vocal/download/${path.basename(finalVocal)}`;
      beatUrl = `${baseUrl}/api/vocal/download/${path.basename(finalBeat)}`;
    }

    // Dọn file upload tạm
    fs.unlinkSync(req.file.path);
    fs.rmSync(tmpOutputDir, { recursive: true, force: true });

    res.json({
      success: true,
      message: 'Tách vocal giữ stereo 100% - Demucs FT',
      vocal_url: vocalUrl,
      instrumental_url: beatUrl,
      beat_url: beatUrl,
      stereo: true,
      model: process.env.DEMUCS_MODEL || 'htdemucs_ft'
    });

  } catch (err) {
    console.error('❌ Lỗi tách:', err);
    try { fs.unlinkSync(req.file.path); } catch {}
    try { fs.rmSync(tmpOutputDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/download/:filename', (req, res) => {
  const filePath = path.join('/tmp/vocal_outputs', req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File không tồn tại hoặc đã hết hạn' });
  }
  res.download(filePath);
});

module.exports = router;
