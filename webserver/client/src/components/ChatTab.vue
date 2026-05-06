<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  ElButton,
  ElCard,
  ElCollapse,
  ElCollapseItem,
  ElInput,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElTag
} from "element-plus";

const CHAT_OUTPUT_PREVIEW_LIMIT = 1200;

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
const expandedResultIds = ref([]);
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

const canSend = computed(() => Boolean(chatInput.value.trim() && !props.submitting));

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
    text: "",
    command: "",
    commandShell: props.commandShell,
    requestId: "",
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

  if (!value || props.submitting) {
    return;
  }

  chatInput.value = "";
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

function resolveAgentLabel(agentId) {
  const agent = props.agents.find((item) => item.agentId === agentId) || null;

  if (!agent) {
    return agentId || "-";
  }

  return agent.label && agent.label !== agent.agentId ? `${agent.label} / ${agent.agentId}` : agent.agentId;
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
  () => props.selectedAgentId,
  () => {
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

        <label class="field-block field-block-tight chat-shell-field">
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

        <div class="chat-state-tags">
          <el-tag :type="activeAgentStatusType" effect="dark" round>{{ activeAgentStatusText }}</el-tag>
          <el-tag :type="authCodeStatusType" effect="dark" round>{{ authCodeStatusText }}</el-tag>
          <el-tag :type="wsConnected ? 'success' : 'warning'" effect="plain" round>
            {{ wsConnected ? "实时同步" : "重连中" }}
          </el-tag>
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
            <time>{{ formatCreatedAt(message.createdAt) }}</time>
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

          <div v-else class="chat-bubble chat-bubble-assistant">
            <p>{{ message.text }}</p>
            <time>{{ formatCreatedAt(message.createdAt) }}</time>
          </div>
        </div>
      </div>

      <div v-if="quickActions.length || presetCommands.length" class="chat-shortcuts">
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
          placeholder="输入命令，或输入：查看主机名、当前用户、查看网络信息"
          @keydown.ctrl.enter.prevent="submitChatInput"
          @keydown.meta.enter.prevent="submitChatInput"
        />
        <el-button type="primary" round :disabled="!canSend" @click="submitChatInput">
          {{ submitting ? "提交中..." : "发送" }}
        </el-button>
      </div>
    </el-card>
  </section>
</template>
