<script setup>
import { computed, ref, watch } from "vue";
import {
  ElAutocomplete,
  ElButton,
  ElCard,
  ElCollapse,
  ElCollapseItem,
  ElInput,
  ElOption,
  ElOptionGroup,
  ElSelect,
  ElTabPane,
  ElTabs,
  ElTag
} from "element-plus";
import RemoteFilePreviewDialog from "./RemoteFilePreviewDialog.vue";
import TerminalEmulator from "./TerminalEmulator.vue";

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
  commandInput: {
    type: String,
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
  terminalProfile: {
    type: String,
    required: true
  },
  terminalCwd: {
    type: String,
    required: true
  },
  terminalInput: {
    type: String,
    required: true
  },
  remoteFilePath: {
    type: String,
    required: true
  },
  remoteFileViewer: {
    type: Object,
    default: null
  },
  remoteFileError: {
    type: String,
    default: ""
  },
  availableTerminalProfiles: {
    type: Array,
    required: true
  },
  terminalSessions: {
    type: Array,
    required: true
  },
  activeTerminalSession: {
    type: Object,
    default: null
  },
  autoOpenTerminalSessionId: {
    type: String,
    default: ""
  },
  canSubmitCommand: {
    type: Boolean,
    required: true
  },
  canCreateTerminalSession: {
    type: Boolean,
    required: true
  },
  canSendTerminalInput: {
    type: Boolean,
    required: true
  },
  canTerminateTerminalSession: {
    type: Boolean,
    required: true
  },
  submitting: {
    type: Boolean,
    required: true
  },
  creatingTerminalSession: {
    type: Boolean,
    required: true
  },
  sendingTerminalInput: {
    type: Boolean,
    required: true
  },
  readingRemoteFile: {
    type: Boolean,
    required: true
  },
  terminatingTerminalSessionId: {
    type: String,
    default: ""
  },
  deletingTerminalSessionId: {
    type: String,
    default: ""
  }
});

const emit = defineEmits([
  "update:selectedAgentId",
  "update:commandInput",
  "update:commandShell",
  "update:terminalProfile",
  "update:terminalCwd",
  "update:terminalInput",
  "update:remoteFilePath",
  "select:terminalSession",
  "opened-terminal-session",
  "submitCommand",
  "create-terminal-session",
  "send-terminal-input",
  "interrupt-terminal-session",
  "send-terminal-raw-input",
  "open-remote-file",
  "resize-terminal-session",
  "terminate-terminal-session",
  "delete-terminal-session"
]);

const activeMode = ref("command");
const sessionScreen = ref("main");
const detailSessionId = ref("");
const sessionMetaPanels = ref([]);
const devicePanels = ref([]);
const remoteFileDialogVisible = ref(false);

const currentSession = computed(
  () =>
    props.terminalSessions.find((item) => item.sessionId === detailSessionId.value) ||
    props.activeTerminalSession ||
    null
);

const selectedTerminalProfileConfig = computed(
  () => props.availableTerminalProfiles.find((item) => item.name === props.terminalProfile) || null
);

const selectedTerminalProfileUnavailableReason = computed(() =>
  selectedTerminalProfileConfig.value?.isAvailable === false
    ? String(selectedTerminalProfileConfig.value?.unavailableReason || "当前 profile 不可用")
    : ""
);

const selectedTerminalProfileDescription = computed(() =>
  String(selectedTerminalProfileConfig.value?.description || "").trim()
);

const terminalProfileOptionGroups = computed(() => {
  const profiles = Array.isArray(props.availableTerminalProfiles) ? props.availableTerminalProfiles : [];
  const groups = [
    {
      key: "recommended",
      label: "推荐 Profile",
      items: profiles.filter((profile) => String(profile?.source || "") !== "discovered")
    },
    {
      key: "shells",
      label: "环境 Shell",
      items: profiles.filter(
        (profile) =>
          String(profile?.source || "") === "discovered" && String(profile?.kind || "") === "shell"
      )
    },
    {
      key: "cli",
      label: "环境 CLI",
      items: profiles.filter(
        (profile) =>
          String(profile?.source || "") === "discovered" && String(profile?.kind || "") !== "shell"
      )
    }
  ];

  return groups.filter((group) => group.items.length > 0);
});

const activeDeviceLabel = computed(() => props.activeAgent?.agentId || "未选择设备");

const activeDeviceBindText = computed(() =>
  props.activeAuthCodeBinding ? "已绑定公钥" : "缺少公钥"
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
        key: createPresetCommandKey(label, command, index),
        label,
        command
      };
    })
    .filter(Boolean);
});

const selectedPresetCommandKey = ref("");

const selectedPresetCommand = computed(
  () => presetCommands.value.find((item) => item.key === selectedPresetCommandKey.value) || null
);

const canSubmitPresetCommand = computed(
  () =>
    Boolean(
      props.selectedAgentId &&
      selectedPresetCommand.value &&
      props.activeAuthCodeBinding &&
      !props.submitting
    )
);

const selectedSessionPresetCommandKey = ref("");

const selectedSessionPresetCommand = computed(
  () =>
    presetCommands.value.find((item) => item.key === selectedSessionPresetCommandKey.value) || null
);

const canSendSessionPresetInput = computed(
  () =>
    Boolean(
      currentSession.value &&
      selectedSessionPresetCommand.value &&
      !isTerminalSessionClosed(currentSession.value.status) &&
      !props.sendingTerminalInput
    )
);

const canInterruptCurrentSession = computed(
  () => Boolean(currentSession.value && !isTerminalSessionClosed(currentSession.value.status))
);

const canTerminateCurrentSession = computed(
  () =>
    Boolean(
      currentSession.value &&
      props.canTerminateTerminalSession &&
      currentSession.value.sessionId === props.activeTerminalSession?.sessionId &&
      props.terminatingTerminalSessionId !== currentSession.value.sessionId
    )
);

const shouldPreferFinalAnswer = computed(
  () =>
    ["final_only", "hybrid"].includes(String(currentSession.value?.displayMode || ""))
);

const hasFinalAnswer = computed(() => Boolean(String(currentSession.value?.finalText || "").trim()));
const canOpenRemoteFile = computed(
  () =>
    Boolean(
      currentSession.value &&
      props.activeAuthCodeBinding &&
      String(props.remoteFilePath || "").trim() &&
      !props.readingRemoteFile
    )
);
const currentRemoteFileViewer = computed(() => {
  const viewer = props.remoteFileViewer && typeof props.remoteFileViewer === "object"
    ? props.remoteFileViewer
    : null;

  if (!viewer) {
    return null;
  }

  if (String(viewer.sessionId || "") !== String(currentSession.value?.sessionId || "")) {
    return null;
  }

  return viewer;
});
const rawTerminalPanels = ref(["raw"]);

function createPresetCommandKey(label, command, index) {
  return `${index}:${label}\u0000${command}`;
}

function statusType(status) {
  if (["running", "completed"].includes(status)) {
    return "success";
  }

  if (["created", "dispatched", "terminating"].includes(status)) {
    return "warning";
  }

  return "danger";
}

function isTerminalSessionClosed(status) {
  return ["completed", "failed", "terminated", "connection_lost"].includes(String(status || ""));
}

function canDeleteSession(session) {
  return Boolean(
    session &&
    isTerminalSessionClosed(session.status) &&
    props.deletingTerminalSessionId !== session.sessionId
  );
}

function getTerminalProfileDisplayName(profileLike) {
  return String(profileLike?.label || profileLike?.profileLabel || profileLike?.name || profileLike?.profile || "").trim();
}

function getTerminalProfileOptionLabel(profile) {
  const displayName = getTerminalProfileDisplayName(profile) || String(profile?.name || "").trim();
  const command = String(profile?.command || "").trim();
  const sourceText = String(profile?.source || "") === "discovered" ? "环境探测" : "内置/配置";
  return command ? `${displayName} / ${command} / ${sourceText}` : `${displayName} / ${sourceText}`;
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

function handlePresetCommandChange(nextValue) {
  selectedPresetCommandKey.value = String(nextValue || "");

  if (!selectedPresetCommand.value) {
    return;
  }

  emit("update:commandInput", selectedPresetCommand.value.command);
}

function submitSelectedPresetCommand() {
  if (!selectedPresetCommand.value) {
    return;
  }

  emit("submitCommand", selectedPresetCommand.value.command);
}

function handleSessionPresetCommandChange(nextValue) {
  selectedSessionPresetCommandKey.value = String(nextValue || "");

  if (!selectedSessionPresetCommand.value) {
    return;
  }

  emit("update:terminalInput", selectedSessionPresetCommand.value.command);
}

function sendSelectedSessionPresetInput() {
  if (!currentSession.value || !selectedSessionPresetCommand.value) {
    return;
  }

  emit("send-terminal-input", {
    sessionId: currentSession.value.sessionId,
    input: selectedSessionPresetCommand.value.command
  });
}

function openSessionDetail(sessionId) {
  detailSessionId.value = sessionId;
  sessionMetaPanels.value = [];
  rawTerminalPanels.value = ["raw"];
  activeMode.value = "session";
  sessionScreen.value = "detail";
  emit("select:terminalSession", sessionId);
}

function goBackToSessionList() {
  activeMode.value = "session";
  sessionScreen.value = "main";
}

function openRemoteFileViewer() {
  if (!currentSession.value) {
    return;
  }

  emit("open-remote-file", {
    sessionId: currentSession.value.sessionId,
    filePath: props.remoteFilePath
  });
}

watch(
  () => props.selectedAgentId,
  () => {
    selectedPresetCommandKey.value = "";
    selectedSessionPresetCommandKey.value = "";
    sessionMetaPanels.value = [];
    rawTerminalPanels.value = [];
    sessionScreen.value = "main";
    detailSessionId.value = "";
  }
);

watch(
  [
    () => props.autoOpenTerminalSessionId,
    () => props.terminalSessions.map((item) => item.sessionId).join("|")
  ],
  ([sessionId]) => {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      return;
    }

    if (!props.terminalSessions.some((item) => item.sessionId === normalizedSessionId)) {
      return;
    }

    openSessionDetail(normalizedSessionId);
    emit("opened-terminal-session", normalizedSessionId);
  }
);

watch(presetCommands, (items) => {
  if (items.some((item) => item.key === selectedPresetCommandKey.value)) {
  } else {
    selectedPresetCommandKey.value = "";
  }

  if (items.some((item) => item.key === selectedSessionPresetCommandKey.value)) {
    return;
  }

  selectedSessionPresetCommandKey.value = "";
});

watch(currentSession, (session) => {
  if (session) {
    if (
      shouldPreferFinalAnswer.value &&
      !hasFinalAnswer.value &&
      !rawTerminalPanels.value.includes("raw")
    ) {
      rawTerminalPanels.value = ["raw"];
    }

    return;
  }

  if (sessionScreen.value === "detail") {
    sessionScreen.value = "main";
  }

  sessionMetaPanels.value = [];
  rawTerminalPanels.value = [];
  detailSessionId.value = "";
  selectedSessionPresetCommandKey.value = "";
});

watch(
  () => currentRemoteFileViewer.value?.openedAt || "",
  (openedAt) => {
    remoteFileDialogVisible.value = Boolean(openedAt);
  }
);
</script>

<template>
  <section class="page explore-page" :class="{ 'is-focus-mode': sessionScreen !== 'main' }">
    <el-card class="surface-card section-banner tab-banner" shadow="never">
      <h2>终端控制台</h2>
    </el-card>

    <el-card v-if="sessionScreen === 'main'" class="surface-card info-card explore-main-card" shadow="never">
      <el-tabs v-model="activeMode" stretch class="explore-mode-tabs">
        <el-tab-pane label="一次性命令" name="command">
          <div class="explore-pane">
            <div class="card-head card-head-tight">
              <div>
                <p class="eyebrow">Quick Command</p>
                <h3>一次性命令</h3>
                <p>适合快速返回结果的系统命令。</p>
              </div>
            </div>

            <label v-if="presetCommands.length" class="field-block field-block-tight">
              <span>预设命令</span>
              <el-select :model-value="selectedPresetCommandKey" clearable placeholder="选择当前设备 localapp/.env 中的预设命令"
                @update:model-value="handlePresetCommandChange">
                <el-option v-for="preset in presetCommands" :key="preset.key" :label="preset.label"
                  :value="preset.key" />
              </el-select>
              <p v-if="selectedPresetCommand" class="muted explore-preset-command-preview">
                {{ selectedPresetCommand.command }}
              </p>
            </label>
            <p v-else-if="selectedAgentId" class="muted explore-preset-command-empty">
              当前设备未配置 PRESET_COMMANDS，仍可直接手动输入命令。
            </p>

            <label class="field-block field-block-tight">
              <span>执行 Shell</span>
              <el-select :model-value="commandShell" placeholder="请选择执行 Shell"
                @update:model-value="emit('update:commandShell', $event)">
                <el-option v-for="shell in commandShellOptions" :key="shell.value" :label="shell.label"
                  :value="shell.value" />
              </el-select>
            </label>

            <label class="field-block field-block-tight">
              <span>命令内容</span>
              <el-input :model-value="commandInput" type="textarea" :autosize="{ minRows: 3, maxRows: 5 }"
                placeholder="例如：ipconfig /all 或 hostname" @update:model-value="emit('update:commandInput', $event)" />
            </label>

            <div class="hero-actions explore-actions">
              <el-button v-if="presetCommands.length" round plain :disabled="!canSubmitPresetCommand"
                @click="submitSelectedPresetCommand">
                {{ submitting ? "提交中..." : "直接调用预设" }}
              </el-button>
              <el-button type="primary" round :disabled="!canSubmitCommand" @click="emit('submitCommand')">
                {{ submitting ? "提交中..." : "发送安全命令" }}
              </el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="交互式会话" name="session">
          <div class="explore-pane explore-session-pane">
            <div class="card-head card-head-tight">
              <div>
                <h3>交互式终端会话</h3>
              </div>
              <el-tag :type="currentSession ? statusType(currentSession.status) : 'info'" effect="dark" round>
                {{ currentSession?.status || "未选择会话" }}
              </el-tag>
            </div>

            <div class="detail-grid explore-session-form">
              <label class="field-block field-block-tight">
                <span>终端 / CLI</span>
                <el-select :model-value="terminalProfile" placeholder="请选择启动方式" filterable
                  @update:model-value="emit('update:terminalProfile', $event)">
                  <el-option-group v-for="group in terminalProfileOptionGroups" :key="group.key" :label="group.label">
                    <el-option v-for="profile in group.items" :key="profile.name"
                      :label="`${getTerminalProfileOptionLabel(profile)}${profile.isAvailable === false ? '（不可用）' : ''}`"
                      :value="profile.name" :disabled="profile.isAvailable === false" />
                  </el-option-group>
                </el-select>
                <small v-if="selectedTerminalProfileDescription" class="muted">
                  {{ selectedTerminalProfileDescription }}
                </small>
                <small v-if="selectedTerminalProfileUnavailableReason" class="muted">
                  {{ selectedTerminalProfileUnavailableReason }}
                </small>
              </label>

              <label class="field-block field-block-tight">
                <span>工作目录</span>
                <el-autocomplete :model-value="terminalCwd" :fetch-suggestions="queryCommonWorkingDirectories"
                  :trigger-on-focus="Boolean(activeAgent?.commonWorkingDirectories?.length)" clearable
                  placeholder="可选常用目录，也可直接输入；留空则使用默认目录" @update:model-value="emit('update:terminalCwd', $event)"
                  @select="emit('update:terminalCwd', $event?.value || '')" />
              </label>
            </div>

            <div class="hero-actions explore-actions">
              <el-button type="primary" round :disabled="!canCreateTerminalSession"
                @click="emit('create-terminal-session')">
                {{ creatingTerminalSession ? "创建中..." : "创建终端会话" }}
              </el-button>
            </div>

            <div class="card-head card-head-tight compact-stack">
              <div>
                <h3>会话列表</h3>
                <p v-if="terminalSessions.length == 0">当前设备还没有终端会话</p>
              </div>
              <el-tag effect="plain" round>
                {{ terminalSessions.length }} 个
              </el-tag>
            </div>

            <div v-if="terminalSessions.length" class="session-list explore-session-list">
              <div v-for="session in terminalSessions" :key="session.sessionId" class="session-item"
                :class="{ active: session.sessionId === currentSession?.sessionId }">
                <button class="session-item-main" type="button" @click="openSessionDetail(session.sessionId)">
                  <span class="stack-text">
                    <strong>{{ session.profileLabel || session.profile }}</strong>
                    <small>{{ session.createdAt }}</small>
                  </span>
                </button>
                <div class="session-item-actions">
                  <el-tag :type="statusType(session.status)" effect="dark" round>
                    {{ session.status }}
                  </el-tag>
                  <el-button v-if="isTerminalSessionClosed(session.status)" round plain size="small"
                    :disabled="!canDeleteSession(session)" @click="emit('delete-terminal-session', session.sessionId)">
                    {{
                      deletingTerminalSessionId === session.sessionId
                        ? "删除中..."
                        : "删除"
                    }}
                  </el-button>
                </div>
              </div>
            </div>
            <p v-else class="muted compact-stack">先创建会话，再在这里选择和切换终端实例。</p>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card v-else-if="sessionScreen === 'detail'" class="surface-card info-card explore-session-detail-card"
      shadow="never">
      <div class="explore-session-screen">
        <div class="profile-screen-top explore-session-detail-top">
          <el-button class="back-button" round plain @click="goBackToSessionList">
            返回会话
          </el-button>
          <div class="explore-session-top-actions">
            <el-tag :type="currentSession ? statusType(currentSession.status) : 'info'" effect="dark" round>
              {{ currentSession?.status || "未选择会话" }}
            </el-tag>
            <el-button v-if="currentSession" round type="danger" plain :disabled="!canTerminateCurrentSession"
              @click="emit('terminate-terminal-session', currentSession.sessionId)">
              {{
                terminatingTerminalSessionId === currentSession.sessionId
                  ? "终止中..."
                  : "结束会话"
              }}
            </el-button>
          </div>
        </div>

        <el-collapse v-if="currentSession" v-model="sessionMetaPanels" class="explore-session-meta">
          <el-collapse-item name="meta" title="会话信息">
            <div class="detail-grid">
              <div class="detail-row">
                <span>Profile</span>
                <strong>{{ currentSession.profileLabel || currentSession.profile }}</strong>
              </div>
              <div class="detail-row">
                <span>工作目录</span>
                <strong>{{ currentSession.cwd || "-" }}</strong>
              </div>
              <div class="detail-row">
                <span>退出码</span>
                <strong>{{ currentSession.exitCode ?? "-" }}</strong>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>

        <div v-if="currentSession" class="explore-terminal-shell">
          <div v-if="shouldPreferFinalAnswer" class="console-block final-answer-block"
            :class="{ empty: !hasFinalAnswer }">
            <h4>Final Answer</h4>
            <pre v-if="hasFinalAnswer">{{ currentSession.finalText }}</pre>
            <p v-else class="muted">
              当前会话将优先展示最终结果。结果尚未提取出来前，可展开下方原始终端查看实时输出。
            </p>
          </div>

          <label v-if="currentSession && !isTerminalSessionClosed(currentSession.status)"
            class="field-block field-block-tight explore-session-input">
            <span>{{ shouldPreferFinalAnswer ? "继续提问" : "发送输入" }}</span>
            <div v-if="presetCommands.length" class="field-block field-block-tight explore-session-preset-field">
              <span>预设输入</span>
              <el-select :model-value="selectedSessionPresetCommandKey" clearable
                placeholder="选择当前设备 localapp/.env 中的预设输入" @update:model-value="handleSessionPresetCommandChange">
                <el-option v-for="preset in presetCommands" :key="`session-${preset.key}`" :label="preset.label"
                  :value="preset.key" />
              </el-select>
              <p v-if="selectedSessionPresetCommand" class="muted explore-preset-command-preview">
                {{ selectedSessionPresetCommand.command }}
              </p>
            </div>
            <div class="explore-session-input-row">
              <el-input :model-value="terminalInput" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }"
                :placeholder="shouldPreferFinalAnswer
                  ? '输入你的追加要求，发送到当前模型会话'
                  : '向当前终端会话发送输入'
                  " @update:model-value="emit('update:terminalInput', $event)" />
            </div>
            <div class="hero-actions explore-session-input-actions">
              <el-button
                v-if="presetCommands.length"
                class="explore-session-action explore-session-action-preset"
                round
                plain
                :disabled="!canSendSessionPresetInput"
                @click="sendSelectedSessionPresetInput">
                {{ sendingTerminalInput ? "发送中..." : "发送预设输入" }}
              </el-button>
              <el-button
                class="explore-session-action explore-session-action-send"
                type="primary"
                round
                :disabled="!canSendTerminalInput"
                @click="emit('send-terminal-input', currentSession.sessionId)">
                {{ sendingTerminalInput ? "发送中..." : "发送" }}
              </el-button>
              <el-button
                class="explore-session-action explore-session-action-stop"
                round
                plain
                type="warning"
                :disabled="!canInterruptCurrentSession"
                @click="emit('interrupt-terminal-session', currentSession.sessionId)">
                停止任务
              </el-button>
            </div>
          </label>

          <el-collapse v-model="rawTerminalPanels" class="explore-raw-terminal">
            <el-collapse-item name="raw" :title="shouldPreferFinalAnswer ? '原始终端输出（调试）' : '终端输出'">
              <TerminalEmulator class="explore-terminal" :session-id="currentSession.sessionId"
                :outputs="currentSession.outputs || []" :interactive="!isTerminalSessionClosed(currentSession.status)"
                @terminal-data="
                  emit('send-terminal-raw-input', {
                    input: $event,
                    sessionId: currentSession.sessionId
                  })
                  " @terminal-resize="emit('resize-terminal-session', $event)" />
            </el-collapse-item>
          </el-collapse>

          <div v-if="currentSession" class="console-block explore-file-launcher">
            <h4>打开目标文件</h4>
            <label class="field-block field-block-tight">
              <el-input :model-value="remoteFilePath" placeholder="例如：C:\\project\\remote-client\\CLAUDE.md"
                @update:model-value="emit('update:remoteFilePath', $event)" @keyup.enter="openRemoteFileViewer" />
            </label>
            <div class="hero-actions explore-file-launcher-actions">
              <el-button type="primary" round :disabled="!canOpenRemoteFile" @click="openRemoteFileViewer">
                {{ readingRemoteFile ? "打开中..." : "打开文件" }}
              </el-button>
            </div>
          </div>

          <div v-if="remoteFileError" class="console-block error explore-file-open-error">
            <h4>File Error</h4>
            <pre>{{ remoteFileError }}</pre>
          </div>
        </div>
        <p v-else class="muted">当前会话不可用，请返回会话列表重新选择。</p>

        <div v-if="currentSession?.error" class="console-block error">
          <h4>Session Error</h4>
          <pre>{{ currentSession.error }}</pre>
        </div>
      </div>
    </el-card>

    <el-card class="surface-card info-card explore-device-card" shadow="never">
      <el-collapse v-model="devicePanels" class="explore-device-collapse">
        <el-collapse-item name="device">
          <template #title>
            <div class="explore-device-summary">
              <span class="explore-device-caption">目标设备</span>
              <strong class="explore-device-name">{{ activeDeviceLabel }}</strong>
              <span class="explore-device-divider">·</span>
              <span class="explore-device-binding" :class="activeAuthCodeBinding ? 'bound' : 'missing'">
                {{ activeDeviceBindText }}
              </span>
            </div>
          </template>

          <label class="field-block field-block-tight explore-device-field">
            <span>设备列表</span>
            <el-select :model-value="selectedAgentId" placeholder="请选择设备"
              @update:model-value="emit('update:selectedAgentId', $event)">
              <el-option v-for="agent in agents" :key="agent.agentId" :label="`${agent.label} / ${agent.agentId}`"
                :value="agent.agentId" />
            </el-select>
          </label>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <RemoteFilePreviewDialog
      v-model="remoteFileDialogVisible"
      :viewer="currentRemoteFileViewer"
    />
  </section>
</template>
