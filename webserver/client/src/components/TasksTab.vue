<script setup>
import { ElCard, ElOption, ElSelect, ElTag } from "element-plus";

defineProps({
  commands: {
    type: Array,
    required: true
  },
  agents: {
    type: Array,
    required: true
  },
  timelineFilterAgentId: {
    type: String,
    required: true
  }
});

const emit = defineEmits(["update:timelineFilterAgentId"]);

function statusType(status) {
  if (status === "completed") {
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
    <el-card class="surface-card section-banner tab-banner" shadow="never">
      <h2>执行记录</h2>
    </el-card>

    <el-card class="surface-card info-card" shadow="never">
      <label class="field-block">
        <span>筛选设备</span>
        <el-select :model-value="timelineFilterAgentId" placeholder="全部设备"
          @update:model-value="emit('update:timelineFilterAgentId', $event)">
          <el-option label="全部设备" value="all" />
          <el-option v-for="agent in agents" :key="agent.agentId" :label="`${agent.label} / ${agent.agentId}`"
            :value="agent.agentId" />
        </el-select>
      </label>
    </el-card>

    <section class="stack-grid">
      <el-card v-for="item in commands" :key="item.requestId" class="surface-card timeline-card" shadow="never">
        <div class="card-head">
          <div>
            <h3>{{ item.command }}</h3>
            <p>{{ item.agentId }}</p>
          </div>
          <el-tag :type="statusType(item.status)" effect="dark" round>{{ item.status }}</el-tag>
        </div>

        <div class="detail-grid">
          <div class="detail-row">
            <span>创建时间</span>
            <strong>{{ item.createdAt }}</strong>
          </div>
          <div class="detail-row">
            <span>退出码</span>
            <strong>{{ item.exitCode ?? "-" }}</strong>
          </div>
          <div class="detail-row">
            <span>安全状态</span>
            <strong>{{ item.secureStatus || "-" }}</strong>
          </div>
        </div>

        <div v-if="item.stdout" class="console-block">
          <h4>STDOUT</h4>
          <pre>{{ item.stdout }}</pre>
        </div>

        <div v-if="item.stderr || item.error" class="console-block error">
          <h4>STDERR / ERROR</h4>
          <pre>{{ item.stderr || item.error }}</pre>
        </div>
      </el-card>

      <el-card v-if="!commands.length" class="surface-card info-card" shadow="never">
        <p class="muted">当前筛选条件下还没有命令记录。</p>
      </el-card>
    </section>
  </section>
</template>
