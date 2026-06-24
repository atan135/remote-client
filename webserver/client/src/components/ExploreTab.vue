<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  ElAutocomplete,
  ElButton,
  ElCard,
  ElIcon,
  ElInput,
  ElOption,
  ElOptionGroup,
  ElPopover,
  ElSelect,
  ElTabPane,
  ElTabs,
  ElTag
} from "element-plus";
import {
  Back,
  Document,
  EditPen,
  FolderOpened,
  InfoFilled,
  SwitchButton,
  VideoPause
} from "@element-plus/icons-vue";
import RemoteFilePreviewDialog from "./RemoteFilePreviewDialog.vue";
import TerminalEmulator from "./TerminalEmulator.vue";
import EmptyState from "./EmptyState.vue";

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
  terminalSessionName: {
    type: String,
    default: ""
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
  remoteFileBaseCwd: {
    type: String,
    default: ""
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
  renamingTerminalSessionId: {
    type: String,
    default: ""
  },
  deletingTerminalSessionId: {
    type: String,
    default: ""
  },
  loadingTerminalSessions: {
    type: Boolean,
    default: false
  },
  terminalSessionsError: {
    type: String,
    default: ""
  }
});

const emit = defineEmits([
  "update:selectedAgentId",
  "update:commandInput",
  "update:commandShell",
  "update:terminalProfile",
  "update:terminalSessionName",
  "update:terminalCwd",
  "update:terminalInput",
  "update:remoteFilePath",
  "update:remoteFileBaseCwd",
  "select:terminalSession",
  "opened-terminal-session",
  "submitCommand",
  "create-terminal-session",
  "send-terminal-input",
  "interrupt-terminal-session",
  "send-terminal-raw-input",
  "open-remote-file",
  "resize-terminal-session",
  "rename-terminal-session",
  "terminate-terminal-session",
  "delete-terminal-session"
]);

const TERMINAL_SESSION_NAME_MAX_LENGTH = 128;

const activeMode = ref("command");
const sessionScreen = ref("main");
const detailSessionId = ref("");
const remoteFileDialogVisible = ref(false);
const sessionInputPopoverVisible = ref(false);
const remoteFilePopoverVisible = ref(false);
const renameSessionPopoverVisible = ref(false);
const renameSessionInput = ref("");
const renameSessionError = ref("");
const savingSessionName = ref(false);
const terminalEmulatorRef = ref(null);

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

const activeDeviceOnline = computed(() => String(props.activeAgent?.status || "") === "online");

const activeDeviceStatusText = computed(() => {
  if (!props.selectedAgentId) {
    return "未选择";
  }

  if (!props.activeAgent) {
    return "未上报";
  }

  return activeDeviceOnline.value ? "在线" : String(props.activeAgent.status || "离线");
});

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
const currentSessionDisplayName = computed(() => getTerminalSessionDisplayName(currentSession.value));
const currentSessionRawName = computed(() => normalizeTerminalSessionName(currentSession.value?.sessionName));
const currentSessionProfileText = computed(
  () => currentSession.value?.profileLabel || currentSession.value?.profile || "-"
);
const currentSessionCwdText = computed(() => currentSession.value?.cwd || "-");
const currentSessionExitCodeText = computed(() => currentSession.value?.exitCode ?? "-");
const isRenamingCurrentSession = computed(
  () => Boolean(currentSession.value?.sessionId && props.renamingTerminalSessionId === currentSession.value.sessionId)
);
const canSaveSessionName = computed(() =>
  Boolean(
      currentSession.value &&
      !savingSessionName.value &&
      !isRenamingCurrentSession.value &&
      normalizeTerminalSessionName(renameSessionInput.value) !== currentSessionRawName.value
  )
);
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

function normalizeTerminalSessionName(value) {
  return String(value ?? "").trim().slice(0, TERMINAL_SESSION_NAME_MAX_LENGTH);
}

function getTerminalSessionDisplayName(session) {
  const sessionName = normalizeTerminalSessionName(session?.sessionName);

  if (sessionName) {
    return sessionName;
  }

  return String(session?.profileLabel || session?.profile || "-").trim() || "-";
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
  sessionInputPopoverVisible.value = false;
  remoteFilePopoverVisible.value = false;
  renameSessionPopoverVisible.value = false;
  renameSessionError.value = "";
  activeMode.value = "session";
  sessionScreen.value = "detail";
  emit("select:terminalSession", sessionId);
  fitVisibleTerminal();
}

function goBackToSessionList() {
  sessionInputPopoverVisible.value = false;
  remoteFilePopoverVisible.value = false;
  renameSessionPopoverVisible.value = false;
  renameSessionError.value = "";
  activeMode.value = "session";
  sessionScreen.value = "main";
}

async function fitVisibleTerminal() {
  await nextTick();
  terminalEmulatorRef.value?.fit?.();
}

function openRemoteFileViewer() {
  if (!currentSession.value) {
    return;
  }

  emit("open-remote-file", {
    sessionId: currentSession.value.sessionId,
    filePath: props.remoteFilePath,
    baseCwd: props.remoteFileBaseCwd
  });
}

function openRenameSessionPopover() {
  renameSessionInput.value = currentSessionRawName.value;
  renameSessionError.value = "";
}

function saveSessionName() {
  if (!currentSession.value || savingSessionName.value || isRenamingCurrentSession.value) {
    return;
  }

  const sessionName = normalizeTerminalSessionName(renameSessionInput.value);

  if (sessionName === currentSessionRawName.value) {
    renameSessionPopoverVisible.value = false;
    renameSessionError.value = "";
    return;
  }

  renameSessionInput.value = sessionName;
  renameSessionError.value = "";
  savingSessionName.value = true;

  emit("rename-terminal-session", {
    sessionId: currentSession.value.sessionId,
    sessionName,
    onDone: (ok, message) => {
      savingSessionName.value = false;

      if (!ok) {
        renameSessionError.value = message || "会话名称保存失败，请稍后重试。";
        return;
      }

      renameSessionPopoverVisible.value = false;
    }
  });
}

function resetSessionNameEditor() {
  savingSessionName.value = false;
  renameSessionInput.value = currentSessionRawName.value;
  renameSessionError.value = "";
}

watch(
  () => props.selectedAgentId,
  () => {
    selectedPresetCommandKey.value = "";
    selectedSessionPresetCommandKey.value = "";
    sessionInputPopoverVisible.value = false;
    remoteFilePopoverVisible.value = false;
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

watch(
  () => currentSession.value?.sessionId || "",
  (sessionId) => {
    if (sessionId) {
      fitVisibleTerminal();
      return;
    }

    if (sessionScreen.value === "detail") {
      sessionScreen.value = "main";
    }

    detailSessionId.value = "";
    selectedSessionPresetCommandKey.value = "";
  }
);

watch(
  () => currentRemoteFileViewer.value?.openedAt || "",
  (openedAt) => {
    remoteFileDialogVisible.value = Boolean(openedAt);
  }
);

watch(
  [
    () => sessionInputPopoverVisible.value,
    () => remoteFilePopoverVisible.value,
    () => shouldPreferFinalAnswer.value,
    () => hasFinalAnswer.value
  ],
  () => {
    fitVisibleTerminal();
  }
);
</script>

<template>
  <section class="page explore-page" :class="{ 'is-focus-mode': sessionScreen !== 'main' }">
    <el-card v-if="sessionScreen === 'main'" class="surface-card explore-target-card" shadow="never">
      <div class="explore-target-identity">
        <span class="explore-target-dot" :class="{ online: activeDeviceOnline }"></span>
        <div class="explore-target-copy">
          <span>目标设备</span>
          <strong>{{ activeDeviceLabel }}</strong>
        </div>
        <div class="explore-target-tags">
          <el-tag :type="activeDeviceOnline ? 'success' : 'info'" effect="plain" round>
            {{ activeDeviceStatusText }}
          </el-tag>
          <el-tag :type="activeAuthCodeBinding ? 'success' : 'danger'" effect="plain" round>
            {{ activeDeviceBindText }}
          </el-tag>
        </div>
      </div>

      <label class="field-block field-block-tight explore-target-select-field">
        <span>切换设备</span>
        <el-select
          class="explore-target-select"
          :model-value="selectedAgentId"
          placeholder="请选择设备"
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
    </el-card>

    <el-card v-if="sessionScreen === 'main'" class="surface-card info-card explore-main-card" shadow="never">
      <el-tabs v-model="activeMode" stretch class="explore-mode-tabs">
        <el-tab-pane label="一次性命令" name="command">
          <div class="explore-pane explore-command-pane">
            <div class="explore-section-head">
              <h3>命令参数</h3>
              <el-tag effect="plain" round>安全封装</el-tag>
            </div>

            <div class="explore-command-grid">
              <label v-if="presetCommands.length" class="field-block field-block-tight">
                <span>预设命令</span>
                <el-select :model-value="selectedPresetCommandKey" clearable placeholder="选择当前设备 localapp/.env 中的预设命令"
                  @update:model-value="handlePresetCommandChange">
                  <el-option v-for="preset in presetCommands" :key="preset.key" :label="preset.label"
                    :value="preset.key" />
                </el-select>
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

              <p v-if="selectedPresetCommand" class="muted explore-preset-command-preview explore-command-grid-preview">
                {{ selectedPresetCommand.command }}
              </p>

              <label class="field-block field-block-tight explore-command-input-field">
                <span>命令内容</span>
                <el-input :model-value="commandInput" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }"
                  placeholder="例如：ipconfig /all 或 hostname" @update:model-value="emit('update:commandInput', $event)" />
              </label>
            </div>

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
            <div class="explore-section-head">
              <h3>会话参数</h3>
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
                <span>会话名称</span>
                <el-input
                  :model-value="terminalSessionName"
                  clearable
                  maxlength="128"
                  show-word-limit
                  placeholder="可选，例如：生产排障 / Codex 修复"
                  @update:model-value="emit('update:terminalSessionName', $event)"
                />
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
                    <strong>{{ getTerminalSessionDisplayName(session) }}</strong>
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
            <EmptyState
              v-else-if="loadingTerminalSessions"
              compact
              variant="loading"
              class="compact-stack"
              title="正在加载终端会话"
              description="正在同步会话列表。"
            />
            <EmptyState
              v-else-if="terminalSessionsError"
              compact
              variant="error"
              class="compact-stack"
              title="终端会话加载失败"
              :description="terminalSessionsError"
            />
            <EmptyState
              v-else
              compact
              class="compact-stack"
              title="暂无终端会话"
              description="先创建会话，再在这里选择和切换终端实例。"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card v-else-if="sessionScreen === 'detail'" class="surface-card info-card explore-session-detail-card"
      shadow="never">
      <div class="explore-session-screen">
        <div class="profile-screen-top explore-session-detail-top">
          <el-button class="back-button explore-session-icon-button" round plain title="返回会话" @click="goBackToSessionList">
            <el-icon><Back /></el-icon>
            <span>返回</span>
          </el-button>
          <div v-if="currentSession" class="explore-session-title-block">
            <strong>{{ currentSessionDisplayName }}</strong>
            <small>{{ currentSessionProfileText }}</small>
          </div>
          <div class="explore-session-top-actions">
            <el-tag :type="currentSession ? statusType(currentSession.status) : 'info'" effect="dark" round>
              {{ currentSession?.status || "未选择会话" }}
            </el-tag>
            <template v-if="currentSession">
              <el-popover
                v-model:visible="sessionInputPopoverVisible"
                placement="bottom-end"
                trigger="click"
                width="min(560px, calc(100vw - 32px))"
                popper-class="terminal-tool-popover"
                @hide="fitVisibleTerminal"
              >
                <template #reference>
                  <el-button
                    v-if="!isTerminalSessionClosed(currentSession.status)"
                    class="explore-session-icon-button"
                    round
                    plain
                    title="发送输入"
                  >
                    <el-icon><EditPen /></el-icon>
                    <span>{{ shouldPreferFinalAnswer ? "提问" : "输入" }}</span>
                  </el-button>
                </template>
                <div class="terminal-tool-panel">
                  <div class="terminal-tool-head">
                    <strong>{{ shouldPreferFinalAnswer ? "继续提问" : "发送输入" }}</strong>
                    <small>也可以直接在下方终端中输入。</small>
                  </div>
                  <label v-if="presetCommands.length" class="field-block field-block-tight explore-session-preset-field">
                    <span>预设输入</span>
                    <el-select :model-value="selectedSessionPresetCommandKey" clearable
                      placeholder="选择当前设备 localapp/.env 中的预设输入" @update:model-value="handleSessionPresetCommandChange">
                      <el-option v-for="preset in presetCommands" :key="`session-${preset.key}`" :label="preset.label"
                        :value="preset.key" />
                    </el-select>
                    <p v-if="selectedSessionPresetCommand" class="muted explore-preset-command-preview">
                      {{ selectedSessionPresetCommand.command }}
                    </p>
                  </label>
                  <label class="field-block field-block-tight explore-session-input">
                    <span>文本输入</span>
                    <el-input :model-value="terminalInput" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }"
                      :placeholder="shouldPreferFinalAnswer
                        ? '输入你的追加要求，发送到当前模型会话'
                        : '向当前终端会话发送输入'
                        " @update:model-value="emit('update:terminalInput', $event)" />
                  </label>
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
                  </div>
                </div>
              </el-popover>

              <el-button
                v-if="!isTerminalSessionClosed(currentSession.status)"
                class="explore-session-icon-button"
                round
                plain
                type="warning"
                title="停止当前任务"
                :disabled="!canInterruptCurrentSession"
                @click="emit('interrupt-terminal-session', currentSession.sessionId)">
                <el-icon><VideoPause /></el-icon>
                <span>停止</span>
              </el-button>

              <el-popover
                v-model:visible="remoteFilePopoverVisible"
                placement="bottom-end"
                trigger="click"
                width="min(500px, calc(100vw - 32px))"
                popper-class="terminal-tool-popover"
                @hide="fitVisibleTerminal"
              >
                <template #reference>
                  <el-button class="explore-session-icon-button" round plain title="打开目标文件">
                    <el-icon><FolderOpened /></el-icon>
                    <span>文件</span>
                  </el-button>
                </template>
                <div class="terminal-tool-panel">
                  <div class="terminal-tool-head">
                    <strong>打开目标文件</strong>
                    <small>读取当前设备上的文本文件；相对路径会按下方基准目录解析。</small>
                  </div>
                  <label class="field-block field-block-tight">
                    <span>基准目录</span>
                    <el-autocomplete
                      :model-value="remoteFileBaseCwd"
                      :fetch-suggestions="queryCommonWorkingDirectories"
                      :trigger-on-focus="Boolean(activeAgent?.commonWorkingDirectories?.length)"
                      clearable
                      placeholder="相对路径必填；绝对路径可留空"
                      @update:model-value="emit('update:remoteFileBaseCwd', $event)"
                      @select="emit('update:remoteFileBaseCwd', $event?.value || '')"
                    />
                  </label>
                  <label class="field-block field-block-tight">
                    <span>文件路径</span>
                    <el-input :model-value="remoteFilePath" placeholder="例如：CLAUDE.md 或 C:\\project\\remote-client\\CLAUDE.md"
                      @update:model-value="emit('update:remoteFilePath', $event)" @keyup.enter="openRemoteFileViewer" />
                  </label>
                  <div class="hero-actions explore-file-launcher-actions">
                    <el-button type="primary" round :disabled="!canOpenRemoteFile" @click="openRemoteFileViewer">
                      {{ readingRemoteFile ? "打开中..." : "打开文件" }}
                    </el-button>
                  </div>
                </div>
              </el-popover>

              <el-popover
                placement="bottom-end"
                trigger="click"
                width="min(480px, calc(100vw - 32px))"
                popper-class="terminal-tool-popover"
                @hide="fitVisibleTerminal"
              >
                <template #reference>
                  <el-button class="explore-session-icon-button" round plain title="会话信息">
                    <el-icon><InfoFilled /></el-icon>
                    <span>详情</span>
                  </el-button>
                </template>
                <div class="terminal-tool-panel">
                  <div class="terminal-tool-head">
                    <strong>会话信息</strong>
                    <small>{{ currentSession.sessionId }}</small>
                  </div>
                  <div class="detail-grid explore-session-meta-grid">
                    <div class="detail-row">
                      <span>会话名称</span>
                      <strong>{{ currentSessionRawName || "未命名" }}</strong>
                    </div>
                    <div class="detail-row">
                      <span>Profile</span>
                      <strong>{{ currentSessionProfileText }}</strong>
                    </div>
                    <div class="detail-row">
                      <span>工作目录</span>
                      <strong>{{ currentSessionCwdText }}</strong>
                    </div>
                    <div class="detail-row">
                      <span>退出码</span>
                      <strong>{{ currentSessionExitCodeText }}</strong>
                    </div>
                  </div>
                </div>
              </el-popover>

              <el-popover
                v-model:visible="renameSessionPopoverVisible"
                placement="bottom-end"
                trigger="click"
                width="min(460px, calc(100vw - 32px))"
                popper-class="terminal-tool-popover"
                @show="openRenameSessionPopover"
                @hide="resetSessionNameEditor"
              >
                <template #reference>
                  <el-button class="explore-session-icon-button" round plain title="重命名会话">
                    <el-icon><EditPen /></el-icon>
                    <span>命名</span>
                  </el-button>
                </template>
                <div class="terminal-tool-panel">
                  <div class="terminal-tool-head">
                    <strong>重命名会话</strong>
                    <small>{{ currentSession.sessionId }}</small>
                  </div>
                  <label class="field-block field-block-tight">
                    <span>会话名称</span>
                    <el-input
                      v-model="renameSessionInput"
                      clearable
                      maxlength="128"
                      show-word-limit
                      placeholder="留空则使用 Profile 名称"
                      @keyup.enter="saveSessionName"
                    />
                    <small v-if="renameSessionError" class="form-error-text">
                      {{ renameSessionError }}
                    </small>
                  </label>
                  <div class="hero-actions explore-session-rename-actions">
                    <el-button
                      round
                      plain
                      :disabled="savingSessionName || isRenamingCurrentSession"
                      @click="resetSessionNameEditor"
                    >
                      还原
                    </el-button>
                    <el-button
                      type="primary"
                      round
                      :disabled="!canSaveSessionName"
                      @click="saveSessionName"
                    >
                      {{ savingSessionName || isRenamingCurrentSession ? "保存中..." : "保存" }}
                    </el-button>
                  </div>
                </div>
              </el-popover>

              <el-button
                class="explore-session-icon-button"
                round
                type="danger"
                plain
                title="结束会话"
                :disabled="!canTerminateCurrentSession"
                @click="emit('terminate-terminal-session', currentSession.sessionId)">
                <el-icon><SwitchButton /></el-icon>
                <span>
                  {{
                    terminatingTerminalSessionId === currentSession.sessionId
                      ? "终止中"
                      : "结束"
                  }}
                </span>
              </el-button>
            </template>
          </div>
        </div>

        <div v-if="currentSession" class="explore-session-summary-strip">
          <span>
            <el-icon><Document /></el-icon>
            {{ currentSessionDisplayName }}
          </span>
          <span>{{ currentSessionProfileText }}</span>
          <span class="explore-session-summary-cwd">{{ currentSessionCwdText }}</span>
          <span>退出码 {{ currentSessionExitCodeText }}</span>
        </div>

        <div v-if="currentSession" class="explore-terminal-shell">
          <div v-if="shouldPreferFinalAnswer" class="console-block final-answer-block"
            :class="{ empty: !hasFinalAnswer }">
            <h4>Final Answer</h4>
            <pre v-if="hasFinalAnswer">{{ currentSession.finalText }}</pre>
            <p v-else class="muted">
              当前会话将优先展示最终结果。结果尚未提取出来前，可展开下方原始终端查看实时输出。
            </p>
          </div>

          <div class="explore-terminal-frame">
            <div v-if="shouldPreferFinalAnswer" class="explore-terminal-frame-head">
              <span>原始终端输出</span>
            </div>
            <TerminalEmulator ref="terminalEmulatorRef" class="explore-terminal" :session-id="currentSession.sessionId"
              :outputs="currentSession.outputs || []" :interactive="!isTerminalSessionClosed(currentSession.status)"
              @terminal-data="
                emit('send-terminal-raw-input', {
                  input: $event,
                  sessionId: currentSession.sessionId
                })
                " @terminal-resize="emit('resize-terminal-session', $event)" />
          </div>

          <div v-if="remoteFileError" class="console-block error explore-file-open-error">
            <h4>File Error</h4>
            <pre>{{ remoteFileError }}</pre>
          </div>
        </div>
        <EmptyState v-else variant="warning" title="会话不可用" description="请返回会话列表重新选择。" />

        <div v-if="currentSession?.error" class="console-block error">
          <h4>Session Error</h4>
          <pre>{{ currentSession.error }}</pre>
        </div>
      </div>
    </el-card>

    <RemoteFilePreviewDialog
      v-model="remoteFileDialogVisible"
      :viewer="currentRemoteFileViewer"
    />
  </section>
</template>
