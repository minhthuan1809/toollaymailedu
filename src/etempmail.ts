import type { Browser, Page, HTTPResponse } from 'puppeteer';
import { ensureBrowser, ensurePageViewport } from './openChrome';
import { registerEmailBrowser, getPageByEmail, getBrowserByEmail } from './emailPageMap';

export type EtempmailResult = {
    url: string;
    email: string;
    pageStatus: 'opened' | 'already-open';
};

export type EtempmailMessage = {
    subject?: string;
    from?: string;
    time?: string;
    snippet?: string;
    text?: string;
};

const ETEMPMAIL_URL = 'https://etempmail.com/email?id=1';
const DELETE_EMAIL_BUTTON_SELECTOR = '#deleteEmailAddress';

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const extractPrimaryEmail = async (page: Page): Promise<string | null> => {
    // Ưu tiên ô input chính giữa trang (địa chỉ email hiện tại), tránh dính email mẫu như test@test.com
    return page.evaluate((regexSource: string) => {
        const regex = new RegExp(regexSource, 'i');

        // Các selector ưu tiên cho ô input chứa email hiện tại
        const candidates: Array<HTMLInputElement | HTMLElement | null> = [
            document.querySelector('input[type="text"]'),
            document.querySelector('input[type="email"]'),
            document.querySelector('input[aria-label*="mail"]'),
            document.querySelector('input[id*="mail"], input[id*="email"]'),
            document.querySelector('[data-clipboard-text]'),
            document.querySelector('[data-email]')
        ];

        for (const el of candidates) {
            if (!el) continue;
            const raw =
                (el as HTMLInputElement).value ??
                el.getAttribute?.('data-clipboard-text') ??
                el.getAttribute?.('data-email') ??
                el.textContent ??
                '';
            if (typeof raw !== 'string') continue;
            const match = raw.match(regex);
            if (match && match[0]) return match[0];
        }
        return null;
    }, EMAIL_REGEX.source);
};

const findEmailInText = (text: string): string | null => {
    const match = text.match(EMAIL_REGEX);
    return match ? match[0] : null;
};

const extractEmailCandidates = async (page: Page): Promise<string[]> => {
    return page.evaluate((regexSource: string) => {
        const regex = new RegExp(regexSource, 'i');
        const emails = new Set<string>();
        const addIfEmail = (val: unknown) => {
            if (typeof val !== 'string') return;
            const m = val.match(regex);
            if (m && m[0]) emails.add(m[0]);
        };

        addIfEmail(document.body?.innerText ?? '');

        document.querySelectorAll('input,textarea').forEach((el) => {
            const value = (el as HTMLInputElement | HTMLTextAreaElement).value;
            addIfEmail(value);
            addIfEmail(el.getAttribute('value'));
        });

        document
            .querySelectorAll('[data-clipboard-text],[data-clipboard-target]')
            .forEach((el) => {
                addIfEmail(el.getAttribute('data-clipboard-text'));
                addIfEmail(el.getAttribute('data-clipboard-target'));
                addIfEmail(el.textContent ?? '');
            });

        document.querySelectorAll('[id*="mail"],[id*="email"],[class*="mail"],[class*="email"]').forEach((el) => {
            addIfEmail(el.textContent ?? '');
            addIfEmail((el as HTMLElement).innerText ?? '');
        });

        return Array.from(emails);
    }, EMAIL_REGEX.source);
};

const extractEmailFromPage = async (page: Page): Promise<string | null> => {
    // Ưu tiên ô input chính, sau đó fallback quét toàn trang
    const primary = await extractPrimaryEmail(page);
    if (primary) return primary;

    const candidates = await extractEmailCandidates(page);
    return candidates.length > 0 ? candidates[0] : null;
};

const findOpenPageByExactUrl = async (
    browserInstance: Browser,
    targetUrl: string
): Promise<Page | null> => {
    const pages = await browserInstance.pages();
    for (const p of pages) {
        try {
            const url = p.url();
            if (url === targetUrl) return p;
        } catch {
            continue;
        }
    }
    return null;
};

const findAnyOpenPage = async (browserInstance: Browser): Promise<Page | null> => {
    const pages = await browserInstance.pages();
    for (const p of pages) {
        try {
            // truy cập url để chắc chắn page còn sống
            await p.url();
            return p;
        } catch {
            continue;
        }
    }
    return null;
};

export const ensureEtempmailPage = async (
    browserInstance: Browser,
    forceNew = false
): Promise<{ page: Page; pageStatus: EtempmailResult['pageStatus'] }> => {
    // Nếu forceNew = true, luôn tạo page mới (dùng khi tạo email mới)
    if (forceNew) {
        const page = await browserInstance.newPage();
        await ensurePageViewport(page);
        await page.goto(ETEMPMAIL_URL, { waitUntil: 'domcontentloaded' });
        return { page, pageStatus: 'opened' };
    }

    // Nếu không forceNew, reuse page nếu có (dùng khi đọc inbox)
    const existing = await findOpenPageByExactUrl(browserInstance, ETEMPMAIL_URL);
    if (existing) {
        await existing.bringToFront();
        return { page: existing, pageStatus: 'already-open' };
    }

    // reuse any open tab if available to avoid spawning extra blank tabs
    const anyOpen = await findAnyOpenPage(browserInstance);
    if (anyOpen) {
        await anyOpen.bringToFront();
        await anyOpen.goto(ETEMPMAIL_URL, { waitUntil: 'domcontentloaded' });
        return { page: anyOpen, pageStatus: 'already-open' };
    }

    const page = await browserInstance.newPage();
    await ensurePageViewport(page);
    await page.goto(ETEMPMAIL_URL, { waitUntil: 'domcontentloaded' });
    return { page, pageStatus: 'opened' };
};

const clickDeleteEmailAddress = async (page: Page): Promise<void> => {
    page.once('dialog', (d: { accept: () => Promise<void> }) => {
        void d.accept();
    });
    await page.waitForSelector(DELETE_EMAIL_BUTTON_SELECTOR, { visible: true });

    await Promise.all([
        page.click(DELETE_EMAIL_BUTTON_SELECTOR),
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => undefined)
    ]);
};

export const getNewEtempmailAddress = async (
    browserInstance: Browser
): Promise<EtempmailResult> => {
    // forceNew = true để luôn tạo cửa sổ mới khi tạo email
    const { page, pageStatus } = await ensureEtempmailPage(browserInstance, true);

    // read current email if present
    const before = await extractEmailFromPage(page);

    // click trash button to delete/renew email
    await clickDeleteEmailAddress(page);

    // wait until the page shows an email (prefer different from previous)
    const waitForEmail = async (prev: string | null, timeoutMs = 15000): Promise<string | null> => {
        const deadline = Date.now() + timeoutMs;
        let lastSeen: string | null = null;
        while (Date.now() < deadline) {
            const email = await extractEmailFromPage(page);
            if (email) {
                lastSeen = email;
                if (!prev || email !== prev) return email;
            }
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(500);
        }
        return lastSeen;
    };

    const email = await waitForEmail(before);

    if (!email) {
        throw new Error('Could not find email on eTempMail page after clicking delete.');
    }

    // Lưu mapping email -> { page, browser } để có thể đóng cửa sổ sau này
    const browser = page.browser();
    registerEmailBrowser(email, page, browser);

    return { url: ETEMPMAIL_URL, email, pageStatus };
};

const scrapeMessages = async (page: Page): Promise<EtempmailMessage[]> => {
    return page.evaluate(() => {
        const rows = Array.from(
            document.querySelectorAll(
                '[onclick*="mail"],[onclick*="email"],.list-group-item, tr, .mail-item, .message'
            )
        ).slice(0, 30);

        const pickText = (el: Element | null): string | undefined => {
            if (!el) return undefined;
            const t = (el as HTMLElement).innerText || el.textContent || '';
            const trimmed = t.trim();
            return trimmed.length > 0 ? trimmed : undefined;
        };

        return rows
            .map((el) => {
                const subject =
                    pickText(el.querySelector('.subject')) ||
                    pickText(el.querySelector('.sub')) ||
                    pickText(el.querySelector('strong')) ||
                    pickText(el.querySelector('b'));

                const from =
                    pickText(el.querySelector('.from')) ||
                    pickText(el.querySelector('[data-from]')) ||
                    pickText(el.querySelector('td:nth-child(2)'));

                const time =
                    pickText(el.querySelector('time')) ||
                    pickText(el.querySelector('.time')) ||
                    pickText(el.querySelector('td:nth-child(3)'));

                const text = pickText(el);

                const snippet = text && subject ? text.replace(subject, '').trim() : text;

                return { subject, from, time, snippet, text };
            })
            .filter((m) => m.subject || m.from || m.text);
    });
};
//
export const readEtempmailInbox = async (
    _browserInstance: Browser,
    expectedEmail?: string
): Promise<{ email: string; inbox: unknown; pageStatus: EtempmailResult['pageStatus'] }> => {
    let page: Page | null = null;
    let browser: Browser | null = null;
    let pageStatus: EtempmailResult['pageStatus'] = 'opened';

    // BẮT BUỘC: phải có expectedEmail để tìm đúng browser đã lưu
    if (!expectedEmail || expectedEmail.trim().length === 0) {
        throw new Error('Email là bắt buộc để đọc inbox. Vui lòng cung cấp email đã được tạo trước đó.');
    }

    const emailTrimmed = expectedEmail.trim();

    // Tìm browser và page đã được register cho email này
    const registeredBrowser = getBrowserByEmail(emailTrimmed);
    const registeredPage = getPageByEmail(emailTrimmed);

    if (registeredBrowser && registeredPage) {
        try {
            // Kiểm tra browser và page còn sống không
            if (registeredBrowser.isConnected()) {
                await registeredPage.url();
                browser = registeredBrowser;
                page = registeredPage;
                await page.bringToFront();
                pageStatus = 'already-open';
            }
        } catch {
            // Browser hoặc page đã bị đóng
            throw new Error(`Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Có thể cửa sổ đã bị đóng.`);
        }
    }

    if (!page || !browser) {
        throw new Error(`Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Email này chưa được tạo hoặc cửa sổ đã bị đóng.`);
    }

    // Wait for page to be fully loaded and inbox to render
    // Đợi một chút để trang render và có thể đã gọi API getInbox
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(2000);

    const currentEmail = await extractEmailFromPage(page);
    if (!currentEmail) {
        throw new Error('Không tìm thấy địa chỉ email hiện tại trên trang eTempMail.');
    }

    // Nếu có expectedEmail và khác với currentEmail, có thể cần navigate đến email đó
    if (expectedEmail && expectedEmail.trim().length > 0 && expectedEmail !== currentEmail) {
        // vẫn tiếp tục đọc, nhưng ghi nhận mismatch nếu cần xử lý phía client
    }

    const targetUrl = 'https://etempmail.com/getInbox';
    let inboxData: unknown = null;

    // Thử fetch trực tiếp từ page context trước (giữ cookie/session)
    try {
        inboxData = await page.evaluate(async (url: string) => {
            try {
                const res = await fetch(url, {
                    cache: 'no-store',
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    return data;
                }
                return null;
            } catch (err) {
                console.error('Fetch error:', err);
                return null;
            }
        }, targetUrl);
    } catch {
        // Ignore và thử cách khác
    }

    // Nếu fetch trực tiếp không thành công, thử bắt network response
    if (!inboxData || (typeof inboxData === 'object' && inboxData !== null && Object.keys(inboxData).length === 0)) {
        try {
            // Setup response listener TRƯỚC khi trigger action
            const responsePromise = page.waitForResponse(
                (res: HTTPResponse) => {
                    const url = res.url();
                    return url.includes('getInbox') || url.startsWith(targetUrl);
                },
                { timeout: 10000 }
            ).catch(() => null);

            // Đợi một chút để đảm bảo listener đã được setup
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(300);

            // Trigger fetch trong context trang để kích hoạt API call
            await page.evaluate((url: string) => {
                void fetch(url, { 
                    cache: 'no-store',
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                    }
                }).catch(() => undefined);
            }, targetUrl);

            // Đợi auto-refresh của trang (trang có auto-refresh mỗi 5 giây)
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1500);

            // Thử scroll vào inbox area để trigger lazy load nếu có
            try {
                await page.evaluate(() => {
                    const inboxArea = document.querySelector('[id*="inbox"], [class*="inbox"], [id*="mail"], table, .list-group');
                    if (inboxArea) {
                        inboxArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
                await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(500);
            } catch {
                // Ignore nếu không tìm thấy element
            }

            // Đợi response
            const response = await responsePromise;
            
            if (response) {
                try {
                    inboxData = await response.json();
                } catch {
                    const text = await response.text();
                    try {
                        inboxData = JSON.parse(text);
                    } catch {
                        inboxData = text;
                    }
                }
            }
        } catch (error) {
            // Ignore errors và fallback
        }
    }

    // Fallback: nếu không bắt được network, thử scrape HTML
    if (!inboxData || (typeof inboxData === 'object' && 'fallbackMessages' in inboxData === false && Object.keys(inboxData).length === 0)) {
        try {
            const messages = await scrapeMessages(page);
            inboxData = inboxData && typeof inboxData === 'object' 
                ? { ...inboxData, fallbackMessages: messages }
                : { fallbackMessages: messages };
        } catch {
            inboxData = inboxData || { fallbackMessages: [] };
        }
    }

    return { email: currentEmail, inbox: inboxData, pageStatus };
};
