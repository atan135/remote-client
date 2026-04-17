<script setup>
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

import AuthScreen from "./components/AuthScreen.vue";
import BottomTabBar from "./components/BottomTabBar.vue";
import ExploreTab from "./components/ExploreTab.vue";
import HomeTab from "./components/HomeTab.vue";
import LoadingScreen from "./components/LoadingScreen.vue";
import ProfileTab from "./components/ProfileTab.vue";
import TasksTab from "./components/TasksTab.vue";
import TopBar from "./components/TopBar.vue";

const activeTab = ref("home");
const tabs = [
  {
    key: "home",
    label: "首页",
    action: "设备",
    badge: 0
  },
  {
    key: "explore",
    label: "发现",
    action: "终端",
    badge: 0
  },
  {
    key: "tasks",
    label: "任务",
    action: "记录",
    badge: 0
  },
  {
    key: "profile",
    label: "我的",
    action: "设置",
    badge: 0
  }
];

const agents = ref([]);
const commands = ref([]);
const users = ref([]);
const authCodes = ref([]);
const selectedAgentId = ref("");
const timelineFilterAgentId = ref("all");
const commandInput = ref("");
const bootstrapping = ref(true);
const authenticating = ref(false);
const submitting = ref(false);
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

const avatarLabel = computed(() => {
  const source = session.value?.user?.displayName || session.value?.user?.username || "Q";
  return String(source).slice(0, 1).toUpperCase();
});

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
  if (!timelineFilterAgentId.value || timelineFilterAgentId.value === "all") {
    return commands.value;
  }

  return commands.value.filter((item) => item.agentId === timelineFilterAgentId.value);
});

const isAdmin = computed(() => session.value?.user?.role === "admin");

const onlineAgentCount = computed(
  () => agents.value.filter((item) => item.status === "online").length
);

const displayName = computed(
  () => session.value?.user?.displayName || session.value?.user?.username || ""
);

const canSubmitCommand = computed(
  () =>
    Boolean(
      selectedAgentId.value &&
        commandInput.value.trim() &&
        activeAuthCodeBinding.value &&
        !submitting.value
    )
);

const pendingTaskCount = computed(
  () =>
    commands.value.filter((item) =>
      ["queued", "running", "dispatched"].includes(item.status)
    ).length
);

const failedTaskCount = computed(
  () =>
    commands.value.filter((item) =>
      ["failed", "timed_out", "connection_lost"].includes(item.status)
    ).length
);

const tabBadges = computed(() => ({
  home: onlineAgentCount.value,
  explore: activeAgent.value ? 1 : 0,
  tasks: pendingTaskCount.value || failedTaskCount.value,
  profile: wsState.error ? 1 : 0
}));

const resolvedTabs = computed(() =>
  tabs.map((tab) => ({
    ...tab,
    badge: tabBadges.value[tab.key] || 0
  }))
);

const currentTab = computed(
  () => resolvedTabs.value.find((item) => item.key === activeTab.value) || resolvedTabs.value[0]
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

    authMode.value = "login";
    loginForm.username = registerForm.username.trim();
    registerForm.username = "";
    registerForm.displayName = "";
    registerForm.password = "";
    ElMessage.success("注册成功，请登录");
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
    activeTab.value = "tasks";
    timelineFilterAgentId.value = selectedAgentId.value || "all";
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
    ElMessage.success("auth_code 已创建");
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
    ElMessage.success("auth_code 已更新");
  } catch (error) {
    wsState.error = error.message;
  } finally {
    savingAuthCodeId.value = null;
  }
}

async function deleteAuthCode(item) {
  try {
    await ElMessageBox.confirm(
      `确认删除设备 ${item.agentId} 的 auth_code 吗？`,
      "删除 auth_code",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消"
      }
    );
  } catch {
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
    ElMessage.success("auth_code 已删除");
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
    ElMessage.success("密码已修改，请重新登录");
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
    ElMessage.success("用户已创建");
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
    ElMessage.success("用户已更新");
  } catch (error) {
    wsState.error = error.message;
  } finally {
    updatingUserId.value = null;
  }
}

async function resetPassword(user) {
  let nextPassword = "";

  try {
    const result = await ElMessageBox.prompt(
      `为用户 ${user.username} 设置新密码`,
      "重置密码",
      {
        inputValue: "ChangeMe123!",
        inputPattern: /^.{8,}$/,
        inputErrorMessage: "新密码至少 8 位",
        confirmButtonText: "提交",
        cancelButtonText: "取消"
      }
    );

    nextPassword = result.value;
  } catch {
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

    ElMessage.success(`已为 ${user.username} 重置密码`);
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
    if (
      timelineFilterAgentId.value !== "all" &&
      !agents.value.some((item) => item.agentId === timelineFilterAgentId.value)
    ) {
      timelineFilterAgentId.value = "all";
    }

    return;
  }

  const onlineAgent = agents.value.find((item) => item.status === "online");
  selectedAgentId.value = onlineAgent?.agentId || agents.value[0]?.agentId || "";

  if (
    timelineFilterAgentId.value !== "all" &&
    !agents.value.some((item) => item.agentId === timelineFilterAgentId.value)
  ) {
    timelineFilterAgentId.value = "all";
  }
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
  timelineFilterAgentId.value = "all";
  commandInput.value = "";
  activeTab.value = "home";
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
    wsState.error = "请先选择设备";
    return;
  }

  authCodeForm.agentId = selectedAgentId.value;
  wsState.error = "";
}
</script>

<template>
  <div class="app-demo">
    <div class="ambient ambient-left"></div>
    <div class="ambient ambient-right"></div>

    <LoadingScreen v-if="bootstrapping" />

    <AuthScreen
      v-else-if="!session"
      :auth-mode="authMode"
      :allow-public-registration="appConfig.allowPublicRegistration"
      :login-form="loginForm"
      :register-form="registerForm"
      :authenticating="authenticating"
      :error-message="wsState.error"
      @update:auth-mode="authMode = $event"
      @login="login"
      @register="register"
    />

    <div v-else class="mobile-shell">
      <TopBar :current-tab="currentTab" :avatar-label="avatarLabel" />

      <main class="content">
        <HomeTab
          v-show="activeTab === 'home'"
          :agents="agents"
          :selected-agent-id="selectedAgentId"
          :active-agent="activeAgent"
          :commands="commands"
          :online-agent-count="onlineAgentCount"
          :display-name="displayName"
          :ws-connected="wsState.connected"
          @select-agent="selectedAgentId = $event"
          @go-terminal="activeTab = 'explore'"
        />

        <ExploreTab
          v-show="activeTab === 'explore'"
          :agents="agents"
          :selected-agent-id="selectedAgentId"
          :active-agent="activeAgent"
          :active-auth-code-binding="activeAuthCodeBinding"
          :command-input="commandInput"
          :can-submit-command="canSubmitCommand"
          :submitting="submitting"
          @update:selected-agent-id="selectedAgentId = $event"
          @update:command-input="commandInput = $event"
          @submit-command="submitCommand"
        />

        <TasksTab
          v-show="activeTab === 'tasks'"
          :commands="visibleCommands"
          :agents="agents"
          :timeline-filter-agent-id="timelineFilterAgentId"
          @update:timeline-filter-agent-id="timelineFilterAgentId = $event"
        />

        <ProfileTab
          v-show="activeTab === 'profile'"
          :session="session"
          :display-name="displayName"
          :is-admin="isAdmin"
          :users="users"
          :auth-codes="authCodes"
          :selected-agent-id="selectedAgentId"
          :password-form="passwordForm"
          :user-form="userForm"
          :auth-code-form="authCodeForm"
          :changing-password="changingPassword"
          :creating-user="creatingUser"
          :loading-users="loadingUsers"
          :loading-auth-codes="loadingAuthCodes"
          :creating-auth-code="creatingAuthCode"
          :saving-auth-code-id="savingAuthCodeId"
          :deleting-auth-code-id="deletingAuthCodeId"
          :updating-user-id="updatingUserId"
          :resetting-user-id="resettingUserId"
          @logout="logout"
          @submit-change-password="submitChangePassword"
          @create-user="createUser"
          @save-user="saveUser"
          @reset-password="resetPassword"
          @create-auth-code="createAuthCode"
          @save-auth-code="saveAuthCode"
          @delete-auth-code="deleteAuthCode"
          @use-selected-agent-id="useSelectedAgentIdForAuthCode"
        />
      </main>

      <BottomTabBar
        :tabs="resolvedTabs"
        :active-tab="activeTab"
        @update:active-tab="activeTab = $event"
      />
    </div>
  </div>
</template>
