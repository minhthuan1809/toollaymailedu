import type { Browser, Page, HTTPResponse } from "puppeteer";
import { ensureBrowser } from "./openChrome";
import {
  registerEmailBrowser,
  getPageByEmail,
  getBrowserByEmail,
} from "./emailPageMap";

export type ImailEduResult = {
  url: string;
  pageStatus: "opened" | "already-open";
  domain: string;
  user: string;
  email: string;
};

const IMAIL_EDU_URL = "https://imail.edu.vn/";
const USER_INPUT_SELECTOR = 'input[name="user"]';
const SUBMIT_INPUT_SELECTOR =
  'input[type="submit"][value="Create"], input[type="submit"][value="Tạo"], input[type="submit"]';

const generateRandomUser = (min: number, max: number): string => {
  const length = Math.floor(Math.random() * (max - min + 1)) + min;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
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

const findAnyOpenPage = async (
  browserInstance: Browser
): Promise<Page | null> => {
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
  await page.waitForSelector('input[name="domain"]', { timeout: 2000 });
  await page.evaluate(() => {
    const input = document.querySelector(
      "input[name='domain']"
    ) as HTMLInputElement | null;
    if (!input) throw new Error("❌ Không tìm thấy input domain");
    let parent = input.parentElement;
    while (parent) {
      if (parent.querySelector('input[name="domain"]')) {
        (parent as HTMLElement).click();
        return;
      }
      parent = parent.parentElement;
    }
    input.click();
  });
  await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(20);
};

const pickRandomEduDomain = async (page: Page): Promise<string> => {
  await page
    .waitForFunction(
      () => {
        const d = document.querySelector('div[x-show="open"]');
        if (!d) return false;
        const s = window.getComputedStyle(d);
        return s.display !== "none" && s.visibility !== "hidden";
      },
      { timeout: 1000 }
    )
    .catch(() => Promise.resolve());

  const result = await page.$$eval("a", (anchors) => {
    // Lấy toàn bộ option <a> chứa .edu
    const options = anchors.filter((a) => {
      const text = (a.textContent ?? "").trim();
      return text.includes(".edu");
    });

    if (options.length === 0) {
      return null;
    }

    // Random 1 option
    const randomIndex = Math.floor(Math.random() * options.length);
    const randomOption = options[randomIndex] as HTMLElement;
    const text = (randomOption.textContent ?? "").trim();

    // Click chọn
    randomOption.click();
    return text || null;
  });

  if (!result) {
    throw new Error("Không tìm thấy domain .edu trong danh sách.");
  }

  return result;
};

const fillUserAndSubmit = async (page: Page): Promise<{ user: string }> => {
  const user = generateRandomUser(15, 20);

  await page.waitForSelector(USER_INPUT_SELECTOR, {
    visible: true,
    timeout: 3000,
  });
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    USER_INPUT_SELECTOR,
    user
  );

  await page.waitForSelector(SUBMIT_INPUT_SELECTOR, {
    visible: true,
    timeout: 3000,
  });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.click();
  }, SUBMIT_INPUT_SELECTOR);

  return { user };
};

export const ensureImailEduPage = async (
  browserInstance: Browser,
  forceNew = false
): Promise<{ page: Page; pageStatus: ImailEduResult["pageStatus"] }> => {
  if (forceNew) {
    const page = await browserInstance.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    // domcontentloaded nhanh hơn nhiều so với load+networkidle2
    await page.goto(IMAIL_EDU_URL, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    return { page, pageStatus: "opened" };
  }

  const existing = await findOpenPageByExactUrl(browserInstance, IMAIL_EDU_URL);
  if (existing) {
    await existing.bringToFront();
    await (
      existing as unknown as {
        navigate: (url: string, delay?: number) => Promise<void>;
      }
    ).navigate(IMAIL_EDU_URL, 0);
    return { page: existing, pageStatus: "already-open" };
  }

  const anyOpen = await findAnyOpenPage(browserInstance);
  if (anyOpen) {
    await anyOpen.bringToFront();
    await (
      anyOpen as unknown as {
        navigate: (url: string, delay?: number) => Promise<void>;
      }
    ).navigate(IMAIL_EDU_URL, 0);
    return { page: anyOpen, pageStatus: "already-open" };
  }

  const page = await browserInstance.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await (
    page as unknown as {
      navigate: (url: string, delay?: number) => Promise<void>;
    }
  ).navigate(IMAIL_EDU_URL, 0);
  return { page, pageStatus: "opened" };
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
    domain: "",
    user: "",
    email: "",
  };
};

const RANDOM_EMAIL_BTN = 'input[value="Create a Random Email"]';

const clickRandomEmailButton = async (page: Page): Promise<void> => {
  await page.waitForSelector(RANDOM_EMAIL_BTN, {
    visible: true,
    timeout: 5000,
  });
  await page.evaluate((sel) => {
    const btn = document.querySelector(sel) as HTMLElement | null;
    if (btn) btn.scrollIntoView({ behavior: "instant", block: "center" });
  }, RANDOM_EMAIL_BTN);

  // Click có thể gây navigation → chờ navigation xong rồi mới poll (tránh "Execution context was destroyed")
  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 6000 })
    .catch(() => null);
  await page.click(RANDOM_EMAIL_BTN, { delay: 0 });
  await navPromise;

  const pollMs = 80;
  const maxWaitMs = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
      pollMs
    );
    try {
      const email = await getEmailFromDisplay(page);
      if (email?.includes("@")) return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("Execution context was destroyed") ||
        msg.includes("Target closed")
      )
        continue;
      throw e;
    }
  }
};

const clickNewButton = async (page: Page): Promise<void> => {
  const clicked = await page.evaluate(() => {
    const hasNewText = (el: HTMLElement) =>
      (el.textContent?.trim().toLowerCase() || "").includes("new");

    // Cách 1: div có x-on:click="in_app = true" và text "New"
    const byAlpine = document.querySelectorAll("div[x-on\\:click]");
    for (const div of Array.from(byAlpine) as HTMLElement[]) {
      const onClick = div.getAttribute("x-on:click");
      if (
        (onClick === "in_app = true" || onClick?.includes("in_app = true")) &&
        hasNewText(div)
      ) {
        div.click();
        return true;
      }
    }

    // Cách 2: div có class giống nút New (bg-white, bg-opacity-10, rounded-md, cursor-pointer) và text "New"
    const candidates = document.querySelectorAll(
      "div.cursor-pointer.rounded-md, div[class*='bg-opacity-10']"
    );
    for (const div of Array.from(candidates) as HTMLElement[]) {
      if (!hasNewText(div)) continue;
      const cls = div.className || "";
      if (
        (cls.includes("bg-white") || cls.includes("bg-opacity")) &&
        (cls.includes("rounded") || cls.includes("py-5"))
      ) {
        div.click();
        return true;
      }
    }

    // Cách 3: div/button có text "New" (hoặc chỉ chứa "New") và có thể click
    const allDivs = document.querySelectorAll("div, button");
    for (const el of Array.from(allDivs) as HTMLElement[]) {
      const text = (el.textContent?.trim() || "").replace(/\s+/g, " ");
      if (!text.toLowerCase().includes("new") || text.length > 20) continue;
      const cls = el.className || "";
      const role = el.getAttribute("role") || "";
      const isClickable =
        cls.includes("cursor-pointer") ||
        role === "button" ||
        el.tagName === "BUTTON";
      if (isClickable) {
        el.click();
        return true;
      }
      // Text "New" có thể nằm trong con; phần tử clickable có thể là cha
      const parent = el.parentElement;
      if (
        parent &&
        (parent.className || "").includes("cursor-pointer") &&
        (parent.textContent?.trim().toLowerCase() || "").includes("new")
      ) {
        parent.click();
        return true;
      }
    }

    return false;
  });

  if (!clicked) throw new Error('Không tìm thấy nút "New" trên trang.');
  await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(80);
};

const getEmailFromDisplay = async (page: Page): Promise<string | null> => {
  try {
    const email = await page.evaluate(() => {
      // Tìm div có class chứa các class bạn cung cấp: block appearance-none w-full bg-white text-white py-4 px-5 pr-8 bg-opacity-10 rounded-md cursor-pointer focus:outline-none select-none
      const divs = Array.from(
        document.querySelectorAll("div")
      ) as HTMLElement[];
      const emailDiv = divs.find((div) => {
        const classList = Array.from(div.classList);
        // Kiểm tra các class quan trọng
        const hasKeyClasses =
          classList.includes("block") &&
          classList.includes("appearance-none") &&
          classList.includes("select-none") &&
          (classList.includes("bg-opacity-10") ||
            classList.some((c) => c.includes("bg-opacity")));

        if (hasKeyClasses) {
          const text = div.textContent?.trim() || "";
          // Kiểm tra xem có chứa email không
          return (
            text.includes("@") &&
            /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)
          );
        }
        return false;
      });

      if (emailDiv) {
        const text = emailDiv.textContent?.trim() || "";
        // Extract email từ text
        const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
        const match = text.match(emailRegex);
        return match ? match[0] : null;
      }

      // Fallback 1: tìm trong input có value chứa email
      const inputs = Array.from(
        document.querySelectorAll("input")
      ) as HTMLInputElement[];
      for (const input of inputs) {
        const value = input.value?.trim() || "";
        if (value.includes("@")) {
          const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
          const match = value.match(emailRegex);
          if (match) {
            return match[0];
          }
        }
      }

      // Fallback 2: tìm bất kỳ div nào chứa email
      for (const div of divs) {
        const text = div.textContent?.trim() || "";
        if (text.includes("@")) {
          const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
          const match = text.match(emailRegex);
          if (match) {
            return match[0];
          }
        }
      }

      // Fallback 3: tìm trong toàn bộ body text
      const bodyText = document.body?.innerText ?? "";
      if (bodyText.includes("@")) {
        const emailRegex = /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
        const match = bodyText.match(emailRegex);
        if (match) {
          return match[0];
        }
      }

      return null;
    });

    return email;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("Execution context was destroyed") ||
      msg.includes("Target closed")
    )
      return null;
    throw e;
  }
};

const getCurrentDomain = async (page: Page): Promise<string | null> => {
  try {
    // Đúng theo DOM bạn gửi: input[name="domain"] là field hiển thị domain
    await page
      .waitForSelector('input[name="domain"]', { timeout: 2000 })
      .catch(() => undefined);

    const inputs = await page.$$('input[name="domain"]');

    // Ưu tiên input nào có value và đang hiển thị
    for (const input of inputs) {
      const isVisible = await page
        .evaluate((el) => {
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden";
        }, input)
        .catch(() => false);

      const value = await page
        .evaluate((el) => (el as HTMLInputElement).value || "", input)
        .catch(() => "");
      if (isVisible && value.trim().length > 0) return value.trim();
    }

    // Fallback: nếu không có cái visible, lấy cái đầu tiên có value
    for (const input of inputs) {
      const value = await page
        .evaluate((el) => (el as HTMLInputElement).value || "", input)
        .catch(() => "");
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
  const { page, pageStatus } = await ensureImailEduPage(browserInstance, true);

  const maxAttempts = 20; // Giới hạn số lần thử để tránh vòng lặp vô hạn
  let attempts = 0;
  let email = "";
  let user = "";
  let domain = "";

  while (attempts < maxAttempts) {
    attempts += 1;

    // Click vào nút "Create a Random Email"
    await clickRandomEmailButton(page);

    // clickRandomEmailButton đã poll cho email hiển thị, chỉ cần đọc
    const currentEmail = await getEmailFromDisplay(page);

    if (currentEmail && currentEmail.includes(".edu")) {
      // Kiểm tra xem email có chứa các từ khóa cần loại bỏ không
      const containsExcludedKeyword = excludeKeywords.some((keyword) =>
        currentEmail.toLowerCase().includes(keyword.toLowerCase())
      );

      if (containsExcludedKeyword) {
        if (attempts < maxAttempts) {
          await clickNewButton(page);
          await (
            page as unknown as { sleep: (ms: number) => Promise<void> }
          ).sleep(200);
        }
        continue;
      }

      // Email hợp lệ (có .edu và không chứa từ khóa loại bỏ), lấy thông tin
      email = currentEmail;
      const emailParts = currentEmail.split("@");
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

    if (attempts < maxAttempts) {
      await clickNewButton(page);
      await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
        80
      );
    }
  }

  if (!email || !user || !domain) {
    throw new Error(
      `Không thể tạo email có .edu sau ${attempts} lần thử. Email cuối cùng: ${
        email || "không tìm thấy"
      }`
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
    email,
  };
};

export const readImailEduInbox = async (
  _browserInstance: Browser,
  expectedEmail?: string
): Promise<{
  email: string;
  inbox: unknown;
  pageStatus: ImailEduResult["pageStatus"];
}> => {
  let page: Page | null = null;
  let browser: Browser | null = null;
  let currentEmail = "";

  // BẮT BUỘC: phải có expectedEmail để tìm đúng browser đã lưu
  if (!expectedEmail || expectedEmail.trim().length === 0) {
    throw new Error(
      "Email là bắt buộc để đọc inbox. Vui lòng cung cấp email đã được tạo trước đó."
    );
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
      throw new Error(
        `Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Có thể cửa sổ đã bị đóng.`
      );
    }
  }

  if (!page || !browser) {
    throw new Error(
      `Không tìm thấy cửa sổ Chrome cho email: ${emailTrimmed}. Email này chưa được tạo hoặc cửa sổ đã bị đóng.`
    );
  }

  const currentUrl = page.url();
  const targetUrl = "https://imail.edu.vn/livewire/message/frontend.app";
  let inboxData: unknown = null;

  // 1) Thu thập TẤT CẢ response livewire/message, rồi chọn cái có serverMemo.data.messages
  //    (tránh bắt nhầm response delta chỉ có checksum, không có data)
  const responsePromises: Promise<unknown>[] = [];
  const onResponse = (res: HTTPResponse) => {
    const url = res.url();
    if (
      !url.includes("livewire/message/frontend.app") &&
      !url.includes("livewire/message")
    )
      return;
    responsePromises.push(res.json().catch(() => null));
  };
  page.on("response", onResponse);

  if (!currentUrl.includes("/mailbox")) {
    await page
      .goto("https://imail.edu.vn/mailbox", { waitUntil: "domcontentloaded" })
      .catch(() => undefined);
  } else {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  }

  await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
    600
  );

  await page.evaluate(() => {
    const btn = Array.from(
      document.querySelectorAll("button, div[x-on\\:click]")
    ).find((b) => {
      const t = (b.textContent || "").toLowerCase();
      const on =
        b.getAttribute("x-on:click") || b.getAttribute("onclick") || "";
      return t.includes("refresh") || on.includes("refresh");
    });
    if (btn) (btn as HTMLElement).click();
    else {
      window.dispatchEvent(new Event("scroll"));
      if (
        typeof (
          window as unknown as { Livewire?: { emit: (e: string) => void } }
        ).Livewire !== "undefined"
      ) {
        (
          window as unknown as { Livewire: { emit: (e: string) => void } }
        ).Livewire.emit("refresh");
      }
    }
  });

  await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
    4500
  );

  page.off("response", onResponse);

  const settled = await Promise.allSettled(responsePromises);
  const candidates = settled
    .filter(
      (r): r is PromiseFulfilledResult<unknown> => r.status === "fulfilled"
    )
    .map((r) => r.value)
    .filter((v) => v != null);

  for (const j of candidates) {
    if (typeof j !== "object" || j === null) continue;
    const sm = (j as { serverMemo?: { data?: { messages?: unknown } } })
      .serverMemo;
    if (sm && typeof sm === "object" && Array.isArray(sm.data?.messages)) {
      inboxData = j;
      break;
    }
  }
  if (!inboxData) {
    const withData = candidates.find(
      (j) =>
        (j as { serverMemo?: { data?: unknown } })?.serverMemo?.data != null
    );
    if (withData) inboxData = withData;
  }

  // Lấy email hiện tại từ trang (nếu chưa có từ expectedEmail)
  if (!currentEmail) {
    const emailFromPage = await getEmailFromDisplay(page);
    if (emailFromPage) {
      currentEmail = emailFromPage;
    } else if (expectedEmail && expectedEmail.trim().length > 0) {
      currentEmail = expectedEmail.trim();
    } else {
      throw new Error(
        "Không tìm thấy địa chỉ email hiện tại trên trang imailEdu."
      );
    }
  }

  // 2) Nếu chưa có data, thử bắt request khi click refresh (fallback)
  if (
    !inboxData ||
    (typeof inboxData === "object" &&
      inboxData !== null &&
      Object.keys(inboxData).length === 0)
  ) {
    try {
      const responsePromise = page
        .waitForResponse(
          (res: HTTPResponse) => {
            const url = res.url();
            return (
              url.includes("livewire/message/frontend.app") ||
              url.includes("livewire/message")
            );
          },
          { timeout: 8000 }
        )
        .catch(() => null);

      await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
        80
      );

      await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll("button, div[x-on\\:click], div[onclick]")
        ) as HTMLElement[];
        const refreshBtn = buttons.find((btn) => {
          const text = btn.textContent?.toLowerCase() || "";
          const onClick =
            btn.getAttribute("x-on:click") || btn.getAttribute("onclick") || "";
          return text.includes("refresh") || onClick.includes("refresh");
        });
        if (refreshBtn) refreshBtn.click();
        else {
          window.dispatchEvent(new Event("scroll"));
          if (
            typeof (
              window as unknown as {
                Livewire?: { emit: (event: string) => void };
              }
            ).Livewire !== "undefined"
          ) {
            (
              window as unknown as {
                Livewire: { emit: (event: string) => void };
              }
            ).Livewire.emit("refresh");
          }
        }
      });

      await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
        500
      );

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
      // Ignore
    }
  }

  // Nếu không bắt được network response, thử fetch trực tiếp từ page context
  if (
    !inboxData ||
    (typeof inboxData === "object" &&
      inboxData !== null &&
      Object.keys(inboxData).length === 0)
  ) {
    try {
      inboxData = await page.evaluate(async (url: string) => {
        try {
          // Lấy Livewire component data từ DOM nếu có
          const livewireData = document.querySelector("[wire\\:id]");
          let body: unknown = {};

          if (livewireData) {
            const wireId = livewireData.getAttribute("wire:id");
            const fingerprint = (
              window as unknown as {
                Livewire?: { find: (id: string) => unknown };
              }
            ).Livewire?.find(wireId || "");
            if (fingerprint) {
              body = { fingerprint, serverMemo: {} };
            }
          }

          const res = await fetch(url, {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: {
              Accept: "application/json, text/plain, */*",
              "Content-Type": "application/json",
              "X-Livewire": "true",
            },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            const data = await res.json();
            return data;
          }
          return null;
        } catch (err) {
          console.error("Fetch error:", err);
          return null;
        }
      }, targetUrl);
    } catch {
      // Ignore
    }
  }

  // Nếu fetch trực tiếp không thành công, thử bắt network response
  if (
    !inboxData ||
    (typeof inboxData === "object" &&
      inboxData !== null &&
      Object.keys(inboxData).length === 0)
  ) {
    try {
      // Setup response listener TRƯỚC khi trigger action
      const responsePromise = page
        .waitForResponse(
          (res: HTTPResponse) => {
            const url = res.url();
            return (
              url.includes("livewire/message/frontend.app") ||
              url.startsWith(targetUrl)
            );
          },
          { timeout: 6000 }
        )
        .catch(() => null);

      await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
        50
      );

      await page.evaluate(() => {
        const refreshBtn = document.querySelector(
          '[onclick*="refresh"], [aria-label*="refresh" i]'
        ) as HTMLElement | null;
        if (refreshBtn) refreshBtn.click();
        else window.dispatchEvent(new Event("scroll"));
      });

      await (page as unknown as { sleep: (ms: number) => Promise<void> }).sleep(
        400
      );

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

  // DEBUG: log toàn bộ response ra console
  console.log(
    "[imailEdu] RAW Livewire response:",
    JSON.stringify(inboxData, null, 2)
  );

  // Fallback: không bắt được response thì trả empty
  if (
    !inboxData ||
    (typeof inboxData === "object" &&
      inboxData !== null &&
      Object.keys(inboxData).length === 0)
  ) {
    inboxData = { messages: [], fallback: true };
  }

  const pageStatus: ImailEduResult["pageStatus"] = currentUrl.includes(
    "imail.edu.vn"
  )
    ? "already-open"
    : "opened";

  // Trả y nguyên 100% response Livewire (effects, serverMemo, ...), không xử lý/chuẩn hóa
  return { email: currentEmail, inbox: inboxData, pageStatus };
};
