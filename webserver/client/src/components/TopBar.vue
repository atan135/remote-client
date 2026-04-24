<script setup>
import { ElAvatar } from "element-plus";

defineProps({
  currentTab: {
    type: Object,
    required: true
  },
  avatarLabel: {
    type: String,
    default: "Q"
  }
});
</script>

<template>
  <header class="topbar">
    <button class="topbar-button" type="button">
      <el-avatar :size="32">{{ avatarLabel }}</el-avatar>
    </button>

    <div class="topbar-center">
      <h1>{{ currentTab.label }}</h1>
    </div>

    <button class="topbar-icon-button" type="button" :aria-label="currentTab.label">
      <span class="topbar-icon">◎</span>
    </button>
  </header>
</template>
