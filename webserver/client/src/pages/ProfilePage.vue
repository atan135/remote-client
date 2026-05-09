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
    :managed-agents="store.managedAgents"
    :admin-auth-codes="store.adminAuthCodes"
    :auth-codes="store.authCodes"
    :selected-agent-id="store.selectedAgentId"
    :password-form="store.passwordForm"
    :user-form="store.userForm"
    :auth-code-form="store.authCodeForm"
    :changing-password="store.changingPassword"
    :creating-user="store.creatingUser"
    :loading-users="store.loadingUsers"
    :loading-managed-agents="store.loadingManagedAgents"
    :loading-admin-auth-codes="store.loadingAdminAuthCodes"
    :loading-auth-codes="store.loadingAuthCodes"
    :auth-codes-error="store.loadErrors.authCodes"
    :users-error="store.loadErrors.users"
    :managed-agents-error="store.loadErrors.managedAgents"
    :admin-auth-codes-error="store.loadErrors.adminAuthCodes"
    :creating-auth-code="store.creatingAuthCode"
    :saving-auth-code-id="store.savingAuthCodeId"
    :deleting-auth-code-id="store.deletingAuthCodeId"
    :updating-user-id="store.updatingUserId"
    :resetting-user-id="store.resettingUserId"
    :approving-user-id="store.approvingUserId"
    :rejecting-user-id="store.rejectingUserId"
    :approving-managed-agent-id="store.approvingManagedAgentId"
    :rejecting-managed-agent-id="store.rejectingManagedAgentId"
    :updating-managed-agent-id="store.updatingManagedAgentId"
    :deleting-admin-auth-code-id="store.deletingAdminAuthCodeId"
    @logout="store.logout"
    @submit-change-password="store.submitChangePassword"
    @create-user="store.createUser"
    @save-user="store.saveUser"
    @approve-user="store.approveUser"
    @reject-user="store.rejectUser"
    @reset-password="store.resetPassword"
    @create-auth-code="store.createAuthCode"
    @save-auth-code="store.saveAuthCode"
    @delete-auth-code="store.deleteAuthCode"
    @save-managed-agent="store.saveManagedAgent"
    @approve-managed-agent="store.approveManagedAgent"
    @reject-managed-agent="store.rejectManagedAgent"
    @admin-delete-auth-code="store.adminDeleteAuthCode"
    @use-selected-agent-id="store.useSelectedAgentIdForAuthCode"
  />
</template>
