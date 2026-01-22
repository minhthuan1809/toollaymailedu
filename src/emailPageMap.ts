import type { Page, Browser } from 'puppeteer';

// Map lưu email -> { page, browser } để có thể đóng cửa sổ theo email
type EmailBrowserInfo = {
    page: Page;
    browser: Browser;
};

const emailBrowserMap = new Map<string, EmailBrowserInfo>();

export const registerEmailBrowser = (email: string, page: Page, browser: Browser): void => {
    emailBrowserMap.set(email.toLowerCase().trim(), { page, browser });
};

export const getPageByEmail = (email: string): Page | undefined => {
    return emailBrowserMap.get(email.toLowerCase().trim())?.page;
};

export const getBrowserByEmail = (email: string): Browser | undefined => {
    return emailBrowserMap.get(email.toLowerCase().trim())?.browser;
};

export const closeBrowserByEmail = async (email: string): Promise<boolean> => {
    const info = emailBrowserMap.get(email.toLowerCase().trim());
    if (!info) {
        return false;
    }

    try {
        // Kiểm tra browser còn sống không
        if (info.browser.isConnected()) {
            // Đóng cả browser (sẽ đóng tất cả pages trong browser đó)
            await info.browser.close();
        }
        emailBrowserMap.delete(email.toLowerCase().trim());
        return true;
    } catch {
        // Browser đã bị đóng, xóa khỏi map
        emailBrowserMap.delete(email.toLowerCase().trim());
        return false;
    }
};

export const getAllRegisteredEmails = (): string[] => {
    return Array.from(emailBrowserMap.keys());
};
