<script setup>
import { ElButton, ElCard, ElTag } from "element-plus";

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
  }
});

const emit = defineEmits(["select-agent", "go-terminal"]);

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
  <section class="page">
    <el-card class="surface-card hero-card" shadow="never">
      <p class="eyebrow">Control Center</p>
      <h2>{{ displayName || "控制台" }}</h2>
      <p class="hero-copy">
        {{ wsConnected ? "实时链路在线，最新设备与命令记录会自动刷新。" : "实时链路重连中，请稍候查看最新状态。" }}
      </p>

      <div class="hero-actions">
        <el-button type="primary" round @click="emit('go-terminal')">发送命令</el-button>
        <el-button round>{{ activeAgent?.label || "选择设备" }}</el-button>
      </div>
    </el-card>

    <section class="metrics-grid">
      <el-card class="surface-card metric-card" shadow="never">
        <span>在线设备</span>
        <strong>{{ onlineAgentCount }}</strong>
        <small>总计 {{ agents.length }} 台</small>
      </el-card>

      <el-card class="surface-card metric-card" shadow="never">
        <span>命令记录</span>
        <strong>{{ commands.length }}</strong>
        <small>最近任务同步中</small>
      </el-card>

      <el-card class="surface-card metric-card" shadow="never">
        <span>当前设备</span>
        <strong>{{ activeAgent?.label || "--" }}</strong>
        <small>{{ activeAgent?.agentId || "未选择设备" }}</small>
      </el-card>
    </section>

    <section class="stack-grid">
      <el-card class="surface-card info-card" shadow="never">
        <div class="card-head">
          <div>
            <p class="eyebrow">Agents</p>
            <h3>可用设备</h3>
          </div>
          <el-tag round effect="plain">{{ agents.length }}</el-tag>
        </div>

        <div class="list-grid">
          <button
            v-for="agent in agents"
            :key="agent.agentId"
            class="settings-item"
            :class="{ active: selectedAgentId === agent.agentId }"
            type="button"
            @click="emit('select-agent', agent.agentId)"
          >
            <span class="stack-text">
              <strong>{{ agent.label }}</strong>
              <small>{{ agent.hostname || agent.agentId }}</small>
            </span>
            <el-tag :type="statusType(agent.status)" effect="dark" round>{{ agent.status }}</el-tag>
          </button>
        </div>
      </el-card>

      <el-card class="surface-card info-card" shadow="never">
        <div class="card-head">
          <div>
            <p class="eyebrow">Selected</p>
            <h3>设备详情</h3>
          </div>
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
        <p v-else class="muted">当前还没有选中的设备。</p>
      </el-card>
    </section>
  </section>
</template>
