import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

export type EnsureBrowserOptions = {
  headless?: boolean;
};

const isHeadlessEnv = (): boolean =>
  process.env.HEADLESS === "true" || process.env.HEADLESS === "1";

/** Mặc định true để dùng Chrome Headless Shell (sau `npx playwright install chromium`). Set HEADLESS=false nếu cần mở cửa sổ và đã cài full Chromium. */
const defaultHeadless = true;

const resolveHeadless = (options: EnsureBrowserOptions): boolean => {
  if (options.headless !== undefined) return options.headless;
  if (process.env.HEADLESS !== undefined && process.env.HEADLESS !== "") return isHeadlessEnv();
  return defaultHeadless;
};

let browser: Browser | null = null;

function launchArgs(): string[] {
  const width = 1200;
  const height = 800;
  const args = [`--window-size=${width},${height}`];
  if (process.platform !== "win32") {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}

export const ensureBrowser = async (
  options: EnsureBrowserOptions = {}
): Promise<Browser> => {
  if (browser) {
    try {
      await browser.contexts();
      return browser;
    } catch {
      browser = null;
    }
  }
  const headless = resolveHeadless(options);
  browser = await chromium.launch({
    headless,
    args: launchArgs(),
  });
  return browser;
};

/** Playwright không có browser.isConnected(); kiểm tra bằng cách dùng contexts. */
export async function isBrowserConnected(b: Browser): Promise<boolean> {
  try {
    await b.contexts();
    return true;
  } catch {
    return false;
  }
}

export const ensurePageViewport = async (page: Page): Promise<void> => {
  const desiredWidth = 1200;
  const desiredHeight = 800;
  await page.setViewportSize({ width: desiredWidth, height: desiredHeight });
};

export const closeBrowser = async (): Promise<void> => {
  if (!browser) return;
  await browser.close();
  browser = null;
};

export const getBrowserIfAny = (): Browser | null => browser;

/** Trả về tất cả page trong mọi context của browser (Playwright dùng context.pages()). */
export async function getBrowserPages(b: Browser): Promise<Page[]> {
  const pages: Page[] = [];
  for (const ctx of b.contexts()) {
    pages.push(...ctx.pages());
  }
  return pages;
}

export const createNewBrowser = async (
  options: EnsureBrowserOptions = {}
): Promise<Browser> => {
  const headless = resolveHeadless(options);
  const newBrowser = await chromium.launch({
    headless,
    args: launchArgs(),
  });
  return newBrowser;
};
