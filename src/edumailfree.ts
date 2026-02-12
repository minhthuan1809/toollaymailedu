import type { Browser, Page } from "puppeteer";
import { ensurePageViewport } from "./openChrome";
import {
  registerEmailBrowser,
  getPageByEmail,
  getBrowserByEmail,
} from "./emailPageMap";

export type EdumailfreeResult = {
  url: string;
  pageStatus: "opened" | "already-open";
  domain: string;
  user: string;
  email: string;
};

const EDUMAILFREE_URL = "https://edumailfree.com/";
const EDUMAILFREE_MAILBOX_URL = "https://edumailfree.com/mailbox";
const LIVEWIRE_UPDATE_URL = "https://edumailfree.com/livewire/update";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Nút submit form: input type="submit" value="Create a Random Email" (Livewire form) */
const SUBMIT_CREATE_RANDOM_SELECTOR =
  'input[type="submit"][value="Create a Random Email"]';

/** Chữ trên nút (fallback tìm theo text) */
const CREATE_RANDOM_EMAIL_TEXTS = ["Create a Random Email", "Tạo Email Ngẫu nhiên"];

/** Nút "New" (div chứa chữ New, x-on:click="in_app = true") — bấm khi cần đổi email vì trùng other */
const clickNewButton = async (page: Page): Promise<void> => {
  const found = await page.evaluate(() => {
    // Tìm div có text "New" (nút New để tạo email mới)
    const all = document.querySelectorAll("div, button, a, [role='button']");
    for (const el of all) {
      const text = ((el as HTMLElement).innerText ?? (el as HTMLElement).textContent ?? "").trim();
      if (text === "New") {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (!found) {
    throw new Error('Không tìm thấy nút "New"');
  }
};

/** Kiểm tra email có chứa bất kỳ chuỗi nào trong other không */
const emailContainsOther = (email: string, other: string[]): boolean => {
  if (!other?.length) return false;
  const lower = email.toLowerCase();
  return other.some((k) => k && lower.includes(k.toLowerCase()));
};

/** Chờ nút "Create a Random Email" xuất hiện (form Livewire load sau) */
const waitForCreateRandomButton = async (page: Page): Promise<void> => {
  await page.waitForSelector(SUBMIT_CREATE_RANDOM_SELECTOR, { timeout: 15000 });
};

/** Bấm nút tạo email: ưu tiên selector input[submit], không thấy thì tìm theo chữ */
const clickCreateRandomEmail = async (page: Page): Promise<void> => {
  try {
    await page.waitForSelector(SUBMIT_CREATE_RANDOM_SELECTOR, { timeout: 3000 });
    await page.click(SUBMIT_CREATE_RANDOM_SELECTOR);
    return;
  } catch {
    // Fallback: tìm theo nội dung chữ
  }
  const found = await page.evaluate((texts: string[]) => {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="submit"]');
    for (const el of inputs) {
      if (el.value && texts.some((label) => el.value.trim() === label || el.value.includes(label))) {
        el.click();
        return true;
      }
    }
    const all = document.querySelectorAll("button, a, [role='button']");
    for (const el of all) {
      const raw = (el as HTMLElement).innerText ?? (el as HTMLElement).textContent ?? "";
      const text = raw.trim();
      for (const label of texts) {
        if (text === label || text.includes(label)) {
          (el as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  }, CREATE_RANDOM_EMAIL_TEXTS);
  if (!found) {
    throw new Error(`Không tìm thấy nút "Create a Random Email"`);
  }
};

const extractEmailFromPage = async (page: Page): Promise<string | null> => {
  return page.evaluate((regexSource: string) => {
    const regex = new RegExp(regexSource, "i");
    // edumailfree.com hiển thị email trong div#email_id sau khi bấm "Tạo Email Ngẫu nhiên"
    const emailIdEl = document.querySelector("#email_id");
    if (emailIdEl) {
      const raw = (emailIdEl as HTMLElement).innerText ?? emailIdEl.textContent ?? "";
      const match = typeof raw === "string" && raw.trim() ? raw.match(regex) : null;
      if (match && match[0]) return match[0];
    }
    const candidates: Array<HTMLInputElement | HTMLElement | null> = [
      document.querySelector("#email"),
      document.querySelector('input[name="email"]'),
      document.querySelector('input[type="email"]'),
      document.querySelector('input[type="text"]'),
      document.querySelector('input[id*="mail"], input[id*="email"]'),
      document.querySelector("[data-clipboard-text]"),
      document.querySelector("[data-email]"),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const raw =
        (el as HTMLInputElement).value ??
        el.getAttribute?.("data-clipboard-text") ??
        el.getAttribute?.("data-email") ??
        el.textContent ??
        "";
      if (typeof raw !== "string") continue;
      const match = raw.match(regex);
      if (match && match[0]) return match[0];
    }
    const bodyMatch = (document.body?.innerText ?? "").match(regex);
    return bodyMatch && bodyMatch[0] ? bodyMatch[0] : null;
  }, EMAIL_REGEX.source);
};

/** Trích xuất email, thử lại vài lần (trang có thể chưa render xong) */
const extractEmailFromPageWithRetry = async (
  page: Page,
  maxRetries = 5,
  delayMs = 600
): Promise<string | null> => {
  const sleep = (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep;
  for (let i = 0; i < maxRetries; i++) {
    const email = await extractEmailFromPage(page);
    if (email) return email;
    if (i < maxRetries - 1) await sleep(delayMs);
  }
  return null;
};

export const getNewEdumailfreeAddress = async (
  browserInstance: Browser,
  other: string[] = []
): Promise<EdumailfreeResult> => {
  const page = await browserInstance.newPage();
  await ensurePageViewport(page);
  await page.goto(EDUMAILFREE_URL, { waitUntil: "domcontentloaded" });

  await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
    1500
  );

  // Chờ form Livewire render, nút input[type=submit][value="Create a Random Email"] xuất hiện
  await waitForCreateRandomButton(page);

  let email: string | null = null;
  const maxAttempts = 20;

  const sleep = (page: Page, ms: number) =>
    (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(ms);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Nếu đang retry (email trước chứa other): bấm nút "New" trước, rồi mới bấm Create a Random Email
    if (attempt > 1) {
      await clickNewButton(page);
      await sleep(page, 1000);
    }

    const navPromise = page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
      .catch(() => null);
    await clickCreateRandomEmail(page);
    await navPromise;

    await page.waitForSelector("#email_id", { timeout: 10000 });
    await sleep(page, 600);

    email = await extractEmailFromPageWithRetry(page, 5, 500);

    if (!email) {
      throw new Error("Could not find email on Edumailfree page.");
    }

    if (!other.length || !emailContainsOther(email, other)) {
      break;
    }

    if (attempt >= maxAttempts) break;
  }

  if (!email || (other.length > 0 && emailContainsOther(email, other))) {
    throw new Error("không lấy được gmail");
  }

  let user = "";
  let domain = "";
  const parts = email.split("@");
  if (parts.length === 2) {
    user = parts[0];
    domain = parts[1];
  }

  const browser = page.browser();
  registerEmailBrowser(email, page, browser);

  return {
    url: EDUMAILFREE_URL,
    pageStatus: "opened",
    domain,
    user,
    email,
  };
};

/** Đọc inbox edumailfree: mở mailbox và bắt response từ livewire/update (fetchMessages) */
export const readEdumailfreeInbox = async (
  _browserInstance: Browser,
  expectedEmail?: string
): Promise<{
  email: string;
  inbox: unknown;
  pageStatus: "opened" | "already-open";
}> => {
  if (!expectedEmail || expectedEmail.trim().length === 0) {
    throw new Error(
      "Email là bắt buộc để đọc inbox. Vui lòng cung cấp email đã được tạo trước đó."
    );
  }

  const emailTrimmed = expectedEmail.trim();
  const registeredBrowser = getBrowserByEmail(emailTrimmed);
  const registeredPage = getPageByEmail(emailTrimmed);

  if (!registeredBrowser || !registeredPage) {
    throw new Error(
      `Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Email này chưa được tạo hoặc cửa sổ đã bị đóng.`
    );
  }

  try {
    if (!registeredBrowser.isConnected()) throw new Error("Browser đã đóng");
    await registeredPage.url();
  } catch {
    throw new Error(
      `Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Có thể cửa sổ đã bị đóng.`
    );
  }

  const page = registeredPage;
  await page.bringToFront();

  // Bắt response của livewire/update (POST) khi trang gọi fetchMessages
  const livewireResponsePromise = new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off("response", onResponse);
      reject(new Error("Timeout: không nhận được response từ livewire/update"));
    }, 20000);

    const onResponse = async (res: import("puppeteer").HTTPResponse) => {
      const url = res.url();
      if (!url.includes("livewire/update")) return;
      const req = res.request();
      if (req.method() !== "POST") return;
      const postData = req.postData() ?? "";
      if (!postData.includes("fetchMessages")) return;
      try {
        clearTimeout(timeout);
        page.off("response", onResponse);
        const body = await res.json();
        resolve(body);
      } catch {
        // ignore parse error
      }
    };
    page.on("response", onResponse);
  });

  await page.goto(EDUMAILFREE_MAILBOX_URL, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });

  let inbox: unknown;
  try {
    inbox = await livewireResponsePromise;
  } catch {
    // Fallback: gọi livewire/update từ page context (cùng cookie/session)
    const updateUrl = LIVEWIRE_UPDATE_URL;
    inbox = await page
      .evaluate(
        async (url: string) => {
          const tokenEl = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null;
          const _token = tokenEl?.content ?? "";
          const payload = {
            _token,
            components: [
              {
                snapshot: JSON.stringify({
                  data: { messages: [], deleted: [], error: "", email: "", initial: true, overflow: false },
                  memo: { id: "", name: "frontend.app", path: "mailbox", method: "GET", children: [], scripts: [], assets: [], errors: [], locale: "en" },
                  checksum: "",
                }),
                updates: {},
                calls: [{ path: "", method: "__dispatch", params: ["fetchMessages", {}] }],
              },
            ],
          };
          const response = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { Accept: "*/*", "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
            body: JSON.stringify(payload),
          });
          return response.json();
        },
        updateUrl
      )
      .catch(() => ({}));
  }

  return {
    email: emailTrimmed,
    inbox,
    pageStatus: "already-open",
  };
};
