<script setup>
import { ChatDotRound, DataBoard, House, Monitor, Tickets, User, UserFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

import { getRealCaptureState, startRealCapture, stopRealCapture } from "../browser-jietu";
import BottomTabBar from "../components/BottomTabBar.vue";
import TopBar from "../components/TopBar.vue";
import { useConsoleStore } from "../stores/console";

const store = useConsoleStore();
const route = useRoute();
const router = useRouter();

const currentTabKey = computed(() => String(route.meta?.key || "home"));

const currentTab = computed(
  () => store.resolvedTabs.find((item) => item.key === currentTabKey.value) || store.resolvedTabs[0]
);

const activeAgentSummary = computed(
  () => store.activeAgent?.label || store.activeAgent?.agentId || store.selectedAgentId || "未选择设备"
);

const liveStatusText = computed(() =>
  store.wsState.connected ? "实时同步已连接" : "实时同步重连中"
);

const showHeaderMeta = computed(() => currentTabKey.value !== "profile");
const realCaptureState = ref(createRealCaptureStateFallback());
const realCaptureBusy = ref(false);
const showRealCaptureControl = computed(
  () => store.appConfig.canJietu && realCaptureState.value.supported
);
const showHeaderActions = computed(() => showHeaderMeta.value || showRealCaptureControl.value);
const realCaptureButtonText = computed(() => {
  if (realCaptureBusy.value) {
    return "授权中";
  }

  return realCaptureState.value.active ? "停止真实截图" : "启用真实截图";
});
const realCaptureButtonTitle = computed(() =>
  realCaptureState.value.active
    ? "停止当前浏览器真实画面授权"
    : "授权后命令行截图会优先截取当前浏览器真实画面"
);
let realCaptureRefreshTimer = 0;

const navIcons = {
  home: House,
  explore: Monitor,
  chat: ChatDotRound,
  tasks: Tickets,
  users: UserFilled,
  profile: User
};

watch(
  () => [currentTabKey.value, store.isAdmin],
  ([tabKey, isAdmin]) => {
    if (tabKey === "users" && !isAdmin) {
      router.replace({ name: "home" });
    }
  },
  { immediate: true }
);

onMounted(() => {
  refreshRealCaptureState();
  realCaptureRefreshTimer = window.setInterval(refreshRealCaptureState, 2000);
});

onBeforeUnmount(() => {
  if (realCaptureRefreshTimer) {
    window.clearInterval(realCaptureRefreshTimer);
    realCaptureRefreshTimer = 0;
  }
});

function navigate(tabKey) {
  const target = store.resolvedTabs.find((item) => item.key === tabKey);

  if (!target?.to) {
    return;
  }

  router.push(target.to);
}

async function toggleRealCapture() {
  if (realCaptureBusy.value) {
    return;
  }

  realCaptureBusy.value = true;

  try {
    if (realCaptureState.value.active) {
      stopRealCapture();
      refreshRealCaptureState();
      ElMessage.success("真实截图已停止");
      return;
    }

    realCaptureState.value = await startRealCapture();
    ElMessage.success("真实截图已启用");
  } catch (error) {
    refreshRealCaptureState();
    ElMessage.error(error?.message || "真实截图授权失败");
  } finally {
    realCaptureBusy.value = false;
  }
}

function refreshRealCaptureState() {
  if (typeof window === "undefined") {
    return;
  }

  realCaptureState.value = getRealCaptureState();
}

function createRealCaptureStateFallback() {
  return {
    supported: false,
    active: false,
    trackState: "",
    label: "",
    width: 0,
    height: 0
  };
}
</script>

<template>
  <div class="app-shell">
    <aside class="console-sidebar">
      <div class="console-sidebar-panel">
        <div class="console-brand">
          <div class="console-brand-mark">RC</div>
          <div class="console-brand-copy">
            <h1>Remote Client</h1>
            <span>Remote Console</span>
          </div>
        </div>

        <nav class="console-nav" aria-label="主导航">
          <button
            v-for="tab in store.resolvedTabs"
            :key="tab.key"
            class="console-nav-item"
            :class="{ active: currentTabKey === tab.key }"
            type="button"
            @click="navigate(tab.key)"
          >
            <span class="console-nav-icon">
              <component :is="navIcons[tab.key] || DataBoard" />
            </span>
            <span class="console-nav-copy">
              <strong>{{ tab.label }}</strong>
            </span>
          </button>
        </nav>

        <div class="console-sidebar-footer">
          <span class="console-status-dot" :class="{ online: store.wsState.connected }"></span>
          <span class="console-sidebar-status-text">{{ liveStatusText }}</span>
        </div>
      </div>
    </aside>

    <section class="console-main">
      <TopBar class="console-mobile-topbar" :current-tab="currentTab" :avatar-label="store.avatarLabel">
        <template #actions>
          <button
            v-if="showRealCaptureControl"
            class="topbar-icon-button topbar-jietu-button"
            :class="{ active: realCaptureState.active }"
            type="button"
            :disabled="realCaptureBusy"
            :title="realCaptureButtonTitle"
            aria-label="真实截图授权"
            @click="toggleRealCapture"
          >
            <Monitor />
          </button>
          <button v-else class="topbar-icon-button" type="button" :aria-label="currentTab.label">
            <span class="topbar-icon">◎</span>
          </button>
        </template>
      </TopBar>

      <header class="console-header">
        <div class="console-header-copy">
          <h1>{{ currentTab?.label || "控制台" }}</h1>
          <p>{{ currentTab?.description }}</p>
        </div>

        <div v-if="showHeaderActions" class="console-header-meta">
          <div v-if="showHeaderMeta" class="console-chip">
            <span>当前设备</span>
            <strong>{{ activeAgentSummary }}</strong>
          </div>
          <div v-if="showHeaderMeta" class="console-chip">
            <span>在线设备</span>
            <strong>{{ store.onlineAgentCount }} / {{ store.agents.length }}</strong>
          </div>
          <button
            v-if="showRealCaptureControl"
            class="console-jietu-button"
            :class="{ active: realCaptureState.active }"
            type="button"
            :disabled="realCaptureBusy"
            :title="realCaptureButtonTitle"
            @click="toggleRealCapture"
          >
            <span class="console-jietu-icon">
              <Monitor />
            </span>
            <span>{{ realCaptureButtonText }}</span>
          </button>
        </div>
      </header>

      <div
        v-if="store.wsState.error"
        class="console-status-banner"
        :class="{ online: store.wsState.connected }"
      >
        <span class="console-status-indicator" :class="{ online: store.wsState.connected }"></span>
        <div>
          <strong>{{ store.wsState.connected ? "链路提示" : "实时链路异常" }}</strong>
          <p>{{ store.wsState.error }}</p>
        </div>
      </div>

      <main class="content console-content">
        <RouterView />
      </main>
    </section>

    <BottomTabBar
      class="console-mobile-nav"
      :tabs="store.resolvedTabs"
      :active-tab="currentTabKey"
      @update:active-tab="navigate"
    />
  </div>
</template>
