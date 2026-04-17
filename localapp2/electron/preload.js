import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("localapp2", {
  getSnapshot() {
    return ipcRenderer.invoke("runtime:get-snapshot");
  },
  subscribeRuntime(listener) {
    const handler = (_event, payload) => {
      listener(payload);
    };

    ipcRenderer.on("runtime:changed", handler);

    return () => {
      ipcRenderer.off("runtime:changed", handler);
    };
  },
  getConfig() {
    return ipcRenderer.invoke("config:get");
  },
  updateConfig(payload) {
    return ipcRenderer.invoke("config:update", payload);
  },
  restartRuntime() {
    return ipcRenderer.invoke("runtime:restart");
  },
  generateLocalKeyPair(options) {
    return ipcRenderer.invoke("rsa:generate-localapp2", options);
  },
  importWebserverPublicKey(input) {
    return ipcRenderer.invoke("rsa:import-webserver-public-key", input);
  },
  getKeySummary() {
    return ipcRenderer.invoke("keys:get-summary");
  },
  readAuthPublicKey() {
    return ipcRenderer.invoke("keys:read-auth-public");
  },
  openLogDirectory() {
    return ipcRenderer.invoke("shell:open-log-dir");
  },
  openKeyDirectory() {
    return ipcRenderer.invoke("shell:open-key-dir");
  },
  showMainWindow() {
    return ipcRenderer.invoke("window:show");
  },
  hideToTray() {
    return ipcRenderer.invoke("window:hide");
  }
});
