<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElDialog,
  ElMessageBox,
  ElSegmented,
  ElTag
} from "element-plus";
import MarkdownIt from "markdown-it";
import EmptyState from "./EmptyState.vue";

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const MODE_MARKDOWN = "markdown";
const MODE_TEXT = "text";
const MODE_EDIT = "edit";

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
  },
  saving: {
    type: Boolean,
    default: false
  },
  saveError: {
    type: String,
    default: ""
  },
  canSave: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["update:modelValue", "save"]);

const metaPanels = ref([]);
const currentViewer = ref(null);
const draftContent = ref("");
const baseContent = ref("");
const displayMode = ref(MODE_TEXT);
const activeViewerKey = ref("");
const pendingSaveContent = ref("");
const hasPendingSave = ref(false);
const lastSaveCompletedAt = ref(0);
const saveSuccessText = ref("");
const previousSaving = ref(false);

const fileTitle = computed(() =>
  String(currentViewer.value?.resolvedPath || currentViewer.value?.requestedPath || currentViewer.value?.filePath || "文件预览")
);

const filePath = computed(() => String(currentViewer.value?.filePath || currentViewer.value?.requestedPath || ""));
const resolvedPath = computed(() => String(currentViewer.value?.resolvedPath || ""));

const isMarkdownFile = computed(() => {
  const targetPath = String(
    currentViewer.value?.resolvedPath || currentViewer.value?.requestedPath || currentViewer.value?.filePath || ""
  );
  return /\.(md|markdown|mdown|mkd|mkdn)$/i.test(targetPath);
});

const isPlainTextDefaultFile = computed(() => {
  const targetPath = String(
    currentViewer.value?.resolvedPath || currentViewer.value?.requestedPath || currentViewer.value?.filePath || ""
  );
  return /\.txt$/i.test(targetPath) || !isMarkdownFile.value;
});

const baseToken = computed(() => {
  const viewer = props.viewer;

  if (!viewer) {
    return "";
  }

  return String(
    viewer.dirtyBaseContent ??
      viewer.savedContent ??
      `${viewer.modifiedAt || ""}:${viewer.writtenAt || ""}:${viewer.content ?? ""}`
  );
});

const summary = computed(() => {
  const viewer = currentViewer.value;

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

const modeOptions = computed(() => {
  const options = [];

  if (isMarkdownFile.value) {
    options.push({ label: "Markdown 预览", value: MODE_MARKDOWN });
  }

  options.push({ label: "纯文本查看", value: MODE_TEXT });
  options.push({ label: "编辑", value: MODE_EDIT });

  return options;
});

const renderedMarkdown = computed(() => {
  if (!isMarkdownFile.value) {
    return "";
  }

  return markdownRenderer.render(String(draftContent.value || ""));
});

const hasUnsavedChanges = computed(() => draftContent.value !== baseContent.value);

const saveBlockedReason = computed(() => {
  if (!currentViewer.value) {
    return "无文件";
  }

  if (currentViewer.value?.truncated) {
    return "截断内容不可保存";
  }

  if (!resolvedPath.value || !filePath.value) {
    return "缺少路径";
  }

  if (props.saving) {
    return "保存中";
  }

  if (!hasUnsavedChanges.value) {
    return "无变更";
  }

  if (!props.canSave) {
    return "当前不可保存";
  }

  return "";
});

const canSubmitSave = computed(() => !saveBlockedReason.value);

const statusText = computed(() => {
  if (props.saving) {
    return "正在保存...";
  }

  if (props.saveError) {
    return props.saveError;
  }

  if (currentViewer.value?.truncated) {
    return "内容已截断，不可保存";
  }

  if (!resolvedPath.value || !filePath.value) {
    return "缺少路径，无法保存";
  }

  if (hasUnsavedChanges.value && !props.canSave) {
    return "当前不可保存";
  }

  if (hasUnsavedChanges.value) {
    return saveSuccessText.value ? "保存成功，当前有未保存变更" : "有未保存变更";
  }

  if (saveSuccessText.value) {
    return saveSuccessText.value;
  }

  return "已同步";
});

const statusClass = computed(() => ({
  "remote-file-status": true,
  "is-error": Boolean(props.saveError),
  "is-success": Boolean(saveSuccessText.value && !props.saveError && !hasUnsavedChanges.value),
  "is-dirty": hasUnsavedChanges.value && !props.saveError
}));

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => {
    if (value) {
      emit("update:modelValue", true);
      return;
    }

    requestCloseDialog();
  }
});

watch(
  () => props.modelValue,
  (visible) => {
    if (visible && props.viewer) {
      syncFromViewer(props.viewer, { resetMode: true });
    }
  }
);

watch(
  () => props.viewer,
  async (viewer, oldViewer) => {
    const nextKey = makeViewerKey(viewer);
    const oldKey = makeViewerKey(oldViewer);
    const nextContent = getInitialContent(viewer);
    const isSameFile = sameFileIdentity(viewer, currentViewer.value);
    const isPendingSaveResult =
      isSameFile && hasPendingSave.value && nextContent === pendingSaveContent.value;
    const isRecentSaveResult =
      isSameFile && lastSaveCompletedAt.value > 0 && Date.now() - lastSaveCompletedAt.value < 3000;

    if (nextKey === activeViewerKey.value) {
      mergeViewerUpdate(viewer, { updateDraft: !hasUnsavedChanges.value });
      return;
    }

    if (isPendingSaveResult || (props.saving && isSameFile) || isRecentSaveResult) {
      mergeViewerUpdate(viewer, {
        updateDraft: !hasUnsavedChanges.value || draftContent.value === pendingSaveContent.value,
        updateBase: isPendingSaveResult || !hasUnsavedChanges.value || isRecentSaveResult
      });

      if (isPendingSaveResult || isRecentSaveResult) {
        saveSuccessText.value = props.saveError ? "" : "保存成功";
      }

      return;
    }

    if (oldViewer && nextKey !== oldKey && hasUnsavedChanges.value) {
      try {
        await confirmDiscardChanges("切换文件将丢弃未保存的编辑内容。");
        syncFromViewer(viewer, { resetMode: true });
      } catch {
      }
      return;
    }

    syncFromViewer(viewer, { resetMode: true });
  }
);

watch(baseToken, () => {
  const viewer = props.viewer;

  if (!viewer || makeViewerKey(viewer) !== activeViewerKey.value) {
    return;
  }

  if (!hasUnsavedChanges.value && !hasPendingSave.value) {
    const nextBase = getInitialContent(viewer);
    baseContent.value = nextBase;
    draftContent.value = nextBase;
  }
});

watch(
  () => props.saving,
  async (saving) => {
    const wasSaving = previousSaving.value;
    previousSaving.value = saving;

    if (!wasSaving || saving) {
      return;
    }

    await nextTick();

    if (props.saveError) {
      pendingSaveContent.value = "";
      hasPendingSave.value = false;
      return;
    }

    lastSaveCompletedAt.value = Date.now();
    const savedContent = hasPendingSave.value ? pendingSaveContent.value : draftContent.value;

    baseContent.value = savedContent;
    pendingSaveContent.value = "";
    hasPendingSave.value = false;
    saveSuccessText.value = "保存成功";
  }
);

watch(
  () => props.saveError,
  (value) => {
    if (value) {
      saveSuccessText.value = "";
    }
  }
);

function getInitialContent(viewer) {
  if (!viewer) {
    return "";
  }

  return String(viewer.dirtyBaseContent ?? viewer.savedContent ?? viewer.content ?? "");
}

function makeViewerKey(viewer) {
  if (!viewer) {
    return "";
  }

  return String(
    viewer.requestId ||
      viewer.openedAt ||
      `${viewer.agentId || ""}:${viewer.resolvedPath || viewer.filePath || viewer.requestedPath || ""}`
  );
}

function sameFileIdentity(left, right) {
  if (!left || !right) {
    return false;
  }

  const leftPath = String(left.resolvedPath || left.filePath || left.requestedPath || "");
  const rightPath = String(right.resolvedPath || right.filePath || right.requestedPath || "");
  const leftAgent = String(left.agentId || left.sessionId || "");
  const rightAgent = String(right.agentId || right.sessionId || "");

  return Boolean(leftPath && rightPath && leftPath === rightPath && leftAgent === rightAgent);
}

function syncFromViewer(viewer, options = {}) {
  currentViewer.value = viewer || null;
  activeViewerKey.value = makeViewerKey(viewer);
  metaPanels.value = [];
  saveSuccessText.value = "";

  const content = getInitialContent(viewer);
  baseContent.value = content;
  draftContent.value = content;
  pendingSaveContent.value = "";
  hasPendingSave.value = false;

  if (options.resetMode) {
    displayMode.value = isMarkdownTarget(viewer) ? MODE_MARKDOWN : MODE_EDIT;
  }
}

function mergeViewerUpdate(viewer, options = {}) {
  currentViewer.value = viewer || null;
  activeViewerKey.value = makeViewerKey(viewer);

  if (!viewer) {
    return;
  }

  const nextBase = getInitialContent(viewer);

  if (options.updateBase !== false) {
    baseContent.value = nextBase;
  }

  if (options.updateDraft) {
    draftContent.value = nextBase;
  }
}

async function requestCloseDialog() {
  if (hasUnsavedChanges.value) {
    try {
      await confirmDiscardChanges("关闭弹窗将丢弃未保存的编辑内容。");
    } catch {
      await nextTick();
      emit("update:modelValue", true);
      return;
    }
  }

  emit("update:modelValue", false);
}

function confirmDiscardChanges(message) {
  return ElMessageBox.confirm(message, "未保存变更", {
    type: "warning",
    confirmButtonText: "丢弃",
    cancelButtonText: "继续编辑",
    closeOnClickModal: false,
    distinguishCancelAndClose: true
  });
}

function handleSave() {
  if (!canSubmitSave.value) {
    return;
  }

  saveSuccessText.value = "";
  pendingSaveContent.value = draftContent.value;
  hasPendingSave.value = true;

  emit("save", {
    content: draftContent.value,
    viewer: currentViewer.value,
    sessionId: currentViewer.value?.sessionId,
    filePath: filePath.value,
    resolvedPath: resolvedPath.value,
    baseCwd: currentViewer.value?.baseCwd,
    encoding: currentViewer.value?.encoding,
    modifiedAt: currentViewer.value?.modifiedAt,
    totalBytes: currentViewer.value?.totalBytes,
    truncated: currentViewer.value?.truncated,
    agentId: currentViewer.value?.agentId,
    requestId: currentViewer.value?.requestId,
    context: currentViewer.value?.context,
    contextKey: currentViewer.value?.contextKey,
    contextId: currentViewer.value?.contextId
  });
}

function isMarkdownTarget(viewer) {
  const targetPath = String(viewer?.resolvedPath || viewer?.requestedPath || viewer?.filePath || "");
  return /\.(md|markdown|mdown|mkd|mkdn)$/i.test(targetPath);
}

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
    top="5vh"
    width="min(1120px, 92vw)"
  >
    <template #header>
      <div class="remote-file-dialog-head">
        <strong>{{ title }}</strong>
        <small>{{ fileTitle }}</small>
      </div>
    </template>

    <div v-if="currentViewer" class="remote-file-dialog-body">
      <div class="remote-file-dialog-meta">
        <span>{{ summary || "文本文件" }}</span>
        <el-tag v-if="isMarkdownFile" type="success" effect="dark" round>Markdown</el-tag>
        <el-tag v-if="isPlainTextDefaultFile && !isMarkdownFile" effect="dark" round>文本</el-tag>
        <el-tag v-if="currentViewer.truncated" type="warning" effect="dark" round>已截断</el-tag>
      </div>

      <el-collapse v-model="metaPanels" class="remote-file-meta-collapse">
        <el-collapse-item name="meta" title="路径与文件详情">
          <div class="detail-grid remote-file-meta">
            <div class="detail-row detail-row-wrap">
              <span>请求路径</span>
              <strong class="detail-value-wrap">{{ currentViewer.requestedPath || currentViewer.filePath || "-" }}</strong>
            </div>
            <div class="detail-row detail-row-wrap">
              <span>实际路径</span>
              <strong class="detail-value-wrap">{{ currentViewer.resolvedPath || "-" }}</strong>
            </div>
            <div class="detail-row detail-row-wrap">
              <span>基准目录</span>
              <strong class="detail-value-wrap">{{ currentViewer.baseCwd || "-" }}</strong>
            </div>
            <div class="detail-row">
              <span>编码</span>
              <strong>{{ currentViewer.encoding || "-" }}</strong>
            </div>
            <div class="detail-row">
              <span>读取字节</span>
              <strong>{{ currentViewer.bytesRead || 0 }}</strong>
            </div>
            <div class="detail-row">
              <span>文件总字节</span>
              <strong>{{ currentViewer.totalBytes || 0 }}</strong>
            </div>
            <div class="detail-row detail-row-wrap">
              <span>修改时间</span>
              <strong class="detail-value-wrap">{{ currentViewer.modifiedAt || "-" }}</strong>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <div class="remote-file-toolbar">
        <el-segmented v-model="displayMode" :options="modeOptions" class="remote-file-mode" />
        <div class="remote-file-actions">
          <span :class="statusClass">{{ statusText }}</span>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!canSubmitSave"
            :title="saveBlockedReason"
            @click="handleSave"
          >
            保存
          </el-button>
        </div>
      </div>

      <section class="remote-file-content">
        <div
          v-if="displayMode === MODE_MARKDOWN"
          class="remote-file-markdown remote-file-scroll"
          v-html="renderedMarkdown"
        />
        <pre v-else-if="displayMode === MODE_TEXT" class="remote-file-plain remote-file-scroll">{{ draftContent }}</pre>
        <textarea
          v-else
          v-model="draftContent"
          class="remote-file-editor"
          placeholder="空文件，可直接输入内容。"
          spellcheck="false"
          wrap="soft"
          aria-label="远程文件内容"
        />

        <EmptyState
          v-if="displayMode !== MODE_EDIT && !draftContent"
          class="remote-file-empty"
          compact
          title="文件内容为空"
          description="当前文件内容为空。"
        />
      </section>
    </div>
    <EmptyState v-else compact title="没有可预览的文件" description="请先打开一个远程文本文件。" />
  </el-dialog>
</template>

<style scoped>
:global(.remote-file-dialog) {
  max-width: 92vw;
}

:global(.remote-file-dialog .el-dialog__body) {
  min-width: 0;
  padding-top: 8px;
}

.remote-file-dialog-head {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.remote-file-dialog-head strong,
.remote-file-dialog-head small {
  min-width: 0;
  overflow-wrap: anywhere;
}

.remote-file-dialog-head small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.35;
}

.remote-file-dialog-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.remote-file-dialog-meta {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.remote-file-dialog-meta span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.remote-file-meta-collapse {
  min-width: 0;
}

.remote-file-meta {
  min-width: 0;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
}

.detail-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  font-size: 13px;
}

.detail-row span {
  color: var(--el-text-color-secondary);
}

.detail-row strong {
  min-width: 0;
  font-weight: 500;
}

.detail-row-wrap {
  grid-column: 1 / -1;
}

.detail-value-wrap {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.remote-file-toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.remote-file-mode {
  max-width: 100%;
}

.remote-file-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-left: auto;
}

.remote-file-status {
  min-width: 0;
  max-width: min(360px, 52vw);
  color: var(--el-text-color-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.remote-file-status.is-error {
  color: var(--el-color-danger);
}

.remote-file-status.is-success {
  color: var(--el-color-success);
}

.remote-file-status.is-dirty {
  color: var(--el-color-warning);
}

.remote-file-actions .el-button {
  flex: 0 0 auto;
}

.remote-file-content {
  position: relative;
  min-width: 0;
  min-height: 420px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  overflow: hidden;
}

.remote-file-scroll,
.remote-file-editor {
  box-sizing: border-box;
  width: 100%;
  height: min(58vh, 620px);
  min-height: 420px;
  overflow: auto;
}

.remote-file-markdown {
  padding: 20px 24px;
  color: var(--el-text-color-primary);
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.remote-file-markdown :deep(pre),
.remote-file-markdown :deep(code) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.remote-file-markdown :deep(pre) {
  padding: 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.remote-file-markdown :deep(img) {
  max-width: 100%;
}

.remote-file-markdown :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.remote-file-markdown :deep(th),
.remote-file-markdown :deep(td) {
  padding: 6px 8px;
  border: 1px solid var(--el-border-color);
  overflow-wrap: anywhere;
}

.remote-file-plain {
  margin: 0;
  padding: 16px;
  color: var(--el-text-color-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.remote-file-editor {
  display: block;
  resize: none;
  border: 0;
  outline: none;
  padding: 16px;
  color: var(--el-text-color-primary);
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.remote-file-empty {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

@media (max-width: 640px) {
  :global(.remote-file-dialog) {
    width: 94vw !important;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .detail-row {
    grid-template-columns: 68px minmax(0, 1fr);
  }

  .remote-file-toolbar {
    align-items: stretch;
  }

  .remote-file-actions {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }

  .remote-file-mode {
    width: 100%;
  }

  .remote-file-status {
    max-width: calc(100% - 92px);
  }

  .remote-file-scroll,
  .remote-file-editor,
  .remote-file-content {
    min-height: 320px;
  }

  .remote-file-scroll,
  .remote-file-editor {
    height: 56vh;
  }
}
</style>
