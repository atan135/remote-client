<script setup>
import {
  Aim,
  ArrowRight,
  Monitor,
  Refresh,
  Tickets
} from "@element-plus/icons-vue";
import { ElAlert, ElButton, ElCard, ElDialog, ElIcon, ElTag } from "element-plus";
import { computed, ref } from "vue";
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
  commands: {
    type: Array,
    required: true
  },
  onlineAgentCount: {
    type: Number,
    required: true
  },
  displayName: {
    type: String,
    required: true
  },
  wsConnected: {
    type: Boolean,
    required: true
  },
  loadingAgents: {
    type: Boolean,
    default: false
  },
  agentsError: {
    type: String,
    default: ""
  },
  diagnosticsLoader: {
    type: Function,
    default: null
  }
});

const emit = defineEmits(["select-agent", "go-terminal"]);

const diagnosticsVisible = ref(false);
const diagnosticsLoading = ref(false);
const diagnosticsError = ref("");
const diagnostics = ref(null);
const diagnosingAgentId = ref("");

const latestCommand = computed(() => props.commands[0] || null);

const currentAgentLabel = computed(() => props.activeAgent?.label || props.activeAgent?.agentId || "未选择设备");

const connectionText = computed(() => (props.wsConnected ? "实时同步已连接" : "实时链路重连中"));

const metrics = computed(() => [
  {
    key: "online",
    label: "在线设备",
    value: props.onlineAgentCount,
    detail: `总计 ${props.agents.length} 台`,
    icon: Monitor
  },
  {
    key: "commands",
    label: "命令记录",
    value: props.commands.length,
    detail: latestCommand.value ? `最近状态 ${latestCommand.value.status || "-"}` : "暂无命令记录",
    icon: Tickets
  },
  {
    key: "current",
    label: "当前设备",
    value: currentAgentLabel.value,
    detail: props.activeAgent?.agentId || "未选择设备",
    icon: Aim
  }
]);

function statusType(status) {
  if (status === "online" || status === "completed") {
    return "success";
  }

  if (["queued", "running", "dispatched"].includes(status)) {
    return "warning";
  }

  return "danger";
}

function selectAgent(agentId) {
  emit("select-agent", agentId);
}

function handleAgentItemKeydown(event, agentId) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  selectAgent(agentId);
}

async function openDiagnostics(agent) {
  const agentId = String(agent?.agentId || "").trim();

  if (!agentId) {
    return;
  }

  diagnosticsVisible.value = true;
  diagnosingAgentId.value = agentId;
  diagnosticsLoading.value = true;
  diagnosticsError.value = "";
  diagnostics.value = null;

  try {
    if (typeof props.diagnosticsLoader !== "function") {
      throw new Error("诊断接口未配置");
    }

    diagnostics.value = await props.diagnosticsLoader(agentId);
  } catch (error) {
    diagnosticsError.value = error.message || "加载设备诊断失败";
  } finally {
    diagnosticsLoading.value = false;
  }
}

function formatValue(value) {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  return normalized || "-";
}

function formatBoolean(value) {
  return value ? "是" : "否";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function diagnosisStatusType(value) {
  const normalized = String(value || "").toLowerCase();

  if (["online", "approved", "open", "enabled", "yes", "true"].includes(normalized)) {
    return "success";
  }

  if (["pending", "unknown"].includes(normalized)) {
    return "warning";
  }

  return "danger";
}
</script>

<template>
  <section class="page home-page">
    <el-card class="surface-card hero-card home-hero-card" shadow="never">
      <div class="home-hero-main">
        <div class="home-status-badge" :class="{ online: wsConnected }">
          <span class="console-status-dot" :class="{ online: wsConnected }"></span>
          <span>{{ connectionText }}</span>
        </div>
        <h2>{{ displayName || "控制台" }}</h2>
        <p class="hero-copy">
          {{ activeAgent ? `当前设备 ${currentAgentLabel}` : "选择在线设备后即可下发安全命令。" }}
        </p>
      </div>

      <div class="home-hero-actions">
        <el-button type="primary" @click="emit('go-terminal')">
          发送命令
          <el-icon class="el-icon--right"><ArrowRight /></el-icon>
        </el-button>
        <el-button plain @click="emit('go-terminal')">
          {{ activeAgent?.label || "选择设备" }}
        </el-button>
      </div>
    </el-card>

    <section class="metrics-grid">
      <el-card v-for="metric in metrics" :key="metric.key" class="surface-card metric-card" shadow="never">
        <div class="metric-card-top">
          <span>{{ metric.label }}</span>
          <span class="metric-icon">
            <component :is="metric.icon" />
          </span>
        </div>
        <strong>{{ metric.value }}</strong>
        <small>{{ metric.detail }}</small>
      </el-card>
    </section>

    <el-card class="surface-card home-device-panel" shadow="never">
      <section class="home-device-list">
        <div class="card-head">
          <div>
            <h3>可用设备</h3>
          </div>
          <el-tag round effect="plain">{{ agents.length }}</el-tag>
        </div>

        <div v-if="loadingAgents && !agents.length" class="home-empty-state-wrap">
          <EmptyState
            variant="loading"
            title="正在加载设备"
            description="正在同步在线设备列表。"
          />
        </div>
        <div v-else-if="agentsError && !agents.length" class="home-empty-state-wrap">
          <EmptyState
            variant="error"
            title="设备列表加载失败"
            :description="agentsError"
          />
        </div>
        <div v-else-if="agents.length" class="list-grid">
          <div
            v-for="agent in agents"
            :key="agent.agentId"
            class="settings-item home-agent-item"
            :class="{ active: selectedAgentId === agent.agentId }"
            role="button"
            tabindex="0"
            @click="selectAgent(agent.agentId)"
            @keydown="handleAgentItemKeydown($event, agent.agentId)"
          >
            <span class="stack-text">
              <strong>{{ agent.label }}</strong>
              <small>{{ agent.hostname || agent.agentId }}</small>
            </span>
            <span class="home-agent-actions" @click.stop @keydown.stop>
              <el-button
                size="small"
                round
                plain
                :loading="diagnosticsLoading && diagnosingAgentId === agent.agentId"
                @click="openDiagnostics(agent)"
              >
                诊断
              </el-button>
              <el-tag :type="statusType(agent.status)" effect="dark" round>{{ agent.status }}</el-tag>
            </span>
          </div>
        </div>
        <div v-else class="home-empty-state-wrap">
          <EmptyState title="暂无在线设备" description="启动 localapp agent 后，设备会显示在这里。">
            <el-button plain @click="emit('go-terminal')">查看终端配置</el-button>
          </EmptyState>
        </div>
      </section>

      <section class="home-device-detail">
        <div class="card-head">
          <div>
            <h3>设备详情</h3>
          </div>
          <el-tag v-if="activeAgent" :type="statusType(activeAgent.status)" round effect="plain">
            {{ activeAgent.status }}
          </el-tag>
        </div>

        <div v-if="activeAgent" class="detail-grid">
          <div class="detail-row">
            <span>设备 ID</span>
            <strong>{{ activeAgent.agentId }}</strong>
          </div>
          <div class="detail-row">
            <span>主机名</span>
            <strong>{{ activeAgent.hostname || "-" }}</strong>
          </div>
          <div class="detail-row">
            <span>平台 / 架构</span>
            <strong>{{ activeAgent.platform }} / {{ activeAgent.arch }}</strong>
          </div>
        </div>
        <div v-if="activeAgent?.commonWorkingDirectories?.length" class="console-block compact-stack">
          <h4>Common Working Directories</h4>
          <pre>{{ activeAgent.commonWorkingDirectories.join("\n") }}</pre>
        </div>
        <EmptyState v-else-if="!activeAgent" compact title="未选择设备" description="从左侧设备列表中选择一台在线设备。" />
      </section>
    </el-card>

    <el-dialog
      v-model="diagnosticsVisible"
      class="agent-diagnostic-dialog"
      title="设备链路诊断"
      width="760px"
      destroy-on-close
    >
      <div v-if="diagnosticsLoading" class="agent-diagnostic-loading">
        <EmptyState variant="loading" title="正在诊断设备" description="正在读取服务端记录、审核状态和绑定信息。" />
      </div>

      <EmptyState
        v-else-if="diagnosticsError"
        variant="error"
        title="诊断加载失败"
        :description="diagnosticsError"
      />

      <div v-else-if="diagnostics" class="agent-diagnostic-body">
        <div class="agent-diagnostic-head">
          <div>
            <strong>{{ diagnostics.registryAgent?.label || diagnostics.agentId }}</strong>
            <small>{{ diagnostics.agentId }}</small>
          </div>
          <div class="tag-row">
            <el-tag :type="diagnosisStatusType(diagnostics.websocket?.status)" effect="dark" round>
              {{ diagnostics.websocket?.status || "unknown" }}
            </el-tag>
            <el-tag :type="diagnostics.websocket?.socketOpen ? 'success' : 'danger'" effect="plain" round>
              Socket {{ diagnostics.websocket?.socketOpen ? "Open" : "Closed" }}
            </el-tag>
          </div>
        </div>

        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="诊断只反映 server 当前可见状态；localapp 进程未启动、网络拦截或机器断电仍需要结合 localapp 日志确认。"
        />

        <section class="agent-diagnostic-section">
          <h4>实时链路</h4>
          <div class="detail-grid">
            <div class="detail-row">
              <span>浏览器到 server</span>
              <strong>{{ wsConnected ? "已连接" : "未连接" }}</strong>
            </div>
            <div class="detail-row">
              <span>server 到 localapp</span>
              <strong>{{ diagnostics.websocket?.socketOpen ? "已连接" : "未连接" }}</strong>
            </div>
            <div class="detail-row">
              <span>首次连接时间</span>
              <strong>{{ formatDateTime(diagnostics.websocket?.connectedAt) }}</strong>
            </div>
            <div class="detail-row">
              <span>最近连接时间</span>
              <strong>{{ formatDateTime(diagnostics.websocket?.lastConnectedAt) }}</strong>
            </div>
            <div class="detail-row">
              <span>最近心跳 / 活动</span>
              <strong>{{ formatDateTime(diagnostics.websocket?.lastSeenAt) }}</strong>
            </div>
            <div class="detail-row">
              <span>最近断开时间</span>
              <strong>{{ formatDateTime(diagnostics.websocket?.lastDisconnectAt) }}</strong>
            </div>
            <div class="detail-row">
              <span>最近断开 code</span>
              <strong>{{ formatValue(diagnostics.websocket?.lastCloseCode) }}</strong>
            </div>
            <div class="detail-row">
              <span>最近断开原因</span>
              <strong>{{ formatValue(diagnostics.websocket?.lastCloseReason) }}</strong>
            </div>
          </div>
        </section>

        <section class="agent-diagnostic-section">
          <h4>设备准入</h4>
          <div class="detail-grid">
            <div class="detail-row">
              <span>审核记录</span>
              <strong>{{ diagnostics.managedAgent ? "存在" : "不存在" }}</strong>
            </div>
            <div class="detail-row">
              <span>审核状态</span>
              <strong>{{ formatValue(diagnostics.managedAgent?.approvalStatus) }}</strong>
            </div>
            <div class="detail-row">
              <span>是否启用</span>
              <strong>{{ diagnostics.managedAgent ? formatBoolean(diagnostics.managedAgent.isEnabled) : "-" }}</strong>
            </div>
            <div class="detail-row">
              <span>设备指纹</span>
              <strong>{{ formatValue(diagnostics.managedAgent?.authPublicKeyFingerprint || diagnostics.registryAgent?.authPublicKeyFingerprint) }}</strong>
            </div>
            <div class="detail-row">
              <span>审核侧最近出现</span>
              <strong>{{ formatDateTime(diagnostics.managedAgent?.lastSeenAt) }}</strong>
            </div>
            <div class="detail-row">
              <span>审核备注</span>
              <strong>{{ formatValue(diagnostics.managedAgent?.reviewComment) }}</strong>
            </div>
          </div>
        </section>

        <section class="agent-diagnostic-section">
          <h4>授权绑定</h4>
          <div class="detail-grid">
            <div class="detail-row">
              <span>auth_code 是否存在</span>
              <strong>{{ formatBoolean(diagnostics.authCode?.exists) }}</strong>
            </div>
            <div class="detail-row">
              <span>当前用户是否绑定</span>
              <strong>{{ formatBoolean(diagnostics.authCode?.currentUserHasBinding) }}</strong>
            </div>
            <div class="detail-row">
              <span>绑定归属</span>
              <strong>
                {{
                  diagnostics.authCode?.ownerVisible
                    ? (diagnostics.authCode.ownerDisplayName || diagnostics.authCode.ownerUsername || "-")
                    : diagnostics.authCode?.exists
                      ? "其他用户"
                      : "-"
                }}
              </strong>
            </div>
            <div class="detail-row">
              <span>绑定指纹</span>
              <strong>{{ formatValue(diagnostics.authCode?.fingerprint) }}</strong>
            </div>
          </div>
        </section>

        <section class="agent-diagnostic-section">
          <h4>运行中任务</h4>
          <div class="detail-grid">
            <div class="detail-row">
              <span>待确认命令</span>
              <strong>{{ diagnostics.runtime?.activeCommandCount ?? 0 }}</strong>
            </div>
            <div class="detail-row">
              <span>活动终端会话</span>
              <strong>{{ diagnostics.runtime?.activeTerminalSessionCount ?? 0 }}</strong>
            </div>
            <div class="detail-row">
              <span>终端 profile 数</span>
              <strong>{{ diagnostics.registryAgent?.terminalProfileCount ?? 0 }}</strong>
            </div>
          </div>
        </section>

        <section class="agent-diagnostic-section">
          <h4>判断建议</h4>
          <ul class="agent-diagnostic-hints">
            <li v-for="hint in diagnostics.hints || []" :key="hint">{{ hint }}</li>
          </ul>
        </section>

        <section class="agent-diagnostic-section">
          <h4>建议检索日志</h4>
          <pre class="console-block agent-diagnostic-command">rg "{{ diagnostics.agentId }}|agent\\.websocket|agent\\.registered|agent\\.disconnect|agent\\.access|reconnect|websocket_error" localapp/logs/agent.log webserver/server/logs/server.log</pre>
        </section>
      </div>

      <template #footer>
        <el-button @click="diagnosticsVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :icon="Refresh"
          :loading="diagnosticsLoading"
          :disabled="!diagnosingAgentId"
          @click="openDiagnostics({ agentId: diagnosingAgentId })"
        >
          刷新诊断
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>
