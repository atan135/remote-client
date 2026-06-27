import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  SECURE_COMMAND_ALGORITHMS,
  createPublicKeyFingerprint,
  createRsaPrivateKey,
  createRsaPublicKey,
  encryptSecureCommandPayload,
  signSecureEnvelope
} from "../../../../shared/secure-command.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");

export class SecureCommandService {
  constructor(config) {
    this.config = config;
  }

  getSigningKeyInfo() {
    const privateKeyPem = readTextFile(resolvePackagePath(this.config.webserverSignPrivateKeyPath));
    const publicKeyPem = readTextFile(resolvePackagePath(this.config.webserverSignPublicKeyPath));
    const privateKey = createRsaPrivateKey(
      privateKeyPem,
      this.config.webserverSignPrivateKeyPassphrase
    );
    const publicKey = createRsaPublicKey(publicKeyPem);

    return {
      privateKey,
      publicKey,
      fingerprint: createPublicKeyFingerprint(publicKeyPem)
    };
  }

  createSecureEnvelope({ commandRecord, operatorUser, authCodeBinding }) {
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();

    return this.createEncryptedEnvelope({
      messageType: "command.execute.secure",
      requestId: commandRecord.requestId,
      agentId: commandRecord.agentId,
      operatorUser,
      authCodeBinding,
      plaintextPayload: {
        requestId: commandRecord.requestId,
        agentId: commandRecord.agentId,
        command: commandRecord.command,
        shell: commandRecord.commandShell || "",
        createdAt: commandRecord.createdAt,
        issuedAt: sentAt,
        expiresAt,
        nonce: randomUUID()
      },
      sentAt,
      expiresAt
    });
  }

  createTerminalSessionCreateEnvelope({
    sessionRecord,
    operatorUser,
    authCodeBinding,
    launchPayload
  }) {
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();

    return this.createEncryptedEnvelope({
      messageType: "terminal.session.create.secure",
      requestId: sessionRecord.requestId,
      agentId: sessionRecord.agentId,
      operatorUser,
      authCodeBinding,
      plaintextPayload: {
        requestId: sessionRecord.requestId,
        sessionId: sessionRecord.sessionId,
        agentId: sessionRecord.agentId,
        sessionType: sessionRecord.sessionType,
        profile: sessionRecord.profile,
        cwd: launchPayload.cwd || "",
        env: launchPayload.env || {},
        cols: launchPayload.cols || 120,
        rows: launchPayload.rows || 30,
        createdAt: sessionRecord.createdAt,
        issuedAt: sentAt,
        expiresAt,
        nonce: randomUUID()
      },
      sentAt,
      expiresAt,
      metaExtra: {
        sessionId: sessionRecord.sessionId,
        profile: sessionRecord.profile
      }
    });
  }

  createTerminalSessionInputEnvelope({
    requestId,
    agentId,
    sessionId,
    input,
    operatorUser,
    authCodeBinding
  }) {
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();

    return this.createEncryptedEnvelope({
      messageType: "terminal.session.input.secure",
      requestId,
      agentId,
      operatorUser,
      authCodeBinding,
      plaintextPayload: {
        requestId,
        sessionId,
        agentId,
        input,
        issuedAt: sentAt,
        expiresAt,
        nonce: randomUUID()
      },
      sentAt,
      expiresAt,
      metaExtra: {
        sessionId
      }
    });
  }

  createTerminalSessionResizeEnvelope({
    requestId,
    agentId,
    sessionId,
    cols,
    rows,
    operatorUser,
    authCodeBinding
  }) {
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();

    return this.createEncryptedEnvelope({
      messageType: "terminal.session.resize.secure",
      requestId,
      agentId,
      operatorUser,
      authCodeBinding,
      plaintextPayload: {
        requestId,
        sessionId,
        agentId,
        cols,
        rows,
        issuedAt: sentAt,
        expiresAt,
        nonce: randomUUID()
      },
      sentAt,
      expiresAt,
      metaExtra: {
        sessionId
      }
    });
  }

  createTerminalSessionTerminateEnvelope({
    requestId,
    agentId,
    sessionId,
    operatorUser,
    authCodeBinding
  }) {
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();

    return this.createEncryptedEnvelope({
      messageType: "terminal.session.terminate.secure",
      requestId,
      agentId,
      operatorUser,
      authCodeBinding,
      plaintextPayload: {
        requestId,
        sessionId,
        agentId,
        issuedAt: sentAt,
        expiresAt,
        nonce: randomUUID()
      },
      sentAt,
      expiresAt,
      metaExtra: {
        sessionId
      }
    });
  }

  createFileReadEnvelope({
    requestId,
    agentId,
    sessionId,
    filePath,
    baseCwd,
    operatorUser,
    authCodeBinding
  }) {
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();

    return this.createEncryptedEnvelope({
      messageType: "file.read.secure",
      requestId,
      agentId,
      operatorUser,
      authCodeBinding,
      plaintextPayload: {
        requestId,
        agentId,
        sessionId: String(sessionId || ""),
        filePath,
        baseCwd: String(baseCwd || ""),
        issuedAt: sentAt,
        expiresAt,
        nonce: randomUUID()
      },
      sentAt,
      expiresAt,
      metaExtra: {
        sessionId: String(sessionId || ""),
        filePath,
        hasBaseCwd: Boolean(String(baseCwd || "").trim())
      }
    });
  }

  createFileWriteEnvelope({
    requestId,
    agentId,
    sessionId,
    filePath,
    resolvedPath,
    baseCwd,
    encoding,
    expectedModifiedAt,
    expectedTotalBytes,
    content,
    operatorUser,
    authCodeBinding
  }) {
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();
    const normalizedContent = String(content ?? "");

    return this.createEncryptedEnvelope({
      messageType: "file.write.secure",
      requestId,
      agentId,
      operatorUser,
      authCodeBinding,
      plaintextPayload: {
        requestId,
        agentId,
        sessionId: String(sessionId || ""),
        filePath,
        resolvedPath,
        baseCwd: String(baseCwd || ""),
        encoding: String(encoding || "utf8"),
        expectedModifiedAt: expectedModifiedAt || null,
        expectedTotalBytes: expectedTotalBytes ?? null,
        content: normalizedContent,
        issuedAt: sentAt,
        expiresAt,
        nonce: randomUUID()
      },
      sentAt,
      expiresAt,
      metaExtra: {
        sessionId: String(sessionId || ""),
        filePath,
        resolvedPath,
        hasBaseCwd: Boolean(String(baseCwd || "").trim()),
        encoding: String(encoding || "utf8"),
        contentChars: normalizedContent.length,
        contentBytes: getTextByteLength(normalizedContent, encoding)
      }
    });
  }

  createEncryptedEnvelope({
    messageType,
    requestId,
    agentId,
    operatorUser,
    authCodeBinding,
    plaintextPayload,
    sentAt,
    expiresAt,
    metaExtra = {}
  }) {
    const authCodePublicKey = createRsaPublicKey(authCodeBinding.authCode);
    const signingKeyInfo = this.getSigningKeyInfo();
    const encryptedPayload = encryptSecureCommandPayload(plaintextPayload, authCodePublicKey);
    const payload = {
      messageType,
      requestId,
      agentId,
      operatorUserId: operatorUser.id,
      authCodeId: authCodeBinding.id,
      encryptKeyVersion: 1,
      signKeyVersion: 1,
      algorithm: SECURE_COMMAND_ALGORITHMS,
      ...encryptedPayload
    };

    payload.signature = signSecureEnvelope({
      payload,
      sentAt,
      privateKey: signingKeyInfo.privateKey
    });

    return {
      type: messageType,
      payload,
      sentAt,
      meta: {
        authCodeId: authCodeBinding.id,
        authCodeFingerprint: authCodeBinding.fingerprint,
        authCodeRemark: authCodeBinding.remark,
        webserverSignFingerprint: signingKeyInfo.fingerprint,
        expiresAt,
        ...metaExtra
      }
    };
  }
}

function resolvePackagePath(filePath) {
  return path.resolve(packageRoot, filePath);
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`读取密钥文件失败: ${filePath} (${error.message})`);
  }
}

function getTextByteLength(value, encoding = "utf8") {
  try {
    return Buffer.byteLength(String(value ?? ""), String(encoding || "utf8"));
  } catch {
    return Buffer.byteLength(String(value ?? ""), "utf8");
  }
}
