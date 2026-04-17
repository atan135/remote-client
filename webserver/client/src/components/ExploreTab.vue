<script setup>
import { ElButton, ElCard, ElInput, ElOption, ElSelect, ElTag } from "element-plus";

defineProps({
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
  canSubmitCommand: {
    type: Boolean,
    required: true
  },
  submitting: {
    type: Boolean,
    required: true
  }
});

const emit = defineEmits(["update:selectedAgentId", "update:commandInput", "submitCommand"]);
</script>

<template>
  <section class="page">
    <el-card class="surface-card section-banner" shadow="never">
      <p class="eyebrow">Terminal</p>
      <h2>终端输入</h2>
      <p>选择目标设备，输入安全命令并提交到服务端执行。</p>
    </el-card>

    <el-card class="surface-card info-card" shadow="never">
      <div class="card-head">
        <div>
          <h3>目标设备</h3>
          <p>{{ activeAgent?.agentId || "未选择设备" }}</p>
        </div>
        <el-tag :type="activeAuthCodeBinding ? 'success' : 'danger'" effect="dark" round>
          {{ activeAuthCodeBinding ? "已绑定公钥" : "缺少公钥" }}
        </el-tag>
      </div>

      <label class="field-block">
        <span>设备列表</span>
        <el-select
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

      <label class="field-block">
        <span>命令内容</span>
        <el-input
          :model-value="commandInput"
          type="textarea"
          :rows="8"
          placeholder="例如：ipconfig /all 或 hostname"
          @update:model-value="emit('update:commandInput', $event)"
        />
      </label>

      <div class="hero-actions">
        <el-button type="primary" round :disabled="!canSubmitCommand" @click="emit('submitCommand')">
          {{ submitting ? "提交中..." : "发送安全命令" }}
        </el-button>
      </div>
    </el-card>
  </section>
</template>
