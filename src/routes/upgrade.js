// src/routes/upgrade.js - TẠO FILE MỚI
// Chứa toàn bộ API toggle gói nâng cấp, tách riêng khỏi index.js cho gọn

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../services/supabase');

const DEFAULT_PLANS = [
  { key: '1m', label: 'Gói 1 tháng', months: 1, price: 99000, enabled: true, is_custom: false, sort_order: 1 },
  { key: '3m', label: 'Gói 3 tháng', months: 3, price: 199000, enabled: true, is_custom: false, sort_order: 2 },
  { key: '6m', label: 'Gói 6 tháng', months: 6, price: 299000, enabled: true, is_custom: false, sort_order: 3 },
  { key: '12m', label: 'Gói 1 năm', months: 12, price: 499000, enabled: true, is_custom: false, sort_order: 4 },
];

let cache = null;
let cacheTime = 0;
let tabCache = true;
let tabCacheTime = 0;
const TTL = 60 * 1000;

async function getPlans(includeDisabled = false) {
  if (!supabaseAdmin) return { plans: DEFAULT_PLANS.filter(p=> includeDisabled || p.enabled), tabEnabled: true };
  let tabEnabled = true;
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('id','upgrade_tab_enabled').single();
    if (data?.value?.enabled !== undefined) tabEnabled = data.value.enabled;
  } catch {}
  let q = supabaseAdmin.from('upgrade_plans').select('*').order('sort_order');
  if (!includeDisabled) q = q.eq('enabled', true);
  const { data, error } = await q;
  if (error || !data || !data.length) return { plans: DEFAULT_PLANS.filter(p=> includeDisabled || p.enabled), tabEnabled };
  return { plans: data, tabEnabled };
}

// GET /api/upgrade-plans - public
router.get('/upgrade-plans', async (req, res) => {
  try {
    const now = Date.now();
    if (cache && (now - cacheTime) < TTL) {
      const hasEnabled = cache.some(p=>p.enabled);
      return res.json({ success: true, plans: cache.filter(p=>p.enabled), tabEnabled: tabCache && hasEnabled, cached: true });
    }
    const result = await getPlans(false);
    cache = result.plans;
    tabCache = result.tabEnabled;
    cacheTime = now;
    tabCacheTime = now;
    const hasEnabled = cache.some(p=>p.enabled);
    res.json({ success: true, plans: cache, tabEnabled: tabCache && hasEnabled });
  } catch (e) {
    res.json({ success: true, plans: DEFAULT_PLANS, tabEnabled: true, fallback: true });
  }
});

// GET /api/admin/upgrade-plans - admin full
router.get('/admin/upgrade-plans', async (req, res) => {
  try {
    const result = await getPlans(true);
    res.json({ success: true, plans: result.plans, tabEnabled: result.tabEnabled, hasEnabled: result.plans.some(p=>p.enabled) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/admin/upgrade-plans - admin save
router.post('/admin/upgrade-plans', async (req, res) => {
  try {
    const { plans, tabEnabled, deletedKeys } = req.body;
    if (!Array.isArray(plans)) return res.status(400).json({ success: false, message: 'plans must be array' });
    if (!supabaseAdmin) return res.status(500).json({ success: false, message: 'Supabase not configured' });

    for (let p of plans) {
      await supabaseAdmin.from('upgrade_plans').upsert({
        key: p.key,
        label: p.label || 'Gói custom',
        months: parseInt(p.months) || 1,
        price: parseInt(p.price) || 0,
        enabled: !!p.enabled,
        is_custom: !!p.is_custom,
        sort_order: parseInt(p.sort_order) || 0,
      }, { onConflict: 'key' });
    }
    if (Array.isArray(deletedKeys)) {
      for (let k of deletedKeys) {
        await supabaseAdmin.from('upgrade_plans').delete().eq('key', k).eq('is_custom', true);
      }
    }
    if (typeof tabEnabled === 'boolean') {
      await supabaseAdmin.from('app_settings').upsert({ id: 'upgrade_tab_enabled', value: { enabled: tabEnabled } }, { onConflict: 'id' });
    }
    cache = null;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
