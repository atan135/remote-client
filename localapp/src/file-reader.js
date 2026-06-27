import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import iconv from "iconv-lite";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const FUZZY_SEARCH_MAX_DEPTH = 6;
const FUZZY_SEARCH_MAX_ENTRIES = 5000;
const FUZZY_SEARCH_SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  ".nuxt",
  "target",
  "vendor"
]);

export function readTextFilePreview(filePath, options = {}) {
  const requestedPath = normalizeFilePathInput(filePath);
  const baseCwd = normalizeFilePathInput(options.baseCwd);
  const baseCwdSource = String(options.baseCwdSource || "").trim();

  if (!requestedPath) {
    throw new Error("文件路径不能为空");
  }

  const resolution = resolveRequestedFilePath(requestedPath, baseCwd);
  const resolvedPath = resolution.resolvedPath;
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
    baseCwd: resolution.baseCwd,
    baseCwdSource,
    fuzzyMatched: Boolean(resolution.fuzzyMatched),
    content,
    truncated: totalBytes > bytesToRead,
    bytesRead: bytesToRead,
    totalBytes,
    encoding,
    modifiedAt: stat.mtime instanceof Date ? stat.mtime.toISOString() : null,
    readAt: new Date().toISOString()
  };
}

export function writeTextFile(filePath, options = {}) {
  const requestedPath = normalizeFilePathInput(filePath);
  const baseCwd = normalizeFilePathInput(options.baseCwd);
  const baseCwdSource = String(options.baseCwdSource || "").trim();

  if (!requestedPath) {
    throw createFileError("文件路径不能为空", "FILE_PATH_REQUIRED");
  }

  const resolution = resolveRequestedFilePath(requestedPath, baseCwd);
  const resolvedPath = resolution.resolvedPath;
  const parentDirectory = path.dirname(resolvedPath);

  assertExistingDirectory(parentDirectory, "FILE_PARENT_NOT_FOUND", "目标文件所在目录不存在");

  const stat = statExistingFile(resolvedPath);

  if (!stat.isFile()) {
    throw createFileError("目标路径不是文件", "FILE_TARGET_NOT_FILE");
  }

  assertNoWriteConflict(stat, options);

  const encoding = normalizeWritableEncoding(options.encoding);
  const content = String(options.content ?? "");
  const buffer = encodeWritableTextBuffer(content, encoding);

  fs.writeFileSync(resolvedPath, buffer);

  const writtenStat = fs.statSync(resolvedPath);

  return {
    requestedPath,
    resolvedPath,
    baseCwd: resolution.baseCwd,
    baseCwdSource,
    fuzzyMatched: Boolean(resolution.fuzzyMatched),
    bytesWritten: buffer.length,
    totalBytes: Math.max(0, Number(writtenStat.size) || 0),
    encoding,
    modifiedAt: writtenStat.mtime instanceof Date ? writtenStat.mtime.toISOString() : null,
    writtenAt: new Date().toISOString()
  };
}

export function resolveRequestedFilePath(requestedPath, baseCwd) {
  if (isUnsupportedPosixStylePath(requestedPath)) {
    throw new Error("当前 Windows agent 不支持自动转换 POSIX/Git Bash 风格路径，请输入 Windows 绝对路径或基准目录");
  }

  if (isWindowsDriveRelativePath(requestedPath)) {
    throw new Error("请输入完整 Windows 绝对路径，例如 C:\\path\\file.txt");
  }

  if (isAbsoluteFilePath(requestedPath)) {
    return resolveUniqueFilePath(path.resolve(requestedPath), requestedPath, "");
  }

  if (!baseCwd) {
    throw new Error("请输入绝对路径或基准目录");
  }

  if (isUnsupportedPosixStylePath(baseCwd)) {
    throw new Error("当前 Windows agent 不支持自动转换 POSIX/Git Bash 风格基准目录，请输入 Windows 绝对路径");
  }

  if (isWindowsDriveRelativePath(baseCwd)) {
    throw new Error("基准目录必须是完整 Windows 绝对路径，例如 C:\\path");
  }

  if (!isAbsoluteFilePath(baseCwd)) {
    throw new Error("基准目录必须是绝对路径");
  }

  return resolveUniqueFilePath(path.resolve(baseCwd, requestedPath), requestedPath, baseCwd);
}

function resolveUniqueFilePath(exactPath, requestedPath, baseCwd) {
  const exactResolvedPath = path.resolve(exactPath);

  if (fs.existsSync(exactResolvedPath)) {
    return {
      resolvedPath: exactResolvedPath,
      baseCwd,
      fuzzyMatched: false
    };
  }

  const fuzzyPath = findUniqueFuzzyFilePath(exactResolvedPath);

  if (!fuzzyPath) {
    return {
      resolvedPath: exactResolvedPath,
      baseCwd,
      fuzzyMatched: false
    };
  }

  return {
    requestedPath,
    resolvedPath: fuzzyPath,
    baseCwd,
    fuzzyMatched: true
  };
}

function findUniqueFuzzyFilePath(exactPath) {
  const directory = path.dirname(exactPath);
  const requestedName = path.basename(exactPath);

  if (!requestedName || requestedName === "." || requestedName === path.sep) {
    return "";
  }

  const entries = collectFuzzySearchFileEntries(directory);

  if (entries.length === 0) {
    return "";
  }

  return (
    pickUniqueFuzzyFilePath(entries, requestedName, (name, keyword) => name === keyword) ||
    pickUniqueFuzzyFilePath(entries, requestedName, (name, keyword) => name.startsWith(keyword)) ||
    pickUniqueFuzzyFilePath(entries, requestedName, (name, keyword) => name.includes(keyword))
  );
}

function collectFuzzySearchFileEntries(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const pending = [{ directory: root, depth: 0 }];
  const files = [];
  let visitedEntries = 0;

  while (pending.length > 0 && visitedEntries < FUZZY_SEARCH_MAX_ENTRIES) {
    const current = pending.shift();
    let entries;

    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntries += 1;

      if (visitedEntries > FUZZY_SEARCH_MAX_ENTRIES) {
        break;
      }

      const entryPath = path.join(current.directory, entry.name);

      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push({
          name: entry.name,
          path: entryPath
        });
        continue;
      }

      if (
        entry.isDirectory() &&
        current.depth < FUZZY_SEARCH_MAX_DEPTH &&
        !FUZZY_SEARCH_SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())
      ) {
        pending.push({
          directory: entryPath,
          depth: current.depth + 1
        });
      }
    }
  }

  return files;
}

function pickUniqueFuzzyFilePath(entries, requestedName, matcher) {
  const keyword = requestedName.toLowerCase();

  if (!keyword) {
    return "";
  }

  const matches = entries.filter((entry) => matcher(String(entry.name || "").toLowerCase(), keyword));

  if (matches.length === 0) {
    return "";
  }

  if (matches.length === 1) {
    return matches[0].path;
  }

  const error = new Error(
    `文件名匹配到多个候选，请输入更完整的名称: ${matches
      .slice(0, 8)
      .map((entry) => entry.path)
      .join(", ")}`
  );
  error.code = "EAMBIGUOUS";
  throw error;
}

function isAbsoluteFilePath(value) {
  const candidate = normalizeFilePathInput(value);

  if (!candidate) {
    return false;
  }

  if (os.platform() === "win32") {
    return /^[A-Za-z]:[\\/]/.test(candidate) || /^\\\\[^\\]/.test(candidate) || /^\/\/[^/]/.test(candidate);
  }

  return path.isAbsolute(candidate);
}

function isUnsupportedPosixStylePath(value) {
  const candidate = normalizeFilePathInput(value);

  if (os.platform() !== "win32" || !candidate.startsWith("/")) {
    return false;
  }

  return !/^[A-Za-z]:[\\/]/.test(candidate) && !/^\/\//.test(candidate);
}

function isWindowsDriveRelativePath(value) {
  const candidate = normalizeFilePathInput(value);
  return os.platform() === "win32" && /^[A-Za-z]:(?![\\/])/.test(candidate);
}

export function normalizeFilePathInput(value) {
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

function statExistingFile(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createFileError("目标文件不存在", "FILE_NOT_FOUND");
    }

    throw error;
  }
}

function assertExistingDirectory(directory, code, message) {
  let stat;

  try {
    stat = fs.statSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createFileError(message, code);
    }

    throw error;
  }

  if (!stat.isDirectory()) {
    throw createFileError(message, code);
  }
}

function assertNoWriteConflict(stat, options) {
  const currentModifiedAt = stat.mtime instanceof Date ? stat.mtime.toISOString() : "";
  const currentTotalBytes = Math.max(0, Number(stat.size) || 0);

  if (hasExpectedValue(options.expectedModifiedAt) && String(options.expectedModifiedAt) !== currentModifiedAt) {
    throw createFileError("文件已被修改，请刷新后重试", "FILE_CHANGED_CONFLICT", {
      expectedModifiedAt: String(options.expectedModifiedAt),
      actualModifiedAt: currentModifiedAt
    });
  }

  if (hasExpectedValue(options.expectedTotalBytes) && Number(options.expectedTotalBytes) !== currentTotalBytes) {
    throw createFileError("文件大小已变化，请刷新后重试", "FILE_CHANGED_CONFLICT", {
      expectedTotalBytes: Number(options.expectedTotalBytes),
      actualTotalBytes: currentTotalBytes
    });
  }
}

function hasExpectedValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeWritableEncoding(encoding) {
  const requestedEncoding = String(encoding || "").trim();

  if (requestedEncoding && iconv.encodingExists(requestedEncoding)) {
    return requestedEncoding;
  }

  return "utf8";
}

function encodeWritableTextBuffer(content, encoding) {
  const encoded = iconv.encode(content, encoding);

  if (encoding === "utf16-be") {
    return Buffer.concat([Buffer.from([0xfe, 0xff]), encoded]);
  }

  if (encoding === "utf16le") {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), encoded]);
  }

  return encoded;
}

function createFileError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;

  for (const [key, value] of Object.entries(details)) {
    error[key] = value;
  }

  return error;
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
