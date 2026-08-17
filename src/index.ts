import express, { Request, Response } from "express";
import { closeAllBrowsers, closeBrowserByEmail } from "./emailPageMap";
import { closeBrowser, ensureBrowser } from "./openChrome";
import { createTempMailAddress, waitForTempMailCode } from "./tempmail";

type ReadBody = { email?: string; timeoutMs?: number; type?: "tempmail" };
const EMAIL_PROVIDERS = ["tempmail"] as const;
type EmailProvider = (typeof EMAIL_PROVIDERS)[number];
type NewBody = { type?: unknown };
const PORT = Number(process.env.PORT ?? 5678);
const app = express();
app.use(express.json());
// Postman can send Raw -> Text without a Content-Type header. Parse every
// non-JSON body as text, then decode JSON in parseRequestBody below.
app.use(express.text({ type: "*/*" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const isEmailProvider = (value: unknown): value is EmailProvider =>
  typeof value === "string" && EMAIL_PROVIDERS.includes(value as EmailProvider);

const parseRequestBody = (requestBody: unknown): unknown => {
  if (typeof requestBody !== "string") return requestBody;
  try {
    return JSON.parse(requestBody);
  } catch {
    return undefined;
  }
};

const createEmail = async (req: Request<unknown, unknown, unknown>, res: Response): Promise<void> => {
  try {
    const parsedBody = parseRequestBody(req.body);
    const rawBody = Array.isArray(parsedBody) ? parsedBody[0] : parsedBody;
    const body: NewBody = rawBody !== null && typeof rawBody === "object" ? rawBody : {};
    const requestedType = body.type ?? req.query.type;

    if (requestedType === undefined) {
      res.status(400).json({
        status: "error",
        message: 'Missing email provider. Send { "type": "tempmail" } or use ?type=tempmail.',
        allowedTypes: EMAIL_PROVIDERS,
      });
      return;
    }

    if (!isEmailProvider(requestedType)) {
      res.status(400).json({
        status: "error",
        message: `Invalid email provider. Allowed types: ${EMAIL_PROVIDERS.join(", ")}`,
        allowedTypes: EMAIL_PROVIDERS,
      });
      return;
    }

    let result;
    switch (requestedType) {
      case "tempmail": {
        const browser = await ensureBrowser();
        result = await createTempMailAddress(browser);
        break;
      }
    }

    res.json({ status: "ok", result });
  } catch (error) {
    res.status(500).json({ status: "error", message: error instanceof Error ? error.message : "Unknown error" });
  }
};

app.get("/api/gmail/new", createEmail);
app.post("/api/gmail/new", createEmail);

app.post("/api/gmail/read", async (req: Request<unknown, unknown, ReadBody[] | ReadBody>, res: Response) => {
  try {
    const body = Array.isArray(req.body) ? req.body[0] : req.body;
    if (!body?.email) {
      res.status(400).json({ status: "error", message: 'Expected { "email": "<email>" } or [{ "email": "<email>" }]' });
      return;
    }
    const result = await waitForTempMailCode(body.email, body.timeoutMs);
    res.json({ status: "ok", result });
  } catch (error) {
    res.status(500).json({ status: "error", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

const closeEmail = async (rawEmail: string, res: Response): Promise<void> => {
  let email = rawEmail;
  try { email = decodeURIComponent(rawEmail); } catch { /* Keep the original value. */ }
  email = email.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ status: "error", message: "Email parameter is required" });
    return;
  }
  if (email === "all") {
    const closedCount = await closeAllBrowsers();
    res.json({ status: "ok", message: `Đã đóng ${closedCount} cửa sổ` });
    return;
  }
  const closed = await closeBrowserByEmail(email);
  res.status(closed ? 200 : 404).json(closed
    ? { status: "ok", message: `Đã đóng cửa sổ cho ${email}` }
    : { status: "error", message: `Không tìm thấy cửa sổ cho ${email}` });
};

app.get("/api/gmail/close/:email", async (req, res) => {
  try { await closeEmail(String(req.params.email), res); }
  catch (error) { res.status(500).json({ status: "error", message: error instanceof Error ? error.message : "Unknown error" }); }
});
app.post("/api/gmail/close/:email", async (req, res) => {
  try { await closeEmail(String(req.params.email), res); }
  catch (error) { res.status(500).json({ status: "error", message: error instanceof Error ? error.message : "Unknown error" }); }
});

const server = app.listen(PORT, () => console.log(`API server listening on port ${PORT}`));
const shutdown = async () => { server.close(); await closeBrowser(); };
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
