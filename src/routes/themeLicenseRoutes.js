
import express from 'express';
import { verifyDomainAndGetKey, getAllowedDomains, decryptPayload, getDecryptedConfig } from '../services/licenseService.js';

const router = express.Router();

// LEGACY: /key - vẫn giữ nhưng không nên dùng nữa vì lộ key
// Khuyên dùng /config
router.post('/key', async (req, res) => {
  try {
    const { domain, fullUrl } = req.body;
    if (!domain) return res.status(400).json({ success: false, message: 'Missing domain' });

    const cleanDomain = domain.toLowerCase().replace(/^www\./, '').split(':')[0];
    const result = await verifyDomainAndGetKey(cleanDomain, fullUrl || `https://${domain}`);

    if (!result.allowed) {
      return res.status(403).json({ success: false, message: 'Domain not licensed', domain: cleanDomain });
    }

    // CẢNH BÁO: endpoint này lộ key, chỉ để debug, không dùng production
    return res.json({ 
      success: true, 
      domain: cleanDomain, 
      key: result.key, 
      expiresAt: result.expiresAt,
      warning: 'This endpoint exposes secret key, use /config instead'
    });
  } catch (err) {
    console.error('[License] Error:', err);
    return res.status(500).json({ success: false, message: 'Internal error: ' + err.message });
  }
});

// SECURE: /config - Trả về link đã giải mã, KHÔNG trả key
// Đây là endpoint an toàn - key bí mật không bao giờ rời khỏi server
router.post('/config', async (req, res) => {
  try {
    const { domain, fullUrl } = req.body;
    if (!domain) return res.status(400).json({ success: false, message: 'Missing domain' });

    const cleanDomain = domain.toLowerCase().replace(/^www\./, '').split(':')[0];

    // Verify domain
    const { verifyDomainAndGetKey } = await import('../services/licenseService.js');
    const result = await verifyDomainAndGetKey(cleanDomain, fullUrl || `https://${domain}`);

    if (!result.allowed) {
      console.warn(`[License] DENIED domain: ${cleanDomain} | fullUrl: ${fullUrl}`);
      return res.status(403).json({ success: false, message: 'Domain not licensed', domain: cleanDomain });
    }

    // Lấy config đã giải mã sẵn (server-side decrypt)
    const config = await getDecryptedConfig();

    // Log để debug
    console.log(`[License] ALLOWED domain: ${cleanDomain} -> returning decrypted config`);

    // Chỉ trả về link, KHÔNG trả key
    return res.json({
      success: true,
      domain: cleanDomain,
      config: config, // { supabaseUrl, driveUrl, apiBase }
      expiresAt: result.expiresAt
    });
  } catch (err) {
    console.error('[License] /config Error:', err);
    return res.status(500).json({ success: false, message: 'Internal error: ' + err.message });
  }
});

router.get('/domains', async (req, res) => {
  try {
    const domains = await getAllowedDomains();
    res.json({ success: true, domains });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;
