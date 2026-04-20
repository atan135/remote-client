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

const emit = defineEmits(["terminal-data"]);

const terminalHost = ref(null);

const hasOutputs = computed(() => Array.isArray(props.outputs) && props.outputs.length > 0);

let terminal = null;
let fitAddon = null;
let fitFrameId = 0;
let renderedSessionId = "";
let renderedSeqs = new Set();
let resizeObserver = null;
let observedHostWidth = 0;

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
  window.removeEventListener("resize", handleWindowResize);
  terminalHost.value?.removeEventListener("click", focusTerminal);
  terminal?.dispose();
  terminal = null;
  fitAddon = null;
  renderedSeqs = new Set();
});

watch(
  () => props.sessionId,
  async () => {
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
      const nextWidth = Math.round(terminalHost.value?.getBoundingClientRect().width || 0);

      if (nextWidth <= 0 || nextWidth === observedHostWidth) {
        return;
      }

      observedHostWidth = nextWidth;
      scheduleFitTerminal();
    });
    observedHostWidth = Math.round(terminalHost.value.getBoundingClientRect().width || 0);
    resizeObserver.observe(terminalHost.value);
  }
}

function fitTerminal() {
  if (!fitAddon) {
    return;
  }

  try {
    fitAddon.fit();
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

function syncOutputs(forceReplay = false) {
  if (!terminal) {
    return;
  }

  const outputs = normalizeOutputs(props.outputs);

  if (forceReplay || renderedSessionId !== props.sessionId) {
    replayOutputs(outputs);
    return;
  }

  if (outputs.length < renderedSeqs.size) {
    replayOutputs(outputs);
    return;
  }

  const availableSeqs = new Set(outputs.map((item) => item.seq));

  for (const seq of renderedSeqs) {
    if (!availableSeqs.has(seq)) {
      replayOutputs(outputs);
      return;
    }
  }

  for (const output of outputs) {
    if (renderedSeqs.has(output.seq)) {
      continue;
    }

    terminal.write(output.chunk);
    renderedSeqs.add(output.seq);
  }

  terminal.scrollToBottom();
}

function replayOutputs(outputs) {
  if (!terminal) {
    return;
  }

  terminal.reset();
  renderedSessionId = props.sessionId;
  renderedSeqs = new Set();

  for (const output of outputs) {
    terminal.write(output.chunk);
    renderedSeqs.add(output.seq);
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
