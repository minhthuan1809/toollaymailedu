import type { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer';

// `src/undetected-browser` là CommonJS JS module, không có type declarations sẵn.
// Mình dùng kiểu tối thiểu để tránh `any`.
type UndetectableBrowserInstance = {
    getBrowser: () => Promise<Browser>;
    extendPage: (page: Page) => Page;
};

const UndetectableBrowser = require('./undetected-browser') as unknown as {
    new(browser: Browser | Promise<Browser>): UndetectableBrowserInstance;
};

export type EnsureBrowserOptions = {
    headless?: boolean;
};

let browser: Browser | null = null;
let undetected: UndetectableBrowserInstance | null = null;

export const ensureBrowser = async (
    options: EnsureBrowserOptions = {}
): Promise<Browser> => {
    if (browser && browser.isConnected()) {
        return browser;
    }

    const width = 1200;
    const height = 800;

    browser = await puppeteer.launch({
        headless: options.headless ?? false,
        args: [`--window-size=${width},${height}`],
        defaultViewport: { width, height }
    });

    undetected = new UndetectableBrowser(browser);
    await undetected.getBrowser();

    // Extend các page đang mở (và các page mới sẽ được hook qua targetcreated)
    const pages = await browser.pages();
    pages.forEach((p: Page) => undetected?.extendPage(p));

    return browser;
};

export const ensurePageViewport = async (page: Page): Promise<void> => {
    const desiredWidth = 1200;
    const desiredHeight = 800;
    const viewport = page.viewport();

    if (!viewport || viewport.width !== desiredWidth || viewport.height !== desiredHeight) {
        await page.setViewport({ width: desiredWidth, height: desiredHeight });
    }
};

export const closeBrowser = async (): Promise<void> => {
    if (!browser) return;
    await browser.close();
    browser = null;
    undetected = null;
};

export const getBrowserIfAny = (): Browser | null => browser;

// Tạo browser instance mới (mở cửa sổ Chrome mới)
export const createNewBrowser = async (
    options: EnsureBrowserOptions = {}
): Promise<Browser> => {
    const width = 1200;
    const height = 800;

    const newBrowser = await puppeteer.launch({
        headless: options.headless ?? false,
        args: [`--window-size=${width},${height}`],
        defaultViewport: { width, height }
    });

    const newUndetected = new UndetectableBrowser(newBrowser);
    await newUndetected.getBrowser();

    // Extend các page đang mở
    const pages = await newBrowser.pages();
    pages.forEach((p: Page) => newUndetected?.extendPage(p));

    return newBrowser;
};