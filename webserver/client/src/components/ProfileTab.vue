<script setup>
import { ElAvatar, ElButton, ElCard, ElDialog, ElInput, ElOption, ElSelect, ElSwitch, ElTag } from "element-plus";
import { computed, ref } from "vue";
import EmptyState from "./EmptyState.vue";

const props = defineProps({
  session: {
    type: Object,
    required: true
  },
  displayName: {
    type: String,
    required: true
  },
  isAdmin: {
    type: Boolean,
    required: true
  },
  users: {
    type: Array,
    required: true
  },
  managedAgents: {
    type: Array,
    required: true
  },
  adminAuthCodes: {
    type: Array,
    required: true
  },
  authCodes: {
    type: Array,
    required: true
  },
  selectedAgentId: {
    type: String,
    required: true
  },
  passwordForm: {
    type: Object,
    required: true
  },
  userForm: {
    type: Object,
    required: true
  },
  authCodeForm: {
    type: Object,
    required: true
  },
  changingPassword: {
    type: Boolean,
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
  loadingManagedAgents: {
    type: Boolean,
    required: true
  },
  loadingAdminAuthCodes: {
    type: Boolean,
    required: true
  },
  loadingAuthCodes: {
    type: Boolean,
    required: true
  },
  authCodesError: {
    type: String,
    default: ""
  },
  usersError: {
    type: String,
    default: ""
  },
  managedAgentsError: {
    type: String,
    default: ""
  },
  adminAuthCodesError: {
    type: String,
    default: ""
  },
  creatingAuthCode: {
    type: Boolean,
    required: true
  },
  savingAuthCodeId: {
    type: [Number, String, null],
    default: null
  },
  deletingAuthCodeId: {
    type: [Number, String, null],
    default: null
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
  },
  approvingManagedAgentId: {
    type: [Number, String, null],
    default: null
  },
  rejectingManagedAgentId: {
    type: [Number, String, null],
    default: null
  },
  updatingManagedAgentId: {
    type: [Number, String, null],
    default: null
  },
  deletingAdminAuthCodeId: {
    type: [Number, String, null],
    default: null
  }
});

const emit = defineEmits([
  "logout",
  "submitChangePassword",
  "createUser",
  "saveUser",
  "approveUser",
  "rejectUser",
  "resetPassword",
  "createAuthCode",
  "saveAuthCode",
  "deleteAuthCode",
  "saveManagedAgent",
  "approveManagedAgent",
  "rejectManagedAgent",
  "adminDeleteAuthCode",
  "useSelectedAgentId"
]);

const profileView = ref("menu");

const profileEntries = [
  {
    key: "identity",
    group: "账号信息",
    title: "个人资料",
    description: "查看登录账号、角色和授权设备"
  },
  {
    key: "password",
    group: "账户安全",
    title: "修改密码",
    description: "更新当前登录账号的密码"
  },
  {
    key: "bind",
    group: "设备授权",
    title: "绑定设备公钥",
    description: "为指定设备新增 auth-code 公钥"
  },
  {
    key: "manage",
    group: "设备授权",
    title: "设备授权管理",
    description: "维护 auth-code 绑定记录"
  }
];

const profileEntryGroups = computed(() => {
  const groups = [];

  for (const entry of profileEntries) {
    const group = groups.find((item) => item.title === entry.group);

    if (group) {
      group.items.push(entry);
      continue;
    }

    groups.push({
      title: entry.group,
      items: [entry]
    });
  }

  return groups;
});

const currentEntry = computed(
  () => profileEntries.find((item) => item.key === profileView.value) || null
);

const profileMetaRows = computed(() => [
  {
    label: "登录账号",
    value: props.session.user.username
  },
  {
    label: "当前角色",
    value: props.session.user.role
  },
  {
    label: "授权设备",
    value: `${props.authCodes.length} 个`
  },
  {
    label: "账号权限",
    value: props.isAdmin ? "管理员" : "个人账号"
  }
]);

const profilePanelVisible = computed({
  get: () => profileView.value !== "menu",
  set: (visible) => {
    if (!visible) {
      backToMenu();
    }
  }
});

function openView(viewKey) {
  profileView.value = viewKey;
}

function backToMenu() {
  profileView.value = "menu";
}
</script>

<template>
  <section class="page profile-page">
    <div class="profile-layout">
      <div class="profile-main">
        <el-card class="surface-card info-card profile-settings-card" shadow="never">
          <div class="profile-summary-strip">
            <el-avatar :size="44">{{ displayName.slice(0, 1) || "Q" }}</el-avatar>
            <div class="profile-summary-copy">
              <strong>{{ displayName }}</strong>
              <span>{{ session.user.username }} / {{ session.user.role }}</span>
            </div>
          </div>

          <div class="profile-section-title">
            <div>
              <h3>账户与授权</h3>
            </div>
          </div>

          <div class="profile-settings-groups">
            <section v-for="group in profileEntryGroups" :key="group.title" class="profile-settings-group">
              <div class="profile-settings-group-head">
                <h4>{{ group.title }}</h4>
              </div>

              <div class="profile-settings-list">
                <button
                  v-for="entry in group.items"
                  :key="entry.key"
                  class="profile-settings-item"
                  type="button"
                  @click="openView(entry.key)"
                >
                  <span class="profile-settings-marker" aria-hidden="true"></span>
                  <span class="profile-settings-copy">
                    <strong>{{ entry.title }}</strong>
                  </span>
                  <span class="profile-settings-arrow">›</span>
                </button>
              </div>
            </section>
          </div>
        </el-card>
      </div>
    </div>

    <el-dialog
      v-model="profilePanelVisible"
      append-to-body
      class="profile-panel-dialog"
      destroy-on-close
      :lock-scroll="false"
      top="5vh"
      width="min(960px, 92vw)"
    >
      <template #header>
        <div class="profile-panel-head">
          <strong>{{ currentEntry?.title || "账户设置" }}</strong>
          <small>{{ currentEntry?.description }}</small>
        </div>
      </template>

      <div class="profile-panel-content">
        <div v-if="profileView === 'identity'" class="profile-panel-section profile-identity-panel">
          <div class="profile-panel-identity">
            <el-avatar :size="68">{{ displayName.slice(0, 1) || "Q" }}</el-avatar>
            <div>
              <p class="eyebrow">个人资料</p>
              <h3>{{ displayName }}</h3>
              <p class="muted">{{ session.user.username }} / {{ session.user.role }}</p>
            </div>
          </div>

          <div class="profile-identity-tags">
            <el-tag round effect="plain">{{ session.user.role }}</el-tag>
            <el-tag round effect="plain">{{ authCodes.length }} 个授权设备</el-tag>
          </div>

          <div class="profile-meta-list">
            <div v-for="row in profileMetaRows" :key="row.label" class="profile-meta-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>

          <div class="hero-actions profile-panel-actions profile-logout-actions">
            <el-button plain @click="emit('logout')">退出登录</el-button>
          </div>
        </div>

        <div v-else-if="profileView === 'password'" class="profile-panel-section">
          <div class="card-head card-head-tight">
            <div>
              <p class="eyebrow">Password</p>
              <h3>修改密码</h3>
              <p>更新当前登录账号的密码。</p>
            </div>
          </div>

          <label class="field-block">
            <span>当前密码</span>
            <el-input v-model="passwordForm.currentPassword" show-password placeholder="输入当前密码" />
          </label>

          <label class="field-block">
            <span>新密码</span>
            <el-input v-model="passwordForm.newPassword" show-password placeholder="至少 8 位" />
          </label>

          <div class="hero-actions profile-panel-actions">
            <el-button type="primary" round :disabled="changingPassword" @click="emit('submitChangePassword')">
              {{ changingPassword ? "提交中..." : "修改密码" }}
            </el-button>
          </div>
        </div>

        <div v-else-if="profileView === 'bind'" class="profile-panel-section">
          <div class="card-head card-head-tight">
            <div>
              <p class="eyebrow">Bind Key</p>
              <h3>绑定设备公钥</h3>
              <p>为指定设备新增一个 auth-code 公钥绑定。</p>
            </div>
            <el-tag round effect="plain">当前设备：{{ selectedAgentId || "未选择" }}</el-tag>
          </div>

          <div class="hero-actions profile-panel-actions">
            <el-button round @click="emit('useSelectedAgentId')">使用当前设备 ID</el-button>
          </div>

          <label class="field-block">
            <span>设备 ID</span>
            <el-input v-model="authCodeForm.agentId" placeholder="例如 office-pc-01" />
          </label>

          <label class="field-block">
            <span>备注</span>
            <el-input v-model="authCodeForm.remark" placeholder="例如 办公室电脑" />
          </label>

          <label class="field-block">
            <span>RSA 公钥 PEM</span>
            <el-input v-model="authCodeForm.authCode" type="textarea" :rows="6" placeholder="粘贴公钥内容" />
          </label>

          <div class="hero-actions profile-panel-actions">
            <el-button type="primary" round :disabled="creatingAuthCode" @click="emit('createAuthCode')">
              {{ creatingAuthCode ? "创建中..." : "新增 auth_code" }}
            </el-button>
          </div>
        </div>

        <div v-else class="profile-panel-section">
          <div class="card-head card-head-tight">
            <div>
              <p class="eyebrow">Manage Auth Codes</p>
              <h3>设备授权管理</h3>
              <p>维护已有设备的公钥绑定记录。</p>
            </div>
            <el-tag round effect="plain">{{ authCodes.length }}</el-tag>
          </div>

          <div class="stack-grid compact-stack">
            <el-card v-for="item in authCodes" :key="item.id" class="surface-card nested-card" shadow="never">
              <div class="card-head card-head-tight">
                <div>
                  <h3>{{ item.agentId }}</h3>
                  <p>{{ item.updatedAt || item.createdAt }}</p>
                </div>
                <el-tag round effect="plain">{{ item.id }}</el-tag>
              </div>

              <label class="field-block">
                <span>设备 ID</span>
                <el-input v-model="item.agentId" />
              </label>

              <label class="field-block">
                <span>备注</span>
                <el-input v-model="item.remark" />
              </label>

              <label class="field-block">
                <span>RSA 公钥 PEM</span>
                <el-input v-model="item.authCode" type="textarea" :rows="4" />
              </label>

              <div class="hero-actions">
                <el-button round :disabled="savingAuthCodeId === item.id" @click="emit('saveAuthCode', item)">
                  {{ savingAuthCodeId === item.id ? "保存中..." : "保存" }}
                </el-button>
                <el-button type="danger" plain round :disabled="deletingAuthCodeId === item.id"
                  @click="emit('deleteAuthCode', item)">
                  {{ deletingAuthCodeId === item.id ? "删除中..." : "删除" }}
                </el-button>
              </div>
            </el-card>

            <EmptyState
              v-if="loadingAuthCodes && !authCodes.length"
              compact
              variant="loading"
              title="正在加载授权绑定"
              description="正在同步 auth_code 列表。"
            />
            <EmptyState
              v-else-if="authCodesError && !authCodes.length"
              compact
              variant="error"
              title="授权绑定加载失败"
              :description="authCodesError"
            />
            <EmptyState
              v-else-if="!authCodes.length"
              compact
              title="暂无授权绑定"
              description="新增 auth_code 后，设备公钥绑定会显示在这里。"
            />
          </div>

          <el-card v-if="isAdmin" class="surface-card info-card profile-admin-card" shadow="never">
            <div class="card-head">
              <div>
                <p class="eyebrow">Admin</p>
                <h3>用户管理</h3>
              </div>
              <el-tag round effect="plain">{{ users.length }}</el-tag>
            </div>

            <label class="field-block">
              <span>用户名</span>
              <el-input v-model="userForm.username" placeholder="新用户名" />
            </label>

            <label class="field-block">
              <span>显示名</span>
              <el-input v-model="userForm.displayName" placeholder="显示名" />
            </label>

            <label class="field-block">
              <span>密码</span>
              <el-input v-model="userForm.password" show-password placeholder="初始密码" />
            </label>

            <label class="field-block">
              <span>角色</span>
              <el-select v-model="userForm.role">
                <el-option label="admin" value="admin" />
                <el-option label="operator" value="operator" />
                <el-option label="viewer" value="viewer" />
              </el-select>
            </label>

            <div class="switch-row">
              <span>创建后启用</span>
              <el-switch v-model="userForm.isActive" />
            </div>

            <div class="hero-actions">
              <el-button type="primary" round :disabled="creatingUser" @click="emit('createUser')">
                {{ creatingUser ? "创建中..." : "创建用户" }}
              </el-button>
            </div>

            <div class="stack-grid compact-stack">
              <el-card v-for="user in users" :key="user.id" class="surface-card nested-card" shadow="never">
                <div class="card-head card-head-tight">
                  <div>
                    <h3>{{ user.username }}</h3>
                    <p>{{ user.createdAt }}</p>
                  </div>
                  <div class="hero-actions">
                    <el-tag
                      :type="user.approvalStatus === 'approved' ? 'success' : user.approvalStatus === 'pending' ? 'warning' : 'danger'"
                      effect="dark"
                      round
                    >
                      {{ user.approvalStatus }}
                    </el-tag>
                    <el-tag :type="user.isActive ? 'success' : 'danger'" effect="plain" round>
                      {{ user.isActive ? "active" : "disabled" }}
                    </el-tag>
                  </div>
                </div>

                <label class="field-block">
                  <span>显示名</span>
                  <el-input v-model="user.displayName" />
                </label>

                <label class="field-block">
                  <span>角色</span>
                  <el-select v-model="user.role">
                    <el-option label="admin" value="admin" />
                    <el-option label="operator" value="operator" />
                    <el-option label="viewer" value="viewer" />
                  </el-select>
                </label>

                <div class="switch-row">
                  <span>启用用户</span>
                  <el-switch v-model="user.isActive" />
                </div>

                <label class="field-block">
                  <span>申请备注</span>
                  <el-input v-model="user.applicationNote" disabled />
                </label>

                <label class="field-block">
                  <span>审核备注</span>
                  <el-input v-model="user.reviewComment" type="textarea" :rows="2" />
                </label>

                <div class="hero-actions">
                  <el-button round :disabled="updatingUserId === user.id" @click="emit('saveUser', user)">
                    {{ updatingUserId === user.id ? "保存中..." : "保存" }}
                  </el-button>
                  <el-button
                    v-if="user.approvalStatus !== 'approved'"
                    type="primary"
                    plain
                    round
                    :disabled="approvingUserId === user.id"
                    @click="emit('approveUser', user)"
                  >
                    {{ approvingUserId === user.id ? "提交中..." : "通过" }}
                  </el-button>
                  <el-button
                    v-if="user.approvalStatus !== 'rejected' && user.id !== session.user.id"
                    type="danger"
                    plain
                    round
                    :disabled="rejectingUserId === user.id"
                    @click="emit('rejectUser', user)"
                  >
                    {{ rejectingUserId === user.id ? "提交中..." : "拒绝" }}
                  </el-button>
                  <el-button round :disabled="resettingUserId === user.id" @click="emit('resetPassword', user)">
                    {{ resettingUserId === user.id ? "提交中..." : "重置密码" }}
                  </el-button>
                </div>
              </el-card>

              <EmptyState
                v-if="loadingUsers && !users.length"
                compact
                variant="loading"
                title="正在加载用户"
                description="正在同步用户列表。"
              />
              <EmptyState
                v-else-if="usersError && !users.length"
                compact
                variant="error"
                title="用户列表加载失败"
                :description="usersError"
              />
              <EmptyState
                v-else-if="!users.length"
                compact
                title="暂无用户"
                description="创建用户后，账号会显示在这里。"
              />
            </div>
          </el-card>

          <el-card v-if="isAdmin" class="surface-card info-card profile-admin-card" shadow="never">
            <div class="card-head">
              <div>
                <p class="eyebrow">Admin</p>
                <h3>设备审核</h3>
              </div>
              <el-tag round effect="plain">{{ managedAgents.length }}</el-tag>
            </div>

            <div class="stack-grid compact-stack">
              <el-card v-for="agent in managedAgents" :key="agent.id" class="surface-card nested-card" shadow="never">
                <div class="card-head card-head-tight">
                  <div>
                    <h3>{{ agent.agentId }}</h3>
                    <p>{{ agent.hostname || agent.label || "未命名设备" }}</p>
                  </div>
                  <div class="hero-actions">
                    <el-tag
                      :type="agent.approvalStatus === 'approved' ? 'success' : agent.approvalStatus === 'pending' ? 'warning' : 'danger'"
                      effect="dark"
                      round
                    >
                      {{ agent.approvalStatus }}
                    </el-tag>
                    <el-tag :type="agent.isEnabled ? 'success' : 'danger'" effect="plain" round>
                      {{ agent.isEnabled ? "enabled" : "disabled" }}
                    </el-tag>
                  </div>
                </div>

                <label class="field-block">
                  <span>显示名</span>
                  <el-input v-model="agent.label" />
                </label>

                <label class="field-block">
                  <span>平台信息</span>
                  <el-input :model-value="`${agent.platform || '-'} / ${agent.arch || '-'}`" disabled />
                </label>

                <label class="field-block">
                  <span>公钥指纹</span>
                  <el-input :model-value="agent.authPublicKeyFingerprint" disabled />
                </label>

                <label class="field-block">
                  <span>申请备注</span>
                  <el-input v-model="agent.applicationNote" type="textarea" :rows="2" />
                </label>

                <label class="field-block">
                  <span>审核备注</span>
                  <el-input v-model="agent.reviewComment" type="textarea" :rows="2" />
                </label>

                <div class="switch-row">
                  <span>启用设备</span>
                  <el-switch v-model="agent.isEnabled" />
                </div>

                <p class="muted">首次接入：{{ agent.firstSeenAt || "-" }}</p>
                <p class="muted">最近出现：{{ agent.lastSeenAt || "-" }}</p>

                <div class="hero-actions">
                  <el-button round :disabled="updatingManagedAgentId === agent.id" @click="emit('saveManagedAgent', agent)">
                    {{ updatingManagedAgentId === agent.id ? "保存中..." : "保存" }}
                  </el-button>
                  <el-button
                    v-if="agent.approvalStatus !== 'approved'"
                    type="primary"
                    plain
                    round
                    :disabled="approvingManagedAgentId === agent.id"
                    @click="emit('approveManagedAgent', agent)"
                  >
                    {{ approvingManagedAgentId === agent.id ? "提交中..." : "通过" }}
                  </el-button>
                  <el-button
                    v-if="agent.approvalStatus !== 'rejected'"
                    type="danger"
                    plain
                    round
                    :disabled="rejectingManagedAgentId === agent.id"
                    @click="emit('rejectManagedAgent', agent)"
                  >
                    {{ rejectingManagedAgentId === agent.id ? "提交中..." : "拒绝" }}
                  </el-button>
                </div>
              </el-card>

              <EmptyState
                v-if="loadingManagedAgents && !managedAgents.length"
                compact
                variant="loading"
                title="正在加载设备审核"
                description="正在同步设备审核列表。"
              />
              <EmptyState
                v-else-if="managedAgentsError && !managedAgents.length"
                compact
                variant="error"
                title="设备审核加载失败"
                :description="managedAgentsError"
              />
              <EmptyState
                v-else-if="!managedAgents.length"
                compact
                title="暂无待管理设备"
                description="新设备接入后，审核信息会显示在这里。"
              />
            </div>
          </el-card>

          <el-card v-if="isAdmin" class="surface-card info-card profile-admin-card" shadow="never">
            <div class="card-head">
              <div>
                <p class="eyebrow">Admin</p>
                <h3>设备绑定归属</h3>
              </div>
              <el-tag round effect="plain">{{ adminAuthCodes.length }}</el-tag>
            </div>

            <div class="stack-grid compact-stack">
              <el-card v-for="binding in adminAuthCodes" :key="binding.id" class="surface-card nested-card" shadow="never">
                <div class="card-head card-head-tight">
                  <div>
                    <h3>{{ binding.agentId }}</h3>
                    <p>{{ binding.ownerDisplayName || binding.ownerUsername || binding.userId }}</p>
                  </div>
                  <el-tag round effect="plain">{{ binding.ownerUsername }}</el-tag>
                </div>

                <label class="field-block">
                  <span>备注</span>
                  <el-input v-model="binding.remark" disabled />
                </label>

                <label class="field-block">
                  <span>公钥指纹</span>
                  <el-input :model-value="binding.fingerprint" disabled />
                </label>

                <div class="hero-actions">
                  <el-button
                    type="danger"
                    plain
                    round
                    :disabled="deletingAdminAuthCodeId === binding.id"
                    @click="emit('adminDeleteAuthCode', binding)"
                  >
                    {{ deletingAdminAuthCodeId === binding.id ? "解绑中..." : "强制解绑" }}
                  </el-button>
                </div>
              </el-card>

              <EmptyState
                v-if="loadingAdminAuthCodes && !adminAuthCodes.length"
                compact
                variant="loading"
                title="正在加载绑定归属"
                description="正在同步所有设备绑定。"
              />
              <EmptyState
                v-else-if="adminAuthCodesError && !adminAuthCodes.length"
                compact
                variant="error"
                title="绑定归属加载失败"
                :description="adminAuthCodesError"
              />
              <EmptyState
                v-else-if="!adminAuthCodes.length"
                compact
                title="暂无绑定归属"
                description="用户绑定设备公钥后，归属信息会显示在这里。"
              />
            </div>
          </el-card>
        </div>
      </div>
    </el-dialog>
  </section>
</template>
