<script setup>
import { useRouter } from "vue-router";

import HomeTab from "../components/HomeTab.vue";
import { useConsoleStore } from "../stores/console";

const router = useRouter();
const store = useConsoleStore();

function openTerminal() {
  router.push({
    name: "explore"
  });
}
</script>

<template>
  <HomeTab
    :agents="store.agents"
    :selected-agent-id="store.selectedAgentId"
    :active-agent="store.activeAgent"
    :commands="store.commands"
    :online-agent-count="store.onlineAgentCount"
    :display-name="store.displayName"
    :ws-connected="store.wsState.connected"
    :loading-agents="store.loadingAgents"
    :agents-error="store.loadErrors.agents"
    @select-agent="store.selectedAgentId = $event"
    @go-terminal="openTerminal"
  />
</template>
