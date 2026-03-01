import type { Page, Browser } from "playwright";
import { isBrowserConnected } from "./openChrome";

type EmailBrowserInfo = {
  page: Page;
  browser: Browser;
};

const emailBrowserMap = new Map<string, EmailBrowserInfo>();

export const registerEmailBrowser = (
  email: string,
  page: Page,
  browser: Browser,
): void => {
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
    if (await isBrowserConnected(info.browser)) {
      await info.browser.close();
    }
    emailBrowserMap.delete(email.toLowerCase().trim());
    return true;
  } catch {
    emailBrowserMap.delete(email.toLowerCase().trim());
    return false;
  }
};

export const getAllRegisteredEmails = (): string[] => {
  return Array.from(emailBrowserMap.keys());
};

export const closeAllBrowsers = async (): Promise<number> => {
  let closedCount = 0;
  const browsersToClose: Browser[] = [];
  const emailsToRemove: string[] = [];

  for (const [email, info] of emailBrowserMap.entries()) {
    try {
      if (await isBrowserConnected(info.browser)) {
        browsersToClose.push(info.browser);
      }
      emailsToRemove.push(email);
    } catch {
      emailsToRemove.push(email);
    }
  }

  for (const browser of browsersToClose) {
    try {
      await browser.close();
      closedCount++;
    } catch {
      // ignore
    }
  }

  for (const email of emailsToRemove) {
    emailBrowserMap.delete(email);
  }

  return closedCount;
};
