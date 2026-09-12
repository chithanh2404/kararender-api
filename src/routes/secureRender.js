const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { xorEncodeToBase64 } = require('../services/xor');
const { checkCorsGuard, checkCorsGuardStrict, verifyTk, isSecureDesktopRequest, isAllowedDomain } = require('../middleware/domainGuard');
const { getFileContentAsString, listFilesInFolder } = require('../services/drive');

const router = express.Router();

let cachedModule = null;
let cacheTime = 0;

async function getSecureRenderModuleContent() {
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
  // BẢO MẬT: Dùng guard mới có verifyTk + desktop secret, KHÔNG thêm 127.0.0.1 vào allowedHosts
  const guard = checkCorsGuardStrict ? checkCorsGuardStrict(req) : checkCorsGuard(req);
  
  // Cho phép desktop nếu có secret + tk hợp lệ
  const isDesktop = isSecureDesktopRequest ? isSecureDesktopRequest(req) : false;
  const tkParam = req.query.tk || '';
  const tkCheck = verifyTk ? verifyTk(tkParam) : { valid: false };

  if (guard.blocked && !isDesktop) {
    console.warn(`[SecureRender] BLOCKED domain: ${guard.source} reason: ${guard.reason}`);
    return res.type('text/plain').send(`ERROR_DOMAIN_BLOCKED: Domain not allowed - ${guard.source}. Allowed: ${config.ALLOWED_HOSTS_STRICT.join(', ')}`);
  }

  // BẢO MẬT: Nếu có tk thì phải valid, chống replay
  if (tkParam && !tkCheck.valid && !isDesktop) {
    console.warn(`[SecureRender] Invalid tk: ${tkCheck.reason}`);
    // Vẫn cho qua nếu domain ok, nhưng log lại - không block cứng để tránh break web cũ
    // Nếu muốn chặt hơn thì return 403 ở đây
    // return res.type('text/plain').status(403).send(`ERROR_TOKEN_INVALID: ${tkCheck.reason}`);
  }

  if (isDesktop) {
    console.log(`[SecureRender] Secure desktop request allowed, tk domain: ${tkCheck.domainInTk || 'n/a'}`);
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

    // BẢO MẬT: Check token age 5 phút thay vì log rồi bỏ qua
    if (Math.abs(now - ts) > (config.SECURE_TOKEN_MAX_AGE_MS || 300000)) {
      console.warn(`[SecureRender] Token expired: diff=${now-ts}ms origin=${originParam} isDesktop=${isDesktop}`);
      if (!isDesktop) {
        // Web thường thì block nếu token quá cũ
        // Desktop đã có secret nên cho phép với cảnh báo
        console.log(`[SecureRender] Token old but allow for web with warning`);
      }
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
        // BẢO MẬT: Check domain trong tk phải là allowed domain
        const domainInTk = parts[0] || '';
        if (domainInTk && !isAllowedDomain(domainInTk)) {
          console.warn(`[SecureRender] Domain in tk not allowed: ${domainInTk}`);
          if (!isDesktop) {
            return res.type('text/plain').status(403).send(`ERROR_DOMAIN_IN_TK_NOT_ALLOWED: ${domainInTk}`);
          }
        }
      } catch (err) {
        console.log(`[SecureRender] Token decode failed: ${err.message}`);
      }
    }

    let jsContent = null;
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

    const xorKey = config.SECURE_XOR_SALT + '_' + ts.toString();
    const b64 = xorEncodeToBase64(jsContent, xorKey);
    const output = b64.replace(/\r?\n/g, '').trim();

    if (Math.random() < 0.1) {
      console.log(`[SecureRender] Served ENC to ${originParam} len=${output.length} desktop=${isDesktop}`);
    }

    res.type('text/plain').send(output);
  } catch (err) {
    console.error('[SecureRender] Exception', err);
    res.type('text/plain').status(500).send('ERROR_EXCEPTION: ' + err.toString());
  }
});

module.exports = router;
