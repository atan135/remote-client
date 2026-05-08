<script setup>
import { ElAlert, ElButton, ElCard, ElInput } from "element-plus";

defineProps({
  authMode: {
    type: String,
    required: true
  },
  allowPublicRegistration: {
    type: Boolean,
    required: true
  },
  registrationApprovalRequired: {
    type: Boolean,
    required: true
  },
  loginForm: {
    type: Object,
    required: true
  },
  registerForm: {
    type: Object,
    required: true
  },
  authenticating: {
    type: Boolean,
    required: true
  },
  errorMessage: {
    type: String,
    default: ""
  }
});

const emit = defineEmits(["update:authMode", "login", "register"]);
</script>

<template>
  <main class="center-shell auth-screen" :class="`auth-mode-${authMode}`">
    <div class="auth-layout">
      <section class="auth-product" aria-label="远程控制台">
        <div class="auth-brand-mark">RC</div>
        <p class="auth-kicker">Remote Console</p>
        <h1 class="auth-product-title">远程控制台</h1>
        <p class="auth-product-subtitle">安全连接内网 Agent，实时下发命令并查看结果</p>

        <div class="auth-proof-grid" aria-label="安全能力">
          <div class="auth-proof-item">
            <span>链路</span>
            <strong>Agent 主动外连</strong>
          </div>
          <div class="auth-proof-item">
            <span>命令</span>
            <strong>RSA / AES-GCM</strong>
          </div>
          <div class="auth-proof-item">
            <span>会话</span>
            <strong>HTTP-only Cookie</strong>
          </div>
        </div>
      </section>

      <el-card class="surface-card auth-card" shadow="never">
        <div class="auth-card-inner">
          <header class="auth-header">
            <p class="auth-card-kicker">{{ authMode === "login" ? "控制台访问" : "访问申请" }}</p>
            <h2 class="auth-title">{{ authMode === "login" ? "账号登录" : "创建账号" }}</h2>
          </header>

          <template v-if="authMode === 'login'">
            <form class="auth-form" @submit.prevent="emit('login')">
              <label class="field-block auth-field">
                <span>用户名</span>
                <el-input
                  v-model="loginForm.username"
                  autocomplete="username"
                  clearable
                  placeholder="输入用户名"
                />
              </label>

              <label class="field-block auth-field">
                <span>密码</span>
                <el-input
                  v-model="loginForm.password"
                  autocomplete="current-password"
                  show-password
                  placeholder="输入密码"
                />
              </label>

              <div class="auth-message-slot" aria-live="polite">
                <el-alert
                  v-if="errorMessage"
                  class="login-error"
                  :title="errorMessage"
                  type="error"
                  :closable="false"
                  show-icon
                />
              </div>

              <div class="auth-actions">
                <el-button
                  class="wide-button"
                  native-type="submit"
                  type="primary"
                  :loading="authenticating"
                  :disabled="authenticating"
                >
                  登录
                </el-button>
              </div>
            </form>
          </template>

          <template v-else>
            <form class="auth-form" @submit.prevent="emit('register')">
              <label class="field-block auth-field">
                <span>用户名</span>
                <el-input
                  v-model="registerForm.username"
                  autocomplete="username"
                  clearable
                  placeholder="输入用户名"
                />
              </label>

              <label class="field-block auth-field">
                <span>显示名</span>
                <el-input
                  v-model="registerForm.displayName"
                  autocomplete="name"
                  clearable
                  placeholder="输入显示名"
                />
              </label>

              <label class="field-block auth-field">
                <span>密码</span>
                <el-input
                  v-model="registerForm.password"
                  autocomplete="new-password"
                  show-password
                  placeholder="至少 8 位"
                />
              </label>

              <label class="field-block auth-field">
                <span>申请备注</span>
                <el-input
                  v-model="registerForm.applicationNote"
                  type="textarea"
                  :rows="3"
                  placeholder="可选，填写用途、团队或联系方式"
                />
              </label>

              <div class="auth-message-slot" aria-live="polite">
                <el-alert
                  v-if="registrationApprovalRequired"
                  class="login-error"
                  title="公开注册提交后需等待管理员审核，通过后才能登录。"
                  type="info"
                  :closable="false"
                  show-icon
                />
                <el-alert
                  v-if="errorMessage"
                  class="login-error"
                  :title="errorMessage"
                  type="error"
                  :closable="false"
                  show-icon
                />
              </div>

              <div class="auth-actions">
                <el-button
                  class="wide-button"
                  native-type="submit"
                  type="primary"
                  :loading="authenticating"
                  :disabled="authenticating"
                >
                  注册
                </el-button>
              </div>
            </form>
          </template>

          <div class="auth-footer">
            <div class="auth-switch">
              <template v-if="allowPublicRegistration && authMode === 'login'">
                <span>没有账号？</span>
                <el-button text @click="emit('update:authMode', 'register')">
                  立即注册
                </el-button>
              </template>
              <template v-if="authMode === 'register'">
                <span>已有账号？</span>
                <el-button text @click="emit('update:authMode', 'login')">
                  返回登录
                </el-button>
              </template>
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </main>
</template>
