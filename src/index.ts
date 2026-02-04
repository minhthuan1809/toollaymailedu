import express, { Request, Response } from 'express';
import type { Browser } from 'puppeteer';
import { getNewEtempmailAddress, readEtempmailInbox } from './etempmail';
import { closeBrowser, ensureBrowser, createNewBrowser } from './openChrome';
import { createImailEduAddress, readImailEduInbox } from './imailEdu';
import { closeBrowserByEmail, closeAllBrowsers } from './emailPageMap';

type GmailNewBodyItem = {
    type?: 'etempmail' | 'imailedu';
    other?: string[]; // Danh sách từ khóa cần loại bỏ (nếu email chứa các từ này thì bỏ qua)
};

type GmailReadBodyItem = {
    email?: string;
    type?: 'etempmail' | 'imailedu';
};

const PORT = Number(process.env.PORT ?? 5678);

const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

app.post('/api/gmail/new', async (req: Request<unknown, unknown, GmailNewBodyItem[]>, res: Response) => {
    try {
        const first = Array.isArray(req.body) && req.body.length > 0 ? req.body[0] : null;
        if (!first || (first.type !== 'etempmail' && first.type !== 'imailedu')) {
            res.status(400).json({
                status: 'error',
                message: 'Invalid body. Expected: [{ "type": "etempmail" | "imailedu" }]'
            });
            return;
        }

        // Tạo browser instance mới (mở cửa sổ Chrome mới) cho mỗi lần tạo email
        const browserInstance = await createNewBrowser();

        if (first.type === 'etempmail') {
            const other = first.other ?? [];
            const result = await getNewEtempmailAddress(browserInstance, other);
            res.json({ status: 'ok', result });
            return;
        }

        // imailedu: mở https://imail.edu.vn/, chọn domain .edu, random user 15-20 ký tự và bấm "Tạo"
        const excludeKeywords = first.other || [];
        const result = await createImailEduAddress(browserInstance, excludeKeywords);
        res.json({ status: 'ok', result });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ status: 'error', message });
    }
});

app.post('/api/gmail/read', async (req: Request<unknown, unknown, GmailReadBodyItem[]>, res: Response) => {
    try {
        const first = Array.isArray(req.body) && req.body.length > 0 ? req.body[0] : null;
        if (!first || (first.type !== 'etempmail' && first.type !== 'imailedu')) {
            res.status(400).json({
                status: 'error',
                message: 'Invalid body. Expected: [{ "type": "etempmail" | "imailedu", "email": "<your_email>" }]'
            });
            return;
        }

        // Không cần ensureBrowser vì sẽ tìm browser từ email đã register
        // Truyền null vì function sẽ tự tìm browser từ email
        if (first.type === 'etempmail') {
            const result = await readEtempmailInbox(null as unknown as Browser, first.email);
            res.json({ status: 'ok', result });
            return;
        }

        // imailedu: đọc inbox từ imail.edu.vn
        const result = await readImailEduInbox(null as unknown as Browser, first.email);
        res.json({ status: 'ok', result });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ status: 'error', message });
    }
});

const handleCloseEmail = async (email: string, res: Response): Promise<void> => {
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
        res.status(400).json({
            status: 'error',
            message: 'Email parameter is required'
        });
        return;
    }

    // Decode URL-encoded email (ví dụ: %40 thay vì @)
    let emailDecoded = email;
    try {
        emailDecoded = decodeURIComponent(email);
    } catch {
        // Nếu decode fail, dùng email gốc
        emailDecoded = email;
    }
    const emailTrimmed = emailDecoded.trim().toLowerCase();

    // Kiểm tra nếu là "all" thì đóng tất cả browsers
    if (emailTrimmed === 'all') {
        const closedCount = await closeAllBrowsers();
        res.json({ 
            status: 'ok', 
            message: `Đã đóng tất cả ${closedCount} cửa sổ browser` 
        });
        return;
    }

    // Đóng browser của email cụ thể
    const closed = await closeBrowserByEmail(emailTrimmed);
    
    if (closed) {
        res.json({ 
            status: 'ok', 
            message: `Đã đóng cửa sổ cho email: ${emailTrimmed}` 
        });
    } else {
        res.status(404).json({ 
            status: 'error', 
            message: `Không tìm thấy cửa sổ cho email: ${emailTrimmed}` 
        });
    }
};

// GET endpoint: /api/gmail/close/:email
app.get('/api/gmail/close/:email', async (req: Request, res: Response) => {
    try {
        const emailParam = req.params.email;
        const email = Array.isArray(emailParam) ? emailParam[0] : emailParam;
        await handleCloseEmail(email, res);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ status: 'error', message });
    }
});

// POST endpoint: /api/gmail/close/:email (hỗ trợ cả POST)
app.post('/api/gmail/close/:email', async (req: Request, res: Response) => {
    try {
        const emailParam = req.params.email;
        const email = Array.isArray(emailParam) ? emailParam[0] : emailParam;
        await handleCloseEmail(email, res);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ status: 'error', message });
    }
});

const start = (): void => {
    const server = app.listen(PORT, () => {
        console.log(`API server listening on port ${PORT}`);
    });

    const shutdown = async (): Promise<void> => {
        server.close();
        await closeBrowser();
    };

    process.on('SIGINT', () => {
        void shutdown().finally(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
        void shutdown().finally(() => process.exit(0));
    });
};

start();