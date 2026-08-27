// FAST VIDEOBG FIXED V3 - Sửa lỗi video 24KB do shortest=1
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const router = express.Router();
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

    const outPath = path.join(os.tmpdir(), `kara_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
    temps.push(outPath);

    console.log(`[FastV3] vb=${(vb.size/1024/1024).toFixed(1)}MB audio=${audio?.size} sub=${sub?.size} logo=${logo?.size} pos=${logoX},${logoY} ${logoW}x${logoH}`);

    function escAss(p){
      return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
    }

    let safeAssPath = null;
    if(sub){
      safeAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);
      fs.copyFileSync(sub.path, safeAssPath);
      temps.push(safeAssPath);
    }

    let cmdParts = [];

    // Input 0: videobg
    cmdParts.push(`-i "${vb.path}"`);
    let logoIdx = -1;
    let audioIdx = -1;
    let nextIdx = 1;

    // Input logo - QUAN TRỌNG: thêm -loop 1 cho ảnh
    if(logo){
      // logo là ảnh PNG, cần loop để nó hiện suốt video
      cmdParts.push(`-loop 1 -i "${logo.path}"`);
      logoIdx = nextIdx++;
    }
    if(audio){
      cmdParts.push(`-i "${audio.path}"`);
      audioIdx = nextIdx++;
    }

    // Filter complex
    let filters = [];
    let lastLabel = '0:v';

    if(logo){
      // Scale logo
      if(logoW>0 && logoH>0){
        filters.push(`[${logoIdx}:v]scale=${logoW}:${logoH}[logo]`);
      }else if(logoW>0){
        filters.push(`[${logoIdx}:v]scale=${logoW}:-1[logo]`);
      }else{
        // Không scale, giữ nguyên
        filters.push(`[${logoIdx}:v]format=rgba[logo]`);
      }
      // Overlay - BỎ shortest=1, để logo hiện suốt video
      filters.push(`[${lastLabel}][logo]overlay=${logoX}:${logoY}:format=auto[withlogo]`);
      lastLabel = 'withlogo';
    }

    if(safeAssPath){
      const esc = escAss(safeAssPath);
      if(filters.length>0){
        filters.push(`[${lastLabel}]ass=${esc}[final]`);
        lastLabel = 'final';
      }
    }

    // Build final command
    let final = [...cmdParts];

    if(filters.length>0){
      final.push(`-filter_complex "${filters.join(';')}"`);
      final.push(`-map "[${lastLabel}]"`);
      if(audio){
        final.push(`-map ${audioIdx}:a`);
      }else{
        final.push(`-map 0:a?`); // giữ audio gốc nếu có
      }
    }else{
      // Chỉ có ass, không logo
      if(safeAssPath){
        const esc = escAss(safeAssPath);
        final.push(`-vf "ass=${esc}"`);
      }
      if(audio){
        final.push(`-map 0:v:0 -map ${audioIdx}:a`);
      }
    }

    // Codec - rất quan trọng: bỏ -shortest nếu không có audio riêng? Giữ lại nhưng không ảnh hưởng vì đã bỏ shortest ở overlay
    final.push(`-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p`);
    final.push(`-c:a aac -b:a 192k`);
    final.push(`-movflags +faststart`);
    final.push(`-shortest`); // để video cắt theo audio nếu audio ngắn hơn
    final.push(`-y "${outPath}"`);

    const fullCmd = `"${ffmpegStatic}" ${final.join(' ')}`;
    console.log('[FFmpeg CMD]', fullCmd);

    await new Promise((resolve, reject)=>{
      exec(fullCmd, {maxBuffer: 1024*1024*50}, (err, stdout, stderr)=>{
        console.log('[FFmpeg stderr]', (stderr||'').slice(-3000));
        if(err){
          console.error('[FFmpeg err]', err);
          reject(new Error(stderr?.slice(-1000) || err.message));
        }else resolve();
      });
    });

    if(!fs.existsSync(outPath)){
      throw new Error('Output not created');
    }
    const stat = fs.statSync(outPath);
    console.log(`[FastV3] Done ${stat.size} bytes (${(stat.size/1024/1024).toFixed(2)}MB) in ${Date.now()-start}ms`);

    if(stat.size < 100*1024){
      // File quá nhỏ (<100KB) là lỗi
      const content = fs.readFileSync(outPath, 'utf8').slice(0,500);
      console.error('[FastV3] Output too small, content:', content);
      throw new Error(`Output too small (${stat.size} bytes), ffmpeg likely failed. Check logs.`);
    }

    res.setHeader('Content-Type','video/mp4');
    res.setHeader('Content-Disposition',`attachment; filename="kara_${Date.now()}.mp4"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', ()=>{
      temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    });

  }catch(e){
    console.error('[FastV3] Error', e);
    temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    res.status(500).json({success:false, message:e.message});
  }
});

router.get('/health', (req,res)=>res.json({ok:true, ver:'v3-fix-24kb'}));

module.exports = router;
