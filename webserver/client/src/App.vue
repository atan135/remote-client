<script setup>
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

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

const fallbackTerminalProfiles = Object.freeze([
  {
    name: "default_shell_session",
    label: "默认 Shell",
    runner: "pty",
    command: "shell",
    cwdPolicy: "allowlist",
    outputMode: "terminal",
    finalOutputMarkers: null,
    idleTimeoutMs: 30 * 60 * 1000,
    envAllowlist: [],
    isAvailable: true,
    unavailableReason: "",
    source: "fallback",
    kind: "shell",
    description: "agent 未上报 profile 时的默认 shell 兜底项",
    recommended: true
  }
]);
const TERMINAL_OUTPUT_BUFFER_LIMIT = 200;

const agents = ref([]);
const commands = ref([]);
const terminalSessions = ref([]);
const users = ref([]);
const authCodes = ref([]);
const selectedAgentId = ref("");
const selectedTerminalSessionId = ref("");
const timelineFilterAgentId = ref("all");
const commandInput = ref("");
const terminalProfile = ref("");
const terminalCwd = ref("");
const terminalInput = ref("");
const remoteFilePath = ref("");
const bootstrapping = ref(true);
const authenticating = ref(false);
const submitting = ref(false);
const creatingTerminalSession = ref(false);
const sendingTerminalInput = ref(false);
const readingRemoteFile = ref(false);
const loadingUsers = ref(false);
const loadingAuthCodes = ref(false);
const creatingUser = ref(false);
const creatingAuthCode = ref(false);
const changingPassword = ref(false);
const resettingUserId = ref(null);
const updatingUserId = ref(null);
const savingAuthCodeId = ref(null);
const deletingAuthCodeId = ref(null);
const terminatingTerminalSessionId = ref(null);
const deletingTerminalSessionId = ref(null);
const session = ref(null);
const authMode = ref("login");
const remoteFileError = ref("");
const remoteFileViewer = ref(createEmptyRemoteFileViewer());

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
const terminalSocketInputQueue = [];
const pendingTerminalSocketInputs = [];
let flushingTerminalSocketInput = false;
let terminalSocketInputFlushTimer = null;
const pendingTerminalResizes = new Map();
let flushingTerminalResize = false;
let terminalResizeFlushTimer = null;
let browserSocketConnectionId = 0;
let browserReconnectTimer = null;

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

const availableTerminalProfiles = computed(() => {
  if (!activeAgent.value) {
    return [];
  }

  const profiles = Array.isArray(activeAgent.value.terminalProfiles)
    ? activeAgent.value.terminalProfiles.filter((profile) => Boolean(profile?.name))
    : [];

  return (profiles.length > 0 ? profiles : fallbackTerminalProfiles)
    .map((profile) => normalizeTerminalProfileRecord(profile))
    .sort(compareTerminalProfileRecords);
});

const selectedTerminalProfileConfig = computed(
  () => availableTerminalProfiles.value.find((item) => item.name === terminalProfile.value) || null
);

const visibleTerminalSessions = computed(() =>
  terminalSessions.value.filter((item) => item.agentId === selectedAgentId.value)
);

const activeTerminalSession = computed(
  () =>
    visibleTerminalSessions.value.find(
      (item) => item.sessionId === selectedTerminalSessionId.value
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

const canCreateTerminalSession = computed(
  () =>
    Boolean(
      selectedAgentId.value &&
        terminalProfile.value &&
        selectedTerminalProfileConfig.value?.isAvailable !== false &&
        activeAuthCodeBinding.value &&
        !creatingTerminalSession.value
    )
);

const canSendTerminalInput = computed(
  () =>
    Boolean(
      activeTerminalSession.value &&
        terminalInput.value &&
        !sendingTerminalInput.value &&
        !isTerminalSessionClosedStatus(activeTerminalSession.value.status)
    )
);

const canTerminateTerminalSession = computed(
  () =>
    Boolean(
      activeTerminalSession.value &&
        !isTerminalSessionClosedStatus(activeTerminalSession.value.status) &&
        terminatingTerminalSessionId.value !== activeTerminalSession.value.sessionId
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

const runningTerminalSessionCount = computed(
  () =>
    visibleTerminalSessions.value.filter(
      (item) => !isTerminalSessionClosedStatus(item.status)
    ).length
);

const tabBadges = computed(() => ({
  home: onlineAgentCount.value,
  explore: runningTerminalSessionCount.value || (activeAgent.value ? 1 : 0),
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

watch(selectedAgentId, () => {
  ensureSelectedTerminalProfile();
  ensureSelectedTerminalSession();
  resetRemoteFileViewer();
});

watch(availableTerminalProfiles, () => {
  ensureSelectedTerminalProfile();
});

watch(visibleTerminalSessions, () => {
  ensureSelectedTerminalSession();
});

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
  const jobs = [loadAgents(), loadCommands(), loadTerminalSessions(), loadAuthCodes()];

  if (isAdmin.value) {
    jobs.push(loadUsers());
  } else {
    users.value = [];
  }

  await Promise.all(jobs);
  ensureSelectedAgent();
  ensureSelectedTerminalProfile();
  ensureSelectedTerminalSession();
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

async function loadTerminalSessions() {
  const response = await fetch("/api/terminal-sessions");

  if (response.status === 401) {
    await handleUnauthorized();
    return;
  }

  if (!response.ok) {
    throw new Error("加载终端会话失败");
  }

  const payload = await response.json();
  terminalSessions.value = payload.items || [];
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

async function submitCommand(commandOverride) {
  const commandSource = commandOverride === undefined ? commandInput.value : commandOverride;
  const command = String(commandSource || "").trim();

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

async function createTerminalSession() {
  if (!selectedAgentId.value || !terminalProfile.value) {
    return;
  }

  if (!activeAuthCodeBinding.value) {
    wsState.error = "请先为当前设备配置 auth_code，再创建终端会话";
    return;
  }

  if (selectedTerminalProfileConfig.value?.isAvailable === false) {
    wsState.error =
      selectedTerminalProfileConfig.value.unavailableReason ||
      `终端 profile 当前不可用: ${terminalProfile.value}`;
    return;
  }

  creatingTerminalSession.value = true;
  wsState.error = "";

  try {
    const response = await fetch("/api/terminal-sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId: selectedAgentId.value,
        profile: terminalProfile.value,
        cwd: terminalCwd.value.trim(),
        env: {},
        cols: 120,
        rows: 30
      })
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || "终端会话创建失败");
    }

    if (payload.item) {
      upsertTerminalSession(payload.item);
      selectedTerminalSessionId.value = payload.item.sessionId;
    }

    terminalInput.value = "";
  } catch (error) {
    wsState.error = error.message;
  } finally {
    creatingTerminalSession.value = false;
  }
}

async function sendTerminalInput(payloadOrSessionId = activeTerminalSession.value?.sessionId) {
  const payload =
    payloadOrSessionId && typeof payloadOrSessionId === "object"
      ? payloadOrSessionId
      : {
          sessionId: payloadOrSessionId,
          input: terminalInput.value
        };
  const sessionId = String(payload?.sessionId || activeTerminalSession.value?.sessionId || "").trim();
  const sessionRecord = terminalSessions.value.find((item) => item.sessionId === sessionId);
  const input = String(payload?.input || "");

  if (!sessionRecord || !input) {
    return;
  }

  sendingTerminalInput.value = true;
  wsState.error = "";

  try {
    enqueueTerminalSocketInput(
      sessionRecord.sessionId,
      buildSessionInputPayload(sessionRecord, input),
      {
        logicalInput: input
      }
    );
    terminalInput.value = "";
  } catch (error) {
    wsState.error = error.message;
  } finally {
    sendingTerminalInput.value = false;
  }
}

function updateRemoteFilePath(value) {
  remoteFilePath.value = String(value || "");
  remoteFileError.value = "";
}

async function openRemoteFile(payload = {}) {
  const sessionId = String(payload?.sessionId || activeTerminalSession.value?.sessionId || "").trim();
  const filePath = String(payload?.filePath || remoteFilePath.value || "").trim();

  if (!selectedAgentId.value || !sessionId) {
    return;
  }

  if (!filePath) {
    remoteFileError.value = "请输入要打开的文件路径";
    return;
  }

  if (!activeAuthCodeBinding.value) {
    remoteFileError.value = "请先为当前设备配置 auth_code，再读取文件";
    return;
  }

  readingRemoteFile.value = true;
  remoteFileError.value = "";

  try {
    const response = await fetch("/api/remote-files/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId: selectedAgentId.value,
        sessionId,
        filePath
      })
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "远程读取文件失败");
    }

    remoteFileViewer.value = normalizeRemoteFileViewer(result.item, sessionId);
    remoteFilePath.value = remoteFileViewer.value.filePath || filePath;
  } catch (error) {
    remoteFileError.value = error.message;
  } finally {
    readingRemoteFile.value = false;
  }
}

function queueTerminalRawInput(inputOrPayload, sessionId = activeTerminalSession.value?.sessionId) {
  const payload =
    inputOrPayload && typeof inputOrPayload === "object"
      ? inputOrPayload
      : {
          input: inputOrPayload,
          sessionId
        };
  const normalizedSessionId = String(payload?.sessionId || sessionId || "").trim();
  const normalizedInput = String(payload?.input || "");
  const sessionRecord = terminalSessions.value.find(
    (item) => item.sessionId === normalizedSessionId
  );

  if (
    !normalizedSessionId ||
    !normalizedInput ||
    !sessionRecord ||
    isTerminalSessionClosedStatus(sessionRecord.status)
  ) {
    return;
  }

  terminalSocketInputQueue.push({
    sessionId: normalizedSessionId,
    input: normalizedInput
  });

  if (terminalSocketInputFlushTimer) {
    return;
  }

  terminalSocketInputFlushTimer = window.setTimeout(() => {
    terminalSocketInputFlushTimer = null;
    flushQueuedTerminalSocketInputs();
  }, 16);
}

function flushQueuedTerminalSocketInputs() {
  while (terminalSocketInputQueue.length > 0) {
    const current = terminalSocketInputQueue.shift();

    if (!current?.sessionId || !current.input) {
      continue;
    }

    let combinedInput = current.input;

    while (terminalSocketInputQueue[0]?.sessionId === current.sessionId) {
      const next = terminalSocketInputQueue.shift();
      combinedInput += String(next?.input || "");
    }

    enqueueTerminalSocketInput(current.sessionId, combinedInput);
  }
}

function enqueueTerminalSocketInput(sessionId, input, options = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedInput = String(input || "");
  const logicalInput = String(options?.logicalInput || "");
  const sessionRecord = terminalSessions.value.find((item) => item.sessionId === normalizedSessionId);

  if (
    !normalizedSessionId ||
    !normalizedInput ||
    !sessionRecord ||
    isTerminalSessionClosedStatus(sessionRecord.status)
  ) {
    return;
  }

  pendingTerminalSocketInputs.push({
    inputId: createClientInputId(),
    sessionId: normalizedSessionId,
    input: normalizedInput,
    logicalInput,
    createdAt: new Date().toISOString(),
    lastSentAt: "",
    sentConnectionId: 0,
    status: "queued",
    error: ""
  });

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    wsState.error = "实时通道暂时断开，输入已排队，连接恢复后会自动重发";
  }

  flushPendingTerminalSocketInputs();
}

function queueTerminalResize(payload) {
  const sessionId = String(payload?.sessionId || "").trim();
  const cols = normalizeTerminalDimension(payload?.cols);
  const rows = normalizeTerminalDimension(payload?.rows);
  const sessionRecord = terminalSessions.value.find((item) => item.sessionId === sessionId);

  if (
    !sessionRecord ||
    !cols ||
    !rows ||
    isTerminalSessionClosedStatus(sessionRecord.status)
  ) {
    return;
  }

  const pending = pendingTerminalResizes.get(sessionId);

  if (pending?.cols === cols && pending?.rows === rows) {
    return;
  }

  pendingTerminalResizes.set(sessionId, {
    sessionId,
    cols,
    rows
  });

  if (terminalResizeFlushTimer) {
    return;
  }

  terminalResizeFlushTimer = window.setTimeout(() => {
    terminalResizeFlushTimer = null;
    flushQueuedTerminalResizes();
  }, 80);
}

function flushQueuedTerminalResizes() {
  if (flushingTerminalResize || pendingTerminalResizes.size === 0) {
    return;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  flushingTerminalResize = true;
  const items = [...pendingTerminalResizes.values()];
  pendingTerminalResizes.clear();

  try {
    for (const item of items) {
      socket.send(
        JSON.stringify({
          type: "terminal.session.resize",
          payload: item
        })
      );
    }
  } catch (error) {
    for (const item of items) {
      pendingTerminalResizes.set(item.sessionId, item);
    }

    wsState.error = error.message || "终端尺寸同步失败";
  } finally {
    flushingTerminalResize = false;
  }
}

function flushPendingTerminalSocketInputs() {
  if (flushingTerminalSocketInput) {
    return;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  flushingTerminalSocketInput = true;

  try {
    for (const item of pendingTerminalSocketInputs) {
      if (
        !item ||
        item.status === "accepted" ||
        item.sentConnectionId === browserSocketConnectionId
      ) {
        continue;
      }

      socket.send(
        JSON.stringify({
          type: "terminal.session.input",
          payload: {
            inputId: item.inputId,
            sessionId: item.sessionId,
            input: item.input,
            logicalInput: item.logicalInput || ""
          }
        })
      );
      item.status = "sent";
      item.error = "";
      item.lastSentAt = new Date().toISOString();
      item.sentConnectionId = browserSocketConnectionId;
    }
  } catch (error) {
    wsState.error = error.message || "终端输入发送失败";
  } finally {
    flushingTerminalSocketInput = false;
  }
}

function applyTerminalInputAck(payload) {
  const inputId = String(payload?.inputId || "");

  if (!inputId) {
    return;
  }

  const index = pendingTerminalSocketInputs.findIndex((item) => item.inputId === inputId);

  if (index === -1) {
    return;
  }

  const status = String(payload?.status || "");
  const error = String(payload?.error || "");

  if (status === "accepted" || status === "duplicate") {
    pendingTerminalSocketInputs.splice(index, 1);
    return;
  }

  pendingTerminalSocketInputs.splice(index, 1);
  wsState.error = error || "终端输入发送失败";
}

function createClientInputId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `input-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function terminateTerminalSession(sessionId = activeTerminalSession.value?.sessionId) {
  if (!sessionId) {
    return;
  }

  terminatingTerminalSessionId.value = sessionId;
  wsState.error = "";

  try {
    const response = await fetch(`/api/terminal-sessions/${sessionId}/terminate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 404 && payload.message === "会话不存在") {
        reconcileMissingTerminalSession(sessionId);
        ElMessage.warning("会话已不存在，界面已按结束处理");
        return;
      }

      throw new Error(payload.message || "终端会话终止失败");
    }

    if (payload?.item?.sessionId) {
      upsertTerminalSession(payload.item);
      ensureSelectedTerminalSession();
    }
  } catch (error) {
    wsState.error = error.message;
  } finally {
    terminatingTerminalSessionId.value = null;
  }
}

async function deleteTerminalSession(sessionId = activeTerminalSession.value?.sessionId) {
  if (!sessionId) {
    return;
  }

  const sessionRecord = terminalSessions.value.find((item) => item.sessionId === sessionId);

  if (!sessionRecord) {
    removeTerminalSession(sessionId);
    ensureSelectedTerminalSession();
    return;
  }

  if (!isTerminalSessionClosedStatus(sessionRecord.status)) {
    wsState.error = "仅允许删除已结束的终端会话";
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确认删除会话 ${getTerminalProfileDisplayName(sessionRecord) || sessionId} 吗？删除后将从列表中移除。`,
      "删除会话",
      {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }

  deletingTerminalSessionId.value = sessionId;
  wsState.error = "";

  try {
    const response = await fetch(`/api/terminal-sessions/${sessionId}`, {
      method: "DELETE"
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 404) {
        removeTerminalSession(sessionId);
        ensureSelectedTerminalSession();
        ElMessage.warning("会话已不存在，已从列表移除");
        return;
      }

      throw new Error(payload.message || "终端会话删除失败");
    }

    removeTerminalSession(sessionId);
    ensureSelectedTerminalSession();
    ElMessage.success("终端会话已删除");
  } catch (error) {
    wsState.error = error.message;
  } finally {
    deletingTerminalSessionId.value = null;
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
  const connectionId = browserSocketConnectionId + 1;

  browserSocketConnectionId = connectionId;

  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    if (connectionId !== browserSocketConnectionId) {
      return;
    }

    if (browserReconnectTimer) {
      window.clearTimeout(browserReconnectTimer);
      browserReconnectTimer = null;
    }

    wsState.connected = true;
    wsState.error = "";
    flushPendingTerminalSocketInputs();
    flushQueuedTerminalResizes();
  });

  socket.addEventListener("message", (event) => {
    if (connectionId !== browserSocketConnectionId) {
      return;
    }

    const message = JSON.parse(event.data);

    if (message.type === "snapshot") {
      agents.value = message.payload.agents || [];
      commands.value = message.payload.commands || [];
      terminalSessions.value = mergeTerminalSessionSnapshot(
        terminalSessions.value,
        message.payload.terminalSessions || []
      );
      ensureSelectedAgent();
      ensureSelectedTerminalProfile();
      ensureSelectedTerminalSession();
      return;
    }

    if (message.type === "agent.updated") {
      upsertByKey(agents.value, message.payload, "agentId");
      ensureSelectedAgent();
      ensureSelectedTerminalProfile();
      return;
    }

    if (message.type === "command.updated") {
      upsertByKey(commands.value, message.payload, "requestId");
      return;
    }

    if (message.type === "terminal.session.updated") {
      upsertTerminalSession(message.payload);
      ensureSelectedTerminalSession();
      return;
    }

    if (message.type === "terminal.session.deleted") {
      removeTerminalSession(message.payload?.sessionId);
      ensureSelectedTerminalSession();
      return;
    }

    if (message.type === "terminal.session.output") {
      appendTerminalSessionOutput(message.payload);
      return;
    }

    if (message.type === "terminal.session.input.ack") {
      applyTerminalInputAck(message.payload);
    }
  });

  socket.addEventListener("close", () => {
    if (connectionId !== browserSocketConnectionId) {
      return;
    }

    wsState.connected = false;
    socket = null;

    if (session.value) {
      scheduleBrowserSocketReconnect(connectionId);
    }
  });

  socket.addEventListener("error", () => {
    if (connectionId !== browserSocketConnectionId) {
      return;
    }

    wsState.error = "实时通道连接失败";
  });
}

function disconnectBrowserSocket() {
  browserSocketConnectionId += 1;

  if (browserReconnectTimer) {
    window.clearTimeout(browserReconnectTimer);
    browserReconnectTimer = null;
  }

  if (socket) {
    socket.close();
    socket = null;
  }
}

function scheduleBrowserSocketReconnect(connectionId) {
  if (browserReconnectTimer) {
    window.clearTimeout(browserReconnectTimer);
  }

  browserReconnectTimer = window.setTimeout(() => {
    browserReconnectTimer = null;

    if (
      connectionId !== browserSocketConnectionId ||
      !session.value ||
      socket
    ) {
      return;
    }

    connectBrowserSocket();
  }, 3000);
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

function ensureSelectedTerminalProfile() {
  const profiles = availableTerminalProfiles.value;

  if (!profiles.length) {
    terminalProfile.value = "";
    return;
  }

  if (profiles.some((item) => item.name === terminalProfile.value)) {
    return;
  }

  const preferredProfile =
    profiles.find((item) => item.isAvailable !== false && item.recommended) ||
    profiles.find((item) => item.isAvailable !== false && item.kind === "shell") ||
    profiles.find((item) => item.isAvailable !== false) ||
    profiles[0];
  terminalProfile.value = preferredProfile?.name || "";
}

function ensureSelectedTerminalSession() {
  if (
    selectedTerminalSessionId.value &&
    visibleTerminalSessions.value.some((item) => item.sessionId === selectedTerminalSessionId.value)
  ) {
    return;
  }

  const runningSession = visibleTerminalSessions.value.find(
    (item) => !isTerminalSessionClosedStatus(item.status)
  );
  selectedTerminalSessionId.value =
    runningSession?.sessionId || visibleTerminalSessions.value[0]?.sessionId || "";
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
  terminalSessions.value = [];
  users.value = [];
  authCodes.value = [];
  selectedAgentId.value = "";
  selectedTerminalSessionId.value = "";
  timelineFilterAgentId.value = "all";
  commandInput.value = "";
  terminalProfile.value = "";
  terminalCwd.value = "";
  terminalInput.value = "";
  resetRemoteFileViewer();
  terminalSocketInputQueue.length = 0;
  pendingTerminalSocketInputs.length = 0;
  flushingTerminalSocketInput = false;
  if (terminalSocketInputFlushTimer) {
    window.clearTimeout(terminalSocketInputFlushTimer);
    terminalSocketInputFlushTimer = null;
  }
  pendingTerminalResizes.clear();
  flushingTerminalResize = false;
  if (terminalResizeFlushTimer) {
    window.clearTimeout(terminalResizeFlushTimer);
    terminalResizeFlushTimer = null;
  }
  if (browserReconnectTimer) {
    window.clearTimeout(browserReconnectTimer);
    browserReconnectTimer = null;
  }
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

function upsertTerminalSession(item) {
  if (!item?.sessionId) {
    return;
  }

  const index = terminalSessions.value.findIndex(
    (candidate) => candidate.sessionId === item.sessionId
  );

  if (index === -1) {
    terminalSessions.value.unshift({
      ...item,
      outputs: clampTerminalOutputs(Array.isArray(item.outputs) ? item.outputs : [])
    });
  } else {
    const currentOutputs = Array.isArray(terminalSessions.value[index].outputs)
      ? terminalSessions.value[index].outputs
      : [];
    const incomingOutputs = Array.isArray(item.outputs) ? item.outputs : [];

    terminalSessions.value[index] = {
      ...terminalSessions.value[index],
      ...item,
      finalText:
        typeof item.finalText === "string"
          ? item.finalText
          : terminalSessions.value[index].finalText || "",
      outputs: clampTerminalOutputs(incomingOutputs.length > 0 ? incomingOutputs : currentOutputs)
    };
  }

  terminalSessions.value.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function removeTerminalSession(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();

  if (!normalizedSessionId) {
    return;
  }

  terminalSessions.value = terminalSessions.value.filter(
    (item) => item.sessionId !== normalizedSessionId
  );

  for (let index = terminalSocketInputQueue.length - 1; index >= 0; index -= 1) {
    if (terminalSocketInputQueue[index]?.sessionId === normalizedSessionId) {
      terminalSocketInputQueue.splice(index, 1);
    }
  }

  for (let index = pendingTerminalSocketInputs.length - 1; index >= 0; index -= 1) {
    if (pendingTerminalSocketInputs[index]?.sessionId === normalizedSessionId) {
      pendingTerminalSocketInputs.splice(index, 1);
    }
  }

  pendingTerminalResizes.delete(normalizedSessionId);

  if (remoteFileViewer.value.sessionId === normalizedSessionId) {
    resetRemoteFileViewer({ preservePath: true });
  }
}

function appendTerminalSessionOutput(output) {
  const sessionRecord = terminalSessions.value.find(
    (item) => item.sessionId === output?.sessionId
  );

  if (!sessionRecord) {
    return;
  }

  const outputs = Array.isArray(sessionRecord.outputs) ? [...sessionRecord.outputs] : [];

  if (outputs.some((item) => item.seq === output.seq)) {
    return;
  }

  outputs.push(output);
  outputs.sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0));
  sessionRecord.outputs = clampTerminalOutputs(outputs);
  sessionRecord.lastOutputAt = output.sentAt || sessionRecord.lastOutputAt;
}

function mergeTerminalSessionSnapshot(existingSessions, snapshotSessions) {
  const existingById = new Map(
    (Array.isArray(existingSessions) ? existingSessions : [])
      .filter((item) => item?.sessionId)
      .map((item) => [item.sessionId, item])
  );

  return (Array.isArray(snapshotSessions) ? snapshotSessions : []).map((item) => {
    const existing = existingById.get(item?.sessionId);
    const existingOutputs = Array.isArray(existing?.outputs) ? existing.outputs : [];
    const incomingOutputs = Array.isArray(item?.outputs) ? item.outputs : [];

    return {
      ...(existing || {}),
      ...(item || {}),
      outputs: clampTerminalOutputs(
        incomingOutputs.length > 0 ? incomingOutputs : existingOutputs
      )
    };
  });
}

function clampTerminalOutputs(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return [];
  }

  return outputs.slice(-TERMINAL_OUTPUT_BUFFER_LIMIT);
}

function reconcileMissingTerminalSession(sessionId) {
  const index = terminalSessions.value.findIndex((item) => item.sessionId === sessionId);

  if (index === -1) {
    return;
  }

  const current = terminalSessions.value[index];
  const now = new Date().toISOString();

  terminalSessions.value[index] = {
    ...current,
    status: "terminated",
    error: current.error || "终端会话已不存在，已按结束处理。",
    updatedAt: now,
    closedAt: current.closedAt || now
  };
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

function normalizeTerminalDimension(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isTerminalSessionClosedStatus(status) {
  return ["completed", "failed", "terminated", "connection_lost"].includes(
    String(status || "")
  );
}

function buildSessionInputPayload(sessionRecord, input) {
  const normalizedInput = String(input || "");

  if (prefersFinalAnswerView(sessionRecord)) {
    const markers = normalizeFinalOutputMarkers(sessionRecord?.finalOutputMarkers);
    const wrapped = markers
      ? [
          "请直接完成下面的用户请求，不要输出中间思考、分析过程、计划或工具调用解释。",
          `最终只允许输出以下标记包裹的结果正文：${markers.start} 与 ${markers.end}。`,
          "如果需要代码、命令或步骤，请直接写在最终结果正文中。",
          "",
          "用户请求：",
          normalizedInput
        ].join("\n")
      : normalizedInput;

    return /[\r\n]$/.test(wrapped) ? wrapped : `${wrapped}\r`;
  }

  return /[\r\n]$/.test(normalizedInput) ? normalizedInput : `${normalizedInput}\r`;
}

function prefersFinalAnswerView(sessionRecord) {
  return ["final_only", "hybrid"].includes(String(sessionRecord?.displayMode || ""));
}

function normalizeFinalOutputMarkers(markers) {
  if (!markers || typeof markers !== "object") {
    return null;
  }

  const start = String(markers.start || "").trim();
  const end = String(markers.end || "").trim();

  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function normalizeTerminalProfileRecord(profile) {
  return {
    ...profile,
    name: String(profile?.name || "").trim(),
    label: String(profile?.label || profile?.name || "").trim(),
    runner: String(profile?.runner || "").trim(),
    command: String(profile?.command || "").trim(),
    cwdPolicy: String(profile?.cwdPolicy || "allowlist").trim() || "allowlist",
    outputMode: String(profile?.outputMode || "terminal").trim() || "terminal",
    idleTimeoutMs: Number(profile?.idleTimeoutMs || 0),
    envAllowlist: Array.isArray(profile?.envAllowlist)
      ? profile.envAllowlist.map((item) => String(item))
      : [],
    isAvailable: profile?.isAvailable !== false,
    unavailableReason: String(profile?.unavailableReason || "").trim(),
    source: String(profile?.source || "").trim(),
    kind: String(profile?.kind || "").trim() || "cli",
    description: String(profile?.description || "").trim(),
    recommended: profile?.recommended === true,
    finalOutputMarkers: normalizeFinalOutputMarkers(profile?.finalOutputMarkers)
  };
}

function compareTerminalProfileRecords(left, right) {
  const availabilityDiff = Number(right?.isAvailable !== false) - Number(left?.isAvailable !== false);

  if (availabilityDiff !== 0) {
    return availabilityDiff;
  }

  const sourceDiff =
    getTerminalProfileSourceWeight(left?.source) - getTerminalProfileSourceWeight(right?.source);

  if (sourceDiff !== 0) {
    return sourceDiff;
  }

  const recommendedDiff = Number(right?.recommended === true) - Number(left?.recommended === true);

  if (recommendedDiff !== 0) {
    return recommendedDiff;
  }

  const kindDiff = Number(String(left?.kind || "") !== "shell") - Number(String(right?.kind || "") !== "shell");

  if (kindDiff !== 0) {
    return kindDiff;
  }

  return String(left?.label || left?.name || "").localeCompare(String(right?.label || right?.name || ""));
}

function getTerminalProfileSourceWeight(source) {
  switch (String(source || "")) {
    case "builtin":
      return 0;
    case "config":
      return 1;
    case "fallback":
      return 2;
    case "discovered":
      return 3;
    default:
      return 9;
  }
}

function getTerminalProfileDisplayName(target) {
  return String(target?.profileLabel || target?.label || target?.profile || target?.name || "").trim();
}

function resetRemoteFileViewer({ preservePath = false } = {}) {
  remoteFileViewer.value = createEmptyRemoteFileViewer();
  remoteFileError.value = "";

  if (!preservePath) {
    remoteFilePath.value = "";
  }
}

function createEmptyRemoteFileViewer() {
  return {
    sessionId: "",
    requestId: "",
    agentId: "",
    filePath: "",
    resolvedPath: "",
    content: "",
    truncated: false,
    bytesRead: 0,
    totalBytes: 0,
    encoding: "utf8",
    modifiedAt: null,
    readAt: null,
    openedAt: ""
  };
}

function normalizeRemoteFileViewer(item, sessionId) {
  return {
    sessionId: String(sessionId || ""),
    requestId: String(item?.requestId || ""),
    agentId: String(item?.agentId || ""),
    filePath: String(item?.filePath || ""),
    resolvedPath: String(item?.resolvedPath || ""),
    content: String(item?.content || ""),
    truncated: Boolean(item?.truncated),
    bytesRead: Number(item?.bytesRead || 0),
    totalBytes: Number(item?.totalBytes || 0),
    encoding: String(item?.encoding || "utf8"),
    modifiedAt: item?.modifiedAt || null,
    readAt: item?.readAt || null,
    openedAt: new Date().toISOString()
  };
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
          :terminal-profile="terminalProfile"
          :terminal-cwd="terminalCwd"
          :terminal-input="terminalInput"
          :remote-file-path="remoteFilePath"
          :remote-file-viewer="remoteFileViewer"
          :remote-file-error="remoteFileError"
          :available-terminal-profiles="availableTerminalProfiles"
          :terminal-sessions="visibleTerminalSessions"
          :active-terminal-session="activeTerminalSession"
          :can-submit-command="canSubmitCommand"
          :can-create-terminal-session="canCreateTerminalSession"
          :can-send-terminal-input="canSendTerminalInput"
          :can-terminate-terminal-session="canTerminateTerminalSession"
          :submitting="submitting"
          :creating-terminal-session="creatingTerminalSession"
          :sending-terminal-input="sendingTerminalInput"
          :reading-remote-file="readingRemoteFile"
          :terminating-terminal-session-id="terminatingTerminalSessionId || ''"
          :deleting-terminal-session-id="deletingTerminalSessionId || ''"
          @update:selected-agent-id="selectedAgentId = $event"
          @update:command-input="commandInput = $event"
          @update:terminal-profile="terminalProfile = $event"
          @update:terminal-cwd="terminalCwd = $event"
          @update:terminal-input="terminalInput = $event"
          @update:remote-file-path="updateRemoteFilePath"
          @select:terminal-session="selectedTerminalSessionId = $event"
          @submit-command="submitCommand"
          @create-terminal-session="createTerminalSession"
          @send-terminal-input="sendTerminalInput"
          @send-terminal-raw-input="queueTerminalRawInput($event)"
          @open-remote-file="openRemoteFile"
          @resize-terminal-session="queueTerminalResize($event)"
          @terminate-terminal-session="terminateTerminalSession"
          @delete-terminal-session="deleteTerminalSession"
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
