// FAST VIDEOBG FULL - FIXED VERSION v2 - Sửa lỗi Invalid argument
// Thay thế file cũ src/routes/fastVideobg-simple.js hoặc fastVideobg-full.js

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

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

    const outPath = path.join(os.tmpdir(), `kara_full_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
    temps.push(outPath);

    console.log(`[FastFullFixed] vb=${vb.path} audio=${audio?.path} sub=${sub?.path} logo=${logo?.path} x=${logoX} y=${logoY} w=${logoW} h=${logoH}`);

    // Build ffmpeg command manually to avoid fluent-ffmpeg quirks
    // Escape ASS path for ffmpeg: replace \ with / and : with \:
    function escAss(p){
      // Trong filter ass, cần escape \ : ' 
      // Cách an toàn nhất: dùng single quote bao quanh path và escape bên trong
      let np = p.replace(/\\/g, '/');
      // ffmpeg ass filter: nếu path có dấu : thì phải escape \:
      // Nhưng nếu dùng trong filter_complex với = thì cần escape thêm
      // Để đơn giản, đổi tên file ass thành không có dấu cách và dùng trực tiếp
      return np.replace(/:/g, '\\:').replace(/'/g, "'\\''");
    }

    // Copy ass file to safe path without spaces
    let safeAssPath = null;
    if(sub){
      safeAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);
      fs.copyFileSync(sub.path, safeAssPath);
      temps.push(safeAssPath);
    }

    let cmdArgs = [];

    // Inputs
    cmdArgs.push(`-i "${vb.path}"`); // 0:v
    let inputIdx = 1;
    let logoInputIdx = -1;
    let audioInputIdx = -1;

    if(logo){
      cmdArgs.push(`-i "${logo.path}"`); // 1:v
      logoInputIdx = inputIdx++;
    }
    if(audio){
      cmdArgs.push(`-i "${audio.path}"`); // 2:a or 1:a
      audioInputIdx = inputIdx++;
    }

    // Build filter_complex
    let filterComplex = [];
    let lastLabel = '0:v';

    if(logo){
      // Scale logo if needed
      if(logoW>0 && logoH>0){
        filterComplex.push(`[${logoInputIdx}:v]scale=${logoW}:${logoH}[logo]`);
      }else if(logoW>0){
        filterComplex.push(`[${logoInputIdx}:v]scale=${logoW}:-1[logo]`);
      }else{
        filterComplex.push(`[${logoInputIdx}:v]copy[logo]`);
      }
      // Overlay
      filterComplex.push(`[${lastLabel}][logo]overlay=${logoX}:${logoY}:format=auto:shortest=1[withlogo]`);
      lastLabel = 'withlogo';
    }

    if(safeAssPath){
      const esc = escAss(safeAssPath);
      // Nếu đã có filter_complex thì nối tiếp ass vào
      if(filterComplex.length>0){
        filterComplex.push(`[${lastLabel}]ass=${esc}[final]`);
        lastLabel = 'final';
      }else{
        // Chỉ có ass, không logo -> dùng -vf thay vì -filter_complex cho đơn giản
        // Sẽ xử lý ở dưới
      }
    }

    let finalArgs = [...cmdArgs];

    if(filterComplex.length>0){
      finalArgs.push(`-filter_complex "${filterComplex.join(';')}"`);
      finalArgs.push(`-map "[${lastLabel}]"`);
      if(audio){
        finalArgs.push(`-map ${audioInputIdx}:a`);
      }else{
        // Giữ audio gốc của videobg nếu có
        finalArgs.push(`-map 0:a?`);
      }
    }else{
      // Không có filter_complex, chỉ có ass hoặc không có gì
      if(safeAssPath){
        const esc = escAss(safeAssPath);
        finalArgs.push(`-vf "ass=${esc}"`);
      }
      if(audio){
        finalArgs.push(`-map 0:v:0 -map ${audioInputIdx}:a`);
      }
      // Nếu không có audio riêng thì giữ nguyên
    }

    // Output codec - dùng veryfast để nhanh, crf 20 giữ chất lượng
    finalArgs.push(`-c:v libx264 -preset veryfast -crf 20`);
    finalArgs.push(`-c:a aac -b:a 192k`);
    finalArgs.push(`-movflags faststart -shortest`);
    finalArgs.push(`-y "${outPath}"`);

    const fullCmd = `"${ffmpegStatic}" ${finalArgs.join(' ')}`;
    console.log('[FFmpeg CMD]', fullCmd);

    await new Promise((resolve, reject)=>{
      exec(fullCmd, {maxBuffer: 1024*1024*20}, (err, stdout, stderr)=>{
        console.log('[FFmpeg stdout]', stdout?.substring(0,1000));
        console.log('[FFmpeg stderr]', stderr?.substring(0,2000));
        if(err){
          console.error('[FFmpeg error]', err);
          reject(new Error(`ffmpeg failed: ${stderr?.substring(0,1000)} - ${err.message}`));
        }else resolve();
      });
    });

    if(!fs.existsSync(outPath)) throw new Error('Output not created');

    const stat = fs.statSync(outPath);
    console.log(`[FastFullFixed] Done ${stat.size} bytes in ${Date.now()-start}ms`);

    res.setHeader('Content-Type','video/mp4');
    res.setHeader('Content-Disposition',`attachment; filename="kara_full_${Date.now()}.mp4"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', ()=>{
      temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    });
    stream.on('error', (e)=>{
      console.error('Stream error', e);
      res.status(500).end();
    });

  }catch(e){
    console.error('[FastFullFixed] Exception', e);
    temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    res.status(500).json({success:false, message:e.message, stack:e.stack?.substring(0,2000)});
  }
});

// Health check
router.get('/health', (req,res)=>res.json({ok:true, version:'fixed-v2'}));

module.exports = router;
