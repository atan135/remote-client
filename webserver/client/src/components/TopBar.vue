<script setup>
import { ElAvatar, ElBadge } from "element-plus";

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

    <el-badge :hidden="!currentTab.badge" :value="currentTab.badge" class="topbar-badge">
      <button class="topbar-icon-button" type="button" :aria-label="currentTab.action">
        <span class="topbar-icon">◎</span>
      </button>
    </el-badge>
  </header>
</template>
