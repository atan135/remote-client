import { createRouter, createWebHashHistory } from "vue-router";

import { NAV_ITEMS } from "../constants/navigation";

const navByKey = new Map(NAV_ITEMS.map((item) => [item.key, item]));

const routes = [
  {
    path: "/",
    redirect: {
      name: "home"
    }
  },
  {
    path: navByKey.get("home").path,
    name: navByKey.get("home").name,
    component: () => import("../pages/HomePage.vue"),
    meta: navByKey.get("home")
  },
  {
    path: navByKey.get("explore").path,
    name: navByKey.get("explore").name,
    component: () => import("../pages/ExplorePage.vue"),
    meta: navByKey.get("explore")
  },
  {
    path: navByKey.get("chat").path,
    name: navByKey.get("chat").name,
    component: () => import("../pages/ChatPage.vue"),
    meta: navByKey.get("chat")
  },
  {
    path: navByKey.get("tasks").path,
    name: navByKey.get("tasks").name,
    component: () => import("../pages/TasksPage.vue"),
    meta: navByKey.get("tasks")
  },
  {
    path: navByKey.get("profile").path,
    name: navByKey.get("profile").name,
    component: () => import("../pages/ProfilePage.vue"),
    meta: navByKey.get("profile")
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return {
      top: 0
    };
  }
});

export default router;
