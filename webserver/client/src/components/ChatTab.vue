<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  ElAutocomplete,
  ElButton,
  ElCard,
  ElCollapse,
  ElCollapseItem,
  ElDialog,
  ElInput,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElTag
} from "element-plus";

const CHAT_OUTPUT_PREVIEW_LIMIT = 1200;
const CHAT_AI_LONG_TEXT_HINT_LIMIT = 300;
const CHAT_MODE_NORMAL = "normal";
const CHAT_MODE_CODEX = "codex";

const props = defineProps({
  agents: {
    type: Array,
    required: true
  },
  selectedAgentId: {
    type: String,
    required: true
  },
  activeAgent: {
    type: Object,
    default: null
  },
  activeAuthCodeBinding: {
    type: Object,
    default: null
  },
  commands: {
    type: Array,
    required: true
  },
  submitting: {
    type: Boolean,
    required: true
  },
  commandShell: {
    type: String,
    required: true
  },
  commandShellOptions: {
    type: Array,
    required: true
  },
  commandSubmitter: {
    type: Function,
    required: true
  },
  availableTerminalProfiles: {
    type: Array,
    default: () => []
  },
  terminalSessions: {
    type: Array,
    default: () => []
  },
  creatingTerminalSession: {
    type: Boolean,
    default: false
  },
  sendingTerminalInput: {
    type: Boolean,
    default: false
  },
  readingRemoteFile: {
    type: Boolean,
    default: false
  },
  terminalSessionCreator: {
    type: Function,
    default: null
  },
  terminalInputSender: {
    type: Function,
    default: null
  },
  terminalSessionTerminator: {
    type: Function,
    default: null
  },
  remoteFileOpener: {
    type: Function,
    default: null
  },
  wsConnected: {
    type: Boolean,
    required: true
  },
  wsError: {
    type: String,
    default: ""
  }
});

const emit = defineEmits(["update:selectedAgentId", "update:commandShell"]);

const chatInput = ref("");
const chatMode = ref(CHAT_MODE_NORMAL);
const chatAiProfile = ref("codex_code_session");
const chatAiCwd = ref("");
const chatAiSessionId = ref("");
const chatAiPendingMessageId = ref("");
const chatAiLastFinalText = ref("");
const expandedResultIds = ref([]);
const aiFileDialogVisible = ref(false);
const activeAiFileViewer = ref(null);
const messageListRef = ref(null);
let messageSeed = 0;
const messages = ref([createSystemMessage("选择在线设备后，可以通过确认卡下发安全命令。")]);

const commandsByRequestId = computed(
  () =>
    new Map(
      (Array.isArray(props.commands) ? props.commands : [])
        .filter((item) => item?.requestId)
        .map((item) => [item.requestId, item])
    )
);

const terminalSessionsById = computed(
  () =>
    new Map(
      (Array.isArray(props.terminalSessions) ? props.terminalSessions : [])
        .filter((item) => item?.sessionId)
        .map((item) => [item.sessionId, item])
    )
);

const aiTerminalProfiles = computed(() => {
  const profiles = Array.isArray(props.availableTerminalProfiles) ? props.availableTerminalProfiles : [];
  const aiProfiles = profiles.filter((profile) => {
    const outputMode = String(profile?.outputMode || "").trim();
    const name = String(profile?.name || "").toLowerCase();
    const command = String(profile?.command || "").toLowerCase();
    return outputMode === "final_only" || outputMode === "hybrid" || /codex|claude/.test(`${name} ${command}`);
  });

  return aiProfiles.length > 0 ? aiProfiles : profiles.filter((profile) => profile?.kind === "cli");
});

const selectedAiProfileConfig = computed(
  () => aiTerminalProfiles.value.find((item) => item.name === chatAiProfile.value) || null
);

const currentAiSession = computed(() => terminalSessionsById.value.get(chatAiSessionId.value) || null);

const codexTerminalSessions = computed(() =>
  (Array.isArray(props.terminalSessions) ? props.terminalSessions : [])
    .filter((session) => isAiTerminalSession(session))
    .sort((left, right) =>
      String(right?.updatedAt || right?.createdAt || "").localeCompare(
        String(left?.updatedAt || left?.createdAt || "")
      )
    )
);

const currentAiSessionStatus = computed(() => {
  if (!chatAiSessionId.value) {
    return "未启动";
  }

  return statusText(currentAiSession.value?.status || "pending");
});

const canStartAiSession = computed(() =>
  Boolean(
    props.selectedAgentId &&
      props.activeAgent?.status === "online" &&
      props.activeAuthCodeBinding &&
      chatAiProfile.value &&
      selectedAiProfileConfig.value &&
      props.terminalSessionCreator &&
      selectedAiProfileConfig.value?.isAvailable !== false &&
      (!currentAiSession.value || isTerminalSessionClosed(currentAiSession.value.status)) &&
      !props.creatingTerminalSession
  )
);

const canTerminateAiSession = computed(() =>
  Boolean(
    currentAiSession.value &&
      !isTerminalSessionClosed(currentAiSession.value.status) &&
      props.terminalSessionTerminator
  )
);

const canRestoreAiSession = computed(() =>
  Boolean(chatMode.value === CHAT_MODE_CODEX && chatAiSessionId.value && currentAiSession.value)
);

const presetCommands = computed(() => {
  const items = Array.isArray(props.activeAgent?.presetCommands) ? props.activeAgent.presetCommands : [];

  return items
    .map((item, index) => {
      const command = String(item?.command || "").trim();
      const label = String(item?.label || "").trim() || command;

      if (!command) {
        return null;
      }

      return {
        key: `${index}:${label}\u0000${command}`,
        label,
        command
      };
    })
    .filter(Boolean)
    .slice(0, 8);
});

const quickActions = computed(() => [
  {
    label: "查看主机名",
    command: "hostname"
  },
  {
    label: "当前用户",
    command: "whoami"
  },
  {
    label: "网络信息",
    command: isWindowsAgent.value ? "ipconfig /all" : "ifconfig || ip addr"
  },
  {
    label: "当前目录",
    command: isWindowsAgent.value ? "cd" : "pwd"
  }
]);

const isWindowsAgent = computed(() =>
  /win/i.test(String(props.activeAgent?.platform || props.activeAgent?.os || ""))
);

const activeAgentStatusType = computed(() => {
  if (props.activeAgent?.status === "online") {
    return "success";
  }

  if (props.selectedAgentId) {
    return "danger";
  }

  return "info";
});

const activeAgentStatusText = computed(() => {
  if (!props.selectedAgentId) {
    return "未选择设备";
  }

  return props.activeAgent?.status === "online" ? "online" : props.activeAgent?.status || "offline";
});

const authCodeStatusType = computed(() => (props.activeAuthCodeBinding ? "success" : "danger"));
const authCodeStatusText = computed(() => (props.activeAuthCodeBinding ? "已绑定公钥" : "缺少公钥"));

const canSend = computed(() => {
  if (!chatInput.value.trim()) {
    return false;
  }

  if (chatMode.value === CHAT_MODE_CODEX) {
    return Boolean(
      currentAiSession.value &&
        !isTerminalSessionClosed(currentAiSession.value.status) &&
        props.terminalInputSender &&
        !props.sendingTerminalInput &&
        !chatAiPendingMessageId.value
    );
  }

  return !props.submitting;
});

function createSystemMessage(text) {
  return createMessage({
    role: "system",
    text
  });
}

function createMessage(payload) {
  messageSeed += 1;
  return {
    id: `chat_${Date.now()}_${messageSeed}`,
    role: "assistant",
    mode: chatMode.value,
    text: "",
    command: "",
    commandShell: props.commandShell,
    requestId: "",
    sessionId: chatAiSessionId.value,
    profile: chatAiProfile.value,
    filePath: "",
    baseCwd: "",
    fileViewer: null,
    fileOpenStatus: "",
    status: "draft",
    riskLevel: "low",
    riskReason: "",
    agentId: props.selectedAgentId || "",
    createdAt: new Date().toISOString(),
    ...payload
  };
}

function submitChatInput() {
  const value = chatInput.value.trim();

  if (!value || !canSend.value) {
    return;
  }

  chatInput.value = "";

  if (chatMode.value === CHAT_MODE_CODEX) {
    void submitAiChatInput(value);
    return;
  }

  messages.value = [
    ...messages.value,
    createMessage({
      role: "user",
      text: value
    })
  ];

  createDraftActionFromText(value);
}

function createDraftActionFromText(value) {
  const validationMessage = validateActionContext();

  if (validationMessage) {
    appendAssistantMessage(validationMessage);
    return;
  }

  const parsed = parseUserText(value);

  if (!parsed.command) {
    appendAssistantMessage("当前只支持明确命令和少量常用表达，请改成具体命令或使用下方快捷项。");
    return;
  }

  appendActionMessage(parsed);
}

function appendActionMessage(parsed) {
  const risk = classifyCommandRisk(parsed.command);
  messages.value = [
    ...messages.value,
    createMessage({
      role: "action",
      text: parsed.intent || "待执行命令",
      command: parsed.command,
      commandShell: props.commandShell,
      riskLevel: risk.level,
      riskReason: risk.reason,
      status: "draft"
    })
  ];
}

function appendAssistantMessage(text) {
  messages.value = [
    ...messages.value,
    createMessage({
      role: "assistant",
      text
    })
  ];
}

function appendFileMessage(payload) {
  messages.value = [
    ...messages.value,
    createMessage({
      role: "file",
      mode: CHAT_MODE_CODEX,
      text: payload?.text || "Codex 返回了文件结果。",
      filePath: payload?.filePath || "",
      sessionId: payload?.sessionId || chatAiSessionId.value,
      agentId: payload?.agentId || props.selectedAgentId || "",
      profile: payload?.profile || chatAiProfile.value,
      baseCwd: payload?.baseCwd || "",
      status: payload?.status || "completed"
    })
  ];
}

function clearAiConversationMessages() {
  messages.value = messages.value.filter((item) => item?.role === "system" || item?.mode !== CHAT_MODE_CODEX);

  if (aiFileDialogVisible.value) {
    showAiFileViewer(null);
  }
}

function validateActionContext() {
  if (!props.selectedAgentId || !props.activeAgent) {
    return "请先选择一台设备。";
  }

  if (props.activeAgent.status !== "online") {
    return `当前设备 ${props.activeAgent.label || props.selectedAgentId} 不在线，暂不从对话页下发命令。`;
  }

  if (!props.activeAuthCodeBinding) {
    return "当前设备缺少 auth_code 绑定，请先完成公钥绑定。";
  }

  return "";
}

function validateAiSessionContext() {
  const actionContext = validateActionContext();

  if (actionContext) {
    return actionContext;
  }

  if (!selectedAiProfileConfig.value) {
    return "当前设备没有可用的 Codex / AI Agent profile。";
  }

  if (selectedAiProfileConfig.value.isAvailable === false) {
    return selectedAiProfileConfig.value.unavailableReason || `AI Agent 当前不可用: ${chatAiProfile.value}`;
  }

  if (!props.terminalSessionCreator || !props.terminalInputSender) {
    return "当前页面缺少 AI 会话动作，请刷新后重试。";
  }

  return "";
}

function parseUserText(value) {
  const text = String(value || "").trim();
  const normalized = text.replace(/\s+/g, " ");
  const lowered = normalized.toLowerCase();
  const mapped = mapNaturalLanguageToCommand(lowered);

  if (mapped) {
    return mapped;
  }

  if (looksLikeExplicitCommand(normalized)) {
    return {
      intent: "执行用户输入的命令",
      command: normalized
    };
  }

  return {
    intent: "",
    command: ""
  };
}

function mapNaturalLanguageToCommand(lowered) {
  if (/(主机名|hostname|机器名)/i.test(lowered)) {
    return {
      intent: "查看主机名",
      command: "hostname"
    };
  }

  if (/(当前用户|用户是谁|whoami)/i.test(lowered)) {
    return {
      intent: "查看当前用户",
      command: "whoami"
    };
  }

  if (/(网络|ipconfig|ip 地址|ip地址|网卡)/i.test(lowered)) {
    return {
      intent: "查看网络信息",
      command: isWindowsAgent.value ? "ipconfig /all" : "ifconfig || ip addr"
    };
  }

  if (/(当前目录|工作目录|pwd)/i.test(lowered)) {
    return {
      intent: "查看当前目录",
      command: isWindowsAgent.value ? "cd" : "pwd"
    };
  }

  return null;
}

function looksLikeExplicitCommand(value) {
  if (!value || /[\u4e00-\u9fff]/.test(value)) {
    return false;
  }

  return /^[a-zA-Z0-9_.:\\/-]+(?:\s|$)/.test(value);
}

function classifyCommandRisk(command) {
  const value = String(command || "").toLowerCase();

  if (
    /\b(rm\s+-rf|del\s+\/[fsq]|format\b|shutdown\b|reboot\b|restart-computer\b|stop-service\b|net\s+user\b|reg\s+(add|delete)|setx\b|chmod\s+777|chown\b|mkfs\b)\b/.test(value)
  ) {
    return {
      level: "high",
      reason: "命令可能修改系统、删除数据或影响服务。"
    };
  }

  if (/\b(ipconfig\s+\/all|ifconfig|ip\s+addr|get-content|type\b|cat\b|dir\b|ls\b)\b/.test(value)) {
    return {
      level: "medium",
      reason: "输出可能包含路径、网络或文件内容等敏感信息。"
    };
  }

  return {
    level: "low",
    reason: "只读或低影响命令。"
  };
}

async function executeAction(message) {
  if (!message?.command || props.submitting || message.status !== "draft") {
    return;
  }

  const validationMessage = validateActionContext();

  if (validationMessage) {
    message.status = "failed";
    appendAssistantMessage(validationMessage);
    return;
  }

  if (message.riskLevel === "high") {
    try {
      await ElMessageBox.confirm(
        `确认在 ${props.activeAgent?.label || props.selectedAgentId} 执行高风险命令吗？\n\n${message.command}`,
        "高风险命令确认",
        {
          type: "warning",
          confirmButtonText: "仍要执行",
          cancelButtonText: "取消"
        }
      );
    } catch {
      return;
    }
  }

  message.status = "pending";
  message.agentId = props.selectedAgentId;

  const result = await emitSubmitCommand(message.command, message.commandShell || props.commandShell);

  if (!result) {
    message.status = "failed";
    appendAssistantMessage("命令提交失败，请查看顶部链路提示或任务记录。");
    return;
  }

  if (result?.requestId) {
    message.requestId = result.requestId;
    message.status = result.status || "pending";
    return;
  }

  message.status = "pending";
}

function emitSubmitCommand(command, shell) {
  return props.commandSubmitter(command, {
    shell
  });
}

async function startAiSession() {
  const validationMessage = validateAiSessionContext();

  if (validationMessage) {
    appendAssistantMessage(validationMessage);
    return false;
  }

  const result = await props.terminalSessionCreator({
    profile: chatAiProfile.value,
    cwd: chatAiCwd.value,
    select: false,
    autoOpen: false
  });

  if (!result?.sessionId) {
    appendAssistantMessage("Codex 会话启动失败，请查看顶部链路提示。");
    return false;
  }

  chatAiSessionId.value = result.sessionId;
  chatAiPendingMessageId.value = "";
  chatAiLastFinalText.value = String(result.finalText || "");
  if (result.cwd) {
    chatAiCwd.value = result.cwd;
  }
  appendAssistantMessage(
    `Codex 会话已启动：${resolveAiProfileLabel(chatAiProfile.value)} · ${chatAiCwd.value || result.cwd || "默认目录"}`
  );
  return true;
}

async function terminateAiSession() {
  if (!chatAiSessionId.value || !props.terminalSessionTerminator) {
    return;
  }

  const terminated = await props.terminalSessionTerminator(chatAiSessionId.value);

  if (terminated !== false) {
    appendAssistantMessage("Codex 会话已请求结束。");
  }
}

async function submitAiChatInput(value) {
  const validationMessage = validateAiSessionContext();

  if (validationMessage) {
    appendAssistantMessage(validationMessage);
    return;
  }

  if (!currentAiSession.value || isTerminalSessionClosed(currentAiSession.value.status)) {
    appendAssistantMessage("请先启动 Codex 会话。");
    return;
  }

  const userMessage = createMessage({
    role: "user",
    mode: CHAT_MODE_CODEX,
    text: value,
    sessionId: chatAiSessionId.value
  });
  const assistantMessage = createMessage({
    role: "assistant",
    mode: CHAT_MODE_CODEX,
    text: "等待 Codex 返回最终结果...",
    sessionId: chatAiSessionId.value,
    status: "running"
  });

  messages.value = [...messages.value, userMessage, assistantMessage];
  chatAiPendingMessageId.value = assistantMessage.id;

  const sent = await props.terminalInputSender({
    sessionId: chatAiSessionId.value,
    input: value
  });

  if (!sent) {
    assistantMessage.status = "failed";
    assistantMessage.text = "发送到 Codex 会话失败，请查看顶部链路提示。";
    chatAiPendingMessageId.value = "";
  }
}

async function openAiFile(message) {
  if (!message?.filePath || !message?.sessionId || !props.remoteFileOpener) {
    return;
  }

  if (message.fileViewer) {
    showAiFileViewer(message.fileViewer);
    return;
  }

  message.fileOpenStatus = "opening";
  const result = await props.remoteFileOpener({
    agentId: message.agentId || props.selectedAgentId,
    sessionId: message.sessionId,
    filePath: message.filePath,
    baseCwd: message.baseCwd || ""
  });

  if (!result) {
    message.fileOpenStatus = "failed";
    appendAssistantMessage("打开 Codex 返回的文件失败，请查看顶部链路提示。");
    return;
  }

  message.fileViewer = result;
  message.fileOpenStatus = "opened";
  showAiFileViewer(result);
}

function showAiFileViewer(viewer) {
  activeAiFileViewer.value = viewer || null;
  aiFileDialogVisible.value = Boolean(viewer);
}

function getAiFileViewerTitle(viewer) {
  return String(viewer?.resolvedPath || viewer?.filePath || "文件预览");
}

function getAiFileViewerMeta(viewer) {
  const parts = [];

  if (viewer?.encoding) {
    parts.push(`编码 ${viewer.encoding}`);
  }

  if (Number(viewer?.bytesRead || 0) > 0) {
    parts.push(`读取 ${viewer.bytesRead} / ${viewer.totalBytes || viewer.bytesRead} 字节`);
  }

  if (viewer?.truncated) {
    parts.push("内容已截断");
  }

  return parts.join(" · ");
}

function applyAiFinalText(session) {
  const finalText = String(session?.finalText || "").trim();
  const pendingMessage = messages.value.find((item) => item.id === chatAiPendingMessageId.value) || null;

  if (
    !finalText ||
    looksLikePromptEchoFinalText(finalText) ||
    (finalText === chatAiLastFinalText.value && !pendingMessage)
  ) {
    return false;
  }

  chatAiLastFinalText.value = finalText;
  const filePath = extractResultFilePath(finalText);
  const existingMessage = pendingMessage ? null : findExistingAiResultMessage(session, finalText, filePath);

  if (existingMessage) {
    refreshExistingAiResultMessage(existingMessage, session, finalText, filePath);
    return true;
  }

  if (pendingMessage) {
    pendingMessage.status = "completed";
    pendingMessage.updatedAt = new Date().toISOString();

    if (filePath) {
      pendingMessage.role = "file";
      pendingMessage.text = "Codex 返回了文件结果。";
      pendingMessage.filePath = filePath;
      pendingMessage.sessionId = session.sessionId;
      pendingMessage.agentId = session.agentId || props.selectedAgentId || "";
      pendingMessage.profile = session.profile || chatAiProfile.value;
      pendingMessage.baseCwd = session.cwd || "";
    } else {
      pendingMessage.text = finalText;
      pendingMessage.longTextHint = finalText.length > CHAT_AI_LONG_TEXT_HINT_LIMIT;
    }

    chatAiPendingMessageId.value = "";
    return true;
  }

  if (filePath) {
    appendFileMessage({
      filePath,
      sessionId: session.sessionId,
      agentId: session.agentId || props.selectedAgentId || "",
      profile: session.profile || chatAiProfile.value,
      baseCwd: session.cwd || ""
    });
    return true;
  }

  messages.value = [
    ...messages.value,
    createMessage({
      role: "assistant",
      mode: CHAT_MODE_CODEX,
      text: finalText,
      sessionId: session.sessionId,
      status: "completed",
      longTextHint: finalText.length > CHAT_AI_LONG_TEXT_HINT_LIMIT
    })
  ];
  return true;
}

function findExistingAiResultMessage(session, finalText, filePath) {
  const sessionId = String(session?.sessionId || "").trim();
  const normalizedFilePath = normalizePathCandidate(filePath);
  const normalizedFinalText = String(finalText || "").trim();

  if (!sessionId) {
    return null;
  }

  return (
    messages.value.find((item) => {
      if (String(item?.sessionId || "") !== sessionId || item?.mode !== CHAT_MODE_CODEX) {
        return false;
      }

      if (normalizedFilePath) {
        return item.role === "file" && normalizePathCandidate(item.filePath) === normalizedFilePath;
      }

      return item.role === "assistant" && String(item.text || "").trim() === normalizedFinalText;
    }) || null
  );
}

function refreshExistingAiResultMessage(message, session, finalText, filePath) {
  message.status = "completed";
  message.updatedAt = new Date().toISOString();
  message.agentId = session?.agentId || message.agentId || props.selectedAgentId || "";
  message.profile = session?.profile || message.profile || chatAiProfile.value;
  message.baseCwd = session?.cwd || message.baseCwd || "";

  if (filePath) {
    message.role = "file";
    message.text = "Codex 返回了文件结果。";
    message.filePath = filePath;
    moveMessageToBottom(message);
    return;
  }

  message.text = finalText;
  message.longTextHint = finalText.length > CHAT_AI_LONG_TEXT_HINT_LIMIT;
  moveMessageToBottom(message);
}

function moveMessageToBottom(message) {
  const index = messages.value.findIndex((item) => item.id === message?.id);

  if (index < 0 || index === messages.value.length - 1) {
    return;
  }

  const nextMessages = [...messages.value];
  const [selectedMessage] = nextMessages.splice(index, 1);
  nextMessages.push(selectedMessage);
  messages.value = nextMessages;
}

function looksLikePromptEchoFinalText(text) {
  const value = String(text || "").trim();
  const lowered = value.toLowerCase();

  if (!value) {
    return true;
  }

  if (["与", "和", "and", "正文"].includes(lowered) || ["与", "和", "正文"].includes(value)) {
    return true;
  }

  return /(用户请求|不要输出中间思考|最终只允许输出|标记包裹|输出规则|开始标记|结束标记|最终结果必须)/.test(value);
}

function settlePendingAiMessageForClosedSession(session) {
  if (!chatAiPendingMessageId.value || !isTerminalSessionClosedStatus(session?.status)) {
    return;
  }

  if (String(session?.finalText || "").trim()) {
    return;
  }

  const pendingMessage = messages.value.find((item) => item.id === chatAiPendingMessageId.value) || null;

  if (pendingMessage) {
    const status = String(session?.status || "");
    pendingMessage.status = "failed";
    pendingMessage.updatedAt = new Date().toISOString();
    pendingMessage.text =
      session?.error ||
      (status === "completed"
        ? "Codex 会话已结束，但没有返回可展示的最终结果。请在终端会话中查看原始输出，处理后重新开始。"
        : "Codex 会话已结束，但没有返回最终结果。");
  }

  chatAiPendingMessageId.value = "";
}

function cancelAction(message) {
  if (!message || message.status !== "draft") {
    return;
  }

  message.status = "cancelled";
}

function useQuickCommand(item) {
  const command = String(item?.command || "").trim();

  if (!command) {
    return;
  }

  chatInput.value = command;
  submitChatInput();
}

function usePresetCommand(item) {
  const command = String(item?.command || "").trim();

  if (!command) {
    return;
  }

  const validationMessage = validateActionContext();

  if (validationMessage) {
    appendAssistantMessage(validationMessage);
    return;
  }

  messages.value = [
    ...messages.value,
    createMessage({
      role: "user",
      text: item.label || command
    })
  ];
  appendActionMessage({
    intent: item.label || "预设命令",
    command
  });
}

function resolveCommandRecord(message) {
  return commandsByRequestId.value.get(message?.requestId) || null;
}

function resolveMessageStatus(message) {
  const record = resolveCommandRecord(message);
  return record?.status || message.status || "draft";
}

function statusType(status) {
  if (status === "completed") {
    return "success";
  }

  if (["draft", "queued", "pending", "running", "dispatched"].includes(String(status || ""))) {
    return "warning";
  }

  if (status === "cancelled") {
    return "info";
  }

  return "danger";
}

function statusText(status) {
  switch (String(status || "")) {
    case "draft":
      return "待确认";
    case "pending":
    case "queued":
      return "排队中";
    case "dispatched":
      return "已派发";
    case "running":
      return "执行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "timed_out":
      return "超时";
    case "connection_lost":
      return "连接中断";
    case "cancelled":
      return "已取消";
    default:
      return status || "-";
  }
}

function riskType(level) {
  if (level === "high") {
    return "danger";
  }

  if (level === "medium") {
    return "warning";
  }

  return "success";
}

function riskText(level) {
  if (level === "high") {
    return "高风险";
  }

  if (level === "medium") {
    return "中风险";
  }

  return "低风险";
}

function resolveShellLabel(shellValue) {
  const normalized = String(shellValue || "").trim();
  return props.commandShellOptions.find((item) => item.value === normalized)?.label || normalized || "-";
}

function resolveAiProfileLabel(profileValue) {
  const normalized = String(profileValue || "").trim();
  const profile = aiTerminalProfiles.value.find((item) => item.name === normalized) || null;
  return profile?.label || profile?.name || normalized || "-";
}

function getAiProfileOptionLabel(profile) {
  const label = String(profile?.label || profile?.name || "").trim();
  const command = String(profile?.command || "").trim();
  return command ? `${label} / ${command}` : label;
}

function getAiSessionOptionLabel(session) {
  const updatedAt = formatCreatedAt(session?.updatedAt || session?.createdAt);
  const cwd = String(session?.cwd || "").trim();
  const status = statusText(session?.status || "");
  const suffix = [status, updatedAt].filter(Boolean).join(" · ");
  return `${cwd || session?.sessionId || "Codex 会话"}${suffix ? ` (${suffix})` : ""}`;
}

function isAiTerminalSession(session) {
  const outputMode = String(session?.displayMode || session?.outputMode || "").trim();
  const profile = String(session?.profile || "").toLowerCase();
  const sessionType = String(session?.sessionType || "").toLowerCase();

  return (
    outputMode === "final_only" ||
    outputMode === "hybrid" ||
    sessionType === "llm_cli" ||
    /codex|claude/.test(profile)
  );
}

function restoreAiSessionRecord(session) {
  if (!session) {
    return false;
  }

  chatAiProfile.value = session.profile || chatAiProfile.value;
  chatAiCwd.value = session.cwd || chatAiCwd.value;
  chatAiPendingMessageId.value = "";
  chatAiLastFinalText.value = "";
  return applyAiFinalText(session);
}

function restoreAiSession() {
  const session = currentAiSession.value;

  if (!session) {
    return;
  }

  const restored = restoreAiSessionRecord(session);

  if (!restored && !String(session.finalText || "").trim()) {
    appendAssistantMessage("当前 Codex 会话还没有可展示的最终结果。");
  }
}

function resolveAgentLabel(agentId) {
  const agent = props.agents.find((item) => item.agentId === agentId) || null;

  if (!agent) {
    return agentId || "-";
  }

  return agent.label && agent.label !== agent.agentId ? `${agent.label} / ${agent.agentId}` : agent.agentId;
}

function queryCommonWorkingDirectories(queryString, callback) {
  const items = Array.isArray(props.activeAgent?.commonWorkingDirectories)
    ? props.activeAgent.commonWorkingDirectories
    : [];
  const keyword = String(queryString || "")
    .trim()
    .toLowerCase();
  const suggestions = items
    .filter((cwd) => !keyword || String(cwd).toLowerCase().includes(keyword))
    .map((cwd) => ({
      value: cwd
    }));

  callback(suggestions);
}

function isTerminalSessionClosed(status) {
  return ["completed", "failed", "terminated", "connection_lost"].includes(String(status || ""));
}

function extractResultFilePath(text) {
  const source = String(text || "").trim();

  if (!source) {
    return "";
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => normalizePathCandidate(line))
    .filter(Boolean);
  const candidates = lines.length > 0 ? lines : [normalizePathCandidate(source)];

  return candidates.find((candidate) => looksLikeResultFilePath(candidate)) || "";
}

function normalizePathCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/^文件路径[:：]\s*/i, "")
    .replace(/^路径[:：]\s*/i, "")
    .replace(/^result(?: file)?[:：]\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function looksLikeResultFilePath(value) {
  const candidate = String(value || "").trim();

  if (!candidate || /\s{2,}/.test(candidate)) {
    return false;
  }

  return (
    /^[a-zA-Z]:[\\/].+\.[a-z0-9]{1,12}$/i.test(candidate) ||
    /^\/.+\.[a-z0-9]{1,12}$/i.test(candidate) ||
    /^\.?\.?[\\/].+\.[a-z0-9]{1,12}$/i.test(candidate) ||
    /^\.remote-client[\\/]codex-results[\\/].+\.[a-z0-9]{1,12}$/i.test(candidate) ||
    /^codex-results[\\/].+\.[a-z0-9]{1,12}$/i.test(candidate) ||
    /(?:^|[\\/])(?:\.remote-client[\\/]codex-results|codex-results)[\\/].+\.[a-z0-9]{1,12}$/i.test(candidate)
  );
}

function hasCommandOutput(record) {
  return Boolean(record?.stdout || record?.stderr || record?.error);
}

function getCommandOutputPreview(record) {
  const stdout = String(record?.stdout || "").trimEnd();
  const stderr = String(record?.stderr || record?.error || "").trimEnd();
  const parts = [];

  if (stdout) {
    parts.push(stdout);
  }

  if (stderr) {
    parts.push(stdout ? `STDERR / ERROR\n${stderr}` : stderr);
  }

  const text = parts.join("\n\n");

  if (text.length <= CHAT_OUTPUT_PREVIEW_LIMIT) {
    return text;
  }

  return `${text.slice(0, CHAT_OUTPUT_PREVIEW_LIMIT)}\n...（已截断，展开原始输出查看完整内容）`;
}

function getCommandOutputPreviewTitle(record) {
  if (record?.stdout) {
    return "输出预览";
  }

  return "错误输出";
}

function isCommandErrorOutput(record) {
  return Boolean(!record?.stdout && (record?.stderr || record?.error));
}

function formatCreatedAt(value) {
  const time = Date.parse(String(value || ""));

  if (!Number.isFinite(time)) {
    return "";
  }

  return new Date(time).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getMessageDisplayTime(message) {
  return message?.updatedAt || message?.createdAt || "";
}

function scrollToBottom() {
  nextTick(() => {
    const element = messageListRef.value;

    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  });
}

watch(
  messages,
  () => {
    scrollToBottom();
  },
  {
    deep: true
  }
);

watch(
  aiTerminalProfiles,
  (profiles) => {
    if (profiles.some((item) => item.name === chatAiProfile.value)) {
      return;
    }

    const codexProfile =
      profiles.find((item) => /codex/i.test(`${item?.name || ""} ${item?.command || ""}`)) ||
      profiles[0] ||
      null;
    chatAiProfile.value = codexProfile?.name || "codex_code_session";
  },
  {
    immediate: true
  }
);

watch(
  () => chatAiSessionId.value,
  (sessionId, previousSessionId) => {
    if (sessionId === previousSessionId) {
      return;
    }

    clearAiConversationMessages();
    chatAiPendingMessageId.value = "";
    chatAiLastFinalText.value = "";

    const session = terminalSessionsById.value.get(sessionId) || null;

    if (session) {
      restoreAiSessionRecord(session);
    }
  },
  {
    flush: "sync"
  }
);

watch(
  () => currentAiSession.value?.finalText || "",
  () => {
    if (currentAiSession.value) {
      applyAiFinalText(currentAiSession.value);
    }
  }
);

watch(
  () => currentAiSession.value?.status || "",
  () => {
    if (currentAiSession.value) {
      settlePendingAiMessageForClosedSession(currentAiSession.value);
    }
  }
);

watch(
  () => props.selectedAgentId,
  () => {
    if (currentAiSession.value?.agentId !== props.selectedAgentId) {
      chatAiSessionId.value = "";
      chatAiPendingMessageId.value = "";
      chatAiLastFinalText.value = "";
    }
    appendAssistantMessage(`当前设备已切换为 ${props.activeAgent?.label || props.selectedAgentId || "未选择设备"}。`);
  }
);
</script>

<template>
  <section class="page chat-page">
    <el-card class="surface-card section-banner tab-banner" shadow="never">
      <h2>对话控制台</h2>
    </el-card>

    <el-card class="surface-card chat-toolbar-card" shadow="never">
      <div class="chat-mode-switch" role="group" aria-label="会话类型">
        <button
          type="button"
          :class="{ active: chatMode === CHAT_MODE_NORMAL }"
          @click="chatMode = CHAT_MODE_NORMAL"
        >
          普通会话
        </button>
        <button
          type="button"
          :class="{ active: chatMode === CHAT_MODE_CODEX }"
          @click="chatMode = CHAT_MODE_CODEX"
        >
          Codex 会话
        </button>
      </div>

      <div class="chat-toolbar">
        <label class="field-block field-block-tight chat-device-field">
          <span>目标设备</span>
          <el-select
            :model-value="selectedAgentId"
            placeholder="请选择设备"
            filterable
            @update:model-value="emit('update:selectedAgentId', $event)"
          >
            <el-option
              v-for="agent in agents"
              :key="agent.agentId"
              :label="`${agent.label} / ${agent.agentId}`"
              :value="agent.agentId"
            />
          </el-select>
        </label>

        <label v-if="chatMode === CHAT_MODE_NORMAL" class="field-block field-block-tight chat-shell-field">
          <span>执行 Shell</span>
          <el-select
            :model-value="commandShell"
            placeholder="请选择执行 Shell"
            @update:model-value="emit('update:commandShell', $event)"
          >
            <el-option
              v-for="shell in commandShellOptions"
              :key="shell.value"
              :label="shell.label"
              :value="shell.value"
            />
          </el-select>
        </label>

        <template v-else>
          <label class="field-block field-block-tight chat-ai-profile-field">
            <span>AI Agent</span>
            <el-select v-model="chatAiProfile" placeholder="请选择 AI Agent" filterable>
              <el-option
                v-for="profile in aiTerminalProfiles"
                :key="profile.name"
                :label="getAiProfileOptionLabel(profile)"
                :value="profile.name"
                :disabled="profile.isAvailable === false"
              />
            </el-select>
          </label>

          <label class="field-block field-block-tight chat-ai-cwd-field">
            <span>工作目录</span>
            <el-autocomplete
              v-model="chatAiCwd"
              :fetch-suggestions="queryCommonWorkingDirectories"
              :trigger-on-focus="Boolean(activeAgent?.commonWorkingDirectories?.length)"
              clearable
              placeholder="选择常用目录或手动输入；留空使用默认目录"
            />
          </label>
        </template>

        <div class="chat-state-tags">
          <el-tag :type="activeAgentStatusType" effect="dark" round>{{ activeAgentStatusText }}</el-tag>
          <el-tag :type="authCodeStatusType" effect="dark" round>{{ authCodeStatusText }}</el-tag>
          <el-tag :type="wsConnected ? 'success' : 'warning'" effect="plain" round>
            {{ wsConnected ? "实时同步" : "重连中" }}
          </el-tag>
          <el-tag v-if="chatMode === CHAT_MODE_CODEX" :type="currentAiSession && !isTerminalSessionClosed(currentAiSession.status) ? 'success' : 'info'" effect="plain" round>
            Codex：{{ currentAiSessionStatus }}
          </el-tag>
        </div>
      </div>

      <div v-if="chatMode === CHAT_MODE_CODEX" class="chat-ai-session-bar">
        <label class="field-block field-block-tight chat-ai-history-field">
          <span>最近会话</span>
          <el-select
            v-model="chatAiSessionId"
            placeholder="选择已启动的 Codex 会话"
            filterable
            clearable
          >
            <el-option
              v-for="session in codexTerminalSessions"
              :key="session.sessionId"
              :label="getAiSessionOptionLabel(session)"
              :value="session.sessionId"
            />
          </el-select>
        </label>
        <div class="hero-actions">
          <el-button
            type="primary"
            round
            :disabled="!canStartAiSession"
            @click="startAiSession"
          >
            {{ creatingTerminalSession ? "启动中..." : "开始会话" }}
          </el-button>
          <el-button
            round
            plain
            :disabled="!canRestoreAiSession"
            @click="restoreAiSession"
          >
            查看结果
          </el-button>
          <el-button
            round
            plain
            :disabled="!canTerminateAiSession"
            @click="terminateAiSession"
          >
            结束会话
          </el-button>
        </div>
      </div>
      <p v-if="wsError" class="muted chat-toolbar-error">{{ wsError }}</p>
    </el-card>

    <el-card class="surface-card chat-main-card" shadow="never">
      <div ref="messageListRef" class="chat-message-list">
        <div
          v-for="message in messages"
          :key="message.id"
          class="chat-message"
          :class="[`chat-message-${message.role}`]"
        >
          <div v-if="message.role === 'user'" class="chat-bubble chat-bubble-user">
            <p>{{ message.text }}</p>
            <time>{{ formatCreatedAt(getMessageDisplayTime(message)) }}</time>
          </div>

          <div v-else-if="message.role === 'action'" class="chat-action-card">
            <div class="chat-action-head">
              <div>
                <strong>{{ message.text }}</strong>
                <small>
                  {{ resolveAgentLabel(message.agentId || selectedAgentId) }} ·
                  {{ resolveShellLabel(message.commandShell) }}
                </small>
              </div>
              <div class="chat-action-tags">
                <el-tag :type="riskType(message.riskLevel)" effect="dark" round>
                  {{ riskText(message.riskLevel) }}
                </el-tag>
                <el-tag :type="statusType(resolveMessageStatus(message))" effect="plain" round>
                  {{ statusText(resolveMessageStatus(message)) }}
                </el-tag>
              </div>
            </div>

            <div class="console-block chat-command-block">
              <h4>Command</h4>
              <pre>{{ message.command }}</pre>
            </div>

            <p class="muted chat-risk-copy">{{ message.riskReason }}</p>

            <div v-if="message.status === 'draft'" class="hero-actions chat-action-buttons">
              <el-button
                type="primary"
                round
                :disabled="submitting"
                @click="executeAction(message)"
              >
                {{ message.riskLevel === "high" ? "高风险确认执行" : "执行" }}
              </el-button>
              <el-button round plain :disabled="submitting" @click="cancelAction(message)">取消</el-button>
            </div>

            <div v-if="message.requestId" class="chat-result">
              <template v-if="resolveCommandRecord(message)">
                <div class="chat-result-meta">
                  <span>退出码：{{ resolveCommandRecord(message).exitCode ?? "-" }}</span>
                  <span>Shell：{{ resolveShellLabel(resolveCommandRecord(message).commandShell || message.commandShell) }}</span>
                  <span>安全：{{ resolveCommandRecord(message).secureStatus || "-" }}</span>
                  <span>{{ formatCreatedAt(resolveCommandRecord(message).updatedAt) }}</span>
                </div>

                <div
                  v-if="hasCommandOutput(resolveCommandRecord(message))"
                  class="console-block chat-output-preview"
                  :class="{ error: isCommandErrorOutput(resolveCommandRecord(message)) }"
                >
                  <h4>{{ getCommandOutputPreviewTitle(resolveCommandRecord(message)) }}</h4>
                  <pre>{{ getCommandOutputPreview(resolveCommandRecord(message)) }}</pre>
                </div>

                <el-collapse
                  v-if="hasCommandOutput(resolveCommandRecord(message))"
                  v-model="expandedResultIds"
                  class="chat-result-collapse"
                >
                  <el-collapse-item :name="message.id" title="完整原始输出">
                    <div v-if="resolveCommandRecord(message).stdout" class="console-block">
                      <h4>STDOUT</h4>
                      <pre>{{ resolveCommandRecord(message).stdout }}</pre>
                    </div>
                    <div
                      v-if="resolveCommandRecord(message).stderr || resolveCommandRecord(message).error"
                      class="console-block error"
                    >
                      <h4>STDERR / ERROR</h4>
                      <pre>{{ resolveCommandRecord(message).stderr || resolveCommandRecord(message).error }}</pre>
                    </div>
                  </el-collapse-item>
                </el-collapse>

                <p v-else class="muted chat-result-empty">当前还没有输出内容。</p>
              </template>
              <p v-else class="muted chat-result-empty">等待任务状态同步。</p>
            </div>
          </div>

          <div v-else-if="message.role === 'file'" class="chat-action-card chat-file-card">
            <div class="chat-action-head">
              <div>
                <strong>{{ message.text }}</strong>
                <small>{{ resolveAgentLabel(message.agentId || selectedAgentId) }} · {{ resolveAiProfileLabel(message.profile || chatAiProfile) }}</small>
              </div>
              <el-tag :type="statusType(message.fileOpenStatus === 'failed' ? 'failed' : message.status)" effect="plain" round>
                {{ message.fileOpenStatus === "opened" ? "已打开" : statusText(message.status) }}
              </el-tag>
            </div>

            <div class="console-block chat-command-block">
              <h4>File</h4>
              <pre>{{ message.filePath }}</pre>
            </div>

            <div class="hero-actions chat-action-buttons">
              <el-button
                type="primary"
                round
                :disabled="readingRemoteFile || message.fileOpenStatus === 'opening'"
                @click="openAiFile(message)"
              >
                {{ message.fileOpenStatus === "opening" ? "打开中..." : message.fileOpenStatus === "opened" ? "查看文件" : "打开文件" }}
              </el-button>
            </div>
          </div>

          <div v-else class="chat-bubble chat-bubble-assistant">
            <p>{{ message.text }}</p>
            <p v-if="message.longTextHint" class="muted chat-long-text-hint">
              内容偏长，后续可让 Codex 写入文件后再打开查看。
            </p>
            <time>{{ formatCreatedAt(getMessageDisplayTime(message)) }}</time>
          </div>
        </div>
      </div>

      <div v-if="chatMode === CHAT_MODE_NORMAL && (quickActions.length || presetCommands.length)" class="chat-shortcuts">
        <button
          v-for="item in quickActions"
          :key="`quick-${item.label}`"
          class="chat-shortcut"
          type="button"
          :disabled="submitting"
          @click="useQuickCommand(item)"
        >
          {{ item.label }}
        </button>
        <button
          v-for="item in presetCommands"
          :key="`preset-${item.key}`"
          class="chat-shortcut chat-shortcut-preset"
          type="button"
          :disabled="submitting"
          @click="usePresetCommand(item)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="chat-composer">
        <el-input
          v-model="chatInput"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          :placeholder="chatMode === CHAT_MODE_CODEX ? '输入要交给 Codex 处理的请求' : '输入命令，或输入：查看主机名、当前用户、查看网络信息'"
          @keydown.ctrl.enter.prevent="submitChatInput"
          @keydown.meta.enter.prevent="submitChatInput"
        />
        <el-button type="primary" round :disabled="!canSend" @click="submitChatInput">
          {{ chatMode === CHAT_MODE_CODEX ? (sendingTerminalInput ? "发送中..." : "发送给 Codex") : (submitting ? "提交中..." : "发送") }}
        </el-button>
      </div>
    </el-card>

    <el-dialog
      v-model="aiFileDialogVisible"
      append-to-body
      class="chat-file-dialog"
      destroy-on-close
      top="5vh"
      width="min(1120px, 92vw)"
    >
      <template #header>
        <div class="chat-file-dialog-head">
          <strong>文件预览</strong>
          <small>{{ getAiFileViewerTitle(activeAiFileViewer) }}</small>
        </div>
      </template>

      <div v-if="activeAiFileViewer" class="chat-file-dialog-body">
        <div class="chat-file-dialog-meta">
          <span>{{ getAiFileViewerMeta(activeAiFileViewer) || "文本文件" }}</span>
        </div>
        <pre>{{ activeAiFileViewer.content }}</pre>
      </div>
    </el-dialog>
  </section>
</template>
