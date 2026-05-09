<script setup>
import { ElCard } from "element-plus";
import EmptyState from "./EmptyState.vue";
</script>

<template>
  <main class="center-shell">
    <el-card class="surface-card auth-card" shadow="never">
      <EmptyState
        variant="loading"
        title="正在检查登录状态"
        description="系统正在连接服务端并恢复当前会话。"
      />
    </el-card>
  </main>
</template>
