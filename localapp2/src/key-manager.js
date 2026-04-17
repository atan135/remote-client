import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  createPublicKeyFingerprint,
  normalizeRsaPublicKeyPem
} from "../../shared/secure-command.mjs";

export class KeyManager {
  async generateLocalKeyPair(config, { force = false, passphrase = "" } = {}) {
    await ensureDirectory(path.dirname(config.authPrivateKeyPath));
    await ensureDirectory(path.dirname(config.authPublicKeyPath));

    if (!force) {
      await assertMissing(config.authPrivateKeyPath);
      await assertMissing(config.authPublicKeyPath);
    }

    const privateKeyEncoding = passphrase
      ? {
          type: "pkcs8",
          format: "pem",
          cipher: "aes-256-cbc",
          passphrase
        }
      : {
          type: "pkcs8",
          format: "pem"
        };

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem"
      },
      privateKeyEncoding
    });

    await fs.writeFile(config.authPrivateKeyPath, privateKey, "utf8");
    await fs.writeFile(config.authPublicKeyPath, publicKey, "utf8");

    return this.getSummary(config);
  }

  async importWebserverPublicKey(config, input) {
    const normalized = normalizeRsaPublicKeyPem(String(input || "").trim());
    await ensureDirectory(path.dirname(config.webserverSignPublicKeyPath));
    await fs.writeFile(config.webserverSignPublicKeyPath, `${normalized}\n`, "utf8");
    return this.getSummary(config);
  }

  async getSummary(config) {
    const authPrivateKeyExists = await fileExists(config.authPrivateKeyPath);
    const authPublicKeyPem = await readTextIfExists(config.authPublicKeyPath);
    const webserverSignPublicKeyPem = await readTextIfExists(config.webserverSignPublicKeyPath);

    return {
      authPrivateKeyExists,
      authPrivateKeyPath: config.authPrivateKeyPath,
      authPublicKeyExists: Boolean(authPublicKeyPem),
      authPublicKeyPath: config.authPublicKeyPath,
      authPublicFingerprint: authPublicKeyPem
        ? createPublicKeyFingerprint(authPublicKeyPem)
        : "",
      authPublicKeyPem: authPublicKeyPem || "",
      webserverSignPublicKeyExists: Boolean(webserverSignPublicKeyPem),
      webserverSignPublicKeyPath: config.webserverSignPublicKeyPath,
      webserverSignFingerprint: webserverSignPublicKeyPem
        ? createPublicKeyFingerprint(webserverSignPublicKeyPem)
        : "",
      webserverSignPublicKeyPem: webserverSignPublicKeyPem || "",
      keysReady: Boolean(authPrivateKeyExists && authPublicKeyPem && webserverSignPublicKeyPem)
    };
  }

  async readAuthPublicKey(config) {
    return readTextIfExists(config.authPublicKeyPath);
  }
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function assertMissing(filePath) {
  if (await fileExists(filePath)) {
    throw new Error(`目标文件已存在，拒绝覆盖: ${filePath}`);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }

    throw new Error(`读取密钥文件失败: ${filePath} (${error.message})`);
  }
}
