import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const viteCliPath = path.join(packageRoot, "..", "..", "node_modules", "vite", "bin", "vite.js");

const child = spawn(process.execPath, [viteCliPath, "build"], {
  cwd: packageRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    GOMAXPROCS: "1",
    ESBUILD_WORKER_THREADS: "0"
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
