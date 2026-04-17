import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ConfigStore } from "../src/config-store.js";
import { KeyManager } from "../src/key-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const defaultUserDataDir = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
  "remote-localapp2"
);

const configStore = new ConfigStore({
  userDataDir: process.env.LOCALAPP2_USERDATA_DIR || defaultUserDataDir,
  env: process.env
});
const keyManager = new KeyManager();

const serverBaseUrl = process.env.LOCALAPP2_VERIFY_BASE_URL || "http://127.0.0.1:3100";
const verifyCommand = process.env.LOCALAPP2_VERIFY_COMMAND || "hostname";
const verifyLimitMs = Number(process.env.LOCALAPP2_VERIFY_TIMEOUT_MS || 45000);
const loginUsername = process.env.LOCALAPP2_VERIFY_USERNAME || "admin";
const loginPassword = process.env.LOCALAPP2_VERIFY_PASSWORD || "ChangeMe123!";
const webserverPublicKeyPath = path.resolve(
  repoRoot,
  "webserver/server/keys/webserver_sign_public.pem"
);

const result = await verifySecureChain();
console.log(JSON.stringify(result, null, 2));

async function verifySecureChain() {
  const config = await configStore.load();
  const generated = await keyManager.generateLocalKeyPair(config, {
    force: true,
    passphrase: config.authPrivateKeyPassphrase || ""
  });
  const webserverPublicKey = await fs.readFile(webserverPublicKeyPath, "utf8");
  const imported = await keyManager.importWebserverPublicKey(config, webserverPublicKey);
  const authPublicKeyPem = await keyManager.readAuthPublicKey(config);

  if (!authPublicKeyPem) {
    throw new Error("localapp2 auth_public.pem 生成失败");
  }

  const session = await loginAndCreateSession();
  const authCodeBinding = await upsertAuthCodeBinding(session.cookie, config.agentId, authPublicKeyPem);
  const commandRecord = await dispatchCommand(session.cookie, config.agentId, verifyCommand);
  const finalRecord = await waitForCommandResult(session.cookie, commandRecord.requestId);

  return {
    config: {
      agentId: config.agentId,
      serverWsUrl: config.serverWsUrl
    },
    keySummary: {
      generatedFingerprint: generated.authPublicFingerprint,
      importedFingerprint: imported.webserverSignFingerprint
    },
    authCodeBinding: {
      id: authCodeBinding.id,
      agentId: authCodeBinding.agentId,
      fingerprint: authCodeBinding.fingerprint
    },
    command: {
      requestId: finalRecord.requestId,
      status: finalRecord.status,
      secureStatus: finalRecord.secureStatus,
      stdout: finalRecord.stdout,
      stderr: finalRecord.stderr,
      error: finalRecord.error,
      securityError: finalRecord.securityError,
      exitCode: finalRecord.exitCode
    }
  };
}

async function loginAndCreateSession() {
  const response = await fetch(`${serverBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: loginUsername,
      password: loginPassword
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || `登录失败: ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];

  if (!cookie) {
    throw new Error("登录成功但未拿到 session cookie");
  }

  return {
    cookie,
    user: payload.user
  };
}

async function upsertAuthCodeBinding(cookie, agentId, authCodePem) {
  const listResponse = await fetch(`${serverBaseUrl}/api/auth-codes`, {
    headers: {
      Cookie: cookie
    }
  });

  const listPayload = await listResponse.json().catch(() => ({}));

  if (!listResponse.ok) {
    throw new Error(listPayload.message || `加载 auth_code 失败: ${listResponse.status}`);
  }

  const existing = (listPayload.items || []).find((item) => item.agentId === agentId);
  const body = JSON.stringify({
    agentId,
    authCode: authCodePem,
    remark: "localapp2 verification binding"
  });

  if (existing) {
    const updateResponse = await fetch(`${serverBaseUrl}/api/auth-codes/${existing.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      body
    });

    const updatePayload = await updateResponse.json().catch(() => ({}));

    if (!updateResponse.ok) {
      throw new Error(updatePayload.message || `更新 auth_code 失败: ${updateResponse.status}`);
    }

    return updatePayload.item;
  }

  const createResponse = await fetch(`${serverBaseUrl}/api/auth-codes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body
  });

  const createPayload = await createResponse.json().catch(() => ({}));

  if (!createResponse.ok) {
    throw new Error(createPayload.message || `创建 auth_code 失败: ${createResponse.status}`);
  }

  return createPayload.item;
}

async function dispatchCommand(cookie, agentId, command) {
  const response = await fetch(`${serverBaseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      agentId,
      command
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || `下发命令失败: ${response.status}`);
  }

  return payload.item;
}

async function waitForCommandResult(cookie, requestId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < verifyLimitMs) {
    const response = await fetch(`${serverBaseUrl}/api/commands?limit=100`, {
      headers: {
        Cookie: cookie
      }
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || `查询命令记录失败: ${response.status}`);
    }

    const item = (payload.items || []).find((entry) => entry.requestId === requestId);

    if (item && ["completed", "failed", "timed_out", "connection_lost"].includes(item.status)) {
      return item;
    }

    await sleep(1500);
  }

  throw new Error(`等待命令完成超时: ${requestId}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
