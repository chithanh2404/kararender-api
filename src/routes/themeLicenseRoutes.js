
import express from 'express';
import { verifyDomainAndGetKey, getAllowedDomains } from '../services/licenseService.js';

const router = express.Router();

router.post('/key', async (req, res) => {
  try {
    const { domain, fullUrl } = req.body;
    if (!domain) return res.status(400).json({ success: false, message: 'Missing domain' });

    const cleanDomain = domain.toLowerCase().replace(/^www\./, '').split(':')[0];
    const result = await verifyDomainAndGetKey(cleanDomain, fullUrl || `https://${domain}`);

    if (!result.allowed) {
      console.warn(`[License] DENIED domain: ${cleanDomain}`);
      return res.status(403).json({ success: false, message: 'Domain not licensed', domain: cleanDomain });
    }

    return res.json({ success: true, domain: cleanDomain, key: result.key, expiresAt: result.expiresAt });
  } catch (err) {
    console.error('[License] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
});

router.get('/domains', async (req, res) => {
  const domains = await getAllowedDomains();
  res.json({ success: true, domains });
});

export default router;
