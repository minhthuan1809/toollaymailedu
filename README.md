# Temp Mail Code API

API Express mở một cửa sổ Chrome tại [temp-mail.org](https://temp-mail.org/), lấy địa chỉ email tạm và chờ đọc mã xác minh từ thư đến.

## Chạy dự án

```bash
npm install
npm run dev
```

Mặc định API chạy tại `http://localhost:5678`.

## Lấy email mới

```http
GET /api/gmail/new
Content-Type: application/json

{}
```

Có thể mở trực tiếp `http://localhost:5678/api/gmail/new` trên trình duyệt. API cũng tiếp tục hỗ trợ phương thức `POST`.

Response:

```json
{
  "status": "ok",
  "result": {
    "url": "https://temp-mail.org/",
    "pageStatus": "opened",
    "email": "example@temporary-domain.com",
    "user": "example",
    "domain": "temporary-domain.com"
  }
}
```

Body cũ dạng `[{ "type": "tempmail" }]` vẫn có thể gửi; endpoint tạo email không còn cần trường `type`.

## Chờ và đọc code

```http
POST /api/gmail/read
Content-Type: application/json

{
  "email": "example@temporary-domain.com",
  "timeoutMs": 120000
}
```

API giữ request trong lúc chờ thư, tự làm mới inbox và trả về ngay khi tìm thấy mã 4–8 chữ số hoặc mã xác minh dạng chữ-số. `timeoutMs` là tùy chọn; mặc định 120 giây và cũng có thể đặt bằng biến môi trường `MAIL_WAIT_TIMEOUT_MS`.

Response:

```json
{
  "status": "ok",
  "result": {
    "email": "example@temporary-domain.com",
    "code": "123456",
    "message": {
      "sender": "service@example.com",
      "subject": "Your verification code",
      "text": "Your verification code is 123456",
      "code": "123456"
    },
    "pageStatus": "already-open"
  }
}
```

Endpoint cũng nhận body dạng mảng để tương thích client cũ:

```json
[{ "email": "example@temporary-domain.com", "timeoutMs": 120000 }]
```

## Đóng cửa sổ

```http
GET /api/gmail/close/example%40temporary-domain.com
GET /api/gmail/close/all
```

Có thể dùng `POST` với cùng URL. Cửa sổ Chrome phải còn mở thì API mới đọc được inbox tương ứng.

## Kiểm tra trạng thái

```http
GET /health
```
