<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { ElButton, ElCard, ElInput, ElOption, ElSelect, ElTag } from "element-plus";

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
  "terminate-terminal-session"
]);

const terminalViewport = ref(null);

const formattedOutputs = computed(() =>
  (props.activeTerminalSession?.outputs || []).map((item) => ({
    ...item,
    chunk: stripAnsi(String(item.chunk || ""))
  }))
);

watch(
  () => [
    props.activeTerminalSession?.sessionId || "",
    (props.activeTerminalSession?.outputs || []).length
  ],
  async () => {
    await nextTick();

    if (terminalViewport.value) {
      terminalViewport.value.scrollTop = terminalViewport.value.scrollHeight;
    }
  }
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

function stripAnsi(value) {
  return value.replace(
    // Covers CSI/OSC sequences commonly emitted by PowerShell and PTY tools.
    /[\u001B\u009B][[\]()#;?]*(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]|(?:].*?(?:\u0007|\u001B\\)))/g,
    ""
  );
}
</script>

<template>
  <section class="page">
    <el-card class="surface-card section-banner" shadow="never">
      <p class="eyebrow">Terminal</p>
      <h2>终端控制台</h2>
      <p>保留一次性安全命令，同时支持基于 PTY 的交互式终端会话。</p>
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

      <div class="tag-row compact-stack">
        <el-tag
          v-for="profile in availableTerminalProfiles"
          :key="profile.name"
          round
          effect="plain"
          :type="terminalProfile === profile.name ? 'warning' : 'info'"
        >
          {{ profile.name }}
        </el-tag>
      </div>
    </el-card>

    <el-card class="surface-card info-card" shadow="never">
      <div class="card-head">
        <div>
          <p class="eyebrow">Quick Command</p>
          <h3>一次性命令</h3>
          <p>适合快速返回结果的系统命令。</p>
        </div>
      </div>

      <label class="field-block">
        <span>命令内容</span>
        <el-input
          :model-value="commandInput"
          type="textarea"
          :rows="5"
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

    <el-card class="surface-card info-card" shadow="never">
      <div class="card-head">
        <div>
          <p class="eyebrow">Interactive Session</p>
          <h3>交互式终端会话</h3>
          <p>适合 Claude Code、Codex CLI 或其他需要持续输入输出的终端工具。</p>
        </div>
        <el-tag :type="activeTerminalSession ? statusType(activeTerminalSession.status) : 'info'" effect="dark" round>
          {{ activeTerminalSession?.status || "未选择会话" }}
        </el-tag>
      </div>

      <div class="detail-grid">
        <label class="field-block">
          <span>终端 Profile</span>
          <el-select
            :model-value="terminalProfile"
            placeholder="请选择 profile"
            @update:model-value="emit('update:terminalProfile', $event)"
          >
            <el-option
              v-for="profile in availableTerminalProfiles"
              :key="profile.name"
              :label="`${profile.name} / ${profile.command || 'shell'}`"
              :value="profile.name"
            />
          </el-select>
        </label>

        <label class="field-block">
          <span>工作目录</span>
          <el-input
            :model-value="terminalCwd"
            placeholder="留空则使用默认目录"
            @update:model-value="emit('update:terminalCwd', $event)"
          />
        </label>
      </div>

      <div class="hero-actions">
        <el-button
          type="primary"
          round
          :disabled="!canCreateTerminalSession"
          @click="emit('create-terminal-session')"
        >
          {{ creatingTerminalSession ? "创建中..." : "创建终端会话" }}
        </el-button>
      </div>
    </el-card>

    <section class="stack-grid terminal-layout">
      <el-card class="surface-card info-card" shadow="never">
        <div class="card-head">
          <div>
            <p class="eyebrow">Sessions</p>
            <h3>会话列表</h3>
            <p>{{ terminalSessions.length ? "选择一个会话继续交互" : "当前设备还没有终端会话" }}</p>
          </div>
        </div>

        <div v-if="terminalSessions.length" class="session-list">
          <button
            v-for="session in terminalSessions"
            :key="session.sessionId"
            class="session-item"
            :class="{ active: session.sessionId === activeTerminalSession?.sessionId }"
            type="button"
            @click="emit('select:terminalSession', session.sessionId)"
          >
            <span class="stack-text">
              <strong>{{ session.profile }}</strong>
              <small>{{ session.createdAt }}</small>
            </span>
            <el-tag :type="statusType(session.status)" effect="dark" round>
              {{ session.status }}
            </el-tag>
          </button>
        </div>
        <p v-else class="muted">先创建会话，再在这里选择和切换终端实例。</p>
      </el-card>

      <el-card class="surface-card info-card" shadow="never">
        <div class="card-head">
          <div>
            <p class="eyebrow">Console</p>
            <h3>会话输出</h3>
            <p>{{ activeTerminalSession?.sessionId || "未选中会话" }}</p>
          </div>
          <el-button
            v-if="activeTerminalSession"
            round
            type="danger"
            plain
            :disabled="!canTerminateTerminalSession"
            @click="emit('terminate-terminal-session', activeTerminalSession.sessionId)"
          >
            {{
              terminatingTerminalSessionId === activeTerminalSession.sessionId
                ? "终止中..."
                : "结束会话"
            }}
          </el-button>
        </div>

        <div v-if="activeTerminalSession" class="detail-grid compact-stack">
          <div class="detail-row">
            <span>Profile</span>
            <strong>{{ activeTerminalSession.profile }}</strong>
          </div>
          <div class="detail-row">
            <span>工作目录</span>
            <strong>{{ activeTerminalSession.cwd || "-" }}</strong>
          </div>
          <div class="detail-row">
            <span>退出码</span>
            <strong>{{ activeTerminalSession.exitCode ?? "-" }}</strong>
          </div>
        </div>

        <div v-if="activeTerminalSession" ref="terminalViewport" class="terminal-viewport compact-stack">
          <div
            v-for="item in formattedOutputs"
            :key="`${item.seq}-${item.stream}`"
            class="terminal-line"
            :class="`stream-${item.stream || 'stdout'}`"
          >
            <span class="terminal-prefix">{{ item.stream || "stdout" }}#{{ item.seq }}</span>
            <pre>{{ item.chunk }}</pre>
          </div>
          <p v-if="!formattedOutputs.length" class="terminal-empty">会话已创建，等待终端输出...</p>
        </div>
        <p v-else class="muted">从左侧选择会话后，这里会持续显示流式输出。</p>

        <div v-if="activeTerminalSession" class="compact-stack">
          <label class="field-block">
            <span>发送输入</span>
            <el-input
              :model-value="terminalInput"
              type="textarea"
              :rows="3"
              placeholder="输入一行命令或给 CLI 的下一步指令"
              @update:model-value="emit('update:terminalInput', $event)"
              @keydown.ctrl.enter.prevent="emit('send-terminal-input')"
            />
          </label>

          <div class="hero-actions">
            <el-button
              type="primary"
              round
              :disabled="!canSendTerminalInput || isTerminalSessionClosed(activeTerminalSession.status)"
              @click="emit('send-terminal-input')"
            >
              {{ sendingTerminalInput ? "发送中..." : "发送输入" }}
            </el-button>
          </div>
        </div>

        <div
          v-if="activeTerminalSession?.error"
          class="console-block error"
        >
          <h4>Session Error</h4>
          <pre>{{ activeTerminalSession.error }}</pre>
        </div>
      </el-card>
    </section>
  </section>
</template>
