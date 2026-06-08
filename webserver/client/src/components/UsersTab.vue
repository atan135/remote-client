<script setup>
import {
  ElButton,
  ElCard,
  ElDialog,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag
} from "element-plus";
import { Check, Close, EditPen, Key, Plus } from "@element-plus/icons-vue";
import { computed, ref } from "vue";
import EmptyState from "./EmptyState.vue";

const props = defineProps({
  session: {
    type: Object,
    required: true
  },
  users: {
    type: Array,
    required: true
  },
  userForm: {
    type: Object,
    required: true
  },
  creatingUser: {
    type: Boolean,
    required: true
  },
  loadingUsers: {
    type: Boolean,
    required: true
  },
  usersError: {
    type: String,
    default: ""
  },
  updatingUserId: {
    type: [Number, String, null],
    default: null
  },
  resettingUserId: {
    type: [Number, String, null],
    default: null
  },
  approvingUserId: {
    type: [Number, String, null],
    default: null
  },
  rejectingUserId: {
    type: [Number, String, null],
    default: null
  }
});

const emit = defineEmits([
  "createUser",
  "saveUser",
  "approveUser",
  "rejectUser",
  "resetPassword"
]);

const createDialogVisible = ref(false);
const userDialogVisible = ref(false);
const activeUser = ref(null);

const userStats = computed(() => [
  {
    label: "全部用户",
    value: props.users.length
  },
  {
    label: "待审核",
    value: props.users.filter((user) => user.approvalStatus === "pending").length
  },
  {
    label: "管理员",
    value: props.users.filter((user) => user.role === "admin").length
  },
  {
    label: "已停用",
    value: props.users.filter((user) => !user.isActive).length
  }
]);

const canCreateUser = computed(
  () =>
    props.userForm.username.trim() &&
    props.userForm.displayName.trim() &&
    props.userForm.password.length >= 8 &&
    !props.creatingUser
);

function openCreateDialog() {
  createDialogVisible.value = true;
}

function submitCreateUser() {
  if (!canCreateUser.value) {
    return;
  }

  emit("createUser");
  createDialogVisible.value = false;
}

function openUserDialog(user) {
  activeUser.value = user;
  userDialogVisible.value = true;
}

function closeUserDialog() {
  userDialogVisible.value = false;
  activeUser.value = null;
}

function submitSaveUser() {
  if (!activeUser.value) {
    return;
  }

  emit("saveUser", activeUser.value);
}

function submitApproveUser(user) {
  emit("approveUser", user);
}

function submitRejectUser(user) {
  emit("rejectUser", user);
}

function submitResetPassword(user) {
  emit("resetPassword", user);
}

function approvalStatusType(status) {
  if (status === "approved") {
    return "success";
  }

  if (status === "pending") {
    return "warning";
  }

  return "danger";
}

function roleTagType(role) {
  return role === "admin" ? "warning" : role === "viewer" ? "info" : "primary";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
</script>

<template>
  <section class="page users-page">
    <div class="users-summary-grid">
      <el-card v-for="item in userStats" :key="item.label" class="surface-card metric-card users-metric-card" shadow="never">
        <div class="metric-card-top">
          <span>{{ item.label }}</span>
        </div>
        <strong>{{ item.value }}</strong>
      </el-card>
    </div>

    <el-card class="surface-card info-card users-table-card" shadow="never">
      <div class="users-toolbar">
        <div>
          <p class="eyebrow">Admin</p>
          <h3>用户管理</h3>
          <p>创建账号，维护角色、审核状态和密码。</p>
        </div>

        <el-button type="primary" round :icon="Plus" @click="openCreateDialog">
          创建用户
        </el-button>
      </div>

      <div v-if="usersError" class="users-error-banner">
        {{ usersError }}
      </div>

      <el-table
        v-if="users.length"
        :data="users"
        class="users-table"
        row-key="id"
      >
        <el-table-column label="账号" min-width="210">
          <template #default="{ row }">
            <div class="users-account-cell">
              <strong>{{ row.displayName || row.username }}</strong>
              <span>{{ row.username }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.role)" effect="plain" round>
              {{ row.role }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="审核" width="120">
          <template #default="{ row }">
            <el-tag :type="approvalStatusType(row.approvalStatus)" effect="dark" round>
              {{ row.approvalStatus }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'danger'" effect="plain" round>
              {{ row.isActive ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="备注" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="users-note-cell">{{ row.reviewComment || row.applicationNote || "-" }}</span>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">
            <span class="users-date-cell">{{ formatDateTime(row.createdAt) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="310" fixed="right">
          <template #default="{ row }">
            <div class="users-row-actions">
              <el-button size="small" round :icon="EditPen" @click="openUserDialog(row)">
                编辑
              </el-button>
              <el-button
                size="small"
                round
                :icon="Key"
                :disabled="resettingUserId === row.id"
                @click="submitResetPassword(row)"
              >
                {{ resettingUserId === row.id ? "提交中" : "重置" }}
              </el-button>
              <el-button
                v-if="row.approvalStatus !== 'approved'"
                size="small"
                type="primary"
                plain
                round
                :icon="Check"
                :disabled="approvingUserId === row.id"
                @click="submitApproveUser(row)"
              >
                通过
              </el-button>
              <el-button
                v-if="row.approvalStatus !== 'rejected' && row.id !== session.user.id"
                size="small"
                type="danger"
                plain
                round
                :icon="Close"
                :disabled="rejectingUserId === row.id"
                @click="submitRejectUser(row)"
              >
                拒绝
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState
        v-else-if="loadingUsers"
        compact
        variant="loading"
        title="正在加载用户"
        description="正在同步用户列表。"
      />
      <EmptyState
        v-else-if="usersError"
        compact
        variant="error"
        title="用户列表加载失败"
        :description="usersError"
      />
      <EmptyState
        v-else
        compact
        title="暂无用户"
        description="创建用户后，账号会显示在这里。"
      />
    </el-card>

    <el-dialog
      v-model="createDialogVisible"
      append-to-body
      class="users-dialog"
      title="创建用户"
      width="min(560px, 92vw)"
    >
      <div class="users-dialog-form">
        <label class="field-block">
          <span>用户名</span>
          <el-input v-model="userForm.username" placeholder="新用户名" />
        </label>

        <label class="field-block">
          <span>显示名</span>
          <el-input v-model="userForm.displayName" placeholder="显示名" />
        </label>

        <label class="field-block">
          <span>初始密码</span>
          <el-input v-model="userForm.password" show-password placeholder="至少 8 位" />
        </label>

        <label class="field-block">
          <span>角色</span>
          <el-select v-model="userForm.role">
            <el-option label="admin" value="admin" />
            <el-option label="operator" value="operator" />
            <el-option label="viewer" value="viewer" />
          </el-select>
        </label>

        <div class="switch-row users-dialog-switch">
          <span>创建后启用</span>
          <el-switch v-model="userForm.isActive" />
        </div>
      </div>

      <template #footer>
        <div class="users-dialog-footer">
          <el-button round @click="createDialogVisible = false">取消</el-button>
          <el-button type="primary" round :disabled="!canCreateUser" @click="submitCreateUser">
            {{ creatingUser ? "创建中..." : "创建用户" }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="userDialogVisible"
      append-to-body
      class="users-dialog"
      title="编辑用户"
      width="min(640px, 92vw)"
      @closed="closeUserDialog"
    >
      <div v-if="activeUser" class="users-dialog-form">
        <div class="users-dialog-identity">
          <div>
            <strong>{{ activeUser.displayName || activeUser.username }}</strong>
            <span>{{ activeUser.username }}</span>
          </div>
          <el-tag :type="approvalStatusType(activeUser.approvalStatus)" effect="dark" round>
            {{ activeUser.approvalStatus }}
          </el-tag>
        </div>

        <div class="users-form-grid">
          <label class="field-block">
            <span>显示名</span>
            <el-input v-model="activeUser.displayName" />
          </label>

          <label class="field-block">
            <span>角色</span>
            <el-select v-model="activeUser.role">
              <el-option label="admin" value="admin" />
              <el-option label="operator" value="operator" />
              <el-option label="viewer" value="viewer" />
            </el-select>
          </label>
        </div>

        <div class="switch-row users-dialog-switch">
          <span>启用用户</span>
          <el-switch v-model="activeUser.isActive" />
        </div>

        <label class="field-block">
          <span>申请备注</span>
          <el-input v-model="activeUser.applicationNote" disabled />
        </label>

        <label class="field-block">
          <span>审核备注</span>
          <el-input v-model="activeUser.reviewComment" type="textarea" :rows="3" />
        </label>
      </div>

      <template #footer>
        <div class="users-dialog-footer">
          <el-button round @click="userDialogVisible = false">取消</el-button>
          <el-button
            v-if="activeUser"
            round
            :icon="Key"
            :disabled="resettingUserId === activeUser.id"
            @click="submitResetPassword(activeUser)"
          >
            重置密码
          </el-button>
          <el-button
            v-if="activeUser?.approvalStatus !== 'approved'"
            type="primary"
            plain
            round
            :disabled="approvingUserId === activeUser.id"
            @click="submitApproveUser(activeUser)"
          >
            通过审核
          </el-button>
          <el-button
            v-if="activeUser && activeUser.approvalStatus !== 'rejected' && activeUser.id !== session.user.id"
            type="danger"
            plain
            round
            :disabled="rejectingUserId === activeUser.id"
            @click="submitRejectUser(activeUser)"
          >
            拒绝
          </el-button>
          <el-button
            v-if="activeUser"
            type="primary"
            round
            :disabled="updatingUserId === activeUser.id"
            @click="submitSaveUser"
          >
            {{ updatingUserId === activeUser.id ? "保存中..." : "保存" }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>
