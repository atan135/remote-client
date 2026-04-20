import { access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const distPath = path.join(packageRoot, "dist");
const archiveName =
  String(process.env.DIST_ARCHIVE_NAME || "remote-webserver-client-dist.zip").trim() ||
  "remote-webserver-client-dist.zip";
const archivePath = path.join(packageRoot, archiveName);

async function ensureDistExists() {
  try {
    await access(distPath);
  } catch {
    throw new Error("dist 目录不存在，请先执行 npm run build");
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`压缩命令执行失败，退出码 ${code ?? "unknown"}`));
    });
  });
}

function escapePowerShellLiteral(value) {
  return value.replace(/'/g, "''");
}

async function zipOnWindows() {
  const command = [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    `Compress-Archive -LiteralPath '${escapePowerShellLiteral(distPath)}' -DestinationPath '${escapePowerShellLiteral(
      archivePath
    )}' -Force`
  ];

  await run("powershell.exe", command);
}

async function zipOnUnix() {
  await run("zip", ["-qr", archivePath, path.basename(distPath)]);
}

async function main() {
  await ensureDistExists();
  await rm(archivePath, { force: true });

  if (process.platform === "win32") {
    await zipOnWindows();
  } else {
    await zipOnUnix();
  }

  console.log(`已生成压缩包：${archivePath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
