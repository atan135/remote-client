<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

const agents = ref([]);
const commands = ref([]);
const selectedAgentId = ref("");
const commandInput = ref("");
const submitting = ref(false);
const wsState = reactive({
  connected: false,
  error: ""
});
const appConfig = reactive({
  controlTokenRequired: false
});

const controlToken = ref(localStorage.getItem("controlToken") || "");
const controlTokenDraft = ref(controlToken.value);
let socket = null;

const activeAgent = computed(
  () => agents.value.find((item) => item.agentId === selectedAgentId.value) || null
);

const visibleCommands = computed(() => {
  if (!selectedAgentId.value) {
    return commands.value;
  }

  return commands.value.filter((item) => item.agentId === selectedAgentId.value);
});

onMounted(async () => {
  try {
    await loadBootstrapData();
  } catch (error) {
    wsState.error = error.message;
  }

  connectBrowserSocket();
});

onBeforeUnmount(() => {
  if (socket) {
    socket.close();
  }
});

async function loadBootstrapData() {
  await loadConfig();
  await Promise.all([loadAgents(), loadCommands()]);
  ensureSelectedAgent();
}

async function applyControlToken() {
  controlToken.value = controlTokenDraft.value.trim();
  localStorage.setItem("controlToken", controlToken.value);

  try {
    await loadBootstrapData();
    connectBrowserSocket();
  } catch (error) {
    wsState.error = error.message;
  }
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const payload = await response.json();
  appConfig.controlTokenRequired = Boolean(payload.controlTokenRequired);
}

async function loadAgents() {
  const response = await fetch("/api/agents", {
    headers: createHeaders()
  });

  if (!response.ok) {
    throw new Error("加载设备列表失败");
  }

  const payload = await response.json();
  agents.value = payload.items || [];
}

async function loadCommands() {
  const response = await fetch("/api/commands", {
    headers: createHeaders()
  });

  if (!response.ok) {
    throw new Error("加载命令记录失败");
  }

  const payload = await response.json();
  commands.value = payload.items || [];
}

async function submitCommand() {
  const command = commandInput.value.trim();

  if (!selectedAgentId.value || !command) {
    return;
  }

  submitting.value = true;
  wsState.error = "";

  try {
    const response = await fetch("/api/commands", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createHeaders()
      },
      body: JSON.stringify({
        agentId: selectedAgentId.value,
        command
      })
    });

    if (!response.ok) {
      throw new Error("命令提交失败");
    }

    commandInput.value = "";
  } catch (error) {
    wsState.error = error.message;
  } finally {
    submitting.value = false;
  }
}

function connectBrowserSocket() {
  if (socket) {
    socket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/ws/browser`);

  if (controlToken.value) {
    url.searchParams.set("token", controlToken.value);
  }

  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    wsState.connected = true;
    wsState.error = "";
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "snapshot") {
      agents.value = message.payload.agents || [];
      commands.value = message.payload.commands || [];
      ensureSelectedAgent();
      return;
    }

    if (message.type === "agent.updated") {
      upsertByKey(agents.value, message.payload, "agentId");
      ensureSelectedAgent();
      return;
    }

    if (message.type === "command.updated") {
      upsertByKey(commands.value, message.payload, "requestId");
    }
  });

  socket.addEventListener("close", () => {
    wsState.connected = false;
    window.setTimeout(connectBrowserSocket, 3000);
  });

  socket.addEventListener("error", () => {
    wsState.error = "实时通道连接失败";
  });
}

function ensureSelectedAgent() {
  if (selectedAgentId.value && agents.value.some((item) => item.agentId === selectedAgentId.value)) {
    return;
  }

  const onlineAgent = agents.value.find((item) => item.status === "online");
  selectedAgentId.value = onlineAgent?.agentId || agents.value[0]?.agentId || "";
}

function createHeaders() {
  if (!controlToken.value) {
    return {};
  }

  return {
    "x-control-token": controlToken.value
  };
}

function upsertByKey(collection, item, key) {
  const index = collection.findIndex((candidate) => candidate[key] === item[key]);

  if (index === -1) {
    collection.unshift(item);
  } else {
    collection[index] = item;
  }

  if (key === "requestId") {
    collection.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } else {
    collection.sort((left, right) => left.label.localeCompare(right.label));
  }
}
</script>

<template>
  <div class="app-shell">
    <div class="ambient ambient-left"></div>
    <div class="ambient ambient-right"></div>

    <header class="hero">
      <div>
        <p class="eyebrow">Remote Control Console</p>
        <h1>内外网指令桥</h1>
        <p class="subtitle">
          控制台通过服务端下发命令，内网 agent 主动执行并把结果实时回传。
        </p>
      </div>

      <div class="status-card">
        <span class="status-dot" :class="{ online: wsState.connected }"></span>
        <strong>{{ wsState.connected ? "实时链路在线" : "实时链路重连中" }}</strong>
        <p>{{ wsState.error || "浏览器和服务端之间的事件通道正常工作。" }}</p>
      </div>
    </header>

    <main class="dashboard">
      <aside class="panel agents-panel">
        <div class="panel-head">
          <div>
            <p class="section-kicker">Agents</p>
            <h2>设备</h2>
          </div>
          <span class="pill">{{ agents.length }}</span>
        </div>

        <label v-if="appConfig.controlTokenRequired" class="token-field">
          <span>控制令牌</span>
          <div class="token-inline">
            <input
              v-model="controlTokenDraft"
              type="password"
              placeholder="输入 CONTROL_TOKEN"
              @keyup.enter="applyControlToken"
            />
            <button class="token-button" type="button" @click="applyControlToken">应用</button>
          </div>
        </label>

        <div class="agent-list">
          <button
            v-for="agent in agents"
            :key="agent.agentId"
            class="agent-item"
            :class="{ selected: selectedAgentId === agent.agentId }"
            @click="selectedAgentId = agent.agentId"
          >
            <div class="agent-title">
              <strong>{{ agent.label }}</strong>
              <span class="tag" :class="agent.status">{{ agent.status }}</span>
            </div>
            <p>{{ agent.hostname || agent.agentId }}</p>
            <small>{{ agent.platform }} / {{ agent.arch }}</small>
          </button>
        </div>
      </aside>

      <section class="workbench">
        <section class="panel command-panel">
          <div class="panel-head">
            <div>
              <p class="section-kicker">Dispatch</p>
              <h2>命令下发</h2>
            </div>
            <span class="pill muted">{{ activeAgent?.label || "未选择设备" }}</span>
          </div>

          <textarea
            v-model="commandInput"
            class="command-input"
            placeholder="例如：ipconfig /all 或 hostname"
            rows="5"
          ></textarea>

          <div class="toolbar">
            <div class="hint">
              <span>目标设备：</span>
              <strong>{{ activeAgent?.agentId || "未选择" }}</strong>
            </div>
            <button class="submit-button" :disabled="submitting || !selectedAgentId || !commandInput.trim()" @click="submitCommand">
              {{ submitting ? "提交中..." : "发送命令" }}
            </button>
          </div>
        </section>

        <section class="panel timeline-panel">
          <div class="panel-head">
            <div>
              <p class="section-kicker">Timeline</p>
              <h2>执行记录</h2>
            </div>
            <span class="pill">{{ visibleCommands.length }}</span>
          </div>

          <div class="command-list">
            <article v-for="item in visibleCommands" :key="item.requestId" class="command-card">
              <div class="command-header">
                <div>
                  <strong>{{ item.command }}</strong>
                  <p>{{ item.agentId }}</p>
                </div>
                <span class="tag" :class="item.status">{{ item.status }}</span>
              </div>

              <dl class="meta-grid">
                <div>
                  <dt>创建时间</dt>
                  <dd>{{ item.createdAt }}</dd>
                </div>
                <div>
                  <dt>退出码</dt>
                  <dd>{{ item.exitCode ?? "-" }}</dd>
                </div>
              </dl>

              <div v-if="item.stdout" class="output-block">
                <h3>STDOUT</h3>
                <pre>{{ item.stdout }}</pre>
              </div>

              <div v-if="item.stderr || item.error" class="output-block error">
                <h3>STDERR / ERROR</h3>
                <pre>{{ item.stderr || item.error }}</pre>
              </div>
            </article>
          </div>
        </section>
      </section>
    </main>
  </div>
</template>
