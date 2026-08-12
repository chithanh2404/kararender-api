// Client patch cho Blogger - thay thế jsonpRequest cũ bằng fetch tới Cloud Run mới
// Dán vào trước </body> trong theme Blogger, SAU khi định nghĩa GOOGLE_API_URL

(function(){
  const NEW_API_BASE = window['NEW_API_BASE'] || window['GOOGLE_API_URL']?.replace(/\/exec.*$/,'') || 'https://kararender-api-xxxx.run.app';

  // Hàm mới: gọi API bằng fetch có CORS, nhanh hơn JSONP
  window.karaApiRequest = async function(action, params = {}) {
    try {
      const url = new URL(`${NEW_API_BASE}/api/${action}`);
      // map action cũ sang endpoint mới
      const map = {
        'login': '/auth/login',
        'registerUser': '/auth/register',
        'sendOTP': '/auth/send-otp',
        'verifyAndResetPassword': '/auth/verify-and-reset',
        'getFonts': '/fonts',
        'getEffects': '/effects',
        'getStyleList': '/styles'
      };
      let endpoint = map[action] || `/${action}`;
      if (!endpoint.startsWith('/api')) endpoint = '/api' + endpoint;
      // Nếu action có sẵn trong map thì endpoint đã chuẩn
      if (map[action]) endpoint = '/api' + map[action];

      const res = await fetch(NEW_API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'KaraRender' },
        body: JSON.stringify(params)
      });
      return await res.json();
    } catch (e) {
      console.error('karaApiRequest error', e);
      // fallback về jsonp cũ nếu server mới chưa sẵn sàng
      return new Promise((resolve) => {
        window.jsonpRequest(action, params, (data) => resolve(data));
      });
    }
  };

  // Giữ nguyên jsonpRequest cũ cho tương thích, nhưng trỏ sang Cloud Run /exec
  const oldJsonp = window.jsonpRequest;
  window.jsonpRequest = function(action, params, callback) {
    // Nếu server mới trả về nhanh, dùng fetch
    if (action === 'getSecureRenderModule') {
      fetch(`${NEW_API_BASE}/api/secure-render?t=${Date.now()}&origin=${location.hostname}`)
        .then(r=>r.text())
        .then(txt=>callback(txt))
        .catch(()=> oldJsonp(action, params, callback));
      return;
    }
    return oldJsonp(action, params, callback);
  };

  console.log('[KaraRender] Client patch loaded, NEW_API_BASE=', NEW_API_BASE);
})();
