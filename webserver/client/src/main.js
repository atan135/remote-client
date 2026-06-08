import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import { installBrowserJietu } from "./browser-jietu";
import router from "./router";
import "@xterm/xterm/css/xterm.css";
import "element-plus/dist/index.css";
import "./styles.css";

installBrowserJietu();

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount("#app");
