// FAST VIDEOBG FULL - hỗ trợ logo + title + marquee + countdown via ASS
// Thay thế file src/routes/fastVideobg-simple.js hiện tại

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

let hasNvenc = null;
async function checkNvenc(){
  if(hasNvenc!==null) return hasNvenc;
  return new Promise(res=>{
    exec(`"${ffmpegStatic}" -hwaccels`, (err, stdout)=>{
      hasNvenc = stdout && stdout.includes('cuda');
      exec(`"${ffmpegStatic}" -encoders | grep nvenc`, (e2, out2)=>{
        if(out2 && out2.includes('h264_nvenc')) hasNvenc = true;
        res(hasNvenc);
      });
    });
  });
}

function escapeAssPath(p){
  return p.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''");
}

router.get('/health', (req,res)=> res.json({ok:true, mode:['copy','burn','burn-full'], hasNvenc}));

router.post('/fast-videobg', upload.fields([
  {name:'videobg', maxCount:1},
  {name:'audio', maxCount:1},
  {name:'sub', maxCount:1},
  {name:'logo', maxCount:1}
]), async (req,res)=>{
  const startTime = Date.now();
  let tempFiles = [];
  try{
    const videobgFile = req.files?.videobg?.[0];
    if(!videobgFile) return res.status(400).json({success:false, message:'Missing videobg'});
    const audioFile = req.files?.audio?.[0];
    const subFile = req.files?.sub?.[0];
    const logoFile = req.files?.logo?.[0];
    
    const mode = (req.body.mode || (subFile ? 'burn' : 'copy')).toLowerCase();
    const logoX = parseInt(req.body.logoX) || 50;
    const logoY = parseInt(req.body.logoY) || 50;
    const logoW = parseInt(req.body.logoW) || 200;
    const logoH = parseInt(req.body.logoH) || 0; // 0 = auto
    const logoOpacity = parseFloat(req.body.logoOpacity) || 1.0;

    tempFiles.push(videobgFile.path);
    if(audioFile) tempFiles.push(audioFile.path);
    if(subFile) tempFiles.push(subFile.path);
    if(logoFile) tempFiles.push(logoFile.path);

    const outputPath = path.join(os.tmpdir(), `kara_full_${Date.now()}.mp4`);
    tempFiles.push(outputPath);

    console.log(`[FastFull] mode=${mode} logo=${!!logoFile} sub=${!!subFile} logoPos=${logoX},${logoY} ${logoW}x${logoH}`);

    await new Promise((resolve, reject)=>{
      let cmd = ffmpeg();
      cmd.input(videobgFile.path);
      let filterComplex = [];
      let inputs = 1;
      let lastVideoLabel = '[0:v]';

      // Nếu có logo thì add input thứ 2
      if(logoFile){
        cmd.input(logoFile.path);
        // Scale logo nếu cần, giữ aspect nếu h=0
        let scaleFilter = '';
        if(logoW>0 && logoH>0){
          scaleFilter = `scale=${logoW}:${logoH}`;
        }else if(logoW>0){
          scaleFilter = `scale=${logoW}:-1`;
        }
        // Overlay với opacity
        if(scaleFilter){
          filterComplex.push(`[1:v]${scaleFilter}${logoOpacity<1?`,format=rgba,colorchannelmixer=aa=${logoOpacity}`:''}[logo]`);
          filterComplex.push(`${lastVideoLabel}[logo]overlay=${logoX}:${logoY}:format=auto:shortest=1[withlogo]`);
        }else{
          if(logoOpacity<1){
            filterComplex.push(`[1:v]format=rgba,colorchannelmixer=aa=${logoOpacity}[logo]`);
            filterComplex.push(`${lastVideoLabel}[logo]overlay=${logoX}:${logoY}[withlogo]`);
          }else{
            filterComplex.push(`${lastVideoLabel}[1:v]overlay=${logoX}:${logoY}[withlogo]`);
          }
        }
        lastVideoLabel = '[withlogo]';
        inputs++;
      }

      // Nếu có sub ASS thì burn sau cùng
      if(subFile && mode!=='copy'){
        const escapedSub = escapeAssPath(subFile.path);
        // Dùng filter_complex nếu đã có logo, không thì dùng videoFilters
        if(filterComplex.length>0){
          filterComplex.push(`${lastVideoLabel}ass=${escapedSub}[final]`);
          lastVideoLabel = '[final]';
        }
      }

      if(audioFile){
        cmd.input(audioFile.path);
      }

      // Build final filters
      if(filterComplex.length>0){
        cmd.complexFilter(filterComplex);
        cmd.map(lastVideoLabel);
        if(audioFile){
          cmd.map(`${inputs}:a`); // audio là input cuối
        }else{
          // Nếu videobg gốc đã có audio và không có audio mới, giữ audio gốc
          // Nếu copy mode thì giữ, burn mode nếu có audio mới thì dùng audio mới
          if(!audioFile){
            // Kiểm tra xem videobg có audio không, nếu có thì map 0:a nếu tồn tại
            // Để đơn giản, không map audio gốc nếu có logo filter - sẽ tự động?
            // Fluent-ffmpeg cần map audio riêng nếu complex filter đã dùng
            // Thử map audio gốc nếu tồn tại
          }
        }
      }else{
        // Không có logo, chỉ có sub
        if(subFile && mode!=='copy'){
          const escapedSub = escapeAssPath(subFile.path);
          cmd.videoFilters(`ass=${escapedSub}`);
        }
      }

      if(mode==='copy' && !subFile && !logoFile){
        cmd.outputOptions(['-c:v','copy','-c:a','aac','-shortest','-movflags','faststart']);
      }else{
        const useNvenc = false; // Tắt NVENC trên Railway để ổn định, bật nếu có GPU: await checkNvenc()
        if(useNvenc){
          cmd.outputOptions(['-c:v','h264_nvenc','-preset','p1','-rc','vbr','-cq','23','-c:a','aac','-b:a','192k','-movflags','faststart','-shortest']);
        }else{
          cmd.outputOptions(['-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','192k','-movflags','faststart','-shortest']);
        }
        // Nếu có audio file riêng thì cần mapping audio
        if(audioFile && filterComplex.length===0 && !subFile){
          cmd.outputOptions(['-shortest']);
        }
        if(audioFile){
          // Nếu đã dùng complex filter thì audio đã map, nếu chưa thì cần đảm bảo
          if(filterComplex.length===0){
            // Trường hợp chỉ có videobg + audio + sub (không logo) thì fluent sẽ tự map
          }
        }
      }

      // Fix audio mapping khi có complex filter
      if(filterComplex.length>0){
        if(audioFile){
          // đã map ở trên
        }else{
          // Thử giữ audio gốc của videobg nếu có
          cmd.outputOptions(['-map','0:a?']); // ? nghĩa là optional
        }
      }

      cmd.on('start', c=>console.log('[FFmpeg]', c))
         .on('error', e=>{console.error(e); reject(e);})
         .on('end', ()=>resolve())
         .save(outputPath);
    });

    const stat = fs.statSync(outputPath);
    console.log(`[FastFull] Done ${stat.size} in ${Date.now()-startTime}ms`);
    res.setHeader('Content-Type','video/mp4');
    res.setHeader('Content-Disposition',`attachment; filename="kara_full_${Date.now()}.mp4"`);
    res.setHeader('X-Render-Time', Date.now()-startTime);
    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('end', ()=>{
      tempFiles.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    });
  }catch(e){
    console.error('[FastFull] Error', e);
    tempFiles.forEach(p=>{ if(p&&fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){} });
    res.status(500).json({success:false, message:e.message});
  }
});

// API tạo ASS full từ JSON
router.post('/ass-full', express.json({limit:'10mb'}), (req,res)=>{
  const { lyrics, title, composer, singer, countdown, marquee, watermark, width=1920, height=1080, titleDuration=8 } = req.body;

  function toAssTime(sec){
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60), cs = Math.floor((sec%1)*100);
    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }

  let ass = `[Script Info]
Title: ${title||'KaraRender Full'}
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,2,2,10,10,10,1
Style: TitleMain,Arial Black,90,&H00FFFF00,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,3,5,10,10,300,1
Style: TitleSub,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1
Style: Countdown,Arial Black,150,&H0000FFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,5,3,5,10,10,10,1
Style: Marquee,Arial,45,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0000000,1,0,0,0,100,100,0,0,1,2,1,2,10,10,20,1
Style: Watermark,Arial,22,&H80FFFFFF,&H80FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,3,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Title 0-8s
  if(title){
    const t = (title||'').toUpperCase().replace(/\n/g,'\\N');
    ass += `Dialogue: 1,0:00:00.00,0:00:${String(titleDuration).padStart(2,'0')}.00,TitleMain,,0,0,0,,{\\pos(${width/2},${height*0.25})\\an5\\fad(300,500)}${t}\n`;
    if(composer) ass += `Dialogue: 1,0:00:00.50,0:00:${titleDuration}.00,TitleSub,,0,0,0,,{\\pos(${width/2},${height*0.25+90})\\an5\\fad(300,500)}${composer.replace(/\n/g,'\\N')}\n`;
    if(singer) ass += `Dialogue: 1,0:00:01.00,0:00:${titleDuration}.00,TitleSub,,0,0,0,,{\\pos(${width/2},${height*0.25+140})\\an5\\fad(300,500)}${singer.replace(/\n/g,'\\N')}\n`;
  }

  // Countdown
  if(countdown && countdown.enabled){
    let cur = 0;
    const sec = countdown.seconds||5;
    for(let i=sec;i>0;i--){
      ass += `Dialogue: 2,${toAssTime(cur)},${toAssTime(cur+1)},Countdown,,0,0,0,,{\\pos(${width/2},${height/2})\\an5\\fad(100,100)}${i}\n`;
      cur+=1;
    }
  }

  // Marquee
  if(marquee && marquee.enabled && marquee.text){
    const start = marquee.startTime||0;
    const end = marquee.endTime||9999;
    // ASS move: \move(x1,y1,x2,y2)
    const y = marquee.y || Math.round(height*0.92);
    ass += `Dialogue: 1,${toAssTime(start)},${toAssTime(end)},Marquee,,0,0,0,,{\\move(${width+200},${y},${-800},${y})}${marquee.text.replace(/\n/g,' ')}\n`;
  }

  // Watermark
  if(watermark && watermark.text){
    ass += `Dialogue: 0,0:00:00.00,9:59:59.00,Watermark,,0,0,0,,{\\pos(${width-20},${height-20})\\an3}${watermark.text}\n`;
  }

  // Lyrics
  if(lyrics && Array.isArray(lyrics)){
    lyrics.forEach(l=>{
      const txt = (l.text||'').replace(/\n/g,'\\N');
      if(!txt) return;
      ass += `Dialogue: 0,${toAssTime(l.start)},${toAssTime(l.end)},Default,,0,0,0,,${txt}\n`;
    });
  }

  res.json({success:true, ass});
});

module.exports = router;
