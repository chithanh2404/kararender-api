// Dịch vụ Drive - fixed v3.6 - hỗ trợ Shared Drive và debug chi tiết
const { google } = require('googleapis');
const config = require('../config');

let driveClient = null;
function getDriveClient() {
  if (driveClient) return driveClient;
  try {
    let credentials;
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      console.warn('[Drive] No GOOGLE_SERVICE_ACCOUNT_JSON env var');
      return null;
    }
    try {
      credentials = JSON.parse(raw);
    } catch (e) {
      // Thử parse khi env var bị escape \n
      try {
        const cleaned = raw.replace(/\\n/g, '\n');
        credentials = JSON.parse(cleaned);
      } catch (e2) {
        console.error('[Drive] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:', e2.message);
        console.error('[Drive] First 200 chars:', raw.substring(0,200));
        return null;
      }
    }
    console.log('[Drive] Service account loaded:', credentials.client_email);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  } catch (e) {
    console.error('[Drive] Init failed', e.message, e.stack);
    return null;
  }
}

async function listFilesInFolder(folderId) {
  const drive = getDriveClient();
  if (!drive) {
    console.warn('[Drive] getDriveClient returned null - cannot list');
    return [];
  }
  try {
    console.log(`[Drive] Listing files in folder: ${folderId}`);
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,createdTime)',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    const files = res.data.files || [];
    console.log(`[Drive] Found ${files.length} files in ${folderId}`);
    if (files.length > 0) console.log('[Drive] Sample:', files.slice(0,3).map(f=>f.name));
    return files;
  } catch (e) {
    console.error('[Drive] list error', e.message);
    if (e.response) console.error('[Drive] response data', JSON.stringify(e.response.data || {}).slice(0,500));
    // Thử lại với query không có supportsAllDrives
    try {
      console.log('[Drive] Retry without supportsAllDrives flag');
      const res2 = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType)',
        pageSize: 1000
      });
      return res2.data.files || [];
    } catch (e2) {
      console.error('[Drive] retry failed', e2.message);
      return [];
    }
  }
}

async function getFileContent(fileId) {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return res.data;
  } catch (e) {
    console.error('[Drive] get error', fileId, e.message);
    return null;
  }
}

async function getFileContentAsString(fileId) {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data).toString('utf-8');
  } catch (e) {
    console.error('[Drive] get string error', fileId, e.message);
    return null;
  }
}

module.exports = { getDriveClient, listFilesInFolder, getFileContent, getFileContentAsString };
