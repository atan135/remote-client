<script setup>
import TasksTab from "../components/TasksTab.vue";
import { useConsoleStore } from "../stores/console";

const store = useConsoleStore();
</script>

<template>
  <TasksTab
    :commands="store.visibleCommands"
    :agents="store.agents"
    :latest-request-id="store.latestVisibleCommandRequestId"
    :timeline-filter-agent-id="store.timelineFilterAgentId"
    @update:timeline-filter-agent-id="store.timelineFilterAgentId = $event"
  />
</template>
