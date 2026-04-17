<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

const runtimeSnapshot = ref(createEmptySnapshot());
const runtimeConfig = ref(createEmptyConfig());
const keySummary = ref(createEmptyKeySummary());
const importWebserverPublicKey = ref("");
const notice = ref("");
const busy = reactive({
  loading: false,
  saving: false,
  restarting: false,
  generatingKeys: false,
  importingKey: false
});
const configForm = reactive(createEmptyConfig());

let unsubscribeRuntime = null;

const statusLabel = computed(() => runtimeSnapshot.value.connection.status || "offline");
const statusClass = computed(() => statusLabel.value.replace(/\s+/g, "-"));
const snapshotJson = computed(() => JSON.stringify(runtimeSnapshot.value, null, 2));

onMounted(async () => {
  await refreshAll();

  if (window.localapp2?.subscribeRuntime) {
    unsubscribeRuntime = window.localapp2.subscribeRuntime((snapshot) => {
      runtimeSnapshot.value = snapshot;
    });
  } else {
    notice.value = "当前页面未运行在 Electron preload 环境，API 不可用。";
  }
});

onBeforeUnmount(() => {
  unsubscribeRuntime?.();
});

async function refreshAll() {
  if (!window.localapp2) {
    return;
  }

  busy.loading = true;
  notice.value = "";

  try {
    const [snapshot, config, keys] = await Promise.all([
      window.localapp2.getSnapshot(),
      window.localapp2.getConfig(),
      window.localapp2.getKeySummary()
    ]);

    runtimeSnapshot.value = snapshot;
    runtimeConfig.value = config;
    keySummary.value = keys;
    applyConfigToForm(config);
  } catch (error) {
    notice.value = getErrorMessage(error);
  } finally {
    busy.loading = false;
  }
}

async function saveConfig() {
  busy.saving = true;
  notice.value = "";

  try {
    const updatedConfig = await window.localapp2.updateConfig({
      serverWsUrl: configForm.serverWsUrl,
      agentId: configForm.agentId,
      agentLabel: configForm.agentLabel,
      agentSharedToken: configForm.agentSharedToken,
      heartbeatIntervalMs: Number(configForm.heartbeatIntervalMs),
      reconnectIntervalMs: Number(configForm.reconnectIntervalMs),
      commandTimeoutMs: Number(configForm.commandTimeoutMs),
      maxBufferBytes: Number(configForm.maxBufferBytes),
      windowsOutputEncoding: configForm.windowsOutputEncoding,
      minimizeToTray: Boolean(configForm.minimizeToTray),
      launchOnStartup: Boolean(configForm.launchOnStartup)
    });

    runtimeConfig.value = updatedConfig;
    applyConfigToForm(updatedConfig);
    runtimeSnapshot.value = await window.localapp2.getSnapshot();
    notice.value = "配置已保存，runtime 已按新配置重启。";
  } catch (error) {
    notice.value = getErrorMessage(error);
  } finally {
    busy.saving = false;
  }
}

async function restartRuntime() {
  busy.restarting = true;
  notice.value = "";

  try {
    runtimeSnapshot.value = await window.localapp2.restartRuntime();
    keySummary.value = await window.localapp2.getKeySummary();
    notice.value = "runtime 已重启。";
  } catch (error) {
    notice.value = getErrorMessage(error);
  } finally {
    busy.restarting = false;
  }
}

async function generateKeys() {
  busy.generatingKeys = true;
  notice.value = "";

  try {
    keySummary.value = await window.localapp2.generateLocalKeyPair({
      force: true
    });
    runtimeSnapshot.value = await window.localapp2.getSnapshot();
    notice.value = "本机密钥已重新生成。";
  } catch (error) {
    notice.value = getErrorMessage(error);
  } finally {
    busy.generatingKeys = false;
  }
}

async function importWebserverKey() {
  if (!importWebserverPublicKey.value.trim()) {
    notice.value = "请粘贴 webserver_sign_public.pem 内容。";
    return;
  }

  busy.importingKey = true;
  notice.value = "";

  try {
    keySummary.value = await window.localapp2.importWebserverPublicKey(
      importWebserverPublicKey.value
    );
    runtimeSnapshot.value = await window.localapp2.getSnapshot();
    importWebserverPublicKey.value = "";
    notice.value = "服务端签名公钥已导入。";
  } catch (error) {
    notice.value = getErrorMessage(error);
  } finally {
    busy.importingKey = false;
  }
}

async function copyAuthPublicKey() {
  try {
    const text = await window.localapp2.readAuthPublicKey();

    if (!text) {
      notice.value = "当前还没有可复制的 auth_public.pem。";
      return;
    }

    await navigator.clipboard.writeText(text);
    notice.value = "本机公钥已复制到剪贴板。";
  } catch (error) {
    notice.value = getErrorMessage(error);
  }
}

async function openLogDirectory() {
  try {
    await window.localapp2.openLogDirectory();
  } catch (error) {
    notice.value = getErrorMessage(error);
  }
}

async function openKeyDirectory() {
  try {
    await window.localapp2.openKeyDirectory();
  } catch (error) {
    notice.value = getErrorMessage(error);
  }
}

function applyConfigToForm(config) {
  Object.assign(configForm, {
    serverWsUrl: config.serverWsUrl || "",
    agentId: config.agentId || "",
    agentLabel: config.agentLabel || "",
    agentSharedToken: config.agentSharedToken || "",
    heartbeatIntervalMs: config.heartbeatIntervalMs ?? 15000,
    reconnectIntervalMs: config.reconnectIntervalMs ?? 5000,
    commandTimeoutMs: config.commandTimeoutMs ?? 120000,
    maxBufferBytes: config.maxBufferBytes ?? 1048576,
    windowsOutputEncoding: config.windowsOutputEncoding || "cp936",
    minimizeToTray: Boolean(config.minimizeToTray),
    launchOnStartup: Boolean(config.launchOnStartup)
  });
}

function createEmptySnapshot() {
  return {
    app: {
      started: false,
      startedAt: null,
      stoppedAt: null
    },
    connection: {
      status: "offline",
      serverWsUrl: "",
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: ""
    },
    agent: {
      agentId: "",
      agentLabel: "",
      hostname: "",
      pid: null
    },
    security: {
      keysReady: false,
      authPublicFingerprint: "",
      webserverSignFingerprint: "",
      authPublicKeyPath: "",
      webserverSignPublicKeyPath: ""
    },
    commands: {
      processing: false,
      queueLength: 0,
      bufferedMessages: 0
    }
  };
}

function createEmptyConfig() {
  return {
    serverWsUrl: "",
    agentId: "",
    agentLabel: "",
    agentSharedToken: "",
    heartbeatIntervalMs: 15000,
    reconnectIntervalMs: 5000,
    commandTimeoutMs: 120000,
    maxBufferBytes: 1048576,
    windowsOutputEncoding: "cp936",
    minimizeToTray: true,
    launchOnStartup: false
  };
}

function createEmptyKeySummary() {
  return {
    authPrivateKeyExists: false,
    authPrivateKeyPath: "",
    authPublicKeyExists: false,
    authPublicKeyPath: "",
    authPublicFingerprint: "",
    authPublicKeyPem: "",
    webserverSignPublicKeyExists: false,
    webserverSignPublicKeyPath: "",
    webserverSignFingerprint: "",
    keysReady: false
  };
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
</script>

<template>
  <div class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Remote LocalApp2</p>
        <h1>Electron Windows Agent Skeleton</h1>
        <p class="hero-copy">
          第一版骨架已接入配置存储、托盘宿主、密钥管理入口，以及来自
          <code>localapp</code> 的同步业务核心文件。
        </p>
      </div>

      <div class="status-card">
        <span class="status-label" :class="statusClass">{{ statusLabel }}</span>
        <strong>{{ runtimeSnapshot.agent.agentId || "未设置 agentId" }}</strong>
        <small>{{ runtimeSnapshot.connection.serverWsUrl || "未配置服务端地址" }}</small>
      </div>
    </header>

    <main class="grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Runtime</p>
            <h2>运行状态</h2>
          </div>

          <div class="toolbar">
            <button type="button" @click="refreshAll" :disabled="busy.loading">
              {{ busy.loading ? "刷新中..." : "刷新" }}
            </button>
            <button type="button" @click="restartRuntime" :disabled="busy.restarting">
              {{ busy.restarting ? "重启中..." : "重启 runtime" }}
            </button>
          </div>
        </div>

        <dl class="facts">
          <div>
            <dt>连接状态</dt>
            <dd>{{ runtimeSnapshot.connection.status }}</dd>
          </div>
          <div>
            <dt>主机名</dt>
            <dd>{{ runtimeSnapshot.agent.hostname || "-" }}</dd>
          </div>
          <div>
            <dt>最后连接时间</dt>
            <dd>{{ runtimeSnapshot.connection.lastConnectedAt || "-" }}</dd>
          </div>
          <div>
            <dt>最后错误</dt>
            <dd>{{ runtimeSnapshot.connection.lastError || "-" }}</dd>
          </div>
          <div>
            <dt>命令队列</dt>
            <dd>{{ runtimeSnapshot.commands.queueLength }}</dd>
          </div>
          <div>
            <dt>离线缓冲</dt>
            <dd>{{ runtimeSnapshot.commands.bufferedMessages }}</dd>
          </div>
        </dl>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Config</p>
            <h2>本地配置</h2>
          </div>
        </div>

        <div class="form-grid">
          <label>
            <span>服务端地址</span>
            <input v-model="configForm.serverWsUrl" type="text" />
          </label>
          <label>
            <span>Agent ID</span>
            <input v-model="configForm.agentId" type="text" />
          </label>
          <label>
            <span>Agent Label</span>
            <input v-model="configForm.agentLabel" type="text" />
          </label>
          <label>
            <span>共享 Token</span>
            <input v-model="configForm.agentSharedToken" type="text" />
          </label>
          <label>
            <span>Heartbeat</span>
            <input v-model="configForm.heartbeatIntervalMs" type="number" />
          </label>
          <label>
            <span>Reconnect</span>
            <input v-model="configForm.reconnectIntervalMs" type="number" />
          </label>
          <label>
            <span>命令超时</span>
            <input v-model="configForm.commandTimeoutMs" type="number" />
          </label>
          <label>
            <span>最大缓冲</span>
            <input v-model="configForm.maxBufferBytes" type="number" />
          </label>
          <label>
            <span>Windows 编码</span>
            <input v-model="configForm.windowsOutputEncoding" type="text" />
          </label>
        </div>

        <div class="toggle-grid">
          <label class="toggle">
            <input v-model="configForm.minimizeToTray" type="checkbox" />
            <span>最小化到托盘</span>
          </label>
          <label class="toggle">
            <input v-model="configForm.launchOnStartup" type="checkbox" />
            <span>开机自启</span>
          </label>
        </div>

        <button type="button" class="primary" @click="saveConfig" :disabled="busy.saving">
          {{ busy.saving ? "保存中..." : "保存配置" }}
        </button>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Keys</p>
            <h2>密钥管理</h2>
          </div>

          <div class="toolbar">
            <button type="button" @click="openKeyDirectory">打开密钥目录</button>
            <button type="button" @click="openLogDirectory">打开日志目录</button>
          </div>
        </div>

        <dl class="facts">
          <div>
            <dt>本机私钥</dt>
            <dd>{{ keySummary.authPrivateKeyExists ? "已存在" : "未生成" }}</dd>
          </div>
          <div>
            <dt>本机公钥</dt>
            <dd>{{ keySummary.authPublicKeyExists ? "已存在" : "未生成" }}</dd>
          </div>
          <div>
            <dt>公钥指纹</dt>
            <dd>{{ keySummary.authPublicFingerprint || "-" }}</dd>
          </div>
          <div>
            <dt>服务端签名公钥</dt>
            <dd>{{ keySummary.webserverSignPublicKeyExists ? "已导入" : "未导入" }}</dd>
          </div>
          <div>
            <dt>签名公钥指纹</dt>
            <dd>{{ keySummary.webserverSignFingerprint || "-" }}</dd>
          </div>
          <div>
            <dt>Keys Ready</dt>
            <dd>{{ keySummary.keysReady ? "true" : "false" }}</dd>
          </div>
        </dl>

        <div class="toolbar">
          <button type="button" @click="generateKeys" :disabled="busy.generatingKeys">
            {{ busy.generatingKeys ? "生成中..." : "重新生成本机密钥" }}
          </button>
          <button type="button" @click="copyAuthPublicKey">复制本机公钥</button>
        </div>

        <label class="stacked">
          <span>导入 webserver_sign_public.pem</span>
          <textarea
            v-model="importWebserverPublicKey"
            rows="7"
            placeholder="粘贴服务端签名公钥 PEM"
          />
        </label>

        <button type="button" class="primary" @click="importWebserverKey" :disabled="busy.importingKey">
          {{ busy.importingKey ? "导入中..." : "导入服务端签名公钥" }}
        </button>

        <label class="stacked">
          <span>当前 auth_public.pem</span>
          <textarea :value="keySummary.authPublicKeyPem || ''" rows="7" readonly />
        </label>
      </section>

      <section class="panel full">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Snapshot</p>
            <h2>结构化状态快照</h2>
          </div>
        </div>

        <pre class="snapshot">{{ snapshotJson }}</pre>
      </section>
    </main>

    <p v-if="notice" class="notice">{{ notice }}</p>
  </div>
</template>
