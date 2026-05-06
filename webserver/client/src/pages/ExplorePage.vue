<script setup>
import { useRouter } from "vue-router";

import ExploreTab from "../components/ExploreTab.vue";
import { useConsoleStore } from "../stores/console";

const router = useRouter();
const store = useConsoleStore();

async function handleSubmitCommand(commandOverride) {
  const didSubmit = await store.submitCommand(commandOverride);

  if (!didSubmit) {
    return;
  }

  router.push({
    name: "tasks"
  });
}
</script>

<template>
  <ExploreTab
    :agents="store.agents"
    :selected-agent-id="store.selectedAgentId"
    :active-agent="store.activeAgent"
    :active-auth-code-binding="store.activeAuthCodeBinding"
    :command-input="store.commandInput"
    :command-shell="store.commandShell"
    :command-shell-options="store.commandShellOptions"
    :terminal-profile="store.terminalProfile"
    :terminal-cwd="store.terminalCwd"
    :terminal-input="store.terminalInput"
    :remote-file-path="store.remoteFilePath"
    :remote-file-viewer="store.remoteFileViewer"
    :remote-file-error="store.remoteFileError"
    :available-terminal-profiles="store.availableTerminalProfiles"
    :terminal-sessions="store.visibleTerminalSessions"
    :active-terminal-session="store.activeTerminalSession"
    :auto-open-terminal-session-id="store.autoOpenTerminalSessionId"
    :can-submit-command="store.canSubmitCommand"
    :can-create-terminal-session="store.canCreateTerminalSession"
    :can-send-terminal-input="store.canSendTerminalInput"
    :can-terminate-terminal-session="store.canTerminateTerminalSession"
    :submitting="store.submitting"
    :creating-terminal-session="store.creatingTerminalSession"
    :sending-terminal-input="store.sendingTerminalInput"
    :reading-remote-file="store.readingRemoteFile"
    :terminating-terminal-session-id="store.terminatingTerminalSessionId || ''"
    :deleting-terminal-session-id="store.deletingTerminalSessionId || ''"
    @update:selected-agent-id="store.selectedAgentId = $event"
    @update:command-input="store.commandInput = $event"
    @update:command-shell="store.commandShell = $event"
    @update:terminal-profile="store.terminalProfile = $event"
    @update:terminal-cwd="store.terminalCwd = $event"
    @update:terminal-input="store.terminalInput = $event"
    @update:remote-file-path="store.updateRemoteFilePath"
    @select:terminal-session="store.selectedTerminalSessionId = $event"
    @opened-terminal-session="store.clearAutoOpenTerminalSession($event)"
    @submit-command="handleSubmitCommand"
    @create-terminal-session="store.createTerminalSession"
    @send-terminal-input="store.sendTerminalInput"
    @interrupt-terminal-session="store.interruptTerminalSession"
    @send-terminal-raw-input="store.queueTerminalRawInput($event)"
    @open-remote-file="store.openRemoteFile"
    @resize-terminal-session="store.queueTerminalResize($event)"
    @terminate-terminal-session="store.terminateTerminalSession"
    @delete-terminal-session="store.deleteTerminalSession"
  />
</template>
