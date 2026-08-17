import type { Browser, ElementHandle, Page } from "puppeteer";
import { ensurePageViewport } from "./openChrome";
import { getBrowserByEmail, getPageByEmail, registerEmailBrowser } from "./emailPageMap";

const TEMP_MAIL_URL = "https://temp-mail.org/";
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const DEFAULT_WAIT_MS = 120_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const messagesResponseByPage = new WeakMap<Page, { receivedAt: number; payload: unknown }>();

const isMessagesResponse = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "web2.temp-mail.org" && parsed.pathname === "/messages";
  } catch {
    return false;
  }
};

const captureMessagesResponses = (page: Page): void => {
  page.on("response", (response) => {
    if (!isMessagesResponse(response.url()) || !response.ok()) return;
    void response.json()
      .then((payload: unknown) => messagesResponseByPage.set(page, { receivedAt: Date.now(), payload }))
      .catch(() => undefined);
  });
};

export type TempMailResult = {
  url: string;
  pageStatus: "opened" | "already-open";
  email: string;
  user: string;
  domain: string;
};

export type TempMailMessage = {
  sender?: string;
  subject?: string;
  text: string;
  code: string | null;
};

const extractEmail = (page: Page): Promise<string | null> => page.evaluate((source) => {
  const regex = new RegExp(source, "i");
  for (const selector of ["#mail", "input#mail", "input[type='email']", "[data-email]"]) {
    const el = document.querySelector(selector) as HTMLInputElement | null;
    const raw = el?.value || el?.getAttribute("data-email") || el?.textContent || "";
    const match = raw.match(regex);
    if (match) return match[0];
  }
  return document.body?.innerText.match(regex)?.[0] ?? null;
}, EMAIL_REGEX.source);

const waitForEmail = async (page: Page): Promise<string> => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const email = await extractEmail(page);
    if (email) return email;
    await sleep(750);
  }
  throw new Error("Temp-mail.org không tạo được địa chỉ email trong 45 giây.");
};

const throwIfAccessBlocked = async (page: Page): Promise<void> => {
  const blocked = await page.evaluate(() => {
    const title = document.title || "";
    const text = document.body?.innerText || "";
    return /attention required|sorry, you have been blocked/i.test(`${title}\n${text}`);
  }).catch(() => false);
  if (blocked) {
    throw new Error(
      "Temp-mail.org bi Cloudflare chan IP/phien trinh duyet. Hay tat VPN/proxy, doi sang mang hop le khac, hoac thu lai sau."
    );
  }
};

export const createTempMailAddress = async (browser: Browser): Promise<TempMailResult> => {
  const page = await browser.newPage();
  captureMessagesResponses(page);
  await ensurePageViewport(page);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const resourceType = request.resourceType();
    if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
      void request.abort();
    } else {
      void request.continue();
    }
  });
  await page.goto(TEMP_MAIL_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await throwIfAccessBlocked(page);
  const email = await waitForEmail(page);
  const [user = "", domain = ""] = email.split("@");
  registerEmailBrowser(email, page, browser);
  return { url: TEMP_MAIL_URL, pageStatus: "opened", email, user, domain };
};

const visibleText = (element: ElementHandle<Element>): Promise<string> =>
  element.evaluate((node) => (node as HTMLElement).innerText || node.textContent || "");

const findMessageRows = async (page: Page): Promise<ElementHandle<Element>[]> => {
  for (const selector of [
    ".inbox-dataList li:not(.hide) a",
    ".inbox-dataList a",
    "a.viewLink",
    "[data-mail-id] a",
    "a[data-mail-id]",
    ".mail-item a",
  ]) {
    const result: ElementHandle<Element>[] = [];
    for (const row of await page.$$(selector)) {
      const value = (await visibleText(row)).trim();
      const box = await row.boundingBox().catch(() => null);
      if (box && value && !/inbox is empty|waiting for incoming/i.test(value)) result.push(row);
    }
    if (result.length) return result;
  }
  return [];
};

const clickMessageRow = async (row: ElementHandle<Element>): Promise<boolean> => {
  const connected = await row.evaluate((node) => node.isConnected).catch(() => false);
  if (!connected) return false;
  await row.evaluate((node) => node.scrollIntoView({ block: "center", inline: "center" }));
  try {
    await row.click();
  } catch {
    // A re-render can invalidate Puppeteer's click point even though the link is
    // still present. A DOM click avoids failing on that transient layout state.
    return row.evaluate((node) => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      node.click();
      return true;
    }).catch(() => false);
  }
  return true;
};

const extractCode = (text: string): string | null => {
  const labelled = text.match(/(?:verification|security|confirmation|one[- ]time|otp|mã(?: xác nhận| xác minh)?|code)[^\r\n]{0,40}?\b((?=[A-Z0-9-]{4,12}\b)(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/i);
  if (labelled) return labelled[1].replace(/-/g, "");
  return text.match(/\b\d{4,8}\b/)?.[0] ?? null;
};

const readOpenedMessage = async (page: Page): Promise<TempMailMessage> => {
  await sleep(1_000);
  const data = await page.evaluate(() => {
    const getText = (selectors: string[]) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector) as HTMLElement | null;
        const text = element?.innerText || element?.textContent || "";
        if (text.trim()) return text.trim();
      }
      return "";
    };
    return {
      sender: getText([".inboxSenderEmail", ".from", "[data-from]"]),
      subject: getText([".inboxSubject", ".subject", "h1", "h2"]),
      text: getText([".inbox-data-content-intro", ".inbox-data-content", ".mail-content", "article", "main"]),
    };
  });
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameText = await frame.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (frameText.trim().length > data.text.length) data.text = frameText.trim();
  }
  return { ...data, code: extractCode(`${data.subject}\n${data.text}`) };
};

export const waitForTempMailCode = async (expectedEmail?: string, timeoutMs = Number(process.env.MAIL_WAIT_TIMEOUT_MS ?? DEFAULT_WAIT_MS)) => {
  const email = expectedEmail?.trim().toLowerCase();
  if (!email) throw new Error("Cần truyền email đã tạo để chờ đọc mã.");
  const browser = getBrowserByEmail(email);
  const page = getPageByEmail(email);
  if (!browser?.isConnected() || !page || page.isClosed()) {
    throw new Error(`Không tìm thấy cửa sổ temp-mail.org cho email: ${email}.`);
  }
  await page.bringToFront();
  await throwIfAccessBlocked(page);
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  let lastReceivedAt = 0;
  while (Date.now() < deadline) {
    const captured = messagesResponseByPage.get(page);
    if (captured && captured.receivedAt > lastReceivedAt) {
      lastReceivedAt = captured.receivedAt;
      const text = JSON.stringify(captured.payload);
      const code = extractCode(text);
      return {
        email,
        code,
        response: captured.payload,
        pageStatus: "already-open" as const,
      };
    }
    await sleep(1_000);
  }
  throw new Error(`Hết thời gian chờ mã cho ${email} (${timeoutMs} ms).`);
};
