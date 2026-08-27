const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { xorEncodeToBase64 } = require('../services/xor');
const { checkCorsGuard } = require('../middleware/domainGuard');
const { getFileContentAsString, listFilesInFolder } = require('../services/drive');

const router = express.Router();

// Cache module trong RAM - nhanh hơn đọc file mỗi lần
let cachedModule = null;
let cacheTime = 0;

async function getSecureRenderModuleContent() {
  // 1. Thử đọc từ file local ./secure-render-engine.js (khuyên dùng)
  try {
    const localPath = path.join(__dirname, '../../secure-render-engine.js');
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf-8');
      if (content.length > 100) return content;
    }
    const localPath2 = path.join(__dirname, '../secure-render-engine.html');
    if (fs.existsSync(localPath2)) {
      let html = fs.readFileSync(localPath2, 'utf-8');
      const match = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      if (match && match[1]) return match[1];
      return html;
    }
  } catch (e) {
    console.warn('Local secure module not found', e.message);
  }
  // 2. Từ Drive folder
  if (config.DRIVE.SECURE_RENDER_FOLDER_ID) {
    try {
      const files = await listFilesInFolder(config.DRIVE.SECURE_RENDER_FOLDER_ID);
      const target = files.find(f => f.name === 'secure-render-engine.js' || f.name === 'secure-render-engine.html');
      if (target) {
        const content = await getFileContentAsString(target.id);
        if (content) return content;
      }
    } catch (e) {
      console.warn('Drive secure module error', e.message);
    }
  }
  return null;
}

router.get('/', async (req, res) => {
  const guard = checkCorsGuard(req);
  if (guard.blocked && !guard.isDirect) {
    console.warn(`[SecureRender] BLOCKED domain: ${guard.source}`);
    return res.type('text/plain').send(`ERROR_DOMAIN_BLOCKED: Domain not allowed - ${guard.source}. Allowed: ${config.ALLOWED_HOSTS_STRICT.join(', ')}`);
  }

  try {
    let tsParam = req.query.t || req.query.ts || '0';
    let tkParam = req.query.tk || '';
    let originParam = req.query.origin || '';

    let ts = parseInt(tsParam, 10);
    const now = Date.now();
    if (!ts || isNaN(ts)) ts = now;
    if (ts > 1000000000 && ts < 1000000000000) ts = ts * 1000;
    if (ts < 1000000000000) ts = now;

    if (Math.abs(now - ts) > config.SECURE_TOKEN_MAX_AGE_MS) {
      console.log(`[SecureRender] Token old but allow: diff=${now-ts} origin=${originParam}`);
    }

    if (tkParam) {
      try {
        let tkPadded = tkParam;
        while (tkPadded.length % 4 !== 0) tkPadded += '=';
        tkPadded = tkPadded.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(tkPadded, 'base64').toString('utf-8');
        const parts = decoded.split('|');
        const tokenTs = parseInt(parts[1] || '0', 10);
        if (tokenTs && Math.abs(tokenTs - ts) > 60000) {
          console.log(`[SecureRender] Token ts mismatch: ${tokenTs} vs ${ts}`);
        }
      } catch (err) {
        console.log(`[SecureRender] Token decode failed: ${err.message}`);
      }
    }

    let jsContent = null;
    // dùng cache 5 phút
    if (cachedModule && Date.now() - cacheTime < 300000) {
      jsContent = cachedModule;
    } else {
      jsContent = await getSecureRenderModuleContent();
      if (jsContent) {
        cachedModule = jsContent;
        cacheTime = Date.now();
      }
    }

    if (!jsContent) {
      return res.type('text/plain').status(404).send('ERROR_MODULE_NOT_FOUND: secure-render-engine file not found');
    }

    let output;
    const xorKey = config.SECURE_XOR_SALT + '_' + ts.toString();
    const b64 = xorEncodeToBase64(jsContent, xorKey);
    output = b64.replace(/\r?\n/g, '').trim();

    if (Math.random() < 0.1) {
      console.log(`[SecureRender] Served ENC to ${originParam} len=${output.length}`);
    }

    res.type('text/plain').send(output);
  } catch (err) {
    console.error('[SecureRender] Exception', err);
    res.type('text/plain').status(500).send('ERROR_EXCEPTION: ' + err.toString());
  }
});

module.exports = router;
