import express, { Request, Response } from 'express';
import { getNewEtempmailAddress, readEtempmailInbox } from './etempmail';
import { closeBrowser, ensureBrowser } from './openChrome';
import { createImailEduAddress, readImailEduInbox } from './imailEdu';

type GmailNewBodyItem = {
    type?: 'etempmail' | 'imailedu';
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

        const browserInstance = await ensureBrowser();

        if (first.type === 'etempmail') {
            const result = await getNewEtempmailAddress(browserInstance);
            res.json({ status: 'ok', result });
            return;
        }

        // imailedu: mở https://imail.edu.vn/, chọn domain .edu, random user 15-20 ký tự và bấm "Tạo"
        const result = await createImailEduAddress(browserInstance);
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

        const browserInstance = await ensureBrowser();

        if (first.type === 'etempmail') {
            const result = await readEtempmailInbox(browserInstance, first.email);
            res.json({ status: 'ok', result });
            return;
        }

        // imailedu: đọc inbox từ imail.edu.vn
        const result = await readImailEduInbox(browserInstance, first.email);
        res.json({ status: 'ok', result });
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