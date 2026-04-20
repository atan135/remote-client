import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import iconv from "iconv-lite";

const DEFAULT_MAX_BYTES = 1024 * 1024;

export function readTextFilePreview(filePath, options = {}) {
  const requestedPath = normalizeFilePathInput(filePath);
  const baseCwd = normalizeFilePathInput(options.baseCwd);

  if (!requestedPath) {
    throw new Error("文件路径不能为空");
  }

  const resolvedPath = resolveRequestedFilePath(requestedPath, baseCwd);
  const stat = fs.statSync(resolvedPath);

  if (!stat.isFile()) {
    throw new Error("目标路径不是文件");
  }

  const maxBytes = normalizePositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
  const totalBytes = Math.max(0, Number(stat.size) || 0);
  const bytesToRead = Math.min(totalBytes, maxBytes);
  const buffer = bytesToRead > 0 ? readFileBytes(resolvedPath, bytesToRead) : Buffer.alloc(0);
  const encoding = detectFileEncoding(buffer, options.windowsEncoding);

  if (looksLikeBinaryFile(buffer, encoding)) {
    throw new Error("暂不支持打开二进制文件");
  }

  const content = stripLeadingBomCharacter(decodeTextBuffer(buffer, encoding));

  return {
    requestedPath,
    resolvedPath,
    content,
    truncated: totalBytes > bytesToRead,
    bytesRead: bytesToRead,
    totalBytes,
    encoding,
    modifiedAt: stat.mtime instanceof Date ? stat.mtime.toISOString() : null,
    readAt: new Date().toISOString()
  };
}

function resolveRequestedFilePath(requestedPath, baseCwd) {
  if (baseCwd) {
    return path.resolve(baseCwd, requestedPath);
  }

  return path.resolve(requestedPath);
}

function normalizeFilePathInput(value) {
  const trimmed = String(value || "").trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFileBytes(filePath, bytesToRead) {
  const fileDescriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(bytesToRead);

  try {
    const bytesRead = fs.readSync(fileDescriptor, buffer, 0, bytesToRead, 0);
    return bytesRead === bytesToRead ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function detectFileEncoding(buffer, windowsEncoding) {
  if (hasUtf8Bom(buffer)) {
    return "utf8";
  }

  if (hasUtf16LeBom(buffer)) {
    return "utf16le";
  }

  if (hasUtf16BeBom(buffer)) {
    return "utf16-be";
  }

  if (isLikelyUtf8(buffer)) {
    return "utf8";
  }

  if (os.platform() === "win32") {
    const normalizedWindowsEncoding = String(windowsEncoding || "").trim();

    if (normalizedWindowsEncoding && iconv.encodingExists(normalizedWindowsEncoding)) {
      return normalizedWindowsEncoding;
    }
  }

  return "utf8";
}

function hasUtf8Bom(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function hasUtf16LeBom(buffer) {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
}

function hasUtf16BeBom(buffer) {
  return buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff;
}

function looksLikeBinaryFile(buffer, encoding) {
  if (buffer.length === 0) {
    return false;
  }

  if (encoding === "utf16le" || encoding === "utf16-be") {
    return false;
  }

  return buffer.includes(0x00);
}

function decodeTextBuffer(buffer, encoding) {
  if (buffer.length === 0) {
    return "";
  }

  return iconv.decode(buffer, encoding || "utf8");
}

function stripLeadingBomCharacter(text) {
  return String(text || "").replace(/^\ufeff/, "");
}

function isLikelyUtf8(buffer) {
  let index = 0;

  while (index < buffer.length) {
    const current = buffer[index];

    if (current <= 0x7f) {
      index += 1;
      continue;
    }

    let expectedLength = 0;

    if ((current & 0xe0) === 0xc0) {
      expectedLength = 2;
    } else if ((current & 0xf0) === 0xe0) {
      expectedLength = 3;
    } else if ((current & 0xf8) === 0xf0) {
      expectedLength = 4;
    } else {
      return false;
    }

    if (index + expectedLength > buffer.length) {
      return false;
    }

    for (let offset = 1; offset < expectedLength; offset += 1) {
      if ((buffer[index + offset] & 0xc0) !== 0x80) {
        return false;
      }
    }

    index += expectedLength;
  }

  return true;
}
