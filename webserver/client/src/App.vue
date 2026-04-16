<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

const agents = ref([]);
const commands = ref([]);
const selectedAgentId = ref("");
const commandInput = ref("");
const submitting = ref(false);
const bootstrapping = ref(true);
const authenticating = ref(false);
const session = ref(null);
const loginForm = reactive({
  username: "",
  password: ""
});
const wsState = reactive({
  connected: false,
  error: ""
});

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

const displayName = computed(
  () => session.value?.user?.displayName || session.value?.user?.username || ""
);

onMounted(async () => {
  await bootstrap();
});

onBeforeUnmount(() => {
  disconnectBrowserSocket();
});

async function bootstrap() {
  bootstrapping.value = true;
  wsState.error = "";

  try {
    await fetch("/api/config");
    const authenticated = await loadSession();

    if (authenticated) {
      await loadDashboard();
      connectBrowserSocket();
    }
  } catch (error) {
    wsState.error = error.message;
  } finally {
    bootstrapping.value = false;
  }
}

async function loadSession() {
  const response = await fetch("/api/auth/session");

  if (response.status === 401) {
    session.value = null;
    return false;
  }

  if (!response.ok) {
    throw new Error("加载登录状态失败");
  }

  const payload = await response.json();
  session.value = payload;
  return true;
}

async function login() {
  if (!loginForm.username.trim() || !loginForm.password) {
    wsState.error = "请输入用户名和密码";
    return;
  }

  authenticating.value = true;
  wsState.error = "";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: loginForm.username.trim(),
        password: loginForm.password
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "登录失败");
    }

    session.value = payload;
    loginForm.password = "";

    await loadDashboard();
    connectBrowserSocket();
  } catch (error) {
    wsState.error = error.message;
  } finally {
    authenticating.value = false;
  }
}

async function logout() {
  disconnectBrowserSocket();

  try {
    await fetch("/api/auth/logout", {
      method: "POST"
    });
  } finally {
    session.value = null;
    agents.value = [];
    commands.value = [];
    selectedAgentId.value = "";
    commandInput.value = "";
  }
}

async function loadDashboard() {
  await Promise.all([loadAgents(), loadCommands()]);
  ensureSelectedAgent();
}

async function loadAgents() {
  const response = await fetch("/api/agents");

  if (response.status === 401) {
    await handleUnauthorized();
    return;
  }

  if (!response.ok) {
    throw new Error("加载设备列表失败");
  }

  const payload = await response.json();
  agents.value = payload.items || [];
}

async function loadCommands() {
  const response = await fetch("/api/commands");

  if (response.status === 401) {
    await handleUnauthorized();
    return;
  }

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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId: selectedAgentId.value,
        command
      })
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "命令提交失败");
    }

    commandInput.value = "";
  } catch (error) {
    wsState.error = error.message;
  } finally {
    submitting.value = false;
  }
}

function connectBrowserSocket() {
  disconnectBrowserSocket();

  if (!session.value) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/ws/browser`);

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

    if (session.value) {
      window.setTimeout(connectBrowserSocket, 3000);
    }
  });

  socket.addEventListener("error", () => {
    wsState.error = "实时通道连接失败";
  });
}

function disconnectBrowserSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
}

function ensureSelectedAgent() {
  if (selectedAgentId.value && agents.value.some((item) => item.agentId === selectedAgentId.value)) {
    return;
  }

  const onlineAgent = agents.value.find((item) => item.status === "online");
  selectedAgentId.value = onlineAgent?.agentId || agents.value[0]?.agentId || "";
}

async function handleUnauthorized() {
  disconnectBrowserSocket();
  session.value = null;
  agents.value = [];
  commands.value = [];
  selectedAgentId.value = "";
  wsState.error = "登录状态已失效，请重新登录";
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

    <template v-if="bootstrapping">
      <main class="login-shell">
        <section class="panel login-panel">
          <p class="eyebrow">Remote Control Console</p>
          <h1>正在检查登录状态</h1>
          <p class="subtitle">系统正在连接服务端并恢复当前会话。</p>
        </section>
      </main>
    </template>

    <template v-else-if="!session">
      <main class="login-shell">
        <section class="panel login-panel">
          <p class="eyebrow">Remote Control Console</p>
          <h1>登录控制台</h1>
          <p class="subtitle">先完成身份验证，再访问设备控制与命令记录。</p>

          <label class="login-field">
            <span>用户名</span>
            <input v-model="loginForm.username" type="text" placeholder="输入用户名" @keyup.enter="login" />
          </label>

          <label class="login-field">
            <span>密码</span>
            <input v-model="loginForm.password" type="password" placeholder="输入密码" @keyup.enter="login" />
          </label>

          <button class="submit-button login-button" :disabled="authenticating" @click="login">
            {{ authenticating ? "登录中..." : "登录" }}
          </button>

          <p v-if="wsState.error" class="login-error">{{ wsState.error }}</p>
        </section>
      </main>
    </template>

    <template v-else>
      <header class="hero">
        <div>
          <p class="eyebrow">Remote Control Console</p>
          <h1>内外网指令桥</h1>
          <p class="subtitle">
            控制台通过服务端下发命令，内网 agent 主动执行并把结果实时回传。
          </p>
        </div>

        <div class="status-card">
          <div class="status-head">
            <div>
              <span class="status-dot" :class="{ online: wsState.connected }"></span>
              <strong>{{ wsState.connected ? "实时链路在线" : "实时链路重连中" }}</strong>
            </div>
            <button class="ghost-button" type="button" @click="logout">退出登录</button>
          </div>
          <p>{{ wsState.error || "浏览器和服务端之间的事件通道正常工作。" }}</p>
          <small class="status-user">当前用户：{{ displayName }}</small>
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
    </template>
  </div>
</template>

