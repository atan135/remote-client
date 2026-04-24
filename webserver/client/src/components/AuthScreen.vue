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
  <main class="center-shell">
    <el-card class="surface-card auth-card" shadow="never">
      <div class="auth-card-inner">
        <header class="auth-header">
          <h2 class="auth-title">{{ authMode === "login" ? "登录控制台" : "注册账号" }}</h2>
        </header>

        <template v-if="authMode === 'login'">
          <div class="auth-form">
            <label class="field-block auth-field">
              <span>用户名</span>
              <el-input v-model="loginForm.username" placeholder="输入用户名" @keyup.enter="emit('login')" />
            </label>

            <label class="field-block auth-field">
              <span>密码</span>
              <el-input
                v-model="loginForm.password"
                show-password
                placeholder="输入密码"
                @keyup.enter="emit('login')"
              />
            </label>
          </div>

          <div class="auth-actions">
            <el-button class="wide-button" type="primary" round :disabled="authenticating" @click="emit('login')">
              {{ authenticating ? "登录中..." : "登录" }}
            </el-button>
          </div>
        </template>

        <template v-else>
          <div class="auth-form">
            <label class="field-block auth-field">
              <span>用户名</span>
              <el-input v-model="registerForm.username" placeholder="输入用户名" @keyup.enter="emit('register')" />
            </label>

            <label class="field-block auth-field">
              <span>显示名</span>
              <el-input
                v-model="registerForm.displayName"
                placeholder="输入显示名"
                @keyup.enter="emit('register')"
              />
            </label>

            <label class="field-block auth-field">
              <span>密码</span>
              <el-input
                v-model="registerForm.password"
                show-password
                placeholder="至少 8 位"
                @keyup.enter="emit('register')"
              />
            </label>
          </div>

          <div class="auth-actions">
            <el-button class="wide-button" type="primary" round :disabled="authenticating" @click="emit('register')">
              {{ authenticating ? "提交中..." : "注册" }}
            </el-button>
          </div>
        </template>

        <div class="auth-footer">
          <div class="auth-switch">
            <el-button
              v-if="allowPublicRegistration && authMode === 'login'"
              text
              @click="emit('update:authMode', 'register')"
            >
              去注册
            </el-button>
            <el-button
              v-if="authMode === 'register'"
              text
              @click="emit('update:authMode', 'login')"
            >
              返回登录
            </el-button>
          </div>

          <el-alert
            v-if="errorMessage"
            class="login-error"
            :title="errorMessage"
            type="error"
            :closable="false"
            show-icon
          />
        </div>
      </div>
    </el-card>
  </main>
</template>
