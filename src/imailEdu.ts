import type { Browser, Page, HTTPResponse } from 'puppeteer';
import { ensureBrowser } from './openChrome';
import { registerEmailBrowser, getPageByEmail, getBrowserByEmail } from './emailPageMap';

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
    browserInstance: Browser,
    forceNew = false
): Promise<{ page: Page; pageStatus: ImailEduResult['pageStatus'] }> => {
    // Nếu forceNew = true, luôn tạo page mới (dùng khi tạo email mới)
    if (forceNew) {
        const page = await browserInstance.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        await (page as unknown as { navigate: (url: string, delay?: number) => Promise<void> }).navigate(IMAIL_EDU_URL, 1000);
        return { page, pageStatus: 'opened' };
    }

    // Nếu không forceNew, reuse page nếu có (dùng khi đọc inbox)
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
    // Tìm và click nút đơn giản như code JavaScript bạn cung cấp
    const clicked = await page.evaluate(() => {
        const btn = document.querySelector('input[value="Create a Random Email"]') as HTMLInputElement | null;
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    });

    if (!clicked) {
        throw new Error('Không tìm thấy nút "Create a Random Email" trên trang.');
    }

    // Đợi form submit và trang cập nhật
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1000);
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => undefined);
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1500);
};

const clickNewButton = async (page: Page): Promise<void> => {
    // Tìm và click nút "New" có x-on:click="in_app = true"
    const clicked = await page.evaluate(() => {
        const divs = Array.from(document.querySelectorAll('div[x-on\\:click]')) as HTMLElement[];
        const newButton = divs.find((div) => {
            const onClick = div.getAttribute('x-on:click');
            return onClick === 'in_app = true' || onClick?.includes('in_app = true');
        });

        if (newButton) {
            // Tìm text "New" bên trong
            const text = newButton.textContent?.trim().toLowerCase() || '';
            if (text.includes('new')) {
                newButton.click();
                return true;
            }
        }
        return false;
    });

    if (!clicked) {
        throw new Error('Không tìm thấy nút "New" trên trang.');
    }

    // Đợi trang cập nhật
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1000);
};

const getEmailFromDisplay = async (page: Page): Promise<string | null> => {
    // Lấy email từ div có class cụ thể như bạn cung cấp
    const email = await page.evaluate(() => {
        // Tìm div có class chứa các class bạn cung cấp: block appearance-none w-full bg-white text-white py-4 px-5 pr-8 bg-opacity-10 rounded-md cursor-pointer focus:outline-none select-none
        const divs = Array.from(document.querySelectorAll('div')) as HTMLElement[];
        const emailDiv = divs.find((div) => {
            const classList = Array.from(div.classList);
            // Kiểm tra các class quan trọng
            const hasKeyClasses =
                classList.includes('block') &&
                classList.includes('appearance-none') &&
                classList.includes('select-none') &&
                (classList.includes('bg-opacity-10') || classList.some((c) => c.includes('bg-opacity')));
            
            if (hasKeyClasses) {
                const text = div.textContent?.trim() || '';
                // Kiểm tra xem có chứa email không
                return text.includes('@') && /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text);
            }
            return false;
        });

        if (emailDiv) {
            const text = emailDiv.textContent?.trim() || '';
            // Extract email từ text
            const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
            const match = text.match(emailRegex);
            return match ? match[0] : null;
        }

        // Fallback 1: tìm trong input có value chứa email
        const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
        for (const input of inputs) {
            const value = input.value?.trim() || '';
            if (value.includes('@')) {
                const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
                const match = value.match(emailRegex);
                if (match) {
                    return match[0];
                }
            }
        }

        // Fallback 2: tìm bất kỳ div nào chứa email
        for (const div of divs) {
            const text = div.textContent?.trim() || '';
            if (text.includes('@')) {
                const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
                const match = text.match(emailRegex);
                if (match) {
                    return match[0];
                }
            }
        }

        // Fallback 3: tìm trong toàn bộ body text
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('@')) {
            const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
            const match = bodyText.match(emailRegex);
            if (match) {
                return match[0];
            }
        }

        return null;
    });

    return email;
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

export const createImailEduAddress = async (
    browserInstance: Browser,
    excludeKeywords: string[] = []
): Promise<ImailEduResult> => {
    // forceNew = true để luôn tạo cửa sổ mới khi tạo email
    const { page, pageStatus } = await ensureImailEduPage(browserInstance, true);

    // Đảm bảo trang đã load xong
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => undefined);
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1000);

    const maxAttempts = 20; // Giới hạn số lần thử để tránh vòng lặp vô hạn
    let attempts = 0;
    let email = '';
    let user = '';
    let domain = '';

    while (attempts < maxAttempts) {
        attempts += 1;

        // Click vào nút "Create a Random Email"
        await clickRandomEmailButton(page);

        // Đợi một lúc để email hiển thị
        await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(2000);

        // Lấy email từ div hiển thị
        const currentEmail = await getEmailFromDisplay(page);

        if (currentEmail && currentEmail.includes('.edu')) {
            // Kiểm tra xem email có chứa các từ khóa cần loại bỏ không
            const containsExcludedKeyword = excludeKeywords.some((keyword) =>
                currentEmail.toLowerCase().includes(keyword.toLowerCase())
            );

            if (containsExcludedKeyword) {
                // Email chứa từ khóa cần loại bỏ, tiếp tục tạo email mới
                if (attempts < maxAttempts) {
                    await clickNewButton(page);
                    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1000);
                }
                continue; // Bỏ qua email này và thử lại
            }

            // Email hợp lệ (có .edu và không chứa từ khóa loại bỏ), lấy thông tin
            email = currentEmail;
            const emailParts = currentEmail.split('@');
            if (emailParts.length === 2) {
                user = emailParts[0];
                domain = emailParts[1];
            } else {
                // Fallback: parse từ email string
                const match = currentEmail.match(/([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+)/);
                if (match) {
                    user = match[1];
                    domain = match[2];
                }
            }
            break; // Thoát khỏi vòng lặp
        }

        // Nếu không có .edu, click nút "New" rồi thử lại
        if (attempts < maxAttempts) {
            await clickNewButton(page);
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1000);
        }
    }

    if (!email || !user || !domain) {
        throw new Error(
            `Không thể tạo email có .edu sau ${attempts} lần thử. Email cuối cùng: ${email || 'không tìm thấy'}`
        );
    }

    // Lưu mapping email -> { page, browser } để có thể đóng cửa sổ sau này
    const browser = page.browser();
    registerEmailBrowser(email, page, browser);

    return {
        url: IMAIL_EDU_URL,
        pageStatus,
        domain,
        user,
        email
    };
};

export const readImailEduInbox = async (
    _browserInstance: Browser,
    expectedEmail?: string
): Promise<{ email: string; inbox: unknown; pageStatus: ImailEduResult['pageStatus'] }> => {
    let page: Page | null = null;
    let browser: Browser | null = null;
    let currentEmail = '';

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
                currentEmail = emailTrimmed;
            }
        } catch {
            // Browser hoặc page đã bị đóng
            throw new Error(`Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Có thể cửa sổ đã bị đóng.`);
        }
    }

    if (!page || !browser) {
        throw new Error(`Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Email này chưa được tạo hoặc cửa sổ đã bị đóng.`);
    }

    // Đảm bảo đang ở trang mailbox hoặc trang có email
    const currentUrl = page.url();
    if (!currentUrl.includes('/mailbox')) {
        // Navigate đến mailbox nếu chưa ở đó
        await page.goto('https://imail.edu.vn/mailbox', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
        await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(2000);
    } else {
        // Refresh trang mailbox
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
        await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(2000);
    }

    // Lấy email hiện tại từ trang (nếu chưa có từ expectedEmail)
    if (!currentEmail) {
        const emailFromPage = await getEmailFromDisplay(page);
        if (emailFromPage) {
            currentEmail = emailFromPage;
        } else if (expectedEmail && expectedEmail.trim().length > 0) {
            // Nếu không tìm thấy trên trang nhưng có expectedEmail, dùng expectedEmail
            currentEmail = expectedEmail.trim();
        } else {
            throw new Error('Không tìm thấy địa chỉ email hiện tại trên trang imailEdu.');
        }
    }

    const targetUrl = 'https://imail.edu.vn/livewire/message/frontend.app';
    let inboxData: unknown = null;

    // Thử bắt network response trước (ưu tiên vì Livewire có thể cần request body cụ thể)
    try {
        // Setup response listener TRƯỚC khi trigger action
        const responsePromise = page.waitForResponse(
            (res: HTTPResponse) => {
                const url = res.url();
                return url.includes('livewire/message/frontend.app') || url.includes('livewire/message');
            },
            { timeout: 15000 }
        ).catch(() => null);

        // Đợi một chút để đảm bảo listener đã được setup
        await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(500);

        // Trigger refresh hoặc action để gọi API Livewire
        await page.evaluate(() => {
            // Tìm và click refresh button nếu có
            const buttons = Array.from(document.querySelectorAll('button, div[x-on\\:click], div[onclick]')) as HTMLElement[];
            const refreshBtn = buttons.find((btn) => {
                const text = btn.textContent?.toLowerCase() || '';
                const onClick = btn.getAttribute('x-on:click') || btn.getAttribute('onclick') || '';
                return text.includes('refresh') || onClick.includes('refresh');
            });

            if (refreshBtn) {
                refreshBtn.click();
            } else {
                // Hoặc trigger bằng cách dispatch event
                window.dispatchEvent(new Event('scroll'));
                // Hoặc trigger Livewire update
                if (typeof (window as unknown as { Livewire?: { emit: (event: string) => void } }).Livewire !== 'undefined') {
                    (window as unknown as { Livewire: { emit: (event: string) => void } }).Livewire.emit('refresh');
                }
            }
        });

        // Đợi response
        await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(2000);

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
    } catch {
        // Ignore và thử fetch trực tiếp
    }

    // Nếu không bắt được network response, thử fetch trực tiếp từ page context
    if (!inboxData || (typeof inboxData === 'object' && inboxData !== null && Object.keys(inboxData).length === 0)) {
        try {
            inboxData = await page.evaluate(async (url: string) => {
                try {
                    // Lấy Livewire component data từ DOM nếu có
                    const livewireData = document.querySelector('[wire\\:id]');
                    let body: unknown = {};
                    
                    if (livewireData) {
                        const wireId = livewireData.getAttribute('wire:id');
                        const fingerprint = (window as unknown as { Livewire?: { find: (id: string) => unknown } }).Livewire?.find(wireId || '');
                        if (fingerprint) {
                            body = { fingerprint, serverMemo: {} };
                        }
                    }

                    const res = await fetch(url, {
                        method: 'POST',
                        cache: 'no-store',
                        credentials: 'include',
                        headers: {
                            'Accept': 'application/json, text/plain, */*',
                            'Content-Type': 'application/json',
                            'X-Livewire': 'true',
                        },
                        body: JSON.stringify(body),
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
            // Ignore
        }
    }

    // Nếu fetch trực tiếp không thành công, thử bắt network response
    if (!inboxData || (typeof inboxData === 'object' && inboxData !== null && Object.keys(inboxData).length === 0)) {
        try {
            // Setup response listener TRƯỚC khi trigger action
            const responsePromise = page.waitForResponse(
                (res: HTTPResponse) => {
                    const url = res.url();
                    return url.includes('livewire/message/frontend.app') || url.startsWith(targetUrl);
                },
                { timeout: 10000 }
            ).catch(() => null);

            // Đợi một chút để đảm bảo listener đã được setup
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(300);

            // Trigger refresh hoặc action để gọi API
            await page.evaluate(() => {
                // Thử trigger Livewire update bằng cách click vào refresh button hoặc scroll
                const refreshBtn = document.querySelector('[onclick*="refresh"], button:has-text("Refresh"), [aria-label*="refresh" i]') as HTMLElement | null;
                if (refreshBtn) {
                    refreshBtn.click();
                } else {
                    // Hoặc trigger bằng cách scroll
                    window.dispatchEvent(new Event('scroll'));
                }
            });

            // Đợi auto-refresh hoặc response
            await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(2000);

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

    // Fallback: nếu không bắt được network, trả về empty
    if (!inboxData || (typeof inboxData === 'object' && inboxData !== null && Object.keys(inboxData).length === 0)) {
        inboxData = { messages: [], fallback: true };
    }

    // Xác định pageStatus
    const pageStatus: ImailEduResult['pageStatus'] = currentUrl.includes('imail.edu.vn') ? 'already-open' : 'opened';

    return { email: currentEmail, inbox: inboxData, pageStatus };
};
