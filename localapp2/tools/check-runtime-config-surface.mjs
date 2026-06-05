import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../../localapp/src/config.js";
import { ConfigStore } from "../src/config-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const localapp2OnlyKeys = new Set(["authPublicKeyPath", "closeToTray", "launchOnStartup"]);

const localappConfigKeys = Object.keys(loadConfig()).sort();
const configStore = new ConfigStore({
  userDataDir: path.join(repoRoot, "localapp2/.tmp/config-surface-check"),
  env: {}
});
const localapp2ConfigKeys = Object.keys(configStore.getDefaultConfig()).sort();

const missingInLocalapp2 = localappConfigKeys.filter(
  (key) => !localapp2ConfigKeys.includes(key)
);
const unexpectedLocalapp2Only = localapp2ConfigKeys.filter(
  (key) => !localappConfigKeys.includes(key) && !localapp2OnlyKeys.has(key)
);

if (missingInLocalapp2.length === 0 && unexpectedLocalapp2Only.length === 0) {
  console.log("OK localapp2 runtime config surface matches localapp");
  process.exit(0);
}

if (missingInLocalapp2.length > 0) {
  console.error(`Missing in localapp2 config: ${missingInLocalapp2.join(", ")}`);
}

if (unexpectedLocalapp2Only.length > 0) {
  console.error(`Unexpected localapp2-only config keys: ${unexpectedLocalapp2Only.join(", ")}`);
}

process.exit(1);
