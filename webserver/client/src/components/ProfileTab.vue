<script setup>
import { ElAvatar, ElButton, ElCard, ElInput, ElMenu, ElMenuItem, ElOption, ElSelect, ElSwitch, ElTag } from "element-plus";
import { computed, ref } from "vue";

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
  loadingAuthCodes: {
    type: Boolean,
    required: true
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
  }
});

const emit = defineEmits([
  "logout",
  "submitChangePassword",
  "createUser",
  "saveUser",
  "resetPassword",
  "createAuthCode",
  "saveAuthCode",
  "deleteAuthCode",
  "useSelectedAgentId"
]);

const profileView = ref("menu");

const profileEntries = [
  {
    key: "password",
    title: "修改密码"
  },
  {
    key: "bind",
    title: "公钥绑定"
  },
  {
    key: "manage",
    title: "管理 auth-code"
  }
];

const currentEntry = computed(
  () => profileEntries.find((item) => item.key === profileView.value) || null
);

function openView(viewKey) {
  profileView.value = viewKey;
}

function backToMenu() {
  profileView.value = "menu";
}
</script>

<template>
  <section class="page">
    <el-card class="surface-card profile-hero" shadow="never">
      <div class="profile-header">
        <el-avatar :size="54">{{ displayName.slice(0, 1) || "Q" }}</el-avatar>
        <div>
          <p class="eyebrow">Profile</p>
          <h2>{{ displayName }}</h2>
          <p class="muted">{{ session.user.username }} / {{ session.user.role }}</p>
        </div>
      </div>

      <div class="hero-actions">
        <el-button round @click="emit('logout')">退出登录</el-button>
      </div>
    </el-card>

    <el-card v-if="profileView === 'menu'" class="surface-card info-card" shadow="never">
      <div class="card-head">
        <div>
          <p class="eyebrow">Profile Menu</p>
          <h3>我的</h3>
          <p>选择一个操作入口，进入对应的独立界面。</p>
        </div>
      </div>

      <el-menu class="profile-entry-menu" mode="vertical" @select="openView">
        <el-menu-item
          v-for="entry in profileEntries"
          :key="entry.key"
          :index="entry.key"
        >
          <span>{{ entry.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-card>

    <template v-else-if="profileView === 'password'">
      <div class="profile-screen-top">
        <el-button class="back-button" round @click="backToMenu">返回</el-button>
      </div>

      <el-card class="surface-card info-card" shadow="never">
        <div class="card-head">
          <div>
            <p class="eyebrow">Password</p>
            <h3>{{ currentEntry?.title }}</h3>
            <p>在单独界面中更新当前登录账号的密码。</p>
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

        <div class="hero-actions">
          <el-button type="primary" round :disabled="changingPassword" @click="emit('submitChangePassword')">
            {{ changingPassword ? "提交中..." : "修改密码" }}
          </el-button>
        </div>
      </el-card>
    </template>

    <template v-else-if="profileView === 'bind'">
      <div class="profile-screen-top">
        <el-button class="back-button" round @click="backToMenu">返回</el-button>
      </div>

      <el-card class="surface-card info-card" shadow="never">
        <div class="card-head">
          <div>
            <p class="eyebrow">Bind Key</p>
            <h3>{{ currentEntry?.title }}</h3>
            <p>为指定设备新增一个新的 auth-code 公钥绑定。</p>
          </div>
          <el-tag round effect="plain">当前设备：{{ selectedAgentId || "未选择" }}</el-tag>
        </div>

        <div class="hero-actions">
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

        <div class="hero-actions">
          <el-button type="primary" round :disabled="creatingAuthCode" @click="emit('createAuthCode')">
            {{ creatingAuthCode ? "创建中..." : "新增 auth_code" }}
          </el-button>
        </div>
      </el-card>
    </template>

    <template v-else>
      <div class="profile-screen-top">
        <el-button class="back-button" round @click="backToMenu">返回</el-button>
      </div>

      <el-card class="surface-card info-card" shadow="never">
        <div class="card-head">
          <div>
            <p class="eyebrow">Manage Auth Codes</p>
            <h3>{{ currentEntry?.title }}</h3>
            <p>在独立界面中维护已有设备的公钥绑定记录。</p>
          </div>
          <el-tag round effect="plain">{{ authCodes.length }}</el-tag>
        </div>

        <div class="stack-grid compact-stack">
          <el-card
            v-for="item in authCodes"
            :key="item.id"
            class="surface-card nested-card"
            shadow="never"
          >
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
              <el-button
                type="danger"
                plain
                round
                :disabled="deletingAuthCodeId === item.id"
                @click="emit('deleteAuthCode', item)"
              >
                {{ deletingAuthCodeId === item.id ? "删除中..." : "删除" }}
              </el-button>
            </div>
          </el-card>

          <p v-if="loadingAuthCodes" class="muted">正在加载 auth_code 列表...</p>
        </div>
      </el-card>

      <el-card v-if="isAdmin" class="surface-card info-card" shadow="never">
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
          <el-card
            v-for="user in users"
            :key="user.id"
            class="surface-card nested-card"
            shadow="never"
          >
            <div class="card-head card-head-tight">
              <div>
                <h3>{{ user.username }}</h3>
                <p>{{ user.createdAt }}</p>
              </div>
              <el-tag :type="user.isActive ? 'success' : 'danger'" effect="dark" round>
                {{ user.isActive ? "active" : "disabled" }}
              </el-tag>
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

            <div class="hero-actions">
              <el-button round :disabled="updatingUserId === user.id" @click="emit('saveUser', user)">
                {{ updatingUserId === user.id ? "保存中..." : "保存" }}
              </el-button>
              <el-button round :disabled="resettingUserId === user.id" @click="emit('resetPassword', user)">
                {{ resettingUserId === user.id ? "提交中..." : "重置密码" }}
              </el-button>
            </div>
          </el-card>

          <p v-if="loadingUsers" class="muted">正在加载用户列表...</p>
        </div>
      </el-card>
    </template>
  </section>
</template>
