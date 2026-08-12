// Dịch vụ Drive - ban đầu vẫn đọc từ Drive để migration, sau đó chuyển sang Supabase Storage
const { google } = require('googleapis');
const config = require('../config');

let driveClient = null;
function getDriveClient() {
  if (driveClient) return driveClient;
  try {
    let credentials;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // file path handled by googleapis default
    } else {
      console.warn('[Drive] No service account - Drive features disabled');
      return null;
    }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  } catch (e) {
    console.error('[Drive] Init failed', e);
    return null;
  }
}

async function listFilesInFolder(folderId) {
  const drive = getDriveClient();
  if (!drive) return [];
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType)',
      pageSize: 1000
    });
    return res.data.files || [];
  } catch (e) {
    console.error('[Drive] list error', e.message);
    return [];
  }
}

async function getFileContent(fileId) {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const res = await drive.files.get({ fileId, alt: 'media' });
    return res.data;
  } catch (e) {
    console.error('[Drive] get error', e.message);
    return null;
  }
}

async function getFileContentAsString(fileId) {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data).toString('utf-8');
  } catch (e) {
    console.error('[Drive] get string error', e.message);
    return null;
  }
}

module.exports = { getDriveClient, listFilesInFolder, getFileContent, getFileContentAsString };
