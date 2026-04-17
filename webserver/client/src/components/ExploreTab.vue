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
  ElSelect,
  ElTabPane,
  ElTabs,
  ElTag
} from "element-plus";
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
  terminatingTerminalSessionId: {
    type: String,
    default: ""
  }
});

const emit = defineEmits([
  "update:selectedAgentId",
  "update:commandInput",
  "update:terminalProfile",
  "update:terminalCwd",
  "update:terminalInput",
  "select:terminalSession",
  "submitCommand",
  "create-terminal-session",
  "send-terminal-input",
  "send-terminal-raw-input",
  "terminate-terminal-session"
]);

const activeMode = ref("command");
const sessionScreen = ref("main");
const detailSessionId = ref("");
const sessionMetaPanels = ref([]);
const devicePanels = ref([]);

const currentSession = computed(
  () =>
    props.terminalSessions.find((item) => item.sessionId === detailSessionId.value) ||
    props.activeTerminalSession ||
    null
);

const activeDeviceLabel = computed(() => props.activeAgent?.agentId || "未选择设备");

const activeDeviceBindText = computed(() =>
  props.activeAuthCodeBinding ? "已绑定公钥" : "缺少公钥"
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

function openSessionDetail(sessionId) {
  detailSessionId.value = sessionId;
  sessionMetaPanels.value = [];
  activeMode.value = "session";
  sessionScreen.value = "detail";
  emit("select:terminalSession", sessionId);
}

function goBackToSessionList() {
  activeMode.value = "session";
  sessionScreen.value = "main";
}

watch(
  () => props.selectedAgentId,
  () => {
    sessionMetaPanels.value = [];
    sessionScreen.value = "main";
    detailSessionId.value = "";
  }
);

watch(currentSession, (session) => {
  if (session) {
    return;
  }

  if (sessionScreen.value === "detail") {
    sessionScreen.value = "main";
  }

  sessionMetaPanels.value = [];
  detailSessionId.value = "";
});
</script>

<template>
  <section class="page explore-page" :class="{ 'is-session-detail': sessionScreen === 'detail' }">
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

            <label class="field-block field-block-tight">
              <span>命令内容</span>
              <el-input :model-value="commandInput" type="textarea" :autosize="{ minRows: 3, maxRows: 5 }"
                placeholder="例如：ipconfig /all 或 hostname" @update:model-value="emit('update:commandInput', $event)" />
            </label>

            <div class="hero-actions explore-actions">
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
                <p class="eyebrow">Interactive Session</p>
                <h3>交互式终端会话</h3>
                <p>创建会话后，点击列表项进入独立终端界面。</p>
              </div>
              <el-tag :type="currentSession ? statusType(currentSession.status) : 'info'" effect="dark" round>
                {{ currentSession?.status || "未选择会话" }}
              </el-tag>
            </div>

            <div class="detail-grid explore-session-form">
              <label class="field-block field-block-tight">
                <span>终端 Profile</span>
                <el-select :model-value="terminalProfile" placeholder="请选择 profile"
                  @update:model-value="emit('update:terminalProfile', $event)">
                  <el-option v-for="profile in availableTerminalProfiles" :key="profile.name"
                    :label="`${profile.name} / ${profile.command || 'shell'}`" :value="profile.name" />
                </el-select>
              </label>

              <label class="field-block field-block-tight">
                <span>工作目录</span>
                <el-autocomplete :model-value="terminalCwd" :fetch-suggestions="queryCommonWorkingDirectories"
                  :trigger-on-focus="Boolean(activeAgent?.commonWorkingDirectories?.length)" clearable
                  placeholder="可选常用目录，也可直接输入；留空则使用默认目录"
                  @update:model-value="emit('update:terminalCwd', $event)"
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
                <p class="eyebrow">Sessions</p>
                <h3>会话列表</h3>
                <p>{{ terminalSessions.length ? "点击任一会话进入输出界面" : "当前设备还没有终端会话" }}</p>
              </div>
              <el-tag effect="plain" round>
                {{ terminalSessions.length }} 个
              </el-tag>
            </div>

            <div v-if="terminalSessions.length" class="session-list explore-session-list">
              <button v-for="session in terminalSessions" :key="session.sessionId" class="session-item"
                :class="{ active: session.sessionId === currentSession?.sessionId }" type="button"
                @click="openSessionDetail(session.sessionId)">
                <span class="stack-text">
                  <strong>{{ session.profile }}</strong>
                  <small>{{ session.createdAt }}</small>
                </span>
                <el-tag :type="statusType(session.status)" effect="dark" round>
                  {{ session.status }}
                </el-tag>
              </button>
            </div>
            <p v-else class="muted compact-stack">先创建会话，再在这里选择和切换终端实例。</p>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-card v-else class="surface-card info-card explore-session-detail-card" shadow="never">
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
                <strong>{{ currentSession.profile }}</strong>
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
          <TerminalEmulator class="explore-terminal" :session-id="currentSession.sessionId"
            :outputs="currentSession.outputs || []" :interactive="!isTerminalSessionClosed(currentSession.status)"
            @terminal-data="emit('send-terminal-raw-input', { input: $event, sessionId: currentSession.sessionId })" />
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
  </section>
</template>
