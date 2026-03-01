import type { Browser, Page } from "playwright";
import { ensurePageViewport, getBrowserPages } from "./openChrome";
import {
  registerEmailBrowser,
  getPageByEmail,
  getBrowserByEmail,
} from "./emailPageMap";
import { sleep } from "./pageUtils";

export type EtempmailResult = {
  url: string;
  pageStatus: "opened" | "already-open";
  domain: string;
  user: string;
  email: string;
};

export type EtempmailMessage = {
  subject?: string;
  from?: string;
  time?: string;
  snippet?: string;
  text?: string;
};

const ETEMPMAIL_URL = "https://etempmail.com/email?id=1";

const DELETE_EMAIL_BUTTON_SELECTOR = "#deleteEmailAddress";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Kiểm tra email có chứa bất kỳ chuỗi nào trong other không */
const emailContainsOther = (email: string, other: string[]): boolean => {
  if (!other?.length) return false;
  const lower = email.toLowerCase();
  return other.some((k) => k && lower.includes(k.toLowerCase()));
};

const clickDeleteEmailAddress = async (page: Page): Promise<void> => {
  await page.waitForSelector(DELETE_EMAIL_BUTTON_SELECTOR, { timeout: 5000 });
  await page.click(DELETE_EMAIL_BUTTON_SELECTOR);
  await sleep(800);
};

const extractPrimaryEmail = async (page: Page): Promise<string | null> => {
  // Ưu tiên ô input chính giữa trang (địa chỉ email hiện tại), tránh dính email mẫu như test@test.com
  return page.evaluate((regexSource: string) => {
    const regex = new RegExp(regexSource, "i");

    // Các selector ưu tiên cho ô input / element chứa email hiện tại (etempmail có thể dùng input readonly hoặc #email)
    const candidates: Array<HTMLInputElement | HTMLElement | null> = [
      document.querySelector("#emailAddress"),
      document.querySelector("#email"),
      document.querySelector('input[name="email"]'),
      document.querySelector("input[readonly]"),
      document.querySelector('input[type="text"]'),
      document.querySelector('input[type="email"]'),
      document.querySelector('input[aria-label*="mail"]'),
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
    return null;
  }, EMAIL_REGEX.source);
};

const findEmailInText = (text: string): string | null => {
  const match = text.match(EMAIL_REGEX);
  return match ? match[0] : null;
};

const extractEmailCandidates = async (page: Page): Promise<string[]> => {
  return page.evaluate((regexSource: string) => {
    const regex = new RegExp(regexSource, "i");
    const emails = new Set<string>();
    const addIfEmail = (val: unknown) => {
      if (typeof val !== "string") return;
      const m = val.match(regex);
      if (m && m[0]) emails.add(m[0]);
    };

    addIfEmail(document.body?.innerText ?? "");

    document.querySelectorAll("input,textarea").forEach((el) => {
      const value = (el as HTMLInputElement | HTMLTextAreaElement).value;
      addIfEmail(value);
      addIfEmail(el.getAttribute("value"));
    });

    document
      .querySelectorAll("[data-clipboard-text],[data-clipboard-target]")
      .forEach((el) => {
        addIfEmail(el.getAttribute("data-clipboard-text"));
        addIfEmail(el.getAttribute("data-clipboard-target"));
        addIfEmail(el.textContent ?? "");
      });

    document
      .querySelectorAll(
        '[id*="mail"],[id*="email"],[class*="mail"],[class*="email"]',
      )
      .forEach((el) => {
        addIfEmail(el.textContent ?? "");
        addIfEmail(
          el && "innerText" in el ? ((el as HTMLElement).innerText ?? "") : "",
        );
      });

    return Array.from(emails);
  }, EMAIL_REGEX.source);
};

const extractEmailFromPage = async (page: Page): Promise<string | null> => {
  // Ưu tiên ô input chính, sau đó fallback quét toàn trang
  const primary = await extractPrimaryEmail(page);
  if (primary) return primary;

  const candidates = await extractEmailCandidates(page);
  // Bỏ qua email mẫu/placeholder
  const skip = new Set(["test@test.com", "example@example.com"]);
  const valid = candidates.filter((e) => e && !skip.has(e.toLowerCase()));
  return valid.length > 0 ? valid[0] : null;
};

/** Trích xuất email, thử lại vài lần với delay (trang có thể chưa render xong hoặc vừa đổi sau khi xóa) */
const extractEmailFromPageWithRetry = async (
  page: Page,
  maxRetries = 6,
  delayMs = 600,
): Promise<string | null> => {
  for (let i = 0; i < maxRetries; i++) {
    const email = await extractEmailFromPage(page);
    if (email) return email;
    if (i < maxRetries - 1) await sleep(delayMs);
  }
  return null;
};

const findOpenPageByExactUrl = async (
  browserInstance: Browser,
  targetUrl: string,
): Promise<Page | null> => {
  const pages = await getBrowserPages(browserInstance);
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

const findAnyOpenPage = async (
  browserInstance: Browser,
): Promise<Page | null> => {
  const pages = await getBrowserPages(browserInstance);
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
  forceNew = false,
): Promise<{ page: Page; pageStatus: EtempmailResult["pageStatus"] }> => {
  // Nếu forceNew = true, luôn tạo page mới (dùng khi tạo email mới)
  if (forceNew) {
    const page = await browserInstance.newPage();
    await ensurePageViewport(page);
    await page.goto(ETEMPMAIL_URL, { waitUntil: "domcontentloaded" });
    return { page, pageStatus: "opened" };
  }

  // Nếu không forceNew, reuse page nếu có (dùng khi đọc inbox)
  const existing = await findOpenPageByExactUrl(browserInstance, ETEMPMAIL_URL);
  if (existing) {
    await existing.bringToFront();
    return { page: existing, pageStatus: "already-open" };
  }

  // reuse any open tab if available to avoid spawning extra blank tabs
  const anyOpen = await findAnyOpenPage(browserInstance);
  if (anyOpen) {
    await anyOpen.bringToFront();
    await anyOpen.goto(ETEMPMAIL_URL, { waitUntil: "domcontentloaded" });
    return { page: anyOpen, pageStatus: "already-open" };
  }

  const page = await browserInstance.newPage();
  await ensurePageViewport(page);
  await page.goto(ETEMPMAIL_URL, { waitUntil: "domcontentloaded" });
  return { page, pageStatus: "opened" };
};

export const getNewEtempmailAddress = async (
  browserInstance: Browser,
  other: string[] = [],
): Promise<EtempmailResult> => {
  const { page, pageStatus } = await ensureEtempmailPage(browserInstance, true);

  await sleep(1200);

  let email: string | null = null;
  const maxAttempts = 20;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Retry extraction (trang có thể chưa render hoặc vừa đổi sau khi nhấn xóa)
    email = await extractEmailFromPageWithRetry(page, 6, 600);

    if (!email) {
      throw new Error("Could not find email on eTempMail page.");
    }

    // Nếu không cần lọc other, hoặc email không chứa ký tự trùng với other → dùng luôn
    if (!other.length || !emailContainsOther(email, other)) {
      break;
    }

    // Email chứa other → nhấn nút xóa, lấy lại email (tối đa 20 lần)
    if (attempt < maxAttempts) {
      await clickDeleteEmailAddress(page);
    }
  }

  // Sau 20 lần vẫn trùng other → báo không lấy được
  if (!email || (other.length > 0 && emailContainsOther(email, other))) {
    throw new Error("không lấy được gmail");
  }

  // Phân tách user và domain để đồng bộ cấu trúc res với imailEdu
  let user = "";
  let domain = "";
  const parts = email.split("@");
  if (parts.length === 2) {
    user = parts[0];
    domain = parts[1];
  }

  // Lưu mapping email -> { page, browser } để có thể đóng cửa sổ sau này
  const browser = page.context().browser();
  if (!browser) throw new Error("Browser context unavailable");
  registerEmailBrowser(email, page, browser);

  return { url: ETEMPMAIL_URL, pageStatus, domain, user, email };
};

const scrapeMessages = async (page: Page): Promise<EtempmailMessage[]> => {
  return page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll(
        '[onclick*="mail"],[onclick*="email"],.list-group-item, tr, .mail-item, .message',
      ),
    ).slice(0, 30);

    const pickText = (el: Element | null): string | undefined => {
      if (!el) return undefined;
      const t =
        ("innerText" in el ? (el as HTMLElement).innerText : null) ||
        el.textContent ||
        "";
      const trimmed = t.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    return rows
      .map((el) => {
        const subject =
          pickText(el.querySelector(".subject")) ||
          pickText(el.querySelector(".sub")) ||
          pickText(el.querySelector("strong")) ||
          pickText(el.querySelector("b"));

        const from =
          pickText(el.querySelector(".from")) ||
          pickText(el.querySelector("[data-from]")) ||
          pickText(el.querySelector("td:nth-child(2)"));

        const time =
          pickText(el.querySelector("time")) ||
          pickText(el.querySelector(".time")) ||
          pickText(el.querySelector("td:nth-child(3)"));

        const text = pickText(el);

        const snippet =
          text && subject ? text.replace(subject, "").trim() : text;

        return { subject, from, time, snippet, text };
      })
      .filter((m) => m.subject || m.from || m.text);
  });
};
//
export const readEtempmailInbox = async (
  _browserInstance: Browser,
  expectedEmail?: string,
): Promise<{
  email: string;
  inbox: unknown;
  pageStatus: EtempmailResult["pageStatus"];
}> => {
  let page: Page | null = null;
  let browser: Browser | null = null;
  let pageStatus: EtempmailResult["pageStatus"] = "opened";

  // BẮT BUỘC: phải có expectedEmail để tìm đúng browser đã lưu
  if (!expectedEmail || expectedEmail.trim().length === 0) {
    throw new Error(
      "Email là bắt buộc để đọc inbox. Vui lòng cung cấp email đã được tạo trước đó.",
    );
  }

  const emailTrimmed = expectedEmail.trim();

  // Tìm browser và page đã được register cho email này
  const registeredBrowser = getBrowserByEmail(emailTrimmed);
  const registeredPage = getPageByEmail(emailTrimmed);

  if (registeredBrowser && registeredPage) {
    try {
      await registeredPage.url();
      browser = registeredBrowser;
      page = registeredPage;
      await page.bringToFront();
      pageStatus = "already-open";
    } catch {
      throw new Error(
        `Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Có thể cửa sổ đã bị đóng.`,
      );
    }
  }

  if (!page || !browser) {
    throw new Error(
      `Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Email này chưa được tạo hoặc cửa sổ đã bị đóng.`,
    );
  }

  // Wait for page to be fully loaded and inbox to render
  await sleep(2000);

  const currentEmail = await extractEmailFromPage(page);
  if (!currentEmail) {
    throw new Error(
      "Không tìm thấy địa chỉ email hiện tại trên trang eTempMail.",
    );
  }

  // Nếu có expectedEmail và khác với currentEmail, có thể cần navigate đến email đó
  if (
    expectedEmail &&
    expectedEmail.trim().length > 0 &&
    expectedEmail !== currentEmail
  ) {
    // vẫn tiếp tục đọc, nhưng ghi nhận mismatch nếu cần xử lý phía client
  }

  const targetUrl = "https://etempmail.com/getInbox";
  let inboxData: unknown = null;

  // CÁCH ĐÚNG NHẤT TRONG PUPPETEER: gọi trực tiếp trong page context, giữ cookie
  try {
    inboxData = await page.evaluate(async (url: string) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include", // giữ cookie session hiện tại
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "*/*",
        },
      });

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }, targetUrl);
  } catch {
    // Ignore, sẽ fallback sang scrape HTML bên dưới
  }

  // Fallback: nếu không bắt được network, thử scrape HTML
  if (
    !inboxData ||
    (typeof inboxData === "object" &&
      "fallbackMessages" in inboxData === false &&
      Object.keys(inboxData).length === 0)
  ) {
    try {
      const messages = await scrapeMessages(page);
      inboxData =
        inboxData && typeof inboxData === "object"
          ? { ...inboxData, fallbackMessages: messages }
          : { fallbackMessages: messages };
    } catch {
      inboxData = inboxData || { fallbackMessages: [] };
    }
  }

  // Nếu có fallbackMessages (tức là chỉ scrape HTML), trả về inbox rỗng cho client
  if (
    inboxData &&
    typeof inboxData === "object" &&
    "fallbackMessages" in (inboxData as { [k: string]: unknown })
  ) {
    inboxData = {};
  }

  return { email: currentEmail, inbox: inboxData, pageStatus };
};
