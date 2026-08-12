const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Supabase env missing - some features will not work');
}

const supabaseAdmin = config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const supabaseAnon = config.SUPABASE_URL && config.SUPABASE_ANON_KEY
  ? createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
  : null;

module.exports = { supabaseAdmin, supabaseAnon };
