<script setup>
import { computed, ref, watch } from "vue";
import { ElButton, ElCard, ElOption, ElSelect, ElTag } from "element-plus";

const props = defineProps({
  commands: {
    type: Array,
    required: true
  },
  agents: {
    type: Array,
    required: true
  },
  canClearCommands: {
    type: Boolean,
    required: true
  },
  clearingCommands: {
    type: Boolean,
    required: true
  },
  deletingCommandRequestId: {
    type: String,
    default: ""
  },
  timelineFilterAgentId: {
    type: String,
    required: true
  },
  latestRequestId: {
    type: String,
    default: ""
  }
});

const emit = defineEmits([
  "clear-commands",
  "delete-command",
  "update:timelineFilterAgentId"
]);
const expandedRequestIds = ref([]);
let lastTimelineFilterAgentId = "";
let lastCommandCount = 0;
const createdAtFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const agentById = computed(
  () =>
    new Map(
      (Array.isArray(props.agents) ? props.agents : [])
        .filter((item) => item?.agentId)
        .map((item) => [item.agentId, item])
    )
);

const clearButtonText = computed(() =>
  props.timelineFilterAgentId && props.timelineFilterAgentId !== "all"
    ? "清空当前设备记录"
    : "一键清空全部记录"
);

watch(
  [
    () => props.timelineFilterAgentId,
    () => props.commands.length,
    () => props.latestRequestId
  ],
  ([nextTimelineFilterAgentId, nextCommandCount, nextLatestRequestId]) => {
    const filterChanged = nextTimelineFilterAgentId !== lastTimelineFilterAgentId;
    const listShrank = nextCommandCount < lastCommandCount;
    let nextExpandedIds = expandedRequestIds.value;

    if (filterChanged || listShrank) {
      const validRequestIds = new Set(
        (Array.isArray(props.commands) ? props.commands : []).map((item) => item.requestId)
      );
      nextExpandedIds = nextExpandedIds.filter((id) => validRequestIds.has(id));
    }

    if (nextLatestRequestId) {
      const currentFirstExpandedId = nextExpandedIds[0] || "";

      if (
        !filterChanged &&
        !listShrank &&
        nextLatestRequestId === currentFirstExpandedId
      ) {
        lastTimelineFilterAgentId = nextTimelineFilterAgentId;
        lastCommandCount = nextCommandCount;
        return;
      }

      nextExpandedIds = [
        nextLatestRequestId,
        ...nextExpandedIds.filter((id) => id !== nextLatestRequestId)
      ];
    } else {
      nextExpandedIds = [];
    }

    expandedRequestIds.value = nextExpandedIds;
    lastTimelineFilterAgentId = nextTimelineFilterAgentId;
    lastCommandCount = nextCommandCount;
  },
  {
    immediate: true
  }
);

function statusType(status) {
  if (status === "completed") {
    return "success";
  }

  if (["queued", "running", "dispatched"].includes(status)) {
    return "warning";
  }

  return "danger";
}

function canDeleteCommand(item) {
  return (
    item &&
    !["queued", "running", "dispatched"].includes(String(item.status || ""))
  );
}

function isExpanded(requestId) {
  return expandedRequestIds.value.includes(requestId);
}

function toggleExpanded(requestId) {
  if (!requestId) {
    return;
  }

  if (isExpanded(requestId)) {
    expandedRequestIds.value = expandedRequestIds.value.filter((id) => id !== requestId);
    return;
  }

  expandedRequestIds.value = [...expandedRequestIds.value, requestId];
}

function resolveAgentSummary(item) {
  const agent = agentById.value.get(item.agentId);
  const hostname = agent?.hostname || agent?.label || item.agentId || "-";

  if (!item.agentId || hostname === item.agentId) {
    return hostname;
  }

  return `${hostname} / ${item.agentId}`;
}

function formatCreatedAt(value) {
  const normalizedValue = String(value || "");

  if (!normalizedValue) {
    return "-";
  }

  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return normalizedValue;
  }

  return createdAtFormatter.format(date).replaceAll("/", "-");
}
</script>

<template>
  <section class="page">
    <el-card class="surface-card section-banner tab-banner" shadow="never">
      <h2>执行记录</h2>
    </el-card>

    <el-card class="surface-card info-card" shadow="never">
      <div class="tasks-toolbar">
        <label class="field-block tasks-filter-field">
          <span>筛选设备</span>
          <el-select
            :model-value="timelineFilterAgentId"
            placeholder="全部设备"
            @update:model-value="emit('update:timelineFilterAgentId', $event)"
          >
            <el-option label="全部设备" value="all" />
            <el-option
              v-for="agent in agents"
              :key="agent.agentId"
              :label="`${agent.label} / ${agent.agentId}`"
              :value="agent.agentId"
            />
          </el-select>
        </label>
        <div class="hero-actions tasks-toolbar-actions">
          <el-button
            round
            plain
            type="danger"
            :disabled="!canClearCommands"
            @click="emit('clear-commands')"
          >
            {{ clearingCommands ? "清空中..." : clearButtonText }}
          </el-button>
        </div>
      </div>
      <p class="muted tasks-toolbar-hint">仅会清空已结束记录，执行中的任务会保留。</p>
    </el-card>

    <section class="stack-grid">
      <el-card
        v-for="item in commands"
        :key="item.requestId"
        class="surface-card timeline-card"
        shadow="never"
      >
        <div class="timeline-summary">
          <div class="timeline-summary-top">
            <h3 :title="item.command">{{ item.command }}</h3>
            <div class="timeline-summary-top-actions">
              <el-button
                v-if="canDeleteCommand(item)"
                round
                plain
                type="danger"
                size="small"
                :loading="deletingCommandRequestId === item.requestId"
                @click="emit('delete-command', item.requestId)"
              >
                删除
              </el-button>
              <el-tag :type="statusType(item.status)" effect="dark" round>{{ item.status }}</el-tag>
            </div>
          </div>

          <div class="timeline-summary-meta">
            <span
              class="timeline-summary-item timeline-summary-device"
              :title="resolveAgentSummary(item)"
            >
              <span class="timeline-summary-label">设备</span>
              <strong>{{ resolveAgentSummary(item) }}</strong>
            </span>
            <span class="timeline-summary-item">
              <span class="timeline-summary-label">创建</span>
              <strong>{{ formatCreatedAt(item.createdAt) }}</strong>
            </span>
            <span class="timeline-summary-item">
              <span class="timeline-summary-label">退出码</span>
              <strong>{{ item.exitCode ?? "-" }}</strong>
            </span>
            <span class="timeline-summary-item">
              <span class="timeline-summary-label">安全</span>
              <strong>{{ item.secureStatus || "-" }}</strong>
            </span>
            <button
              class="timeline-toggle"
              type="button"
              :aria-expanded="isExpanded(item.requestId)"
              @click="toggleExpanded(item.requestId)"
            >
              {{ isExpanded(item.requestId) ? "收起详情" : "展开详情" }}
            </button>
          </div>
        </div>

        <div v-if="isExpanded(item.requestId)" class="timeline-details">
          <div class="detail-row">
            <span>完整命令</span>
            <strong>{{ item.command }}</strong>
          </div>

          <div v-if="item.stdout" class="console-block">
            <h4>STDOUT</h4>
            <pre>{{ item.stdout }}</pre>
          </div>

          <div v-if="item.stderr || item.error" class="console-block error">
            <h4>STDERR / ERROR</h4>
            <pre>{{ item.stderr || item.error }}</pre>
          </div>

          <p v-if="!item.stdout && !item.stderr && !item.error" class="muted">
            当前没有输出内容。
          </p>
        </div>
      </el-card>

      <el-card v-if="!commands.length" class="surface-card info-card" shadow="never">
        <p class="muted">当前筛选条件下还没有命令记录。</p>
      </el-card>
    </section>
  </section>
</template>
