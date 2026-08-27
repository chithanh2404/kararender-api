// backend/routes/fastVideobg-simple.js
// BẢN GỘP - KHÔNG CẦN TẠO THÊM THƯ MỤC config
// Chỉ cần file này + cài npm là chạy
// npm i fluent-ffmpeg ffmpeg-static multer

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

const router = express.Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024*1024*500 } });

let hasNvenc = null;
function checkNvenc(){
  if(hasNvenc!==null) return Promise.resolve(hasNvenc);
  return new Promise(res=>{
    exec(`"${ffmpegStatic}" -hwaccels`, (err, out)=>{
      exec(`"${ffmpegStatic}" -encoders`, (e2, out2)=>{
        hasNvenc = out && out.toLowerCase().includes('cuda') && out2.includes('h264_nvenc');
        res(hasNvenc);
      });
    });
  });
}

// POST /api/render/fast-videobg
// FormData: videobg (mp4), audio (mp3 optional), sub (.ass optional), mode=copy|burn
router.post('/fast-videobg', upload.fields([{name:'videobg', maxCount:1},{name:'audio', maxCount:1},{name:'sub', maxCount:1}]), async (req,res)=>{
  try{
    const vb = req.files?.videobg?.[0];
    if(!vb) return res.status(400).json({success:false, message:'Thieu videobg'});
    const audio = req.files?.audio?.[0];
    const sub = req.files?.sub?.[0];
    const mode = (req.body.mode || (sub ? 'burn' : 'copy')).toLowerCase();
    const out = path.join(os.tmpdir(), `kara_${Date.now()}.mp4`);

    await new Promise((resolve, reject)=>{
      let cmd = ffmpeg().input(vb.path);
      if(audio) cmd = cmd.input(audio.path);

      if(mode==='copy' && !sub){
        // COPY - giữ nguyên videobg, nhanh tức thì
        cmd.outputOptions(['-c:v','copy','-c:a','aac','-shortest','-movflags','faststart']);
      }else{
        // BURN - burn sub.ass
        checkNvenc().then(useNvenc=>{
          if(sub){
            const esc = sub.path.replace(/\\/g,'/').replace(/:/g,'\\:');
            cmd = cmd.videoFilters(`ass=${esc}`);
          }
          if(useNvenc){
            cmd.outputOptions(['-c:v','h264_nvenc','-preset','p1','-cq','23','-c:a','aac','-movflags','faststart']);
          }else{
            cmd.outputOptions(['-c:v','libx264','-preset','ultrafast','-crf','23','-threads','0','-c:a','aac','-movflags','faststart']);
          }
          cmd.on('error', reject).on('end', resolve).save(out);
        });
        return;
      }
      cmd.on('error', reject).on('end', resolve).save(out);
    });

    res.setHeader('Content-Type','video/mp4');
    const stream = fs.createReadStream(out);
    stream.pipe(res);
    stream.on('end', ()=>{
      [vb.path, req.files?.audio?.[0]?.path, req.files?.sub?.[0]?.path, out].forEach(p=>{
        if(p && fs.existsSync(p)) try{fs.unlinkSync(p);}catch(e){}
      });
    });
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});

router.get('/health', (req,res)=> res.json({ok:true, mode:['copy','burn']}));

module.exports = router;

// CÁCH DÙNG TRONG index_9.js:
// const fastVideobgRouter = require('./routes/fastVideobg-simple');
// app.use('/api/render', fastVideobgRouter);
