<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

const agents = ref([]);
const commands = ref([]);
const users = ref([]);
const authCodes = ref([]);
const selectedAgentId = ref("");
const commandInput = ref("");
const submitting = ref(false);
const bootstrapping = ref(true);
const authenticating = ref(false);
const loadingUsers = ref(false);
const loadingAuthCodes = ref(false);
const creatingUser = ref(false);
const creatingAuthCode = ref(false);
const changingPassword = ref(false);
const resettingUserId = ref(null);
const updatingUserId = ref(null);
const savingAuthCodeId = ref(null);
const deletingAuthCodeId = ref(null);
const session = ref(null);
const authMode = ref("login");
const loginForm = reactive({
  username: "",
  password: ""
});
const registerForm = reactive({
  username: "",
  displayName: "",
  password: ""
});
const passwordForm = reactive({
  currentPassword: "",
  newPassword: ""
});
const userForm = reactive({
  username: "",
  displayName: "",
  password: "",
  role: "operator",
  isActive: true
});
const authCodeForm = reactive({
  agentId: "",
  remark: "",
  authCode: ""
});
const wsState = reactive({
  connected: false,
  error: ""
});
const appConfig = reactive({
  allowPublicRegistration: true
});

let socket = null;

const selectedAgentIdKey = computed(() => normalizeAgentId(selectedAgentId.value));

const activeAgent = computed(
  () => agents.value.find((item) => item.agentId === selectedAgentId.value) || null
);

const activeAuthCodeBinding = computed(
  () =>
    authCodes.value.find(
      (item) => normalizeAgentId(item.agentId) === selectedAgentIdKey.value
    ) || null
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

const isAdmin = computed(() => session.value?.user?.role === "admin");

const canSubmitCommand = computed(
  () =>
    Boolean(
      selectedAgentId.value &&
        commandInput.value.trim() &&
        activeAuthCodeBinding.value &&
        !submitting.value
    )
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
    await loadConfig();
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

async function loadConfig() {
  const response = await fetch("/api/config");

  if (!response.ok) {
    throw new Error("加载配置失败");
  }

  const payload = await response.json();
  appConfig.allowPublicRegistration = Boolean(payload.allowPublicRegistration);
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
    authMode.value = "login";

    await loadDashboard();
    connectBrowserSocket();
  } catch (error) {
    wsState.error = error.message;
  } finally {
    authenticating.value = false;
  }
}

async function register() {
  if (
    !registerForm.username.trim() ||
    !registerForm.displayName.trim() ||
    registerForm.password.length < 8
  ) {
    wsState.error = "请填写有效的用户名、显示名和至少 8 位密码";
    return;
  }

  authenticating.value = true;
  wsState.error = "";

  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: registerForm.username.trim(),
        displayName: registerForm.displayName.trim(),
        password: registerForm.password
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || "注册失败");
    }

    wsState.error = "注册成功，请登录";
    authMode.value = "login";
    loginForm.username = registerForm.username.trim();
    registerForm.username = "";
    registerForm.displayName = "";
    registerForm.password = "";
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
    resetAuthedState();
  }
}

async function loadDashboard() {
  const jobs = [loadAgents(), loadCommands(), loadAuthCodes()];

  if (isAdmin.value) {
    jobs.push(loadUsers());
  } else {
    users.value = [];
  }

  await Promise.all(jobs);
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

async function loadAuthCodes() {
  loadingAuthCodes.value = true;

  try {
    const response = await fetch("/api/auth-codes");

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      throw new Error("加载 auth_code 列表失败");
    }

    const payload = await response.json();
    authCodes.value = payload.items || [];
  } finally {
    loadingAuthCodes.value = false;
  }
}

async function loadUsers() {
  if (!isAdmin.value) {
    return;
  }

  loadingUsers.value = true;

  try {
    const response = await fetch("/api/users");

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (response.status === 403) {
      return;
    }

    if (!response.ok) {
      throw new Error("加载用户列表失败");
    }

    const payload = await response.json();
    users.value = payload.items || [];
  } finally {
    loadingUsers.value = false;
  }
}

async function submitCommand() {
  const command = commandInput.value.trim();

  if (!selectedAgentId.value || !command) {
    return;
  }

  if (!activeAuthCodeBinding.value) {
    wsState.error = "请先为当前设备配置 auth_code，再发送命令";
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

async function createAuthCode() {
  if (!authCodeForm.agentId.trim() || !authCodeForm.authCode.trim()) {
    wsState.error = "请填写设备标识和 RSA 公钥";
    return;
  }

  creatingAuthCode.value = true;
  wsState.error = "";

  try {
    const response = await fetch("/api/auth-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId: authCodeForm.agentId.trim(),
        remark: authCodeForm.remark.trim(),
        authCode: authCodeForm.authCode.trim()
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "创建 auth_code 失败");
    }

    authCodeForm.agentId = "";
    authCodeForm.remark = "";
    authCodeForm.authCode = "";
    await loadAuthCodes();
  } catch (error) {
    wsState.error = error.message;
  } finally {
    creatingAuthCode.value = false;
  }
}

async function saveAuthCode(item) {
  savingAuthCodeId.value = item.id;
  wsState.error = "";

  try {
    const response = await fetch(`/api/auth-codes/${item.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId: item.agentId,
        remark: item.remark,
        authCode: item.authCode
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "更新 auth_code 失败");
    }

    Object.assign(item, payload.item);
  } catch (error) {
    wsState.error = error.message;
  } finally {
    savingAuthCodeId.value = null;
  }
}

async function deleteAuthCode(item) {
  if (!window.confirm(`确认删除设备 ${item.agentId} 的 auth_code 吗？`)) {
    return;
  }

  deletingAuthCodeId.value = item.id;
  wsState.error = "";

  try {
    const response = await fetch(`/api/auth-codes/${item.id}`, {
      method: "DELETE"
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "删除 auth_code 失败");
    }

    authCodes.value = authCodes.value.filter((candidate) => candidate.id !== item.id);
  } catch (error) {
    wsState.error = error.message;
  } finally {
    deletingAuthCodeId.value = null;
  }
}

async function submitChangePassword() {
  if (!passwordForm.currentPassword || passwordForm.newPassword.length < 8) {
    wsState.error = "请填写当前密码和至少 8 位新密码";
    return;
  }

  changingPassword.value = true;
  wsState.error = "";

  try {
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "修改密码失败");
    }

    passwordForm.currentPassword = "";
    passwordForm.newPassword = "";
    resetAuthedState();
    wsState.error = "密码已修改，请重新登录";
  } catch (error) {
    wsState.error = error.message;
  } finally {
    changingPassword.value = false;
  }
}

async function createUser() {
  if (
    !userForm.username.trim() ||
    !userForm.displayName.trim() ||
    userForm.password.length < 8
  ) {
    wsState.error = "请填写完整的新用户信息";
    return;
  }

  creatingUser.value = true;
  wsState.error = "";

  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: userForm.username.trim(),
        displayName: userForm.displayName.trim(),
        password: userForm.password,
        role: userForm.role,
        isActive: userForm.isActive
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "创建用户失败");
    }

    userForm.username = "";
    userForm.displayName = "";
    userForm.password = "";
    userForm.role = "operator";
    userForm.isActive = true;
    await loadUsers();
  } catch (error) {
    wsState.error = error.message;
  } finally {
    creatingUser.value = false;
  }
}

async function saveUser(user) {
  updatingUserId.value = user.id;
  wsState.error = "";

  try {
    const response = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        displayName: user.displayName,
        role: user.role,
        isActive: user.isActive
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "更新用户失败");
    }

    Object.assign(user, payload.item);
  } catch (error) {
    wsState.error = error.message;
  } finally {
    updatingUserId.value = null;
  }
}

async function resetPassword(user) {
  const nextPassword = window.prompt(`为用户 ${user.username} 设置新密码`, "ChangeMe123!");

  if (!nextPassword) {
    return;
  }

  if (nextPassword.length < 8) {
    wsState.error = "新密码至少 8 位";
    return;
  }

  resettingUserId.value = user.id;
  wsState.error = "";

  try {
    const response = await fetch(`/api/users/${user.id}/reset-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        newPassword: nextPassword
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "重置密码失败");
    }
  } catch (error) {
    wsState.error = error.message;
  } finally {
    resettingUserId.value = null;
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
  resetAuthedState();
  wsState.error = "登录状态已失效，请重新登录";
}

function resetAuthedState() {
  session.value = null;
  agents.value = [];
  commands.value = [];
  users.value = [];
  authCodes.value = [];
  selectedAgentId.value = "";
  commandInput.value = "";
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

function shortFingerprint(fingerprint) {
  const value = String(fingerprint || "");

  if (!value) {
    return "-";
  }

  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function normalizeAgentId(value) {
  return String(value || "").trim().toLowerCase();
}

function useSelectedAgentIdForAuthCode() {
  if (!selectedAgentId.value) {
    wsState.error = "请先从左侧选择设备";
    return;
  }

  authCodeForm.agentId = selectedAgentId.value;
  wsState.error = "";
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
          <h1>{{ authMode === "login" ? "登录控制台" : "注册账号" }}</h1>
          <p class="subtitle">
            {{
              authMode === "login"
                ? "先完成身份验证，再访问设备控制与命令记录。"
                : "创建新账号后，再回到登录页进入控制台。"
            }}
          </p>

          <template v-if="authMode === 'login'">
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
          </template>

          <template v-else>
            <label class="login-field">
              <span>用户名</span>
              <input v-model="registerForm.username" type="text" placeholder="输入用户名" @keyup.enter="register" />
            </label>

            <label class="login-field">
              <span>显示名</span>
              <input v-model="registerForm.displayName" type="text" placeholder="输入显示名" @keyup.enter="register" />
            </label>

            <label class="login-field">
              <span>密码</span>
              <input v-model="registerForm.password" type="password" placeholder="至少 8 位" @keyup.enter="register" />
            </label>

            <button class="submit-button login-button" :disabled="authenticating" @click="register">
              {{ authenticating ? "提交中..." : "注册" }}
            </button>
          </template>

          <div class="auth-switch">
            <button v-if="appConfig.allowPublicRegistration && authMode === 'login'" class="ghost-button" type="button" @click="authMode = 'register'">
              去注册
            </button>
            <button v-if="authMode === 'register'" class="ghost-button" type="button" @click="authMode = 'login'">
              返回登录
            </button>
          </div>

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
          <small class="status-user">当前用户：{{ displayName }} / {{ session.user.role }}</small>
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

            <div class="binding-summary" :class="{ missing: !activeAuthCodeBinding }">
              <strong>{{ activeAuthCodeBinding ? "auth_code 已绑定" : "缺少 auth_code 绑定" }}</strong>
              <span v-if="activeAuthCodeBinding">
                指纹 {{ shortFingerprint(activeAuthCodeBinding.fingerprint) }}
              </span>
              <span v-else>
                请先在下方 auth_code 管理中为当前设备添加 RSA 公钥
              </span>
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
              <button class="submit-button" :disabled="!canSubmitCommand" @click="submitCommand">
                {{ submitting ? "提交中..." : "发送安全命令" }}
              </button>
            </div>
          </section>

          <section class="panel authcodes-panel">
            <div class="panel-head">
              <div>
                <p class="section-kicker">Auth Codes</p>
                <h2>设备公钥绑定</h2>
              </div>
              <span class="pill">{{ authCodes.length }}</span>
            </div>

            <div class="authcode-create-grid">
              <label class="login-field">
                <span>设备 ID</span>
                <input v-model="authCodeForm.agentId" type="text" placeholder="例如 office-pc-01" />
              </label>
              <label class="login-field">
                <span>备注</span>
                <input v-model="authCodeForm.remark" type="text" placeholder="例如 办公室电脑" />
              </label>
            </div>

            <div class="toolbar compact-toolbar">
              <div class="hint">
                <span>当前选中设备：</span>
                <strong>{{ selectedAgentId || "未选择" }}</strong>
              </div>
              <button class="ghost-button" type="button" @click="useSelectedAgentIdForAuthCode">
                使用当前设备 ID
              </button>
            </div>

            <label class="login-field">
              <span>RSA 公钥 PEM</span>
              <textarea
                v-model="authCodeForm.authCode"
                class="authcode-input"
                rows="7"
                placeholder="粘贴 localapp 生成的 auth_public.pem 内容"
              ></textarea>
            </label>

            <button class="submit-button" :disabled="creatingAuthCode" @click="createAuthCode">
              {{ creatingAuthCode ? "创建中..." : "新增 auth_code" }}
            </button>

            <div class="authcode-list">
              <article v-for="item in authCodes" :key="item.id" class="authcode-card">
                <div class="authcode-card-head">
                  <div>
                    <strong>{{ item.agentId }}</strong>
                    <p>{{ item.updatedAt || item.createdAt }}</p>
                  </div>
                  <span class="pill muted">{{ shortFingerprint(item.fingerprint) }}</span>
                </div>

                <div class="authcode-edit-grid">
                  <label class="login-field">
                    <span>设备 ID</span>
                    <input v-model="item.agentId" type="text" />
                  </label>
                  <label class="login-field">
                    <span>备注</span>
                    <input v-model="item.remark" type="text" />
                  </label>
                </div>

                <label class="login-field">
                  <span>RSA 公钥 PEM</span>
                  <textarea v-model="item.authCode" class="authcode-input" rows="7"></textarea>
                </label>

                <div class="hint-line">
                  <span>authCodeId: {{ item.id }}</span>
                  <span>SHA-256: {{ item.fingerprint }}</span>
                </div>

                <div class="user-actions">
                  <button
                    class="ghost-button"
                    type="button"
                    :disabled="savingAuthCodeId === item.id"
                    @click="saveAuthCode(item)"
                  >
                    {{ savingAuthCodeId === item.id ? "保存中..." : "保存" }}
                  </button>
                  <button
                    class="ghost-button danger-button"
                    type="button"
                    :disabled="deletingAuthCodeId === item.id"
                    @click="deleteAuthCode(item)"
                  >
                    {{ deletingAuthCodeId === item.id ? "删除中..." : "删除" }}
                  </button>
                </div>
              </article>
            </div>

            <p v-if="loadingAuthCodes" class="hint">正在加载 auth_code 列表...</p>
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
                  <div>
                    <dt>安全状态</dt>
                    <dd>{{ item.secureStatus || "-" }}</dd>
                  </div>
                  <div>
                    <dt>authCodeId</dt>
                    <dd>{{ item.authCodeId ?? "-" }}</dd>
                  </div>
                </dl>

                <p v-if="item.securityError" class="inline-error">
                  安全校验失败：{{ item.securityError }}
                </p>

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

          <section class="panel account-panel">
            <div class="panel-head">
              <div>
                <p class="section-kicker">Account</p>
                <h2>修改密码</h2>
              </div>
            </div>

            <div class="form-grid">
              <label class="login-field">
                <span>当前密码</span>
                <input v-model="passwordForm.currentPassword" type="password" placeholder="输入当前密码" />
              </label>

              <label class="login-field">
                <span>新密码</span>
                <input v-model="passwordForm.newPassword" type="password" placeholder="至少 8 位" />
              </label>
            </div>

            <button class="submit-button" :disabled="changingPassword" @click="submitChangePassword">
              {{ changingPassword ? "提交中..." : "修改密码" }}
            </button>
          </section>

          <section v-if="isAdmin" class="panel users-panel">
            <div class="panel-head">
              <div>
                <p class="section-kicker">Users</p>
                <h2>用户管理</h2>
              </div>
              <span class="pill">{{ users.length }}</span>
            </div>

            <div class="user-create-grid">
              <label class="login-field">
                <span>用户名</span>
                <input v-model="userForm.username" type="text" placeholder="新用户名" />
              </label>
              <label class="login-field">
                <span>显示名</span>
                <input v-model="userForm.displayName" type="text" placeholder="显示名" />
              </label>
              <label class="login-field">
                <span>密码</span>
                <input v-model="userForm.password" type="password" placeholder="初始密码" />
              </label>
              <label class="login-field">
                <span>角色</span>
                <select v-model="userForm.role" class="select-input">
                  <option value="admin">admin</option>
                  <option value="operator">operator</option>
                  <option value="viewer">viewer</option>
                </select>
              </label>
            </div>

            <label class="checkbox-row">
              <input v-model="userForm.isActive" type="checkbox" />
              <span>创建后启用</span>
            </label>

            <button class="submit-button" :disabled="creatingUser" @click="createUser">
              {{ creatingUser ? "创建中..." : "创建用户" }}
            </button>

            <div class="user-list">
              <article v-for="user in users" :key="user.id" class="user-card">
                <div class="user-card-head">
                  <div>
                    <strong>{{ user.username }}</strong>
                    <p>{{ user.createdAt }}</p>
                  </div>
                  <span class="tag" :class="user.isActive ? 'completed' : 'failed'">
                    {{ user.isActive ? "active" : "disabled" }}
                  </span>
                </div>

                <div class="user-edit-grid">
                  <label class="login-field">
                    <span>显示名</span>
                    <input v-model="user.displayName" type="text" />
                  </label>
                  <label class="login-field">
                    <span>角色</span>
                    <select v-model="user.role" class="select-input">
                      <option value="admin">admin</option>
                      <option value="operator">operator</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </label>
                </div>

                <label class="checkbox-row">
                  <input v-model="user.isActive" type="checkbox" />
                  <span>启用用户</span>
                </label>

                <div class="user-actions">
                  <button class="ghost-button" type="button" :disabled="updatingUserId === user.id" @click="saveUser(user)">
                    {{ updatingUserId === user.id ? "保存中..." : "保存" }}
                  </button>
                  <button class="ghost-button" type="button" :disabled="resettingUserId === user.id" @click="resetPassword(user)">
                    {{ resettingUserId === user.id ? "提交中..." : "重置密码" }}
                  </button>
                </div>
              </article>
            </div>

            <p v-if="loadingUsers" class="hint">正在加载用户列表...</p>
          </section>
        </section>
      </main>
    </template>
  </div>
</template>
