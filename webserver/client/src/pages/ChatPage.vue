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
    :available-terminal-profiles="store.availableTerminalProfiles"
    :terminal-sessions="store.visibleTerminalSessions"
    :creating-terminal-session="store.creatingTerminalSession"
    :sending-terminal-input="store.sendingTerminalInput"
    :reading-remote-file="store.readingRemoteFile"
    :terminal-session-creator="store.createTerminalSession"
    :terminal-input-sender="store.sendTerminalInput"
    :terminal-session-terminator="store.terminateTerminalSession"
    :remote-file-opener="store.openRemoteFile"
    :ws-connected="store.wsState.connected"
    :ws-error="store.wsState.error"
    @update:selected-agent-id="store.selectedAgentId = $event"
    @update:command-shell="store.commandShell = $event"
  />
</template>
