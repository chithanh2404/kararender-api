// V4.2 - Trả về lỗi chi tiết khi output 48 bytes
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const router = express.Router();
router.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024*1024*800 } });

router.post('/fast-videobg', upload.fields([
  {name:'videobg', maxCount:1},
  {name:'audio', maxCount:1},
  {name:'sub', maxCount:1},
  {name:'logo', maxCount:1}
]), async (req,res)=>{
  const temps=[];
  let lastStderr='';
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

    let safeAssPath=null;
    let assContentDebug='';
    if(sub){
      let content = fs.readFileSync(sub.path,'utf8');
      assContentDebug = content.substring(0,500);
      // Loại bỏ ký tự có thể gây lỗi ass
      // Thay thế \ bằng / trong path? Không, giữ nguyên
      safeAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);
      fs.writeFileSync(safeAssPath, content, 'utf8');
      temps.push(safeAssPath);
    }

    console.log(`[V4.2] vb=${(vb.size/1024/1024).toFixed(1)}MB ass=${safeAssPath} logo=${!!logo}`);

    let cmdParts=[];
    cmdParts.push(`-i "${vb.path}"`);
    let logoIdx=-1, audioIdx=-1, nextIdx=1;
    if(logo){ cmdParts.push(`-i "${logo.path}"`); logoIdx=nextIdx++; }
    if(audio){ cmdParts.push(`-i "${audio.path}"`); audioIdx=nextIdx++; }

    let filters=[];
    let last='0:v';
    if(logo){
      if(logoW>0 && logoH>0) filters.push(`[${logoIdx}:v]scale=${logoW}:${logoH}[logo]`);
      else if(logoW>0) filters.push(`[${logoIdx}:v]scale=${logoW}:-1[logo]`);
      else filters.push(`[${logoIdx}:v]scale=200:-1[logo]`);
      filters.push(`[${last}][logo]overlay=${logoX}:${logoY}[withlogo]`);
      last='withlogo';
    }
    if(safeAssPath){
      const esc = safeAssPath.replace(/\\/g,'/').replace(/:/g,'\\:');
      if(filters.length>0){
        filters.push(`[${last}]ass=${esc}[final]`);
        last='final';
      }
    }

    let final=[...cmdParts];
    if(filters.length>0){
      final.push(`-filter_complex "${filters.join(';')}"`);
      final.push(`-map "[${last}]"`);
      if(audio) final.push(`-map ${audioIdx}:a`);
      else final.push(`-map 0:a?`);
    }else{
      if(safeAssPath){
        const esc = safeAssPath.replace(/\\/g,'/').replace(/:/g,'\\:');
        final.push(`-vf "ass=${esc}"`);
      }
      if(audio) final.push(`-map 0:v -map ${audioIdx}:a`);
    }

    final.push(`-c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart`);
    if(audio) final.push(`-shortest`);
    final.push(`-y "${outPath}"`);

    const fullCmd = `"${ffmpegStatic}" -y ${final.join(' ')}`;
    console.log('[CMD]', fullCmd);

    await new Promise((resolve, reject)=>{
      exec(fullCmd, {maxBuffer: 1024*1024*50}, (err, stdout, stderr)=>{
        lastStderr = stderr || '';
        console.log('[STDERR]', lastStderr.slice(-5000));
        console.log('[STDOUT]', stdout?.slice(-1000));
        if(err && !fs.existsSync(outPath)){
          reject(new Error(lastStderr.slice(-2000)));
        }else{
          // Dù có err nhưng file tồn tại thì vẫn coi là ok (ffmpeg hay warning)
          resolve();
        }
      });
    });

    if(!fs.existsSync(outPath)){
      throw new Error(`No output. FFmpeg: ${lastStderr.slice(-2000)}`);
    }
    const stat = fs.statSync(outPath);
    console.log(`[V4.2] Output ${stat.size} bytes`);

    if(stat.size < 1024){
      // Đọc file 48 bytes xem là gì
      let txt='';
      try{ txt = fs.readFileSync(outPath,'utf8'); }catch(e){ txt='binary'; }
      console.error(`[V4.2] Output too small ${stat.size}, content:`, txt);
      console.error(`[V4.2] ASS debug:`, assContentDebug);
      throw new Error(`Output too small ${stat.size} bytes. File content: "${txt}". FFmpeg stderr: ${lastStderr.slice(-3000)}. ASS head: ${assContentDebug.slice(0,200)}`);
    }

    res.setHeader('Content-Type','video/mp4');
    res.setHeader('Access-Control-Allow-Origin','*');
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', ()=>{ temps.forEach(p=>{ try{if(fs.existsSync(p)) fs.unlinkSync(p);}catch(e){} }); });

  }catch(e){
    console.error('[V4.2] Error', e);
    temps.forEach(p=>{ try{if(fs.existsSync(p)) fs.unlinkSync(p);}catch(e){} });
    res.status(500).json({success:false, message:e.message, stderr: lastStderr?.slice(-3000)});
  }
});

module.exports = router;
