const express = require('express');
const router = express.Router();

// Dependency: supabaseAdmin from services/supabase
function getSupabaseAdmin() {
  try {
    const { supabaseAdmin } = require('../services/supabase');
    return supabaseAdmin;
  } catch(e) {
    console.error('[karaProjects] supabaseAdmin not found', e.message);
    return null;
  }
}

function getUserEmail(req){
  const h = (req.headers['x-user-email'] || '').toString().toLowerCase().trim();
  const b = (req.body && req.body.email || '').toString().toLowerCase().trim();
  const q = (req.query && req.query.email || '').toString().toLowerCase().trim();
  return h || b || q;
}

// Middleware simple auth check
function requireEmail(req,res,next){
  const email = getUserEmail(req);
  if(!email) return res.status(401).json({success:false, message:'Missing X-User-Email header'});
  req.userEmail = email;
  next();
}

/**
 * POST /api/projects/save
 * body: { title, artist, data_json, id? (for update), duration, lyrics_count, thumbnail_url }
 */
router.post('/save', requireEmail, async (req,res)=>{
  try{
    const admin = getSupabaseAdmin();
    if(!admin) return res.status(500).json({success:false, message:'Supabase not configured'});
    const { id, title, artist, data_json, duration, lyrics_count, thumbnail_url } = req.body;
    if(!title) return res.status(400).json({success:false, message:'Missing title'});
    if(!data_json) return res.status(400).json({success:false, message:'Missing data_json'});

    if(id){
      // Update own project
      const { data, error } = await admin.from('kara_projects')
        .update({ title, artist, data_json, duration, lyrics_count, thumbnail_url })
        .eq('id', id)
        .eq('user_email', req.userEmail)
        .select().single();
      if(error) throw error;
      return res.json({success:true, project: data, message:'Updated'});
    } else {
      const { data, error } = await admin.from('kara_projects')
        .insert([{ user_email: req.userEmail, title, artist, data_json, duration: duration||0, lyrics_count: lyrics_count||0, thumbnail_url }])
        .select().single();
      if(error) throw error;
      return res.json({success:true, project: data, message:'Created'});
    }
  }catch(e){
    console.error('[karaProjects save]', e);
    res.status(500).json({success:false, message:e.message});
  }
});

/**
 * GET /api/projects/list?email=&search=&limit=50
 */
router.get('/list', requireEmail, async (req,res)=>{
  try{
    const admin = getSupabaseAdmin();
    if(!admin) return res.status(500).json({success:false, message:'Supabase not configured'});
    const search = (req.query.search||'').toString().trim();
    let q = admin.from('kara_projects').select('id,title,artist,duration,lyrics_count,thumbnail_url,created_at,updated_at').eq('user_email', req.userEmail).order('updated_at',{ascending:false}).limit(parseInt(req.query.limit)||50);
    if(search){
      q = q.ilike('title', `%${search}%`);
    }
    const { data, error } = await q;
    if(error) throw error;
    res.json({success:true, projects: data});
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});

/**
 * GET /api/projects/:id  -> full data
 */
router.get('/:id', requireEmail, async (req,res)=>{
  try{
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from('kara_projects').select('*').eq('id', req.params.id).eq('user_email', req.userEmail).single();
    if(error) throw error;
    if(!data) return res.status(404).json({success:false, message:'Not found'});
    res.json({success:true, project: data});
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});

/**
 * DELETE /api/projects/:id
 */
router.delete('/:id', requireEmail, async (req,res)=>{
  try{
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('kara_projects').delete().eq('id', req.params.id).eq('user_email', req.userEmail);
    if(error) throw error;
    res.json({success:true});
  }catch(e){
    res.status(500).json({success:false, message:e.message});
  }
});

module.exports = router;
