<script setup>
import { computed, ref } from "vue";
import { Delete } from "@element-plus/icons-vue";
import { ElButton, ElCard, ElOption, ElSelect, ElTag } from "element-plus";
import CommandDetailDialog from "./CommandDetailDialog.vue";

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
const activeCommandDetailRequestId = ref("");
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
    ? "清空当前"
    : "清空记录"
);

const clearButtonTitle = computed(() =>
  props.timelineFilterAgentId && props.timelineFilterAgentId !== "all"
    ? "清空当前设备的已结束记录"
    : "清空全部已结束记录"
);

const activeCommandDetailRecord = computed(
  () => props.commands.find((item) => item.requestId === activeCommandDetailRequestId.value) || null
);

const commandDetailDialogVisible = computed({
  get: () => Boolean(activeCommandDetailRecord.value),
  set: (value) => {
    if (!value) {
      activeCommandDetailRequestId.value = "";
    }
  }
});

const activeCommandDetailMetaItems = computed(() => {
  const item = activeCommandDetailRecord.value;

  if (!item) {
    return [];
  }

  return [
    {
      label: "设备",
      value: resolveAgentSummary(item)
    },
    {
      label: "状态",
      value: item.status || "-"
    },
    {
      label: "退出码",
      value: formatExitCode(item.exitCode)
    },
    {
      label: "Shell",
      value: resolveShellLabel(item.commandShell)
    },
    {
      label: "安全",
      value: item.secureStatus || "-"
    },
    {
      label: "时间",
      value: formatCreatedAt(item.updatedAt || item.createdAt)
    }
  ];
});

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

function openCommandDetail(requestId) {
  activeCommandDetailRequestId.value = requestId || "";
}

function resolveAgentSummary(item) {
  const agent = agentById.value.get(item.agentId);
  const hostname = agent?.hostname || agent?.label || item.agentId || "-";

  if (!item.agentId || hostname === item.agentId) {
    return hostname;
  }

  return `${hostname} / ${item.agentId}`;
}

function resolveShellLabel(shellValue) {
  switch (String(shellValue || "")) {
    case "cmd":
      return "cmd";
    case "powershell":
      return "PowerShell";
    case "pwsh":
      return "PowerShell 7";
    case "bash":
      return "Bash";
    default:
      return shellValue || "-";
  }
}

function formatExitCode(value) {
  return value ?? "-";
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

function hasCommandOutput(item) {
  return Boolean(item?.stdout || item?.stderr || item?.error);
}

function isErrorOnlyOutput(item) {
  return Boolean(!item?.stdout && (item?.stderr || item?.error));
}

function getCommandOutputPreviewTitle(item) {
  return item?.stdout ? "输出预览" : "错误输出";
}

function getCommandOutputPreview(item) {
  const stdout = String(item?.stdout || "").trimEnd();
  const stderr = String(item?.stderr || item?.error || "").trimEnd();
  const parts = [];

  if (stdout) {
    parts.push(stdout);
  }

  if (stderr) {
    parts.push(stdout ? `STDERR / ERROR\n${stderr}` : stderr);
  }

  return parts.join("\n\n");
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
      </div>
      <div class="tasks-toolbar-footer">
        <p class="muted tasks-toolbar-hint">仅会清空已结束记录，执行中的任务会保留。</p>
        <el-button
          class="tasks-clear-button"
          link
          type="danger"
          :icon="Delete"
          :disabled="!canClearCommands"
          :title="clearButtonTitle"
          @click="emit('clear-commands')"
        >
          {{ clearingCommands ? "清空中..." : clearButtonText }}
        </el-button>
      </div>
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
              <el-tag class="timeline-status-tag" :type="statusType(item.status)" effect="dark" round>
                {{ item.status }}
              </el-tag>
            </div>
          </div>

          <div class="timeline-command-preview-grid">
            <div class="console-block timeline-command-preview">
              <h4>输入</h4>
              <pre>{{ item.command || "-" }}</pre>
            </div>

            <div
              v-if="hasCommandOutput(item)"
              class="console-block timeline-output-preview"
              :class="{ error: isErrorOnlyOutput(item) }"
            >
              <h4>{{ getCommandOutputPreviewTitle(item) }}</h4>
              <pre>{{ getCommandOutputPreview(item) }}</pre>
            </div>

            <p v-else class="muted timeline-output-empty">
              当前还没有输出内容。
            </p>
          </div>

          <div class="timeline-summary-footer">
            <el-button
              v-if="canDeleteCommand(item)"
              class="timeline-delete-button"
              link
              type="danger"
              :loading="deletingCommandRequestId === item.requestId"
              @click="emit('delete-command', item.requestId)"
            >
              删除
            </el-button>
            <span v-else></span>
            <el-button
              class="timeline-detail-button"
              link
              type="primary"
              @click="openCommandDetail(item.requestId)"
            >
              查看详情
            </el-button>
          </div>
        </div>
      </el-card>

      <el-card v-if="!commands.length" class="surface-card info-card" shadow="never">
        <p class="muted">当前筛选条件下还没有命令记录。</p>
      </el-card>
    </section>

    <CommandDetailDialog
      v-if="activeCommandDetailRecord"
      v-model="commandDetailDialogVisible"
      title="命令详情"
      :subtitle="resolveAgentSummary(activeCommandDetailRecord)"
      :command="activeCommandDetailRecord.command || ''"
      :stdout="activeCommandDetailRecord.stdout || ''"
      :stderr="activeCommandDetailRecord.stderr || ''"
      :error="activeCommandDetailRecord.error || ''"
      :meta-items="activeCommandDetailMetaItems"
    />
  </section>
</template>
