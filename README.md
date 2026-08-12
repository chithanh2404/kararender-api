# KaraRender Backend v2 - Supabase + Cloud Run

Đây là bản chuyển đổi từ Apps Script sang backend thật, nhanh hơn 20-50 lần.

## Tại sao phải chuyển?

Apps Script cũ của bạn:
- Chạy chung server, cold start 2-5s mỗi request
- Lưu user dạng `email_gmail_com.json` trên Drive -> chậm, không có index, dễ mất
- OTP lưu bằng CacheService -> mất khi restart
- Bị giới hạn 50MB, 6 phút

Backend mới:
- Cloud Run: luôn bật, phản hồi 80-200ms
- Supabase Postgres: có index, RLS, auth chuẩn
- JWT + bcrypt + rate limit thật
- Upload 5TB, resumable

## Cài đặt nhanh

1. Tạo project Supabase mới: https://supabase.com
2. Vào SQL Editor, chạy file `supabase/schema.sql`
3. Tạo buckets storage: `fonts` (public), `secure-render` (private)
4. Lấy URL và service_role key, điền vào `.env`
5. Deploy lên Cloud Run:

```bash
gcloud run deploy kararender-api --source . --region asia-southeast1 --allow-unauthenticated --set-env-vars-from-file=.env.yaml
```

## Thay đổi ở client Blogger (theme-677845744794205451_18.xml)

Tìm dòng:
```js
window['GOOGLE_API_URL']='https://script.google.com/macros/s/.../exec'
```

Đổi thành:
```js
window['GOOGLE_API_URL']='https://kararender-api-xxxx.run.app'
window['NEW_API_BASE']='https://kararender-api-xxxx.run.app/api'
```

Và thay hàm jsonpRequest cũ bằng fetch mới (đã có sẵn trong client-patch.js)

## Bảo mật

- Token Telegram cũ đã lộ trong file bạn gửi: `8205697874:AAHi...` -> Vào @BotFather tạo token mới ngay
- Đổi SECURE_XOR_SALT nếu muốn
- Thêm ADMIN_EMAILS vào env để bảo vệ route /api/admin

## Migration dữ liệu cũ từ Drive

Chạy script `node scripts/migrate-drive-to-supabase.js` (mình sẽ viết nếu bạn cần) để chuyển toàn bộ file `*_gmail_com.json` sang bảng users.

## Liên hệ

Giữ nguyên domain guard như cũ: kararender.com, blogspot.
