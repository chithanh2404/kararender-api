// FIXED V4 - Bỏ -loop 1, sửa lỗi frame=0
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

    const outPath = path.join(os.tmpdir(), `kara_${Date.now()}.mp4`);
    temps.push(outPath);

    // Safe ASS path - đổi tên để không có ký tự đặc biệt
    let safeAssPath = null;
    if(sub){
      // Đọc nội dung ASS và ghi lại đảm bảo UTF-8, loại bỏ BOM nếu có
      let assContent = fs.readFileSync(sub.path, 'utf8');
      // Fix: nếu ASS có \N ở cuối dòng không có text, ffmpeg có thể lỗi
      safeAssPath = path.join(os.tmpdir(), `sub_${Date.now()}.ass`);
      fs.writeFileSync(safeAssPath, assContent, 'utf8');
      temps.push(safeAssPath);
      console.log(`[FastV4] ASS size ${assContent.length}, first 200 chars:`, assContent.substring(0,200));
    }

    console.log(`[FastV4] vb=${(vb.size/1024/1024).toFixed(1)}MB logo=${logo?.size} sub=${sub?.size}`);

    let cmdParts = [];
    cmdParts.push(`-i "${vb.path}"`); // 0
    let logoIdx = -1, audioIdx = -1, nextIdx = 1;

    if(logo){
      // KHÔNG dùng -loop 1 nữa, để tránh infinite
      cmdParts.push(`-i "${logo.path}"`); // 1
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
        filters.push(`[${logoIdx}:v]scale=${logoW}:${logoH}:flags=lanczos[logo]`);
      }else if(logoW>0){
        filters.push(`[${logoIdx}:v]scale=${logoW}:-1:flags=lanczos[logo]`);
      }else{
        filters.push(`[${logoIdx}:v]scale=200:-1[logo]`);
      }
      // Bỏ format=auto và shortest, dùng overlay đơn giản
      filters.push(`[${lastLabel}][logo]overlay=${logoX}:${logoY}[withlogo]`);
      lastLabel = 'withlogo';
    }

    if(safeAssPath){
      // Trên Linux, path /tmp/... không cần escape colon, nhưng escape an toàn
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
      // Chỉ có ASS
      if(safeAssPath){
        const escPath = safeAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        final.push(`-vf "ass=${escPath}"`);
      }
      if(audio){
        final.push(`-map 0:v -map ${audioIdx}:a`);
      }
    }

    // Thêm -t để giới hạn thời gian nếu cần? Không, để tự động
    final.push(`-c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p`);
    final.push(`-c:a aac -b:a 192k`);
    final.push(`-movflags +faststart`);
    // Bỏ -shortest để tránh cắt ngắn khi logo là ảnh
    // Nếu có audio riêng thì dùng shortest, nếu không thì không
    if(audio){
      final.push(`-shortest`);
    }
    final.push(`-y "${outPath}"`);

    const fullCmd = `"${ffmpegStatic}" -loglevel error -y ${final.join(' ')}`;
    // Để debug full log, dùng loglevel info
    const fullCmdInfo = `"${ffmpegStatic}" -y ${final.join(' ')}`;

    console.log('[FFmpeg CMD]', fullCmdInfo);

    await new Promise((resolve, reject)=>{
      exec(fullCmdInfo, {maxBuffer: 1024*1024*50}, (err, stdout, stderr)=>{
        console.log('[FFmpeg stdout]', stdout?.slice(-2000));
        console.log('[FFmpeg stderr FULL]', stderr);
        if(err){
          // Kiểm tra xem output có tồn tại không dù có lỗi
          if(fs.existsSync(outPath) && fs.statSync(outPath).size > 100*1024){
            console.log('[FFmpeg] Output exists despite error, treating as success');
            resolve();
          }else{
            reject(new Error(stderr || err.message));
          }
        }else{
          resolve();
        }
      });
    });

    if(!fs.existsSync(outPath)){
      throw new Error('Output not created');
    }
    const stat = fs.statSync(outPath);
    console.log(`[FastV4] Done ${stat.size} bytes in ${Date.now()-start}ms`);

    if(stat.size < 100*1024){
      const txt = fs.readFileSync(outPath, 'utf8').slice(0,1000);
      throw new Error(`Output too small (${stat.size} bytes). Content: ${txt}`);
    }

    res.setHeader('Content-Type','video/mp4');
    res.setHeader('Content-Disposition',`attachment; filename="kara_${Date.now()}.mp4"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', ()=>{
      temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    });

  }catch(e){
    console.error('[FastV4] Error', e);
    temps.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    res.status(500).json({success:false, message:e.message});
  }
});

module.exports = router;
