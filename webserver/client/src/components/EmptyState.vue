<script setup>
import { computed } from "vue";
import { Box, CircleClose, Loading, Warning } from "@element-plus/icons-vue";
import { ElIcon } from "element-plus";

const props = defineProps({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ""
  },
  variant: {
    type: String,
    default: "empty"
  },
  compact: {
    type: Boolean,
    default: false
  }
});

const iconComponent = computed(() => {
  if (props.variant === "loading") {
    return Loading;
  }

  if (props.variant === "error") {
    return CircleClose;
  }

  if (props.variant === "warning") {
    return Warning;
  }

  return Box;
});

const stateRole = computed(() => (props.variant === "error" ? "alert" : "status"));
const liveMode = computed(() => (props.variant === "error" ? "assertive" : "polite"));
</script>

<template>
  <div
    class="empty-state"
    :class="[`empty-state-${variant}`, { compact }]"
    :role="stateRole"
    :aria-live="liveMode"
  >
    <el-icon class="empty-state-icon" :class="{ 'is-loading': variant === 'loading' }">
      <component :is="iconComponent" />
    </el-icon>
    <div class="empty-state-copy">
      <strong>{{ title }}</strong>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="empty-state-actions">
      <slot />
    </div>
  </div>
</template>
