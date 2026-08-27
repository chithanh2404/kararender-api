// FIXED V4.1 - Thêm CORS để không bị lỗi Không kết nối được Railway
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const router = express.Router();

// === THÊM CORS ===
router.use((req, res, next)=>{
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Expose-Headers', 'Content-Disposition, X-Render-Time');
  if(req.method === 'OPTIONS'){
    return res.sendStatus(200);
  }
  next();
});

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024*1024*800 } });

router.post('/fast-videobg', upload.fields([
  {name:'videobg', maxCount:1},
  {name:'audio', maxCount:1},
  {name:'sub', maxCount:1},
  {name:'logo', maxCount:1}
]), async (req,res)=>{
  const start = Date.now();
  const temps = [];
  try{
    const vb = req.files?.videobg?.[0];
    if(!vb) return res.status(400).json({success:false, message:'Missing videobg'});
    const audio = req.files?.audio?.[0];
    const sub = req.files?.sub?.[0];
    const logo = req.files?.logo?.[0];

    const logoX = parseInt(req.body.logoX)||50;
    const logoY = parseInt(req.body.logoY)||50;
    const logoW = parseInt(req.body.logoW)||0;
    const logoH = parseInt(req.body.logoH)||0;

    temps.push(vb.path);
    if(audio) temps.push(audio.path);
    if(sub) temps.push(sub.path);
    if(logo) temps.push(logo.path);

    const outPath = path.join(os.tmpdir(), `kara_${Date.now()}.mp4`);
    temps.push(outPath);

    let safeAssPath = null;
    if(sub){
      let assContent = fs.readFileSync(sub.path, 'utf8');
      safeAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);
      fs.writeFileSync(safeAssPath, assContent, 'utf8');
      temps.push(safeAssPath);
    }

    console.log(`[FastV4.1] vb=${(vb.size/1024/1024).toFixed(1)}MB`);

    let cmdParts = [];
    cmdParts.push(`-i "${vb.path}"`);
    let logoIdx = -1, audioIdx = -1, nextIdx = 1;

    if(logo){
      cmdParts.push(`-i "${logo.path}"`);
      logoIdx = nextIdx++;
    }
    if(audio){
      cmdParts.push(`-i "${audio.path}"`);
      audioIdx = nextIdx++;
    }

    let filters = [];
    let lastLabel = '0:v';

    if(logo){
      if(logoW>0 && logoH>0){
        filters.push(`[${logoIdx}:v]scale=${logoW}:${logoH}[logo]`);
      }else if(logoW>0){
        filters.push(`[${logoIdx}:v]scale=${logoW}:-1[logo]`);
      }else{
        filters.push(`[${logoIdx}:v]scale=200:-1[logo]`);
      }
      filters.push(`[${lastLabel}][logo]overlay=${logoX}:${logoY}[withlogo]`);
      lastLabel = 'withlogo';
    }

    if(safeAssPath){
      const escPath = safeAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      if(filters.length>0){
        filters.push(`[${lastLabel}]ass=${escPath}[final]`);
        lastLabel = 'final';
      }
    }

    let final = [...cmdParts];

    if(filters.length>0){
      final.push(`-filter_complex "${filters.join(';')}"`);
      final.push(`-map "[${lastLabel}]"`);
      if(audio){
        final.push(`-map ${audioIdx}:a`);
      }else{
        final.push(`-map 0:a?`);
      }
    }else{
      if(safeAssPath){
        const escPath = safeAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        final.push(`-vf "ass=${escPath}"`);
      }
      if(audio){
        final.push(`-map 0:v -map ${audioIdx}:a`);
      }
    }

    final.push(`-c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p`);
    final.push(`-c:a aac -b:a 192k`);
    final.push(`-movflags +faststart`);
    if(audio) final.push(`-shortest`);
    final.push(`-y "${outPath}"`);

    const fullCmd = `"${ffmpegStatic}" -y ${final.join(' ')}`;
    console.log('[FFmpeg CMD]', fullCmd);

    await new Promise((resolve, reject)=>{
      exec(fullCmd, {maxBuffer: 1024*1024*50}, (err, stdout, stderr)=>{
        console.log('[FFmpeg stderr]', stderr?.slice(-3000));
        if(err && !fs.existsSync(outPath)){
          reject(new Error(stderr || err.message));
        }else resolve();
      });
    });

    const stat = fs.statSync(outPath);
    console.log(`[FastV4.1] Done ${stat.size} bytes`);

    if(stat.size < 100*1024){
      throw new Error(`Output too small ${stat.size}`);
    }

    res.setHeader('Content-Type','video/mp4');
    res.setHeader('Content-Disposition',`attachment; filename="kara_${Date.now()}.mp4"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', ()=>{
      temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    });

  }catch(e){
    console.error('[FastV4.1] Error', e);
    temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    res.status(500).json({success:false, message:e.message});
  }
});

router.get('/health', (req,res)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.json({ok:true, ver:'v4.1-cors'});
});

// OPTIONS handler cho preflight
router.options('/fast-videobg', (req,res)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  res.sendStatus(200);
});

module.exports = router;
