<script setup>
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
          <p class="eyebrow">Remote Control Console</p>
          <h1>Remote Client</h1>
          <p>{{ currentTab?.description || "统一控制设备、命令与账户安全。" }}</p>
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
            <span class="console-nav-copy">
              <strong>{{ tab.label }}</strong>
              <small>{{ tab.description }}</small>
            </span>
          </button>
        </nav>

        <section class="console-sidebar-stats">
          <button class="console-kpi console-kpi-action" type="button" @click="navigate('home')">
            <span>在线设备</span>
            <strong>{{ store.onlineAgentCount }}</strong>
          </button>
          <button class="console-kpi console-kpi-action" type="button" @click="navigate('tasks')">
            <span>命令记录</span>
            <strong>{{ store.commands.length }}</strong>
          </button>
          <article class="console-kpi">
            <span>当前设备</span>
            <strong>{{ store.selectedAgentId || "--" }}</strong>
          </article>
          <article class="console-kpi">
            <span>待处理任务</span>
            <strong>{{ store.pendingTaskCount || 0 }}</strong>
          </article>
        </section>

        <div class="console-sidebar-footer">
          <span class="console-status-dot" :class="{ online: store.wsState.connected }"></span>
          <div class="console-sidebar-footer-copy">
            <strong>{{ store.displayName || "控制台" }}</strong>
            <small>{{ liveStatusText }}</small>
          </div>
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
