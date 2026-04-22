<script setup>
import ProfileTab from "../components/ProfileTab.vue";
import { useConsoleStore } from "../stores/console";

const store = useConsoleStore();
</script>

<template>
  <ProfileTab
    :session="store.session"
    :display-name="store.displayName"
    :is-admin="store.isAdmin"
    :users="store.users"
    :auth-codes="store.authCodes"
    :selected-agent-id="store.selectedAgentId"
    :password-form="store.passwordForm"
    :user-form="store.userForm"
    :auth-code-form="store.authCodeForm"
    :changing-password="store.changingPassword"
    :creating-user="store.creatingUser"
    :loading-users="store.loadingUsers"
    :loading-auth-codes="store.loadingAuthCodes"
    :creating-auth-code="store.creatingAuthCode"
    :saving-auth-code-id="store.savingAuthCodeId"
    :deleting-auth-code-id="store.deletingAuthCodeId"
    :updating-user-id="store.updatingUserId"
    :resetting-user-id="store.resettingUserId"
    @logout="store.logout"
    @submit-change-password="store.submitChangePassword"
    @create-user="store.createUser"
    @save-user="store.saveUser"
    @reset-password="store.resetPassword"
    @create-auth-code="store.createAuthCode"
    @save-auth-code="store.saveAuthCode"
    @delete-auth-code="store.deleteAuthCode"
    @use-selected-agent-id="store.useSelectedAgentIdForAuthCode"
  />
</template>
