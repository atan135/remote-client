<script setup>
import { onBeforeUnmount, onMounted } from "vue";

import AuthScreen from "./components/AuthScreen.vue";
import LoadingScreen from "./components/LoadingScreen.vue";
import AppShell from "./layouts/AppShell.vue";
import { useConsoleStore } from "./stores/console";

const store = useConsoleStore();

onMounted(async () => {
  await store.bootstrap();
});

onBeforeUnmount(() => {
  store.dispose();
});
</script>

<template>
  <div class="app-demo">
    <div class="ambient ambient-left"></div>
    <div class="ambient ambient-right"></div>

    <LoadingScreen v-if="store.bootstrapping" />

    <AuthScreen
      v-else-if="!store.session"
      :auth-mode="store.authMode"
      :allow-public-registration="store.appConfig.allowPublicRegistration"
      :login-form="store.loginForm"
      :register-form="store.registerForm"
      :authenticating="store.authenticating"
      :error-message="store.wsState.error"
      @update:auth-mode="store.authMode = $event"
      @login="store.login"
      @register="store.register"
    />

    <AppShell v-else />
  </div>
</template>
