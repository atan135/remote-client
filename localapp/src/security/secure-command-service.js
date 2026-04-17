import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicKeyFingerprint,
  createRsaPrivateKey,
  createRsaPublicKey,
  decryptSecureCommandPayload,
  verifySecureEnvelopeSignature
} from "../../../shared/secure-command.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");

export class SecureCommandError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SecureCommandError";
    this.code = code;
  }
}

export class SecureCommandService {
  constructor(config) {
    this.config = config;
    this.nonceCache = new Map();
  }

  unwrapMessage(message, options = {}) {
    const expectedType = options.expectedType || "command.execute.secure";

    if (message.type !== expectedType) {
      throw new SecureCommandError(`不接受消息类型 ${String(message.type || "")}`, "unexpected_type");
    }

    const payload = message.payload || {};
    const signature = String(payload.signature || "");
    const sentAt = String(message.sentAt || "");

    if (!payload.requestId || !payload.agentId || !signature || !sentAt) {
      throw new SecureCommandError("安全消息结构不完整", "invalid_envelope");
    }

    if (String(payload.messageType || "") !== expectedType) {
      throw new SecureCommandError("签名消息类型与外层消息类型不匹配", "message_type_mismatch");
    }

    const webserverPublicKeyInfo = this.loadWebserverPublicKey();
    const signatureValid = verifySecureEnvelopeSignature({
      payload,
      sentAt,
      signature,
      publicKey: webserverPublicKeyInfo.publicKey
    });

    if (!signatureValid) {
      throw new SecureCommandError("消息签名校验失败", "invalid_signature");
    }

    const authPrivateKeyInfo = this.loadAuthPrivateKey();
    const plaintext = decryptSecureCommandPayload(payload, authPrivateKeyInfo.privateKey);

    this.validatePlaintextPayload(plaintext, options.requiredFields || []);

    return {
      payload: plaintext,
      meta: {
        authCodeId: payload.authCodeId ?? null,
        encryptKeyVersion: payload.encryptKeyVersion ?? null,
        signKeyVersion: payload.signKeyVersion ?? null,
        webserverSignFingerprint: webserverPublicKeyInfo.fingerprint
      }
    };
  }

  loadWebserverPublicKey() {
    const publicKeyPath = resolvePackagePath(this.config.webserverSignPublicKeyPath);
    const publicKeyPem = readTextFile(publicKeyPath);
    const publicKey = createRsaPublicKey(publicKeyPem);

    return {
      publicKey,
      path: publicKeyPath,
      fingerprint: createPublicKeyFingerprint(publicKeyPem)
    };
  }

  loadAuthPrivateKey() {
    const privateKeyPath = resolvePackagePath(this.config.authPrivateKeyPath);
    const privateKeyPem = readTextFile(privateKeyPath);
    const privateKey = createRsaPrivateKey(
      privateKeyPem,
      this.config.authPrivateKeyPassphrase
    );

    return {
      privateKey,
      path: privateKeyPath
    };
  }

  validatePlaintextPayload(payload, requiredFields = []) {
    this.pruneNonceCache();

    if (!payload || typeof payload !== "object") {
      throw new SecureCommandError("解密后的命令载荷无效", "invalid_plaintext");
    }

    if (String(payload.agentId || "") !== this.config.agentId) {
      throw new SecureCommandError("agentId 与本地配置不匹配", "agent_mismatch");
    }

    const expiresAt = Date.parse(String(payload.expiresAt || ""));

    if (!Number.isFinite(expiresAt)) {
      throw new SecureCommandError("expiresAt 无效", "invalid_expiry");
    }

    if (Date.now() > expiresAt) {
      throw new SecureCommandError("安全命令已过期", "expired_command");
    }

    const nonce = String(payload.nonce || "");

    if (!nonce) {
      throw new SecureCommandError("nonce 缺失", "missing_nonce");
    }

    if (this.nonceCache.has(nonce)) {
      throw new SecureCommandError("检测到重复 nonce，命令已拒绝", "replayed_nonce");
    }

    for (const fieldName of requiredFields) {
      if (!hasRequiredField(payload, fieldName)) {
        throw new SecureCommandError(`缺少必要字段: ${fieldName}`, "missing_required_field");
      }
    }

    this.nonceCache.set(nonce, expiresAt);
  }

  pruneNonceCache() {
    const now = Date.now();

    for (const [nonce, expiresAt] of this.nonceCache.entries()) {
      if (expiresAt <= now) {
        this.nonceCache.delete(nonce);
      }
    }
  }
}

function resolvePackagePath(filePath) {
  return path.resolve(packageRoot, filePath);
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new SecureCommandError(`读取密钥文件失败: ${filePath} (${error.message})`, "key_read_failed");
  }
}

function hasRequiredField(payload, fieldName) {
  if (fieldName === "command") {
    return Boolean(String(payload.command || "").trim());
  }

  if (fieldName === "input") {
    return typeof payload.input === "string" && payload.input.length > 0;
  }

  return Boolean(String(payload[fieldName] || "").trim());
}
