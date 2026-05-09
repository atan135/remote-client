<script setup>
import { computed } from "vue";
import { ElButton, ElDialog, ElMessage } from "element-plus";

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  title: {
    type: String,
    default: "命令详情"
  },
  subtitle: {
    type: String,
    default: ""
  },
  command: {
    type: String,
    default: ""
  },
  stdout: {
    type: String,
    default: ""
  },
  stderr: {
    type: String,
    default: ""
  },
  error: {
    type: String,
    default: ""
  },
  metaItems: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(["update:modelValue"]);

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value)
});

const errorText = computed(() => [props.stderr, props.error].filter(Boolean).join("\n\n"));
const hasAnyOutput = computed(() => Boolean(props.stdout || errorText.value));

async function copyText(text, label) {
  const value = String(text || "");

  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success(`${label}已复制`);
  } catch {
    ElMessage.error(`${label}复制失败`);
  }
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    append-to-body
    class="remote-file-dialog command-detail-dialog"
    destroy-on-close
    top="5vh"
    width="min(1120px, 92vw)"
  >
    <template #header>
      <div class="remote-file-dialog-head">
        <strong>{{ title }}</strong>
        <small v-if="subtitle">{{ subtitle }}</small>
      </div>
    </template>

    <div class="remote-file-dialog-body command-detail-dialog-body">
      <div v-if="metaItems.length" class="command-detail-meta-card">
        <div
          v-for="item in metaItems"
          :key="item.label"
          class="command-detail-meta-item"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.value ?? "-" }}</strong>
        </div>
      </div>

      <div class="command-detail-output-stack">
        <section class="command-detail-output-panel command-detail-command-panel">
          <div class="command-detail-panel-head">
            <h4>COMMAND</h4>
            <el-button link type="primary" :disabled="!command" @click="copyText(command, '命令')">
              复制
            </el-button>
          </div>
          <pre>{{ command || "-" }}</pre>
        </section>

        <section v-if="stdout" class="command-detail-output-panel">
          <div class="command-detail-panel-head">
            <h4>STDOUT</h4>
            <el-button link type="primary" @click="copyText(stdout, 'STDOUT')">
              复制
            </el-button>
          </div>
          <pre>{{ stdout }}</pre>
        </section>

        <section v-if="errorText" class="command-detail-output-panel error">
          <div class="command-detail-panel-head">
            <h4>STDERR / ERROR</h4>
            <el-button link type="primary" @click="copyText(errorText, '错误输出')">
              复制
            </el-button>
          </div>
          <pre>{{ errorText }}</pre>
        </section>

        <p v-if="!hasAnyOutput" class="muted remote-file-empty">
          当前还没有输出内容。
        </p>
      </div>
    </div>
  </el-dialog>
</template>
