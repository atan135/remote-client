<script setup>
import { computed, ref, watch } from "vue";
import { ElCollapse, ElCollapseItem, ElDialog, ElTag } from "element-plus";
import MarkdownIt from "markdown-it";

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  viewer: {
    type: Object,
    default: null
  },
  title: {
    type: String,
    default: "文件预览"
  }
});

const emit = defineEmits(["update:modelValue"]);

const metaPanels = ref([]);

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value)
});

const fileTitle = computed(() => String(props.viewer?.resolvedPath || props.viewer?.filePath || "文件预览"));

const isMarkdownFile = computed(() => {
  const targetPath = String(props.viewer?.resolvedPath || props.viewer?.filePath || "");
  return /\.(md|markdown|mdown|mkd|mkdn)$/i.test(targetPath);
});

const summary = computed(() => {
  const viewer = props.viewer;

  if (!viewer) {
    return "";
  }

  const parts = [];
  const encoding = String(viewer.encoding || "").trim();

  if (encoding) {
    parts.push(`编码 ${encoding}`);
  }

  if (Number(viewer.bytesRead || 0) > 0) {
    parts.push(`读取 ${viewer.bytesRead} / ${viewer.totalBytes || viewer.bytesRead} 字节`);
  }

  if (viewer.modifiedAt) {
    parts.push(formatCompactDateTime(viewer.modifiedAt));
  }

  if (viewer.truncated) {
    parts.push("内容已截断");
  }

  return parts.join(" · ");
});

const renderedMarkdown = computed(() => {
  if (!isMarkdownFile.value || !props.viewer?.content) {
    return "";
  }

  return markdownRenderer.render(String(props.viewer.content || ""));
});

const shouldShowResolvedPathSeparately = computed(() => {
  const viewer = props.viewer;

  if (!viewer) {
    return false;
  }

  return String(viewer.filePath || "").trim() !== String(viewer.resolvedPath || "").trim();
});

watch(
  () => props.viewer?.requestId || props.viewer?.openedAt || "",
  () => {
    metaPanels.value = [];
  }
);

function formatCompactDateTime(value) {
  const time = Date.parse(String(value || ""));

  if (!Number.isFinite(time)) {
    return String(value || "");
  }

  return new Date(time).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    append-to-body
    class="remote-file-dialog"
    destroy-on-close
    top="5vh"
    width="min(1120px, 92vw)"
  >
    <template #header>
      <div class="remote-file-dialog-head">
        <strong>{{ title }}</strong>
        <small>{{ fileTitle }}</small>
      </div>
    </template>

    <div v-if="viewer" class="remote-file-dialog-body">
      <div class="remote-file-dialog-meta">
        <span>{{ summary || "文本文件" }}</span>
        <el-tag v-if="isMarkdownFile" type="success" effect="dark" round>Markdown</el-tag>
        <el-tag v-if="viewer.truncated" type="warning" effect="dark" round>已截断</el-tag>
      </div>

      <el-collapse v-model="metaPanels" class="remote-file-meta-collapse">
        <el-collapse-item name="meta" title="路径与文件详情">
          <div class="detail-grid remote-file-meta">
            <div class="detail-row detail-row-wrap">
              <span>{{ shouldShowResolvedPathSeparately ? "输入路径" : "文件路径" }}</span>
              <strong class="detail-value-wrap">
                {{
                  shouldShowResolvedPathSeparately
                    ? viewer.filePath
                    : viewer.resolvedPath || viewer.filePath || "-"
                }}
              </strong>
            </div>
            <div v-if="shouldShowResolvedPathSeparately" class="detail-row detail-row-wrap">
              <span>实际路径</span>
              <strong class="detail-value-wrap">{{ viewer.resolvedPath || "-" }}</strong>
            </div>
            <div class="detail-row">
              <span>编码</span>
              <strong>{{ viewer.encoding || "-" }}</strong>
            </div>
            <div class="detail-row">
              <span>读取字节</span>
              <strong>{{ viewer.bytesRead || 0 }}</strong>
            </div>
            <div class="detail-row">
              <span>文件总字节</span>
              <strong>{{ viewer.totalBytes || 0 }}</strong>
            </div>
            <div class="detail-row detail-row-wrap">
              <span>修改时间</span>
              <strong class="detail-value-wrap">{{ viewer.modifiedAt || "-" }}</strong>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <div v-if="isMarkdownFile && viewer.content" class="remote-file-markdown" v-html="renderedMarkdown" />
      <pre v-else-if="viewer.content">{{ viewer.content }}</pre>
      <p v-else class="muted remote-file-empty">文件内容为空。</p>
    </div>
  </el-dialog>
</template>
