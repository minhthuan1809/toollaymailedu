# API Documentation

Base URL: `http://localhost:5678` (hoặc port được cấu hình trong biến môi trường `PORT`)

---

## 1. Health Check

Kiểm tra server có đang chạy không.

**Endpoint:** `GET /health`

**JavaScript Example:**
```javascript
async function checkHealth() {
    const response = await fetch('http://localhost:5678/health');
    const data = await response.json();
    console.log(data);
    // Output: { status: 'ok' }
}

checkHealth();
```

---

## 2. Tạo Email Mới

Tạo một email tạm mới (etempmail hoặc imailedu).

**Endpoint:** `POST /api/gmail/new`

**Request Body:**
```json
[
    {
        "type": "etempmail" | "imailedu",
        "other": ["keyword1", "keyword2"]  // Optional: danh sách từ khóa cần loại bỏ
    }
]
```

**JavaScript Example:**

### Tạo Email Etempmail
```javascript
async function createEtempmail() {
    const response = await fetch('http://localhost:5678/api/gmail/new', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([
            {
                type: 'etempmail'
            }
        ])
    });
    
    const data = await response.json();
    console.log(data);
    // Output: { status: 'ok', result: { url: '...', email: '...', ... } }
    
    return data.result;
}

createEtempmail();
```

### Tạo Email ImailEdu
```javascript
async function createImailEdu() {
    const response = await fetch('http://localhost:5678/api/gmail/new', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([
            {
                type: 'imailedu'
            }
        ])
    });
    
    const data = await response.json();
    console.log(data);
    return data.result;
}

createImailEdu();
```

### Tạo Email ImailEdu Với Loại Bỏ Từ Khóa
```javascript
async function createImailEduWithExclude() {
    const response = await fetch('http://localhost:5678/api/gmail/new', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([
            {
                type: 'imailedu',
                other: ['spam', 'test', 'demo']  // Email chứa các từ này sẽ bị bỏ qua
            }
        ])
    });
    
    const data = await response.json();
    console.log(data);
    return data.result;
}

createImailEduWithExclude();
```

**Response Success:**
```json
{
    "status": "ok",
    "result": {
        "url": "https://...",
        "pageStatus": "opened",
        "domain": "example.edu.vn",
        "user": "randomuser123",
        "email": "randomuser123@example.edu.vn"
    }
}
```

**Response Error:**
```json
{
    "status": "error",
    "message": "Error message here"
}
```

---

## 3. Đọc Inbox

Đọc hộp thư đến của email đã tạo.

**Endpoint:** `POST /api/gmail/read`

**Request Body:**
```json
[
    {
        "type": "etempmail" | "imailedu",
        "email": "your-email@example.com"
    }
]
```

**JavaScript Example:**

### Đọc Inbox Etempmail
```javascript
async function readEtempmailInbox(email) {
    const response = await fetch('http://localhost:5678/api/gmail/read', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([
            {
                type: 'etempmail',
                email: email
            }
        ])
    });
    
    const data = await response.json();
    console.log(data);
    return data.result;
}

// Sử dụng
const email = 'user@etempmail.com';
readEtempmailInbox(email);
```

### Đọc Inbox ImailEdu
```javascript
async function readImailEduInbox(email) {
    const response = await fetch('http://localhost:5678/api/gmail/read', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([
            {
                type: 'imailedu',
                email: email
            }
        ])
    });
    
    const data = await response.json();
    console.log(data);
    return data.result;
}

// Sử dụng
const email = 'user@domain.edu.vn';
readImailEduInbox(email);
```

**Response Success:**
```json
{
    "status": "ok",
    "result": {
        "email": "user@example.com",
        "inbox": {
            "messages": [...],
            ...
        },
        "pageStatus": "already-open"
    }
}
```

**Response Error:**
```json
{
    "status": "error",
    "message": "Error message here"
}
```

---

## 4. Đóng Browser Của Email

Đóng cửa sổ browser của một email cụ thể.

**Endpoint:** `GET /api/gmail/close/:email` hoặc `POST /api/gmail/close/:email`

**JavaScript Example:**

### Dùng GET Request
```javascript
async function closeEmail(email) {
    // Encode email để tránh lỗi với ký tự đặc biệt như @
    const encodedEmail = encodeURIComponent(email);
    
    const response = await fetch(`http://localhost:5678/api/gmail/close/${encodedEmail}`, {
        method: 'GET'
    });
    
    const data = await response.json();
    console.log(data);
    return data;
}

// Sử dụng
const email = 'user@domain.edu.vn';
closeEmail(email);
```

### Dùng POST Request
```javascript
async function closeEmailPost(email) {
    const encodedEmail = encodeURIComponent(email);
    
    const response = await fetch(`http://localhost:5678/api/gmail/close/${encodedEmail}`, {
        method: 'POST'
    });
    
    const data = await response.json();
    console.log(data);
    return data;
}

// Sử dụng
const email = 'user@domain.edu.vn';
closeEmailPost(email);
```

**Response Success (200 OK):**
```json
{
    "status": "ok",
    "message": "Đã đóng cửa sổ cho email: user@domain.edu.vn"
}
```

**Response Error (404 Not Found):**
```json
{
    "status": "error",
    "message": "Không tìm thấy cửa sổ cho email: user@domain.edu.vn"
}
```

---

## Ví Dụ Hoàn Chỉnh

### Tạo Email, Đọc Inbox, Rồi Đóng
```javascript
async function fullExample() {
    try {
        // 1. Tạo email mới
        console.log('Bước 1: Tạo email mới...');
        const createResponse = await fetch('http://localhost:5678/api/gmail/new', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ type: 'imailedu' }])
        });
        const createData = await createResponse.json();
        
        if (createData.status !== 'ok') {
            throw new Error(createData.message);
        }
        
        const email = createData.result.email;
        console.log('Email đã tạo:', email);
        
        // 2. Đợi một chút rồi đọc inbox
        console.log('Bước 2: Đợi 3 giây rồi đọc inbox...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const readResponse = await fetch('http://localhost:5678/api/gmail/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ type: 'imailedu', email: email }])
        });
        const readData = await readResponse.json();
        
        if (readData.status === 'ok') {
            console.log('Inbox:', readData.result.inbox);
        }
        
        // 3. Đóng browser của email
        console.log('Bước 3: Đóng browser...');
        const encodedEmail = encodeURIComponent(email);
        const closeResponse = await fetch(`http://localhost:5678/api/gmail/close/${encodedEmail}`, {
            method: 'GET'
        });
        const closeData = await closeResponse.json();
        console.log(closeData.message);
        
    } catch (error) {
        console.error('Lỗi:', error.message);
    }
}

fullExample();
```

---

## Error Handling

```javascript
async function callAPIWithErrorHandling() {
    try {
        const response = await fetch('http://localhost:5678/api/gmail/new', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ type: 'imailedu' }])
        });
        
        const data = await response.json();
        
        if (data.status === 'error') {
            console.error('API Error:', data.message);
            return null;
        }
        
        return data.result;
        
    } catch (error) {
        console.error('Network Error:', error.message);
        return null;
    }
}

callAPIWithErrorHandling();
```
