<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

const props = defineProps({
  sessionId: {
    type: String,
    default: ""
  },
  outputs: {
    type: Array,
    default: () => []
  },
  interactive: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["terminal-data", "terminal-resize"]);

const terminalHost = ref(null);

const hasOutputs = computed(() => Array.isArray(props.outputs) && props.outputs.length > 0);
const INTERRUPT_SEQUENCE = "\u0003";

let terminal = null;
let fitAddon = null;
let fitFrameId = 0;
let renderedSessionId = "";
let renderedMaxSeq = 0;
let resizeObserver = null;
let observedHostWidth = 0;
let reportedTerminalSizeKey = "";

onMounted(async () => {
  createTerminal();
  await nextTick();
  syncOutputs(true);
  scheduleFitTerminal();
});

onBeforeUnmount(() => {
  if (fitFrameId) {
    window.cancelAnimationFrame(fitFrameId);
    fitFrameId = 0;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  observedHostWidth = 0;
  reportedTerminalSizeKey = "";
  window.removeEventListener("resize", handleWindowResize);
  terminalHost.value?.removeEventListener("click", focusTerminal);
  terminal?.dispose();
  terminal = null;
  fitAddon = null;
  renderedMaxSeq = 0;
});

watch(
  () => props.sessionId,
  async () => {
    reportedTerminalSizeKey = "";
    await nextTick();
    syncOutputs();
    scheduleFitTerminal();
  }
);

watch(
  () => [
    props.outputs.length,
    props.outputs[0]?.seq ?? "",
    props.outputs[props.outputs.length - 1]?.seq ?? ""
  ],
  async () => {
    await nextTick();
    syncOutputs();
  }
);

watch(
  () => props.interactive,
  (interactive) => {
    if (!terminal) {
      return;
    }

    terminal.options.disableStdin = !interactive;
  }
);

function createTerminal() {
  if (!terminalHost.value) {
    return;
  }

  terminal = new Terminal({
    allowTransparency: true,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "block",
    disableStdin: !props.interactive,
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.35,
    scrollback: 4000,
    theme: {
      background: "#0b1118",
      foreground: "#e7eef6",
      cursor: "#f2a65a",
      cursorAccent: "#0b1118",
      selectionBackground: "rgba(242, 166, 90, 0.25)"
    }
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost.value);
  terminal.attachCustomKeyEventHandler(handleTerminalKeyEvent);
  terminal.onData((data) => {
    if (!props.interactive || !props.sessionId) {
      return;
    }

    emit("terminal-data", data);
  });

  terminalHost.value.addEventListener("click", focusTerminal);
  window.addEventListener("resize", handleWindowResize);
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      const nextWidth = getHostWidth();

      if (nextWidth <= 0 || nextWidth === observedHostWidth) {
        return;
      }

      observedHostWidth = nextWidth;
      scheduleFitTerminal();
    });
    observedHostWidth = getHostWidth();
    resizeObserver.observe(terminalHost.value);
  }
}

function fitTerminal() {
  if (!fitAddon) {
    return;
  }

  try {
    fitAddon.fit();
    emitTerminalResize();
  } catch {
    // The container may still be hidden while the tab is not active.
  }
}

function scheduleFitTerminal() {
  if (!fitAddon || fitFrameId) {
    return;
  }

  fitFrameId = window.requestAnimationFrame(() => {
    fitFrameId = 0;
    fitTerminal();
  });
}

function handleWindowResize() {
  scheduleFitTerminal();
}

function focusTerminal() {
  if (props.interactive && terminal) {
    terminal.focus();
  }
}

function handleTerminalKeyEvent(event) {
  if (!props.interactive || !props.sessionId || !terminal) {
    return true;
  }

  if (isCtrlC(event)) {
    if (terminal.hasSelection()) {
      return false;
    }

    if (event.type === "keydown") {
      sendInterruptSignal(event);
    }

    return false;
  }

  if (isInterruptShortcut(event)) {
    if (event.type === "keydown") {
      sendInterruptSignal(event);
    }

    return false;
  }

  return true;
}

function isCtrlC(event) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === "KeyC"
  );
}

function isInterruptShortcut(event) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === "Period"
  );
}

function sendInterruptSignal(event) {
  event.preventDefault();
  event.stopPropagation();
  emit("terminal-data", INTERRUPT_SEQUENCE);
}

function emitTerminalResize() {
  if (!terminal || !props.sessionId) {
    return;
  }

  const cols = Number(terminal.cols || 0);
  const rows = Number(terminal.rows || 0);

  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
    return;
  }

  const nextKey = `${props.sessionId}:${cols}x${rows}`;

  if (nextKey === reportedTerminalSizeKey) {
    return;
  }

  reportedTerminalSizeKey = nextKey;
  emit("terminal-resize", {
    sessionId: props.sessionId,
    cols,
    rows
  });
}

function getHostWidth() {
  return Math.round(terminalHost.value?.getBoundingClientRect().width || 0);
}

function syncOutputs(forceReplay = false) {
  if (!terminal) {
    return;
  }

  const outputs = normalizeOutputs(props.outputs);

  if (forceReplay || renderedSessionId !== props.sessionId) {
    replayOutputs(outputs);
    return;
  }

  if (outputs.length === 0) {
    return;
  }

  const nextOutputs = outputs.filter((output) => output.seq > renderedMaxSeq);

  for (const output of nextOutputs) {
    terminal.write(output.chunk);
    renderedMaxSeq = output.seq;
  }

  if (nextOutputs.length > 0) {
    terminal.scrollToBottom();
  }
}

function replayOutputs(outputs) {
  if (!terminal) {
    return;
  }

  terminal.reset();
  renderedSessionId = props.sessionId;
  renderedMaxSeq = 0;

  for (const output of outputs) {
    terminal.write(output.chunk);
    renderedMaxSeq = output.seq;
  }

  terminal.scrollToBottom();
}

function normalizeOutputs(outputs) {
  return Array.isArray(outputs)
    ? outputs
        .map((item, index) => ({
          seq: Number(item?.seq ?? index),
          chunk: String(item?.chunk || "")
        }))
        .sort((left, right) => left.seq - right.seq)
    : [];
}
</script>

<template>
  <div
    class="terminal-emulator"
    :class="{
      interactive,
      empty: !hasOutputs
    }"
  >
    <div ref="terminalHost" class="terminal-host"></div>
    <div v-if="!hasOutputs" class="terminal-placeholder">
      会话已创建，等待终端输出...
    </div>
  </div>
</template>
