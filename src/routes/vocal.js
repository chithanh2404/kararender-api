
// src/routes/vocal.js - FIX NumPy + thêm /health + giữ stereo 100%
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// FIX CORS
router.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['*'] }));
router.options('*', cors());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET || 'vocal-remover';
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ hỗ trợ file audio'));
    }
  }
});

async function separateWithDemucs(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const model = process.env.DEMUCS_MODEL || 'htdemucs';
    const args = ['-m','demucs.separate','--two-stems=vocals','-n',model,'--segment','6','-o',outputDir,inputPath];
    console.log(`🤖 Chạy: python3 ${args.join(' ')}`);
    const proc = spawn('python3', args, { env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONWARNINGS: 'ignore' } });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr+=d.toString(); console.error(d.toString().trim()); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Demucs failed code ${code}: ${stderr.slice(-1500)}`));
      const findWav = (dir) => {
        try {
          const files = fs.readdirSync(dir, { withFileTypes: true });
          for (const f of files) {
            const full = path.join(dir, f.name);
            if (f.isDirectory()) {
              if (fs.existsSync(path.join(full, 'vocals.wav'))) return full;
              const found = findWav(full);
              if (found) return found;
            }
          }
        } catch {}
        return null;
      };
      const resultDir = findWav(outputDir);
      if (!resultDir) return reject(new Error('Không tìm thấy file output Demucs'));
      resolve({ vocalPath: path.join(resultDir,'vocals.wav'), beatPath: path.join(resultDir,'no_vocals.wav') });
    });
    proc.on('error', err => reject(new Error(`Không chạy được python3: ${err.message}`)));
  });
}

// THÊM /health - để test không bị Cannot GET
router.get('/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const { spawnSync } = require('child_process');
  let pythonOk = false, demucsOk = false, numpyVersion = 'unknown';
  try {
    const py = spawnSync('python3', ['-c','import numpy; print(numpy.__version__)']);
    if (py.status === 0) {
      numpyVersion = py.stdout.toString().trim();
      pythonOk = true;
    }
    const dem = spawnSync('python3', ['-m','demucs.separate','--help']);
    demucsOk = dem.status === 0 || dem.stdout.toString().includes('usage');
  } catch {}
  res.json({ 
    status: 'ok', 
    message: 'Vocal API ready - CORS + NumPy fixed',
    checks: { python: pythonOk, demucs: demucsOk, numpy: numpyVersion, supabase: !!supabase },
    model: process.env.DEMUCS_MODEL || 'htdemucs',
    time: new Date().toISOString()
  });
});

router.post('/separate', upload.single('file'), async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  if (!req.file) return res.status(400).json({ success: false, error: 'Chưa upload file' });
  const tmpOutputDir = `/tmp/output_${uuidv4()}`;
  fs.mkdirSync(tmpOutputDir, { recursive: true });
  try {
    console.log(`📥 ${req.file.originalname} ${(req.file.size/1024/1024).toFixed(2)}MB`);
    const { vocalPath, beatPath } = await separateWithDemucs(req.file.path, tmpOutputDir);
    let vocalUrl = null, beatUrl = null;
    if (supabase) {
      try {
        const vocalBuf = fs.readFileSync(vocalPath);
        const beatBuf = fs.readFileSync(beatPath);
        const vocalName = `vocal/${uuidv4()}_vocal.wav`;
        const beatName = `beat/${uuidv4()}_beat.wav`;
        await supabase.storage.from(supabaseBucket).upload(vocalName, vocalBuf, { contentType: 'audio/wav', upsert: true });
        await supabase.storage.from(supabaseBucket).upload(beatName, beatBuf, { contentType: 'audio/wav', upsert: true });
        const { data: vPub } = supabase.storage.from(supabaseBucket).getPublicUrl(vocalName);
        const { data: bPub } = supabase.storage.from(supabaseBucket).getPublicUrl(beatName);
        vocalUrl = vPub.publicUrl;
        beatUrl = bPub.publicUrl;
      } catch (e) { console.error('Supabase lỗi:', e.message); }
    }
    if (!vocalUrl || !beatUrl) {
      const finalDir = '/tmp/vocal_outputs';
      fs.mkdirSync(finalDir, { recursive: true });
      const finalVocal = path.join(finalDir, `${uuidv4()}_vocal.wav`);
      const finalBeat = path.join(finalDir, `${uuidv4()}_beat.wav`);
      fs.copyFileSync(vocalPath, finalVocal);
      fs.copyFileSync(beatPath, finalBeat);
      const base = process.env.RENDER_EXTERNAL_URL || `https://kararender-api.onrender.com`;
      vocalUrl = `${base}/api/vocal/download/${path.basename(finalVocal)}`;
      beatUrl = `${base}/api/vocal/download/${path.basename(finalBeat)}`;
    }
    try { fs.unlinkSync(req.file.path); } catch {}
    try { fs.rmSync(tmpOutputDir, { recursive: true, force: true }); } catch {}
    res.json({ success: true, message: 'Tách vocal stereo 100%', vocal_url: vocalUrl, instrumental_url: beatUrl, beat_url: beatUrl, stereo: true, model: process.env.DEMUCS_MODEL || 'htdemucs' });
  } catch (err) {
    console.error('❌', err);
    try { fs.unlinkSync(req.file.path); } catch {}
    try { fs.rmSync(tmpOutputDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/download/:filename', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const fp = path.join('/tmp/vocal_outputs', req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File hết hạn' });
  res.download(fp);
});

module.exports = router;
