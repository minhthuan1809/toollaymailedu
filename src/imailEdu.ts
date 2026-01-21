import type { Browser, Page } from 'puppeteer';
import { ensureBrowser } from './openChrome';

export type ImailEduResult = {
    url: string;
    pageStatus: 'opened' | 'already-open';
    domain: string;
    user: string;
    email: string;
};

const IMAIL_EDU_URL = 'https://imail.edu.vn/';
const USER_INPUT_SELECTOR = 'input[name="user"]';
const SUBMIT_INPUT_SELECTOR = 'input[type="submit"][value="Create"], input[type="submit"][value="Tạo"], input[type="submit"]';
const RANDOM_EMAIL_BUTTON_SELECTOR =
    'button:has-text("Create a Random Email"), button:has-text("Create Random Email"), button[type="button"]:has-text("Random"), a:has-text("Create a Random Email")';

const generateRandomUser = (min: number, max: number): string => {
    const length = Math.floor(Math.random() * (max - min + 1)) + min;
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i += 1) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const findOpenPageByExactUrl = async (
    browserInstance: Browser,
    targetUrl: string
): Promise<Page | null> => {
    const pages = await browserInstance.pages();
    for (const p of pages) {
        try {
            const url = p.url();
            if (url.startsWith(targetUrl)) return p;
        } catch {
            // Page might be closed, skip it
            continue;
        }
    }
    return null;
};

const findAnyOpenPage = async (browserInstance: Browser): Promise<Page | null> => {
    const pages = await browserInstance.pages();
    for (const p of pages) {
        try {
            // Try to access url to check if page is still valid
            await p.url();
            return p;
        } catch {
            continue;
        }
    }
    return null;
};

const clickDomainInput = async (page: Page): Promise<void> => {
    // Đợi input domain xuất hiện - giảm timeout
    await page.waitForSelector("input[name=\"domain\"]", {
        timeout: 5000
    });

    // Click vào div cha có @click="open = ! open" thay vì click trực tiếp vào input readonly
    // Dùng JavaScript để tìm và click vào div cha
    await page.evaluate(() => {
        const input = document.querySelector("input[name='domain']") as HTMLInputElement | null;
        if (!input) {
            throw new Error("❌ Không tìm thấy input domain");
        }

        // Tìm div cha có @click="open = ! open"
        let parent = input.parentElement;
        while (parent) {
            // Kiểm tra xem div có chứa input và có thể click được không
            if (parent.querySelector('input[name="domain"]')) {
                // Click vào div cha này để toggle dropdown
                (parent as HTMLElement).click();
                return;
            }
            parent = parent.parentElement;
        }

        // Fallback: click vào input nếu không tìm thấy div cha
        input.click();
    });

    // Đợi dropdown xuất hiện - giảm từ 300ms xuống 100ms
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(100);
};

const pickRandomEduDomain = async (page: Page): Promise<string> => {
    // Đợi dropdown render giống như setTimeout trong script của bạn (100ms)
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(100);

    // Đảm bảo dropdown đã mở (x-show="open" thành true)
    await page.waitForFunction(
        () => {
            const dropdown = document.querySelector('div[x-show="open"]');
            if (!dropdown) return false;
            const style = window.getComputedStyle(dropdown);
            return style.display !== 'none' && style.visibility !== 'hidden';
        },
        { timeout: 5000 }
    ).catch(() => {
        // Nếu không tìm thấy bằng x-show, đợi thêm một chút
        return Promise.resolve();
    });

    const result = await page.$$eval(
        'a',
        (anchors) => {
            // Lấy toàn bộ option <a> chứa .edu
            const options = anchors.filter((a) => {
                const text = (a.textContent ?? '').trim();
                return text.includes('.edu');
            });

            if (options.length === 0) {
                return null;
            }

            // Random 1 option
            const randomIndex = Math.floor(Math.random() * options.length);
            const randomOption = options[randomIndex] as HTMLElement;
            const text = (randomOption.textContent ?? '').trim();

            // Click chọn
            randomOption.click();
            return text || null;
        }
    );

    if (!result) {
        throw new Error('Không tìm thấy domain .edu trong danh sách.');
    }

    return result;
};

const fillUserAndSubmit = async (page: Page): Promise<{ user: string }> => {
    const user = generateRandomUser(15, 20);

    await page.waitForSelector(USER_INPUT_SELECTOR, { visible: true, timeout: 10000 });
    await page.type(USER_INPUT_SELECTOR, user);

    await page.waitForSelector(SUBMIT_INPUT_SELECTOR, { visible: true, timeout: 10000 });
    await page.click(SUBMIT_INPUT_SELECTOR);

    return { user };
};

export const ensureImailEduPage = async (
    browserInstance: Browser
): Promise<{ page: Page; pageStatus: ImailEduResult['pageStatus'] }> => {
    const existing = await findOpenPageByExactUrl(browserInstance, IMAIL_EDU_URL);
    if (existing) {
        await existing.bringToFront();
        // Đợi trang load hoàn toàn: dùng navigate từ undetected-browser
        await (existing as unknown as { navigate: (url: string, delay?: number) => Promise<void> }).navigate(IMAIL_EDU_URL, 1000);
        return { page: existing, pageStatus: 'already-open' };
    }

    const anyOpen = await findAnyOpenPage(browserInstance);
    if (anyOpen) {
        await anyOpen.bringToFront();
        await (anyOpen as unknown as { navigate: (url: string, delay?: number) => Promise<void> }).navigate(IMAIL_EDU_URL, 1000);
        return { page: anyOpen, pageStatus: 'already-open' };
    }

    const page = await browserInstance.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await (page as unknown as { navigate: (url: string, delay?: number) => Promise<void> }).navigate(IMAIL_EDU_URL, 1000);
    return { page, pageStatus: 'opened' };
};

export const openImailEduDomainPicker = async (
    browserInstance: Browser
): Promise<ImailEduResult> => {
    const { page, pageStatus } = await ensureImailEduPage(browserInstance);

    await clickDomainInput(page);

    return {
        url: IMAIL_EDU_URL,
        pageStatus,
        // các field bên dưới sẽ được gán sau khi pick domain + user
        domain: '',
        user: '',
        email: ''
    };
};

const clickRandomEmailButton = async (page: Page): Promise<void> => {
    // Đợi trang load xong trước khi tìm nút
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => undefined);

    // Tìm nút "Create a Random Email" bằng text content (Puppeteer không có :has-text)
    const buttons = await page.$$('button, a');
    let clicked = false;

    for (const btn of buttons) {
        try {
            const text = await page.evaluate((el) => el.textContent?.trim().toLowerCase() || '', btn);
            if (text.includes('random') && text.includes('email')) {
                const isVisible = await page.evaluate((el) => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                }, btn);

                if (isVisible) {
                    await page.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), btn);
                    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(300);
                    await btn.click();
                    clicked = true;
                    break;
                }
            }
        } catch {
            continue;
        }
    }

    if (!clicked) {
        throw new Error('Không tìm thấy nút "Create a Random Email" trên trang.');
    }

    // Đợi form cập nhật sau khi click (đợi lâu hơn để form render xong)
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(2000);
};

const getCurrentDomain = async (page: Page): Promise<string | null> => {
    try {
        // Đúng theo DOM bạn gửi: input[name="domain"] là field hiển thị domain
        await page.waitForSelector('input[name="domain"]', { timeout: 5000 }).catch(() => undefined);

        const inputs = await page.$$('input[name="domain"]');

        // Ưu tiên input nào có value và đang hiển thị
        for (const input of inputs) {
            const isVisible = await page.evaluate((el) => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
            }, input).catch(() => false);

            const value = await page.evaluate((el) => (el as HTMLInputElement).value || '', input).catch(() => '');
            if (isVisible && value.trim().length > 0) return value.trim();
        }

        // Fallback: nếu không có cái visible, lấy cái đầu tiên có value
        for (const input of inputs) {
            const value = await page.evaluate((el) => (el as HTMLInputElement).value || '', input).catch(() => '');
            if (value.trim().length > 0) return value.trim();
        }
    } catch {
        // ignore
    }
    return null;
};

export const createImailEduAddress = async (browserInstance: Browser): Promise<ImailEduResult> => {
    const { page, pageStatus } = await ensureImailEduPage(browserInstance);

    // Đảm bảo trang đã load xong - giảm timeout và bỏ sleep không cần thiết
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => undefined);

    // Làm đúng như script console: Click vào input domain để mở dropdown
    await clickDomainInput(page);

    // Đợi 100ms rồi chọn random domain .edu
    const domainText = await pickRandomEduDomain(page);

    // Đợi form cập nhật sau khi chọn domain - giảm từ 1500ms xuống 300ms
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(300);

    // Bước 3: Chỉ có 1 ô username -> click như người thật rồi gõ
    // (không dùng visible:true vì đôi khi overlay/animation làm Puppeteer nghĩ là "not visible")
    const smartWait =
        (page as unknown as { smartWaitForSelector?: (selector: string, delay?: number) => Promise<void> })
            .smartWaitForSelector;
    if (smartWait) {
        await smartWait(USER_INPUT_SELECTOR, 15000);
    } else {
        await page.waitForSelector(USER_INPUT_SELECTOR, { timeout: 15000 });
    }

    const inputElement = await page.$(USER_INPUT_SELECTOR);
    if (!inputElement) throw new Error('Không tìm thấy input username.');

    let user = '';
    try {
        const currentUserValue = await page.evaluate((el) => (el as HTMLInputElement).value || '', inputElement).catch(() => '');
        if (!currentUserValue || currentUserValue.trim().length === 0) {
            user = generateRandomUser(15, 20);
            // Click giống người thật + clear + gõ
            const simulateMouseClick =
                (page as unknown as { simulateMouseClick?: (selector: string) => Promise<void> })
                    .simulateMouseClick;
            if (simulateMouseClick) {
                await simulateMouseClick(USER_INPUT_SELECTOR);
            } else {
                await page.click(USER_INPUT_SELECTOR);
            }

            // Clear nhanh
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');

            const simulateTyping =
                (page as unknown as { simulateTyping?: (selectorOrHandle: unknown, text: string) => Promise<void> })
                    .simulateTyping;
            if (simulateTyping) {
                await simulateTyping(USER_INPUT_SELECTOR, user);
            } else {
                await page.type(USER_INPUT_SELECTOR, user);
            }

            // Đợi typing animation hoàn thành và verify username đã được điền vào input
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(500);

            // Verify username đã được điền vào input
            const verifyValue = await page.evaluate((el) => (el as HTMLInputElement).value || '', inputElement).catch(() => '');
            if (!verifyValue || verifyValue.trim().length === 0) {
                // Nếu không có value, thử set trực tiếp
                await page.evaluate((el, val) => { (el as HTMLInputElement).value = val; }, inputElement, user);
                await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(200);
            }
            user = verifyValue.trim() || user;
        } else {
            user = currentUserValue.trim();
        }
    } catch {
        // Nếu không lấy được, tạo user mới và dùng simulateTyping
        user = generateRandomUser(15, 20);
        const simulateMouseClick =
            (page as unknown as { simulateMouseClick?: (selector: string) => Promise<void> })
                .simulateMouseClick;
        if (simulateMouseClick) {
            await simulateMouseClick(USER_INPUT_SELECTOR).catch(() => undefined);
        } else {
            await page.click(USER_INPUT_SELECTOR).catch(() => undefined);
        }

        const simulateTyping =
            (page as unknown as { simulateTyping?: (selectorOrHandle: unknown, text: string) => Promise<void> })
                .simulateTyping;
        if (simulateTyping) {
            await simulateTyping(USER_INPUT_SELECTOR, user).catch(() => undefined);
        } else {
            await page.type(USER_INPUT_SELECTOR, user).catch(() => undefined);
        }
        await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(500);

        // Verify và set trực tiếp nếu cần
        const verifyValue = await page.evaluate((el) => (el as HTMLInputElement).value || '', inputElement).catch(() => '');
        if (!verifyValue || verifyValue.trim().length === 0) {
            await page.evaluate((el, val) => { (el as HTMLInputElement).value = val; }, inputElement, user);
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(200);
        }
    }

    // Đảm bảo username đã được điền trước khi submit
    const finalCheck = await page.evaluate((el) => (el as HTMLInputElement).value || '', inputElement).catch(() => '');
    if (!finalCheck || finalCheck.trim().length === 0) {
        throw new Error('Username chưa được điền vào input trước khi submit.');
    }

    // Bước 4: Submit form - click đúng input[type=submit][value=Create|Tạo]
    // Không dùng visible:true vì đôi khi CSS/overlay làm Puppeteer fail dù element có trên DOM.
    await page.waitForSelector('input[type="submit"]', { timeout: 15000 });

    const clickedSubmit = await page.evaluate(() => {
        const submits = Array.from(document.querySelectorAll('input[type="submit"]')) as HTMLInputElement[];
        const target =
            submits.find((s) => (s.value ?? '').trim().toLowerCase() === 'create') ??
            submits.find((s) => (s.value ?? '').trim().toLowerCase() === 'tạo') ??
            submits[0];
        if (!target) return false;
        target.click();
        return true;
    });

    if (!clickedSubmit) {
        // Fallback: thử click bằng undetected-browser cursor nếu có
        const simulateMouseClick =
            (page as unknown as { simulateMouseClick?: (selector: string) => Promise<void> }).simulateMouseClick;
        if (simulateMouseClick) {
            await simulateMouseClick('input[type="submit"]');
        } else {
            await page.click('input[type="submit"]');
        }
    }

    // Đợi form submit - giảm từ 1500ms xuống 500ms
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(500);

    // Lấy thông tin email cuối cùng từ trang (có thể đã thay đổi sau khi submit)
    try {
        const finalUserInput = await page.$(USER_INPUT_SELECTOR);
        if (finalUserInput) {
            const finalUser = await page.evaluate((el) => (el as HTMLInputElement).value || '', finalUserInput).catch(() => '');
            if (finalUser && finalUser.trim().length > 0) {
                user = finalUser.trim();
            }
        }
    } catch {
        // Giữ user hiện tại
    }

    // cố gắng rút domain dạng @xxx từ text domain đã chọn
    const domainMatch = domainText.match(/[A-Za-z0-9.-]+\.edu[^\s]*/);
    const domain = domainMatch ? domainMatch[0] : domainText.replace(/^@/, '');

    const email = `${user}@${domain.replace(/^@/, '')}`;

    return {
        url: IMAIL_EDU_URL,
        pageStatus,
        domain,
        user,
        email
    };
};

