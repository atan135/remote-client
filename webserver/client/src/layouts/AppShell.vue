<script setup>
import { ChatDotRound, DataBoard, House, Monitor, Tickets, User } from "@element-plus/icons-vue";
import { computed } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

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

const navIcons = {
  home: House,
  explore: Monitor,
  chat: ChatDotRound,
  tasks: Tickets,
  profile: User
};

function navigate(tabKey) {
  const target = store.resolvedTabs.find((item) => item.key === tabKey);

  if (!target?.to) {
    return;
  }

  router.push(target.to);
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
      <TopBar class="console-mobile-topbar" :current-tab="currentTab" :avatar-label="store.avatarLabel" />

      <header class="console-header">
        <div class="console-header-copy">
          <h1>{{ currentTab?.label || "控制台" }}</h1>
          <p>{{ currentTab?.description }}</p>
        </div>

        <div v-if="showHeaderMeta" class="console-header-meta">
          <div class="console-chip">
            <span>当前设备</span>
            <strong>{{ activeAgentSummary }}</strong>
          </div>
          <div class="console-chip">
            <span>在线设备</span>
            <strong>{{ store.onlineAgentCount }} / {{ store.agents.length }}</strong>
          </div>
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
