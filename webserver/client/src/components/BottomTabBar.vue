<script setup>
defineProps({
  tabs: {
    type: Array,
    required: true
  },
  activeTab: {
    type: String,
    required: true
  }
});

const emit = defineEmits(["update:activeTab"]);

function selectTab(tabKey) {
  emit("update:activeTab", tabKey);
}
</script>

<template>
  <nav class="bottom-tabbar" aria-label="底部标签栏">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="tab-item"
      :class="{ active: activeTab === tab.key }"
      type="button"
      @click="selectTab(tab.key)"
    >
      <span class="tab-item-label">{{ tab.label }}</span>
    </button>
  </nav>
</template>
