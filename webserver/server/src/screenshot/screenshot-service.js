import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");
const webserverRoot = path.resolve(packageRoot, "..");

const DEFAULT_PATH = "/";
const SCREENSHOT_SELECTOR = ".app-shell, .auth-screen";

export class ScreenshotService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.activeCount = 0;
  }

  isEnabled() {
    return Boolean(this.config.canJietu);
  }

  async capture(options = {}) {
    if (!this.isEnabled()) {
      throw createHttpError(403, "截图 API 未启用，请设置 CAN_JIETU=true 并重启 server");
    }

    const maxConcurrent = normalizePositiveInteger(this.config.jietuMaxConcurrent, 1);

    if (this.activeCount >= maxConcurrent) {
      throw createHttpError(429, "截图任务繁忙，请稍后重试");
    }

    this.activeCount += 1;

    try {
      return await this.captureInternal(options);
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  async close() {
    if (!this.browser) {
      return;
    }

    const browser = this.browser;
    this.browser = null;
    await browser.close();
  }

  async captureInternal(options) {
    const viewport = normalizeViewport(options, this.config);
    const baseUrl = normalizeBaseUrl(options.baseUrl || this.config.jietuWebBaseUrl, options.requestOrigin);
    const routePath = normalizeRoutePath(options.path || options.route || options.urlPath || DEFAULT_PATH);
    const targetUrl = new URL(routePath, baseUrl).toString();
    const outputDir = resolveOutputDir(this.config.jietuOutputDir);
    const fileName = createScreenshotFileName(options.name);
    const filePath = path.join(outputDir, fileName);
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: {
        width: viewport.width,
        height: viewport.height
      },
      deviceScaleFactor: viewport.deviceScaleFactor,
      locale: "zh-CN"
    });

    try {
      await addCookiesFromHeader(context, {
        cookieHeader: options.cookieHeader,
        baseUrl
      });

      const page = await context.newPage();
      const timeoutMs = normalizePositiveInteger(this.config.jietuMaxWaitMs, 12000);

      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
      await waitForConsoleReady(page, timeoutMs);
      await settlePage(page, this.config.jietuSettleMs);

      await fs.mkdir(outputDir, { recursive: true });
      await page.screenshot({
        path: filePath,
        fullPage: Boolean(options.fullPage)
      });

      const stat = await fs.stat(filePath);

      return {
        fileName,
        filePath,
        relativePath: path.relative(webserverRoot, filePath).replace(/\\/g, "/"),
        url: targetUrl,
        viewport,
        fullPage: Boolean(options.fullPage),
        bytes: stat.size,
        capturedAt: new Date().toISOString()
      };
    } finally {
      await context.close();
    }
  }

  async getBrowser() {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    this.browser = await launchBrowser(this.config);
    return this.browser;
  }
}

async function launchBrowser(config) {
  const executablePath = String(config.jietuBrowserExecutablePath || "").trim();
  const channel = String(config.jietuBrowserChannel || "").trim();
  const explicitLaunchOptions = createLaunchOptions({ executablePath, channel });

  if (executablePath || channel) {
    return chromium.launch(explicitLaunchOptions);
  }

  try {
    return await chromium.launch(createLaunchOptions());
  } catch (error) {
    if (!isMissingBundledBrowserError(error)) {
      throw error;
    }
  }

  for (const fallbackChannel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch(createLaunchOptions({ channel: fallbackChannel }));
    } catch {
      // Try the next fallback below.
    }
  }

  for (const fallbackPath of getBrowserExecutableCandidates()) {
    try {
      return await chromium.launch(createLaunchOptions({ executablePath: fallbackPath }));
    } catch {
      // Try the next executable path below.
    }
  }

  throw createHttpError(
    500,
    "截图浏览器不可用：请运行 npx playwright install chromium，或设置 JIETU_BROWSER_CHANNEL=chrome / JIETU_BROWSER_EXECUTABLE_PATH"
  );
}

function createLaunchOptions(options = {}) {
  const launchOptions = {
    headless: true
  };

  if (options.executablePath) {
    launchOptions.executablePath = options.executablePath;
  }

  if (options.channel) {
    launchOptions.channel = options.channel;
  }

  return launchOptions;
}

function isMissingBundledBrowserError(error) {
  const message = String(error?.message || "");
  return /Executable doesn't exist|Please run the following command to download new browsers/i.test(message);
}

function getBrowserExecutableCandidates() {
  const candidates = [];
  const platform = os.platform();

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.PROGRAMFILES || "";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "";

    candidates.push(
      path.join(localAppData, "Google/Chrome/Application/chrome.exe"),
      path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
      path.join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
      path.join(localAppData, "Microsoft/Edge/Application/msedge.exe"),
      path.join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
      path.join(programFilesX86, "Microsoft/Edge/Application/msedge.exe")
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable"
    );
  }

  return candidates.filter((candidate) => candidate && fsSync.existsSync(candidate));
}

function normalizeBaseUrl(value, requestOrigin) {
  const candidate = String(value || requestOrigin || "").trim();

  if (!candidate) {
    throw createHttpError(400, "缺少截图目标 baseUrl");
  }

  let url;

  try {
    url = new URL(candidate);
  } catch {
    throw createHttpError(400, "截图目标 baseUrl 无效");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw createHttpError(400, "截图目标 baseUrl 仅支持 http/https");
  }

  url.username = "";
  url.password = "";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeRoutePath(value) {
  const trimmed = String(value || DEFAULT_PATH).trim();

  if (!trimmed) {
    return DEFAULT_PATH;
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    throw createHttpError(400, "截图 path 只能是当前 Web 控制台内的相对路径");
  }

  if (trimmed.startsWith("#")) {
    return `/${trimmed}`;
  }

  if (trimmed.startsWith("/#")) {
    return trimmed;
  }

  if (trimmed === "/") {
    return DEFAULT_PATH;
  }

  const routePath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;

  if (/^\/(?:api|ws)(?:\/|$)/i.test(routePath)) {
    throw createHttpError(400, "截图 path 只能指向 Web 控制台页面");
  }

  return `/#${routePath}`;
}

function normalizeViewport(options, config) {
  return {
    width: clampInteger(options.width, config.jietuDefaultWidth, 320, 3840),
    height: clampInteger(options.height, config.jietuDefaultHeight, 480, 3000),
    deviceScaleFactor: clampInteger(options.deviceScaleFactor, 1, 1, 3)
  };
}

function createScreenshotFileName(value) {
  const safeName = String(value || "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);

  return `${safeName || "web"}-${timestamp}-${random}.png`;
}

function resolveOutputDir(value) {
  const outputDir = String(value || "../output/image").trim();

  return path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(packageRoot, outputDir);
}

async function addCookiesFromHeader(context, { cookieHeader, baseUrl }) {
  const source = String(cookieHeader || "").trim();

  if (!source) {
    return;
  }

  const url = new URL(baseUrl);
  const cookies = source
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf("=");

      if (separatorIndex <= 0) {
        return null;
      }

      return {
        name: item.slice(0, separatorIndex).trim(),
        value: item.slice(separatorIndex + 1).trim(),
        url: url.origin
      };
    })
    .filter((item) => item?.name);

  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
}

async function waitForConsoleReady(page, timeoutMs) {
  try {
    await page.waitForSelector(SCREENSHOT_SELECTOR, {
      state: "visible",
      timeout: Math.min(timeoutMs, 8000)
    });
  } catch {
    await page.waitForLoadState("domcontentloaded", {
      timeout: Math.min(timeoutMs, 8000)
    });
  }
}

async function settlePage(page, settleMs) {
  const timeout = normalizePositiveInteger(settleMs, 500);

  if (timeout <= 0) {
    return;
  }

  await page.waitForTimeout(Math.min(timeout, 5000));
}

function clampInteger(value, fallback, min, max) {
  const parsed = Math.floor(Number(value));

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
