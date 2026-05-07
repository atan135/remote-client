import { ElMessage, ElMessageBox } from "element-plus";
import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";

import { NAV_ITEMS } from "../constants/navigation";

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

const TERMINAL_OUTPUT_BUFFER_LIMIT = 1200;
const TERMINAL_INTERRUPT_SEQUENCE = "\u0003";
const PENDING_COMMAND_STATUSES = new Set(["queued", "running", "dispatched"]);
const FAILED_COMMAND_STATUSES = new Set(["failed", "timed_out", "connection_lost"]);
const commandShellOptions = Object.freeze([
  {
    value: "cmd",
    label: "cmd"
  },
  {
    value: "powershell",
    label: "PowerShell"
  },
  {
    value: "pwsh",
    label: "PowerShell 7"
  },
  {
    value: "bash",
    label: "Bash"
  }
]);

export const useConsoleStore = defineStore("console", () => {
  const agents = ref([]);
  const commands = ref([]);
  const terminalSessions = ref([]);
  const users = ref([]);
  const managedAgents = ref([]);
  const authCodes = ref([]);
  const adminAuthCodes = ref([]);
  const selectedAgentId = ref("");
  const selectedTerminalSessionId = ref("");
  const autoOpenTerminalSessionId = ref("");
  const timelineFilterAgentId = ref("all");
  const commandInput = ref("");
  const commandShell = ref("powershell");
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
  const loadingManagedAgents = ref(false);
  const loadingAuthCodes = ref(false);
  const loadingAdminAuthCodes = ref(false);
  const creatingUser = ref(false);
  const creatingAuthCode = ref(false);
  const changingPassword = ref(false);
  const resettingUserId = ref(null);
  const updatingUserId = ref(null);
  const approvingUserId = ref(null);
  const rejectingUserId = ref(null);
  const approvingManagedAgentId = ref(null);
  const rejectingManagedAgentId = ref(null);
  const updatingManagedAgentId = ref(null);
  const savingAuthCodeId = ref(null);
  const deletingAuthCodeId = ref(null);
  const deletingAdminAuthCodeId = ref(null);
  const terminatingTerminalSessionId = ref(null);
  const deletingTerminalSessionId = ref(null);
  const deletingCommandRequestId = ref(null);
  const clearingCommands = ref(false);
  const session = ref(null);
  const authMode = ref("login");
  const remoteFileError = ref("");
  const remoteFileViewer = ref(createEmptyRemoteFileViewer());
  const pendingTaskCount = ref(0);
  const failedTaskCount = ref(0);

  const loginForm = reactive({
    username: "",
    password: ""
  });

  const registerForm = reactive({
    username: "",
    displayName: "",
    password: "",
    applicationNote: ""
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
    allowPublicRegistration: true,
    registrationApprovalRequired: false,
    agentApprovalRequired: false
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
  const queuedBrowserMessages = [];
  let browserMessageFlushHandle = 0;
  let browserMessageFlushUsesAnimationFrame = false;

  const avatarLabel = computed(() => {
    const source = session.value?.user?.displayName || session.value?.user?.username || "Q";
    return String(source).slice(0, 1).toUpperCase();
  });

  const selectedAgentIdKey = computed(() => normalizeAgentId(selectedAgentId.value));

  const agentSummary = computed(() => {
    const byId = new Map();
    let onlineCount = 0;
    let firstAgentId = "";
    let firstOnlineAgentId = "";

    for (const item of agents.value) {
      const agentId = String(item?.agentId || "").trim();

      if (!agentId) {
        continue;
      }

      if (!firstAgentId) {
        firstAgentId = agentId;
      }

      if (item.status === "online") {
        onlineCount += 1;

        if (!firstOnlineAgentId) {
          firstOnlineAgentId = agentId;
        }
      }

      byId.set(agentId, item);
    }

    return {
      byId,
      onlineCount,
      firstAgentId,
      firstOnlineAgentId
    };
  });

  const agentsById = computed(() => agentSummary.value.byId);

  const authCodesByAgentId = computed(() => {
    const byAgentId = new Map();

    for (const item of authCodes.value) {
      const agentId = normalizeAgentId(item?.agentId);

      if (!agentId) {
        continue;
      }

      byAgentId.set(agentId, item);
    }

    return byAgentId;
  });

  const terminalSessionSummary = computed(() => {
    const byId = new Map();
    const byAgentId = new Map();

    for (const item of terminalSessions.value) {
      const sessionId = String(item?.sessionId || "").trim();
      const agentId = String(item?.agentId || "").trim();

      if (sessionId) {
        byId.set(sessionId, item);
      }

      if (!agentId) {
        continue;
      }

      const bucket = byAgentId.get(agentId);

      if (bucket) {
        bucket.push(item);
        continue;
      }

      byAgentId.set(agentId, [item]);
    }

    return {
      byId,
      byAgentId
    };
  });

  const terminalSessionById = computed(() => terminalSessionSummary.value.byId);
  const terminalSessionsByAgentId = computed(() => terminalSessionSummary.value.byAgentId);

  const commandsByAgentId = computed(() => {
    const byAgentId = new Map();

    for (const item of commands.value) {
      const agentId = String(item?.agentId || "").trim();

      if (!agentId) {
        continue;
      }

      const bucket = byAgentId.get(agentId);

      if (bucket) {
        bucket.push(item);
        continue;
      }

      byAgentId.set(agentId, [item]);
    }

    return byAgentId;
  });

  const activeAgent = computed(() => agentsById.value.get(selectedAgentId.value) || null);

  const activeAuthCodeBinding = computed(
    () => authCodesByAgentId.value.get(selectedAgentIdKey.value) || null
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

  const visibleTerminalSessions = computed(
    () => terminalSessionsByAgentId.value.get(selectedAgentId.value) || []
  );

  const activeTerminalSession = computed(() => {
    const item = terminalSessionById.value.get(selectedTerminalSessionId.value) || null;
    return item?.agentId === selectedAgentId.value ? item : null;
  });

  const visibleCommands = computed(() => {
    if (!timelineFilterAgentId.value || timelineFilterAgentId.value === "all") {
      return commands.value;
    }

    return commandsByAgentId.value.get(timelineFilterAgentId.value) || [];
  });

  const isAdmin = computed(() => session.value?.user?.role === "admin");

  const onlineAgentCount = computed(() => agentSummary.value.onlineCount);

  const displayName = computed(
    () => session.value?.user?.displayName || session.value?.user?.username || ""
  );

  const canSubmitCommand = computed(() =>
    Boolean(
      selectedAgentId.value &&
        commandInput.value.trim() &&
        activeAuthCodeBinding.value &&
        !submitting.value
    )
  );

  const canCreateTerminalSession = computed(() =>
    Boolean(
      selectedAgentId.value &&
        terminalProfile.value &&
        selectedTerminalProfileConfig.value?.isAvailable !== false &&
        activeAuthCodeBinding.value &&
        !creatingTerminalSession.value
    )
  );

  const canSendTerminalInput = computed(() =>
    Boolean(
      activeTerminalSession.value &&
        terminalInput.value &&
        !sendingTerminalInput.value &&
        !isTerminalSessionClosedStatus(activeTerminalSession.value.status)
    )
  );

  const canTerminateTerminalSession = computed(() =>
    Boolean(
      activeTerminalSession.value &&
        !isTerminalSessionClosedStatus(activeTerminalSession.value.status) &&
        terminatingTerminalSessionId.value !== activeTerminalSession.value.sessionId
    )
  );

  const canClearCommands = computed(() =>
    Boolean(
      !clearingCommands.value &&
        visibleCommands.value.some((item) => isCommandRecordDeletableStatus(item?.status))
    )
  );

  const runningTerminalSessionCount = computed(
    () =>
      visibleTerminalSessions.value.filter(
        (item) => !isTerminalSessionClosedStatus(item.status)
      ).length
  );

  const resolvedTabs = computed(() =>
    NAV_ITEMS.map((tab) => ({
      ...tab,
      to: {
        name: tab.name
      }
    }))
  );

  const latestVisibleCommandRequestId = computed(
    () => String(visibleCommands.value[0]?.requestId || "")
  );

  watch(selectedAgentId, () => {
    ensureSelectedTerminalProfile();
    ensureSelectedTerminalSession();
    ensureSelectedCommandShell();
    resetRemoteFileViewer();
  });

  watch(availableTerminalProfiles, () => {
    ensureSelectedTerminalProfile();
  });

  watch(visibleTerminalSessions, () => {
    ensureSelectedTerminalSession();
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

  function dispose() {
    disconnectBrowserSocket();
  }

  async function loadConfig() {
    const response = await fetch("/api/config");

    if (!response.ok) {
      throw new Error("加载配置失败");
    }

    const payload = await response.json();
    appConfig.allowPublicRegistration = Boolean(payload.allowPublicRegistration);
    appConfig.registrationApprovalRequired = Boolean(payload.registrationApprovalRequired);
    appConfig.agentApprovalRequired = Boolean(payload.agentApprovalRequired);
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
      return false;
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
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
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
      return false;
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
          password: registerForm.password,
          applicationNote: registerForm.applicationNote.trim()
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
      registerForm.applicationNote = "";
      ElMessage.success(payload.message || "注册成功，请登录");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
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
      jobs.push(loadManagedAgents());
      jobs.push(loadAdminAuthCodes());
    } else {
      users.value = [];
      managedAgents.value = [];
      adminAuthCodes.value = [];
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
    replaceAgents(payload.items || []);
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
    replaceCommands(payload.items || []);
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
    replaceTerminalSessions(payload.items || []);
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

  async function loadManagedAgents() {
    if (!isAdmin.value) {
      return;
    }

    loadingManagedAgents.value = true;

    try {
      const response = await fetch("/api/managed-agents");

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (response.status === 403) {
        return;
      }

      if (!response.ok) {
        throw new Error("加载设备审核列表失败");
      }

      const payload = await response.json();
      managedAgents.value = payload.items || [];
    } finally {
      loadingManagedAgents.value = false;
    }
  }

  async function loadAdminAuthCodes() {
    if (!isAdmin.value) {
      return;
    }

    loadingAdminAuthCodes.value = true;

    try {
      const response = await fetch("/api/admin/auth-codes");

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (response.status === 403) {
        return;
      }

      if (!response.ok) {
        throw new Error("加载全量 auth_code 绑定失败");
      }

      const payload = await response.json();
      adminAuthCodes.value = payload.items || [];
    } finally {
      loadingAdminAuthCodes.value = false;
    }
  }

  async function submitCommand(commandOverride, options = {}) {
    const commandSource = commandOverride === undefined ? commandInput.value : commandOverride;
    const command = String(commandSource || "").trim();
    const shell = normalizeCommandShell(
      options?.shell || commandShell.value || getDefaultCommandShellForAgent(activeAgent.value),
      activeAgent.value
    );

    if (!selectedAgentId.value || !command) {
      return false;
    }

    if (!activeAuthCodeBinding.value) {
      wsState.error = "请先为当前设备配置 auth_code，再发送命令";
      return false;
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
          command,
          shell
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "命令提交失败");
      }

      if (payload.item) {
        upsertCommand(payload.item);
      }

      commandInput.value = "";
      timelineFilterAgentId.value = selectedAgentId.value || "all";
      return payload.item || true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      submitting.value = false;
    }
  }

  async function deleteCommandRecord(requestId) {
    const normalizedRequestId = String(requestId || "").trim();
    const commandRecord = commands.value.find((item) => item.requestId === normalizedRequestId) || null;

    if (!normalizedRequestId || !commandRecord) {
      return false;
    }

    if (!isCommandRecordDeletableStatus(commandRecord.status)) {
      wsState.error = "仅允许删除已结束的任务记录";
      return false;
    }

    try {
      await ElMessageBox.confirm(
        `确认删除任务记录 ${commandRecord.command || normalizedRequestId} 吗？删除后将从执行记录中移除。`,
        "删除任务记录",
        {
          type: "warning",
          confirmButtonText: "删除",
          cancelButtonText: "取消"
        }
      );
    } catch {
      return false;
    }

    deletingCommandRequestId.value = normalizedRequestId;
    wsState.error = "";

    try {
      const response = await fetch(`/api/commands/${normalizedRequestId}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 404) {
          removeCommand(normalizedRequestId);
          ElMessage.warning("任务记录已不存在，已从列表移除");
          return false;
        }

        throw new Error(payload.message || "删除任务记录失败");
      }

      removeCommand(normalizedRequestId);
      ElMessage.success("任务记录已删除");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      deletingCommandRequestId.value = null;
    }
  }

  async function clearCommandRecords(agentId = timelineFilterAgentId.value) {
    const normalizedAgentId =
      !agentId || String(agentId || "").trim() === "all" ? "" : String(agentId || "").trim();
    const targetLabel = normalizedAgentId
      ? agentsById.value.get(normalizedAgentId)?.label || normalizedAgentId
      : "全部设备";

    try {
      await ElMessageBox.confirm(
        `确认清空 ${targetLabel} 下所有已结束的任务记录吗？执行中的任务会保留。`,
        "清空任务记录",
        {
          type: "warning",
          confirmButtonText: "清空",
          cancelButtonText: "取消"
        }
      );
    } catch {
      return false;
    }

    clearingCommands.value = true;
    wsState.error = "";

    try {
      const query = normalizedAgentId
        ? `?agentId=${encodeURIComponent(normalizedAgentId)}`
        : "";
      const response = await fetch(`/api/commands${query}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "清空任务记录失败");
      }

      await loadCommands();

      if (Number(payload.deletedFromHistory || 0) > 0 || Number(payload.removedActiveCount || 0) > 0) {
        ElMessage.success("任务记录已清空");
      } else {
        ElMessage.info("当前没有可清空的已结束记录");
      }

      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      clearingCommands.value = false;
    }
  }

  async function createTerminalSession(options = {}) {
    const requestedProfile = String(options?.profile || terminalProfile.value || "").trim();
    const requestedCwd = String(
      options && Object.prototype.hasOwnProperty.call(options, "cwd")
        ? options.cwd
        : terminalCwd.value
    ).trim();
    const profileConfig =
      availableTerminalProfiles.value.find((item) => item.name === requestedProfile) || null;
    const shouldSelect = options?.select !== false;
    const shouldAutoOpen = options?.autoOpen !== false;

    if (!selectedAgentId.value || !requestedProfile) {
      return false;
    }

    if (!activeAuthCodeBinding.value) {
      wsState.error = "请先为当前设备配置 auth_code，再创建终端会话";
      return false;
    }

    if (profileConfig?.isAvailable === false) {
      wsState.error =
        profileConfig.unavailableReason ||
        `终端 profile 当前不可用: ${requestedProfile}`;
      return false;
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
          profile: requestedProfile,
          cwd: requestedCwd,
          env: {},
          cols: 120,
          rows: 30
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "终端会话创建失败");
      }

      if (payload.item) {
        upsertTerminalSession(payload.item);

        if (shouldSelect) {
          selectedTerminalSessionId.value = payload.item.sessionId;
        }

        if (shouldAutoOpen) {
          autoOpenTerminalSessionId.value = payload.item.sessionId;
        }
      }

      terminalInput.value = "";
      return payload.item || true;
    } catch (error) {
      wsState.error = error.message;
      return false;
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
    const sessionId = String(
      payload?.sessionId || activeTerminalSession.value?.sessionId || ""
    ).trim();
    const sessionRecord = terminalSessionById.value.get(sessionId);
    const input = String(payload?.input || "");

    if (!sessionRecord || !input) {
      return false;
    }

    sendingTerminalInput.value = true;
    wsState.error = "";

    try {
      enqueueTerminalSocketInput(sessionRecord.sessionId, buildSessionInputPayload(sessionRecord, input), {
        logicalInput: input
      });
      terminalInput.value = "";
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      sendingTerminalInput.value = false;
    }
  }

  function updateRemoteFilePath(value) {
    remoteFilePath.value = String(value || "");
    remoteFileError.value = "";
  }

  async function openRemoteFile(payload = {}) {
    const agentId = String(payload?.agentId || selectedAgentId.value || "").trim();
    const sessionId = String(
      payload?.sessionId || activeTerminalSession.value?.sessionId || ""
    ).trim();
    const filePath = String(payload?.filePath || remoteFilePath.value || "").trim();
    const baseCwd = String(payload?.baseCwd || payload?.cwd || "").trim();

    if (!agentId || !sessionId) {
      return false;
    }

    if (!filePath) {
      remoteFileError.value = "请输入要打开的文件路径";
      return false;
    }

    if (!activeAuthCodeBinding.value) {
      remoteFileError.value = "请先为当前设备配置 auth_code，再读取文件";
      return false;
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
          agentId,
          sessionId,
          filePath,
          baseCwd
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "远程读取文件失败");
      }

      remoteFileViewer.value = normalizeRemoteFileViewer(result.item, sessionId);
      remoteFilePath.value = remoteFileViewer.value.filePath || filePath;
      return remoteFileViewer.value;
    } catch (error) {
      remoteFileError.value = error.message;
      return false;
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
    const sessionRecord = terminalSessionById.value.get(normalizedSessionId);

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

  function interruptTerminalSession(sessionId = activeTerminalSession.value?.sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      return;
    }

    queueTerminalRawInput({
      sessionId: normalizedSessionId,
      input: TERMINAL_INTERRUPT_SEQUENCE
    });
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
    const sessionRecord = terminalSessionById.value.get(normalizedSessionId);

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
    const sessionRecord = terminalSessionById.value.get(sessionId);

    if (!sessionRecord || !cols || !rows || isTerminalSessionClosedStatus(sessionRecord.status)) {
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
    if (flushingTerminalSocketInput || !socket || socket.readyState !== WebSocket.OPEN) {
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
      return false;
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
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 404 && payload.message === "会话不存在") {
          reconcileMissingTerminalSession(sessionId);
          ElMessage.warning("会话已不存在，界面已按结束处理");
          return false;
        }

        throw new Error(payload.message || "终端会话终止失败");
      }

      if (payload?.item?.sessionId) {
        upsertTerminalSession(payload.item);
        ensureSelectedTerminalSession();
      }

      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      terminatingTerminalSessionId.value = null;
    }
  }

  async function deleteTerminalSession(sessionId = activeTerminalSession.value?.sessionId) {
    if (!sessionId) {
      return false;
    }

    const sessionRecord = terminalSessionById.value.get(sessionId);

    if (!sessionRecord) {
      removeTerminalSession(sessionId);
      ensureSelectedTerminalSession();
      return true;
    }

    if (!isTerminalSessionClosedStatus(sessionRecord.status)) {
      wsState.error = "仅允许删除已结束的终端会话";
      return false;
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
      return false;
    }

    deletingTerminalSessionId.value = sessionId;
    wsState.error = "";

    try {
      const response = await fetch(`/api/terminal-sessions/${sessionId}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 404) {
          removeTerminalSession(sessionId);
          ensureSelectedTerminalSession();
          ElMessage.warning("会话已不存在，已从列表移除");
          return false;
        }

        throw new Error(payload.message || "终端会话删除失败");
      }

      removeTerminalSession(sessionId);
      ensureSelectedTerminalSession();
      ElMessage.success("终端会话已删除");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      deletingTerminalSessionId.value = null;
    }
  }

  async function createAuthCode() {
    if (!authCodeForm.agentId.trim() || !authCodeForm.authCode.trim()) {
      wsState.error = "请填写设备标识和 RSA 公钥";
      return false;
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

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "创建 auth_code 失败");
      }

      authCodeForm.agentId = "";
      authCodeForm.remark = "";
      authCodeForm.authCode = "";
      await loadAuthCodes();
      if (isAdmin.value) {
        await loadAdminAuthCodes();
      }
      ElMessage.success("auth_code 已创建");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
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

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "更新 auth_code 失败");
      }

      Object.assign(item, payload.item);
      if (isAdmin.value) {
        await loadAdminAuthCodes();
      }
      ElMessage.success("auth_code 已更新");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      savingAuthCodeId.value = null;
    }
  }

  async function deleteAuthCode(item) {
    try {
      await ElMessageBox.confirm(`确认删除设备 ${item.agentId} 的 auth_code 吗？`, "删除 auth_code", {
        type: "warning",
        confirmButtonText: "删除",
        cancelButtonText: "取消"
      });
    } catch {
      return false;
    }

    deletingAuthCodeId.value = item.id;
    wsState.error = "";

    try {
      const response = await fetch(`/api/auth-codes/${item.id}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "删除 auth_code 失败");
      }

      authCodes.value = authCodes.value.filter((candidate) => candidate.id !== item.id);
      if (isAdmin.value) {
        await loadAdminAuthCodes();
      }
      ElMessage.success("auth_code 已删除");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      deletingAuthCodeId.value = null;
    }
  }

  async function adminDeleteAuthCode(item) {
    try {
      await ElMessageBox.confirm(
        `确认解绑设备 ${item.agentId} 当前归属的 auth_code 吗？解绑后其他用户才可重新绑定。`,
        "管理员解绑 auth_code",
        {
          type: "warning",
          confirmButtonText: "解绑",
          cancelButtonText: "取消"
        }
      );
    } catch {
      return false;
    }

    deletingAdminAuthCodeId.value = item.id;
    wsState.error = "";

    try {
      const response = await fetch(`/api/admin/auth-codes/${item.id}`, {
        method: "DELETE"
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "管理员解绑 auth_code 失败");
      }

      adminAuthCodes.value = adminAuthCodes.value.filter((candidate) => candidate.id !== item.id);
      authCodes.value = authCodes.value.filter((candidate) => candidate.id !== item.id);
      ElMessage.success("绑定已解绑");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      deletingAdminAuthCodeId.value = null;
    }
  }

  async function submitChangePassword() {
    if (!passwordForm.currentPassword || passwordForm.newPassword.length < 8) {
      wsState.error = "请填写当前密码和至少 8 位新密码";
      return false;
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

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "修改密码失败");
      }

      passwordForm.currentPassword = "";
      passwordForm.newPassword = "";
      resetAuthedState();
      ElMessage.success("密码已修改，请重新登录");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      changingPassword.value = false;
    }
  }

  async function createUser() {
    if (!userForm.username.trim() || !userForm.displayName.trim() || userForm.password.length < 8) {
      wsState.error = "请填写完整的新用户信息";
      return false;
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

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

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
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
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

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "更新用户失败");
      }

      Object.assign(user, payload.item);
      ElMessage.success("用户已更新");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      updatingUserId.value = null;
    }
  }

  async function approveUser(user) {
    approvingUserId.value = user.id;
    wsState.error = "";

    try {
      const response = await fetch(`/api/users/${user.id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reviewComment: user.reviewComment || ""
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "审核通过失败");
      }

      Object.assign(user, payload.item);
      ElMessage.success("用户已审核通过");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      approvingUserId.value = null;
    }
  }

  async function rejectUser(user) {
    rejectingUserId.value = user.id;
    wsState.error = "";

    try {
      const response = await fetch(`/api/users/${user.id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reviewComment: user.reviewComment || ""
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "拒绝用户失败");
      }

      Object.assign(user, payload.item);
      ElMessage.success("用户已拒绝");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      rejectingUserId.value = null;
    }
  }

  async function resetPassword(user) {
    let nextPassword = "";

    try {
      const result = await ElMessageBox.prompt(`为用户 ${user.username} 设置新密码`, "重置密码", {
        inputValue: "ChangeMe123!",
        inputPattern: /^.{8,}$/,
        inputErrorMessage: "新密码至少 8 位",
        confirmButtonText: "提交",
        cancelButtonText: "取消"
      });

      nextPassword = result.value;
    } catch {
      return false;
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

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "重置密码失败");
      }

      ElMessage.success(`已为 ${user.username} 重置密码`);
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      resettingUserId.value = null;
    }
  }

  async function saveManagedAgent(agent) {
    updatingManagedAgentId.value = agent.id;
    wsState.error = "";

    try {
      const response = await fetch(`/api/managed-agents/${agent.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          label: agent.label,
          applicationNote: agent.applicationNote,
          reviewComment: agent.reviewComment,
          isEnabled: agent.isEnabled
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "更新设备记录失败");
      }

      Object.assign(agent, payload.item);
      ElMessage.success("设备记录已更新");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      updatingManagedAgentId.value = null;
    }
  }

  async function approveManagedAgent(agent) {
    approvingManagedAgentId.value = agent.id;
    wsState.error = "";

    try {
      const response = await fetch(`/api/managed-agents/${agent.id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reviewComment: agent.reviewComment || ""
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "设备审核通过失败");
      }

      Object.assign(agent, payload.item);
      ElMessage.success("设备已审核通过");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      approvingManagedAgentId.value = null;
    }
  }

  async function rejectManagedAgent(agent) {
    rejectingManagedAgentId.value = agent.id;
    wsState.error = "";

    try {
      const response = await fetch(`/api/managed-agents/${agent.id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reviewComment: agent.reviewComment || ""
        })
      });

      if (response.status === 401) {
        await handleUnauthorized();
        return false;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "拒绝设备失败");
      }

      Object.assign(agent, payload.item);
      ElMessage.success("设备已拒绝");
      return true;
    } catch (error) {
      wsState.error = error.message;
      return false;
    } finally {
      rejectingManagedAgentId.value = null;
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

      if (message.type === "terminal.session.input.ack") {
        applyTerminalInputAck(message.payload);
        return;
      }

      queueBrowserMessage(message);
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
    queuedBrowserMessages.length = 0;
    cancelQueuedBrowserMessageFlush();
    wsState.connected = false;

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

      if (connectionId !== browserSocketConnectionId || !session.value || socket) {
        return;
      }

      connectBrowserSocket();
    }, 3000);
  }

  function queueBrowserMessage(message) {
    queuedBrowserMessages.push(message);

    if (browserMessageFlushHandle) {
      return;
    }

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      browserMessageFlushUsesAnimationFrame = true;
      browserMessageFlushHandle = window.requestAnimationFrame(() => {
        browserMessageFlushHandle = 0;
        browserMessageFlushUsesAnimationFrame = false;
        flushQueuedBrowserMessages();
      });
      return;
    }

    browserMessageFlushUsesAnimationFrame = false;
    browserMessageFlushHandle = window.setTimeout(() => {
      browserMessageFlushHandle = 0;
      flushQueuedBrowserMessages();
    }, 16);
  }

  function flushQueuedBrowserMessages() {
    if (queuedBrowserMessages.length === 0) {
      return;
    }

    const batch = queuedBrowserMessages.splice(0, queuedBrowserMessages.length);
    let shouldEnsureAgent = false;
    let shouldEnsureProfile = false;
    let shouldEnsureSession = false;

    for (const message of batch) {
      switch (message?.type) {
        case "snapshot":
          replaceAgents(message.payload?.agents || []);
          replaceCommands(message.payload?.commands || []);
          replaceTerminalSessions(
            mergeTerminalSessionSnapshot(terminalSessions.value, message.payload?.terminalSessions || [])
          );
          shouldEnsureAgent = true;
          shouldEnsureProfile = true;
          shouldEnsureSession = true;
          break;
        case "agent.updated":
          if (upsertAgent(message.payload)) {
            shouldEnsureAgent = true;
            shouldEnsureProfile = true;
          }
          break;
        case "command.updated":
          upsertCommand(message.payload);
          break;
        case "command.deleted":
          removeCommand(message.payload?.requestId);
          break;
        case "command.cleared":
          void loadCommands().catch((error) => {
            wsState.error = error.message || "加载命令记录失败";
          });
          break;
        case "terminal.session.updated":
          if (upsertTerminalSession(message.payload)) {
            shouldEnsureSession = true;
          }
          break;
        case "terminal.session.deleted":
          if (removeTerminalSession(message.payload?.sessionId)) {
            shouldEnsureSession = true;
          }
          break;
        case "terminal.session.output":
          appendTerminalSessionOutput(message.payload);
          break;
        default:
          break;
      }
    }

    if (shouldEnsureAgent) {
      ensureSelectedAgent();
    }

    if (shouldEnsureProfile) {
      ensureSelectedTerminalProfile();
    }

    if (shouldEnsureSession) {
      ensureSelectedTerminalSession();
    }
  }

  function ensureSelectedAgent() {
    if (selectedAgentId.value && agentsById.value.has(selectedAgentId.value)) {
      if (timelineFilterAgentId.value !== "all" && !agentsById.value.has(timelineFilterAgentId.value)) {
        timelineFilterAgentId.value = "all";
      }

      return;
    }

    selectedAgentId.value = agentSummary.value.firstOnlineAgentId || agentSummary.value.firstAgentId || "";

    if (timelineFilterAgentId.value !== "all" && !agentsById.value.has(timelineFilterAgentId.value)) {
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
    if (selectedTerminalSessionId.value) {
      const selectedSession = terminalSessionById.value.get(selectedTerminalSessionId.value);

      if (selectedSession?.agentId === selectedAgentId.value) {
        return;
      }
    }

    const sessions = visibleTerminalSessions.value;

    if (!sessions.length) {
      selectedTerminalSessionId.value = "";
      return;
    }

    const runningSession = sessions.find((item) => !isTerminalSessionClosedStatus(item.status));
    selectedTerminalSessionId.value = runningSession?.sessionId || sessions[0]?.sessionId || "";
  }

  function ensureSelectedCommandShell() {
    commandShell.value = getDefaultCommandShellForAgent(activeAgent.value);
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
    pendingTaskCount.value = 0;
    failedTaskCount.value = 0;
    users.value = [];
    managedAgents.value = [];
    authCodes.value = [];
    adminAuthCodes.value = [];
    selectedAgentId.value = "";
    selectedTerminalSessionId.value = "";
    autoOpenTerminalSessionId.value = "";
    timelineFilterAgentId.value = "all";
    commandInput.value = "";
    commandShell.value = "powershell";
    terminalProfile.value = "";
    terminalCwd.value = "";
    terminalInput.value = "";
    authMode.value = "login";
    wsState.connected = false;
    wsState.error = "";
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
    approvingUserId.value = null;
    rejectingUserId.value = null;
    approvingManagedAgentId.value = null;
    rejectingManagedAgentId.value = null;
    updatingManagedAgentId.value = null;
    deletingAdminAuthCodeId.value = null;
    if (terminalResizeFlushTimer) {
      window.clearTimeout(terminalResizeFlushTimer);
      terminalResizeFlushTimer = null;
    }
    if (browserReconnectTimer) {
      window.clearTimeout(browserReconnectTimer);
      browserReconnectTimer = null;
    }
    queuedBrowserMessages.length = 0;
    cancelQueuedBrowserMessageFlush();
  }

  function replaceAgents(items) {
    const normalizedItems = Array.isArray(items) ? items.slice() : [];
    normalizedItems.sort(compareAgentRecords);
    agents.value = normalizedItems;
  }

  function replaceCommands(items) {
    const normalizedItems = Array.isArray(items) ? items.slice() : [];
    normalizedItems.sort(compareCommandRecords);
    commands.value = normalizedItems;
    recomputeCommandStatusCounts();
  }

  function removeCommand(requestId) {
    const normalizedRequestId = String(requestId || "").trim();

    if (!normalizedRequestId) {
      return false;
    }

    const nextItems = commands.value.filter((item) => item.requestId !== normalizedRequestId);

    if (nextItems.length === commands.value.length) {
      return false;
    }

    commands.value = nextItems;
    recomputeCommandStatusCounts();
    return true;
  }

  function replaceTerminalSessions(items) {
    const normalizedItems = Array.isArray(items) ? items.slice() : [];
    normalizedItems.sort(compareTerminalSessionRecords);
    terminalSessions.value = normalizedItems;
  }

  function upsertAgent(item) {
    if (!item?.agentId) {
      return false;
    }

    const index = agents.value.findIndex((candidate) => candidate.agentId === item.agentId);

    if (index === -1) {
      const nextItems = [...agents.value, item];
      nextItems.sort(compareAgentRecords);
      agents.value = nextItems;
      return true;
    }

    const current = agents.value[index];
    const next = {
      ...current,
      ...item
    };

    if (!didAgentSortKeyChange(current, next)) {
      agents.value[index] = next;
      return true;
    }

    const nextItems = [...agents.value];
    nextItems[index] = next;
    nextItems.sort(compareAgentRecords);
    agents.value = nextItems;
    return true;
  }

  function upsertCommand(item) {
    if (!item?.requestId) {
      return false;
    }

    const index = commands.value.findIndex((candidate) => candidate.requestId === item.requestId);

    if (index === -1) {
      const nextItems = [...commands.value, item];
      nextItems.sort(compareCommandRecords);
      commands.value = nextItems;
      adjustCommandStatusCounts(null, item);
      return true;
    }

    const current = commands.value[index];
    const next = {
      ...current,
      ...item
    };

    adjustCommandStatusCounts(current, next);

    if (!didCommandSortKeyChange(current, next)) {
      commands.value[index] = next;
      return true;
    }

    const nextItems = [...commands.value];
    nextItems[index] = next;
    nextItems.sort(compareCommandRecords);
    commands.value = nextItems;
    return true;
  }

  function upsertTerminalSession(item) {
    if (!item?.sessionId) {
      return false;
    }

    const index = terminalSessions.value.findIndex((candidate) => candidate.sessionId === item.sessionId);

    if (index === -1) {
      const nextItems = [
        ...terminalSessions.value,
        {
          ...item,
          outputs: clampTerminalOutputs(Array.isArray(item.outputs) ? item.outputs : [])
        }
      ];
      nextItems.sort(compareTerminalSessionRecords);
      terminalSessions.value = nextItems;
      return true;
    }

    const current = terminalSessions.value[index];
    const currentOutputs = Array.isArray(current.outputs) ? current.outputs : [];
    const incomingOutputs = Array.isArray(item.outputs) ? item.outputs : [];
    const next = {
      ...current,
      ...item,
      finalText:
        typeof item.finalText === "string"
          ? item.finalText
          : current.finalText || "",
      outputs: clampTerminalOutputs(incomingOutputs.length > 0 ? incomingOutputs : currentOutputs)
    };

    if (!didTerminalSessionSortKeyChange(current, next)) {
      terminalSessions.value[index] = next;
      return true;
    }

    const nextItems = [...terminalSessions.value];
    nextItems[index] = next;
    nextItems.sort(compareTerminalSessionRecords);
    terminalSessions.value = nextItems;
    return true;
  }

  function removeTerminalSession(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      return false;
    }

    const nextItems = terminalSessions.value.filter((item) => item.sessionId !== normalizedSessionId);
    const didRemoveSession = nextItems.length !== terminalSessions.value.length;

    if (didRemoveSession) {
      terminalSessions.value = nextItems;
    }

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
      resetRemoteFileViewer({
        preservePath: true
      });
    }

    return didRemoveSession;
  }

  function appendTerminalSessionOutput(output) {
    const sessionRecord = terminalSessionById.value.get(String(output?.sessionId || ""));

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
        outputs: clampTerminalOutputs(incomingOutputs.length > 0 ? incomingOutputs : existingOutputs)
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
    const current = terminalSessionById.value.get(String(sessionId || ""));

    if (!current) {
      return;
    }

    const now = new Date().toISOString();
    upsertTerminalSession({
      ...current,
      status: "terminated",
      error: current.error || "终端会话已不存在，已按结束处理。",
      updatedAt: now,
      closedAt: current.closedAt || now
    });
  }

  function normalizeAgentId(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeTerminalDimension(value) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function isCommandRecordDeletableStatus(status) {
    return !PENDING_COMMAND_STATUSES.has(String(status || ""));
  }

  function isTerminalSessionClosedStatus(status) {
    return ["completed", "failed", "terminated", "connection_lost"].includes(String(status || ""));
  }

  function buildSessionInputPayload(sessionRecord, input) {
    const normalizedInput = String(input || "");

    if (prefersFinalAnswerView(sessionRecord)) {
      const markers = normalizeFinalOutputMarkers(sessionRecord?.finalOutputMarkers);
      const wrapped = markers ? buildFinalAnswerPrompt(markers, normalizedInput) : normalizedInput;

      if (isCodexExecShellSession(sessionRecord)) {
        return buildCodexExecShellInput(wrapped);
      }

      return /[\r\n]$/.test(wrapped) ? wrapped : `${wrapped}\r`;
    }

    return /[\r\n]$/.test(normalizedInput) ? normalizedInput : `${normalizedInput}\r`;
  }

  function buildFinalAnswerPrompt(markers, input) {
    return [
      "请直接完成用户请求，不要输出中间思考、计划、工具调用解释或执行日志。",
      `最终结果必须用开始标记和结束标记包裹；开始标记为 ${markers.start}；结束标记为 ${markers.end}；两个标记都必须单独占一行。`,
      "如果结果适合在聊天框直接阅读，请在标记内返回 100 字以内摘要。",
      "如果结果超过 100 个中文字符，或包含代码块、日志、表格、清单、长命令输出、多步骤方案、详细分析、需要保存或反复查看的内容，请写入当前工作目录下 .remote-client/codex-results/codex-YYYYMMDD-HHmmss.md，并在标记内只返回文件路径。",
      "标记内不要返回额外说明。",
      "",
      "用户请求：",
      input
    ].join("\n");
  }

  function buildCodexExecShellInput(prompt) {
    const promptBase64 = encodeUtf8Base64(prompt);
    const promptBase64Length = promptBase64.length;
    const command = [
      `$__rcPromptBase64 = '${promptBase64}'`,
      "$__rcPrompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($__rcPromptBase64))",
      `Write-Output "[remote-client] codex.exec.start promptBase64Chars=${promptBase64Length}"`,
      "$__rcPrompt | codex exec --skip-git-repo-check --color never",
      "$__rcExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }",
      'Write-Output ("[remote-client] codex.exec.exit code={0}" -f $__rcExitCode)',
      "Remove-Variable __rcPrompt,__rcPromptBase64,__rcExitCode -ErrorAction SilentlyContinue"
    ].join("; ");

    return `${command}\r`;
  }

  function isCodexExecShellSession(sessionRecord) {
    return /codex/i.test(`${sessionRecord?.profile || ""} ${sessionRecord?.profileLabel || ""}`);
  }

  function encodeUtf8Base64(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    const chunkSize = 0x8000;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
    }

    return btoa(binary);
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

    return {
      start,
      end
    };
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

    const sourceDiff = getTerminalProfileSourceWeight(left?.source) - getTerminalProfileSourceWeight(right?.source);

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

  function cancelQueuedBrowserMessageFlush() {
    if (!browserMessageFlushHandle) {
      return;
    }

    if (browserMessageFlushUsesAnimationFrame) {
      window.cancelAnimationFrame(browserMessageFlushHandle);
    } else {
      window.clearTimeout(browserMessageFlushHandle);
    }

    browserMessageFlushHandle = 0;
    browserMessageFlushUsesAnimationFrame = false;
  }

  function recomputeCommandStatusCounts() {
    let nextPendingCount = 0;
    let nextFailedCount = 0;

    for (const item of commands.value) {
      const status = String(item?.status || "");

      if (PENDING_COMMAND_STATUSES.has(status)) {
        nextPendingCount += 1;
      }

      if (FAILED_COMMAND_STATUSES.has(status)) {
        nextFailedCount += 1;
      }
    }

    pendingTaskCount.value = nextPendingCount;
    failedTaskCount.value = nextFailedCount;
  }

  function adjustCommandStatusCounts(previousRecord, nextRecord) {
    const previousStatus = String(previousRecord?.status || "");
    const nextStatus = String(nextRecord?.status || "");

    if (PENDING_COMMAND_STATUSES.has(previousStatus)) {
      pendingTaskCount.value = Math.max(0, pendingTaskCount.value - 1);
    }

    if (FAILED_COMMAND_STATUSES.has(previousStatus)) {
      failedTaskCount.value = Math.max(0, failedTaskCount.value - 1);
    }

    if (PENDING_COMMAND_STATUSES.has(nextStatus)) {
      pendingTaskCount.value += 1;
    }

    if (FAILED_COMMAND_STATUSES.has(nextStatus)) {
      failedTaskCount.value += 1;
    }
  }

  function compareCommandRecords(left, right) {
    return String(right?.createdAt || "").localeCompare(String(left?.createdAt || ""));
  }

  function compareAgentRecords(left, right) {
    return String(left?.label || "").localeCompare(String(right?.label || ""));
  }

  function compareTerminalSessionRecords(left, right) {
    return String(right?.createdAt || "").localeCompare(String(left?.createdAt || ""));
  }

  function didCommandSortKeyChange(previousRecord, nextRecord) {
    return String(previousRecord?.createdAt || "") !== String(nextRecord?.createdAt || "");
  }

  function didAgentSortKeyChange(previousRecord, nextRecord) {
    return String(previousRecord?.label || "") !== String(nextRecord?.label || "");
  }

  function didTerminalSessionSortKeyChange(previousRecord, nextRecord) {
    return String(previousRecord?.createdAt || "") !== String(nextRecord?.createdAt || "");
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

  function clearAutoOpenTerminalSession(sessionId) {
    if (String(sessionId || "").trim() === autoOpenTerminalSessionId.value) {
      autoOpenTerminalSessionId.value = "";
    }
  }

  function normalizeCommandShell(value, agent = activeAgent.value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^powershell7$/, "pwsh")
      .replace(/^power-shell$/, "powershell")
      .replace(/^ps$/, "powershell")
      .replace(/^ps7$/, "pwsh");

    if (commandShellOptions.some((item) => item.value === normalized)) {
      return normalized;
    }

    return getDefaultCommandShellForAgent(agent);
  }

  function getDefaultCommandShellForAgent(agent) {
    const platform = String(agent?.platform || agent?.os || "").toLowerCase();
    return platform && !platform.startsWith("win") ? "bash" : "powershell";
  }

  return {
    activeAgent,
    activeAuthCodeBinding,
    activeTerminalSession,
    adminAuthCodes,
    adminDeleteAuthCode,
    agents,
    appConfig,
    authCodeForm,
    authCodes,
    authMode,
    authenticating,
    autoOpenTerminalSessionId,
    availableTerminalProfiles,
    avatarLabel,
    bootstrapping,
    canClearCommands,
    canCreateTerminalSession,
    canSendTerminalInput,
    canSubmitCommand,
    canTerminateTerminalSession,
    changingPassword,
    approveManagedAgent,
    approveUser,
    approvingManagedAgentId,
    approvingUserId,
    clearAutoOpenTerminalSession,
    clearCommandRecords,
    commandInput,
    commandShell,
    commandShellOptions,
    commands,
    createAuthCode,
    createTerminalSession,
    createUser,
    creatingAuthCode,
    clearingCommands,
    creatingTerminalSession,
    creatingUser,
    deleteAuthCode,
    deleteCommandRecord,
    deleteTerminalSession,
    deletingAuthCodeId,
    deletingAdminAuthCodeId,
    deletingCommandRequestId,
    deletingTerminalSessionId,
    displayName,
    dispose,
    failedTaskCount,
    latestVisibleCommandRequestId,
    loadDashboard,
    loadingAdminAuthCodes,
    loadingAuthCodes,
    loadingManagedAgents,
    loadingUsers,
    login,
    loginForm,
    logout,
    managedAgents,
    onlineAgentCount,
    openRemoteFile,
    passwordForm,
    pendingTaskCount,
    queueTerminalRawInput,
    queueTerminalResize,
    readRemoteFile: openRemoteFile,
    readingRemoteFile,
    register,
    registerForm,
    remoteFileError,
    remoteFilePath,
    remoteFileViewer,
    rejectManagedAgent,
    rejectUser,
    rejectingManagedAgentId,
    rejectingUserId,
    resolvedTabs,
    resettingUserId,
    saveAuthCode,
    saveManagedAgent,
    saveUser,
    selectedAgentId,
    selectedTerminalSessionId,
    sendTerminalInput,
    sendingTerminalInput,
    session,
    submitChangePassword,
    submitCommand,
    submitting,
    terminalCwd,
    terminalInput,
    terminalProfile,
    terminateTerminalSession,
    terminatingTerminalSessionId,
    timelineFilterAgentId,
    updateRemoteFilePath,
    updatingManagedAgentId,
    updatingUserId,
    useSelectedAgentIdForAuthCode,
    userForm,
    users,
    visibleCommands,
    visibleTerminalSessions,
    wsState,
    isAdmin,
    bootstrap,
    interruptTerminalSession,
    resetPassword,
    savingAuthCodeId
  };
});
