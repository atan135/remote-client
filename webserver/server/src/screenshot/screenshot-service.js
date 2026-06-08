import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");
const webserverRoot = path.resolve(packageRoot, "..");

const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export class ScreenshotService {
  constructor(config) {
    this.config = config;
  }

  isEnabled() {
    return Boolean(this.config.canJietu);
  }

  async saveUpload(payload = {}) {
    if (!this.isEnabled()) {
      throw createHttpError(403, "截图 API 未启用，请设置 CAN_JIETU=true 并重启 server");
    }

    const imageBuffer = parsePngPayload(payload.image);
    const maxBytes = normalizePositiveInteger(
      this.config.jietuMaxUploadBytes,
      DEFAULT_MAX_UPLOAD_BYTES
    );

    if (imageBuffer.length > maxBytes) {
      throw createHttpError(413, `截图过大，最大允许 ${maxBytes} 字节`);
    }

    const outputDir = resolveOutputDir(this.config.jietuOutputDir);
    const fileName = createScreenshotFileName(payload.name);
    const filePath = path.join(outputDir, fileName);
    const metadata = normalizeMetadata(payload.metadata);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(filePath, imageBuffer);

    const stat = await fs.stat(filePath);

    return {
      fileName,
      filePath,
      relativePath: path.relative(webserverRoot, filePath).replace(/\\/g, "/"),
      bytes: stat.size,
      metadata,
      capturedAt: new Date().toISOString()
    };
  }

  async close() {
    return undefined;
  }
}

function parsePngPayload(value) {
  const source = String(value || "").trim();
  const base64 = source.startsWith(PNG_DATA_URL_PREFIX)
    ? source.slice(PNG_DATA_URL_PREFIX.length)
    : source;

  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    throw createHttpError(400, "请上传 PNG base64 截图数据");
  }

  const buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");

  if (!isPng(buffer)) {
    throw createHttpError(400, "截图数据必须是 PNG 图片");
  }

  return buffer;
}

function isPng(buffer) {
  return (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
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

  return `${safeName || "browser"}-${timestamp}-${random}.png`;
}

function resolveOutputDir(value) {
  const outputDir = String(value || "../output/image").trim();

  return path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(packageRoot, outputDir);
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    requestId: limitText(value.requestId, 80),
    title: limitText(value.title, 200),
    href: limitText(value.href, 500),
    route: limitText(value.route, 200),
    userAgent: limitText(value.userAgent, 300),
    viewport: normalizeViewport(value.viewport),
    scroll: normalizePoint(value.scroll),
    capturedBy: limitText(value.capturedBy, 80)
  };
}

function normalizeViewport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    width: normalizePositiveInteger(value.width, 0),
    height: normalizePositiveInteger(value.height, 0),
    devicePixelRatio: Number.isFinite(Number(value.devicePixelRatio))
      ? Number(value.devicePixelRatio)
      : 0
  };
}

function normalizePoint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    x: normalizePositiveInteger(value.x, 0),
    y: normalizePositiveInteger(value.y, 0)
  };
}

function limitText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
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
