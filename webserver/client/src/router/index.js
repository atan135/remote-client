import { createRouter, createWebHashHistory } from "vue-router";

import { NAV_ITEMS } from "../constants/navigation";
import { useConsoleStore } from "../stores/console";

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
    path: navByKey.get("users").path,
    name: navByKey.get("users").name,
    component: () => import("../pages/UsersPage.vue"),
    meta: navByKey.get("users")
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

router.beforeEach((to) => {
  const store = useConsoleStore();

  if (to.meta?.adminOnly && !store.bootstrapping && !store.isAdmin) {
    return {
      name: "home"
    };
  }

  return true;
});

export default router;
