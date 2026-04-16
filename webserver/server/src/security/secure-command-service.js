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
    const authCodePublicKey = createRsaPublicKey(authCodeBinding.authCode);
    const signingKeyInfo = this.getSigningKeyInfo();
    const issuedAt = new Date();
    const sentAt = issuedAt.toISOString();
    const expiresAt = new Date(issuedAt.getTime() + this.config.secureCommandTtlMs).toISOString();
    const plaintextPayload = {
      requestId: commandRecord.requestId,
      agentId: commandRecord.agentId,
      command: commandRecord.command,
      createdAt: commandRecord.createdAt,
      issuedAt: sentAt,
      expiresAt,
      nonce: randomUUID()
    };
    const encryptedPayload = encryptSecureCommandPayload(plaintextPayload, authCodePublicKey);
    const payload = {
      requestId: commandRecord.requestId,
      agentId: commandRecord.agentId,
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
      type: "command.execute.secure",
      payload,
      sentAt,
      meta: {
        authCodeId: authCodeBinding.id,
        authCodeFingerprint: authCodeBinding.fingerprint,
        authCodeRemark: authCodeBinding.remark,
        webserverSignFingerprint: signingKeyInfo.fingerprint,
        expiresAt
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
