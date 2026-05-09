<script setup>
import TasksTab from "../components/TasksTab.vue";
import { useConsoleStore } from "../stores/console";

const store = useConsoleStore();
</script>

<template>
  <TasksTab
    :commands="store.visibleCommands"
    :agents="store.agents"
    :can-clear-commands="store.canClearCommands"
    :clearing-commands="store.clearingCommands"
    :deleting-command-request-id="store.deletingCommandRequestId || ''"
    :latest-request-id="store.latestVisibleCommandRequestId"
    :timeline-filter-agent-id="store.timelineFilterAgentId"
    :loading-commands="store.loadingCommands"
    :commands-error="store.loadErrors.commands"
    @clear-commands="store.clearCommandRecords"
    @delete-command="store.deleteCommandRecord"
    @update:timeline-filter-agent-id="store.timelineFilterAgentId = $event"
  />
</template>
