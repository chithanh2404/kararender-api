function xorEncodeToBase64(str, key) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const keyBytes = encoder.encode(key);
    const xored = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      xored[i] = data[i] ^ (keyBytes[i % keyBytes.length] & 0xFF);
    }
    return Buffer.from(xored).toString('base64');
  } catch (e) {
    console.error('xorEncode fail', e);
    return Buffer.from(str, 'utf-8').toString('base64');
  }
}

function xorDecodeFromBase64(b64, key) {
  try {
    const xored = Buffer.from(b64, 'base64');
    const keyBytes = new TextEncoder().encode(key);
    const decoded = new Uint8Array(xored.length);
    for (let i = 0; i < xored.length; i++) {
      decoded[i] = xored[i] ^ (keyBytes[i % keyBytes.length] & 0xFF);
    }
    return new TextDecoder().decode(decoded);
  } catch (e) {
    console.error('xorDecode fail', e);
    return null;
  }
}

module.exports = { xorEncodeToBase64, xorDecodeFromBase64 };
