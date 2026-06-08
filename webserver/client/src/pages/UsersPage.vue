<script setup>
import UsersTab from "../components/UsersTab.vue";
import { useConsoleStore } from "../stores/console";

const store = useConsoleStore();
</script>

<template>
  <UsersTab
    :session="store.session"
    :users="store.users"
    :user-form="store.userForm"
    :creating-user="store.creatingUser"
    :loading-users="store.loadingUsers"
    :users-error="store.loadErrors.users"
    :updating-user-id="store.updatingUserId"
    :resetting-user-id="store.resettingUserId"
    :approving-user-id="store.approvingUserId"
    :rejecting-user-id="store.rejectingUserId"
    @create-user="store.createUser"
    @save-user="store.saveUser"
    @approve-user="store.approveUser"
    @reject-user="store.rejectUser"
    @reset-password="store.resetPassword"
  />
</template>
