<script setup>
import {
  Aim,
  ArrowRight,
  Monitor,
  Tickets
} from "@element-plus/icons-vue";
import { ElButton, ElCard, ElIcon, ElTag } from "element-plus";
import { computed } from "vue";
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
  }
});

const emit = defineEmits(["select-agent", "go-terminal"]);

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
          <button v-for="agent in agents" :key="agent.agentId" class="settings-item"
            :class="{ active: selectedAgentId === agent.agentId }" type="button"
            @click="emit('select-agent', agent.agentId)">
            <span class="stack-text">
              <strong>{{ agent.label }}</strong>
              <small>{{ agent.hostname || agent.agentId }}</small>
            </span>
            <el-tag :type="statusType(agent.status)" effect="dark" round>{{ agent.status }}</el-tag>
          </button>
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
  </section>
</template>
