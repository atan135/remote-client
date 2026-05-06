<script setup>
import ChatTab from "../components/ChatTab.vue";
import { useConsoleStore } from "../stores/console";

const store = useConsoleStore();
</script>

<template>
  <ChatTab
    :agents="store.agents"
    :selected-agent-id="store.selectedAgentId"
    :active-agent="store.activeAgent"
    :active-auth-code-binding="store.activeAuthCodeBinding"
    :commands="store.commands"
    :submitting="store.submitting"
    :command-shell="store.commandShell"
    :command-shell-options="store.commandShellOptions"
    :command-submitter="store.submitCommand"
    :ws-connected="store.wsState.connected"
    :ws-error="store.wsState.error"
    @update:selected-agent-id="store.selectedAgentId = $event"
    @update:command-shell="store.commandShell = $event"
  />
</template>
