import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  ipcMain,
  nativeImage,
  shell
} from "electron";

import { ConfigStore } from "../src/config-store.js";
import { KeyManager } from "../src/key-manager.js";
import { Localapp2Runtime } from "../src/runtime-adapter.js";
import { RuntimeStateStore } from "../src/runtime-state-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const rendererEntryPath = path.resolve(packageRoot, "dist/renderer/index.html");

dotenv.config({
  path: path.resolve(packageRoot, ".env")
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let currentConfig = null;

const stateStore = new RuntimeStateStore();
const configStore = new ConfigStore({
  userDataDir: app.getPath("userData")
});
const keyManager = new KeyManager();
const runtime = new Localapp2Runtime({
  configStore,
  keyManager,
  stateStore
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  }
});

stateStore.subscribe((snapshot) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("runtime:changed", snapshot);
    }
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  void runtime.stop();
});

app.whenReady().then(async () => {
  currentConfig = await configStore.load();
  applyLoginItemSettings(currentConfig);
  registerIpcHandlers();
  mainWindow = await createMainWindow();
  await runtime.start();
  createTray();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = await createMainWindow();
  } else {
    mainWindow?.show();
  }
});

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: "#0c1512",
    webPreferences: {
      preload: path.resolve(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  window.on("close", (event) => {
    if (isQuitting || !currentConfig?.closeToTray) {
      return;
    }

    event.preventDefault();
    window.hide();
  });

  if (process.env.LOCALAPP2_RENDERER_URL) {
    await window.loadURL(process.env.LOCALAPP2_RENDERER_URL);
  } else {
    await window.loadFile(rendererEntryPath);
  }

  return window;
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Remote LocalApp2");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", () => {
    mainWindow?.show();
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "打开主界面",
      click: () => {
        mainWindow?.show();
      }
    },
    {
      label: "重启连接",
      click: () => {
        void runtime.restart();
      }
    },
    {
      label: "复制本机公钥",
      click: async () => {
        const config = await loadCurrentConfig();
        const publicKey = await keyManager.readAuthPublicKey(config);

        if (publicKey) {
          clipboard.writeText(publicKey);
        }
      }
    },
    {
      label: "打开日志目录",
      click: async () => {
        const config = await loadCurrentConfig();
        await shell.openPath(config.logDir);
      }
    },
    {
      type: "separator"
    },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#143a2c" stroke="#63d1a2" />
      <path d="M5 8h6" stroke="#f4fff9" stroke-width="1.4" stroke-linecap="round" />
      <path d="M8 5v6" stroke="#f4fff9" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  `.trim();

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  );
}

function registerIpcHandlers() {
  ipcMain.handle("runtime:get-snapshot", async () => runtime.getSnapshot());

  ipcMain.handle("runtime:restart", async () => {
    await runtime.restart();
    return runtime.getSnapshot();
  });

  ipcMain.handle("config:get", async () => loadCurrentConfig());

  ipcMain.handle("config:update", async (_event, payload) => {
    currentConfig = await configStore.update(payload);
    applyLoginItemSettings(currentConfig);
    await runtime.restart();
    return currentConfig;
  });

  ipcMain.handle("keys:get-summary", async () => {
    const config = await loadCurrentConfig();
    return keyManager.getSummary(config);
  });

  ipcMain.handle("rsa:generate-localapp2", async (_event, options = {}) => {
    const config = await loadCurrentConfig();
    const result = await keyManager.generateLocalKeyPair(config, options);
    await runtime.refreshSecurityState();
    return result;
  });

  ipcMain.handle("rsa:import-webserver-public-key", async (_event, input) => {
    const config = await loadCurrentConfig();
    const result = await keyManager.importWebserverPublicKey(config, input);
    await runtime.refreshSecurityState();
    return result;
  });

  ipcMain.handle("shell:open-log-dir", async () => {
    const config = await loadCurrentConfig();
    return shell.openPath(config.logDir);
  });

  ipcMain.handle("shell:open-key-dir", async () => {
    const config = await loadCurrentConfig();
    return shell.openPath(path.dirname(config.authPrivateKeyPath));
  });

  ipcMain.handle("keys:read-auth-public", async () => {
    const config = await loadCurrentConfig();
    return keyManager.readAuthPublicKey(config);
  });

  ipcMain.handle("window:show", async () => {
    mainWindow?.show();
    return true;
  });

  ipcMain.handle("window:hide", async () => {
    mainWindow?.hide();
    return true;
  });
}

async function loadCurrentConfig() {
  currentConfig = await configStore.load();
  return currentConfig;
}

function applyLoginItemSettings(config) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(config.launchOnStartup)
    });
  } catch {
    // Ignore unsupported environments while keeping the stored preference.
  }
}
