import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import log4js from "log4js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

export function configureLogging(config) {
  const logDir = path.resolve(packageRoot, config.logDir);
  fs.mkdirSync(logDir, { recursive: true });

  const patternLayout = {
    type: "pattern",
    pattern: "%d %p %c %m"
  };

  log4js.configure({
    appenders: {
      stdout: {
        type: "stdout",
        layout: patternLayout
      },
      agentFile: {
        type: "dateFile",
        filename: path.join(logDir, "agent.log"),
        keepFileExt: true,
        daysToKeep: 14,
        layout: patternLayout
      },
      commandFile: {
        type: "dateFile",
        filename: path.join(logDir, "command.log"),
        keepFileExt: true,
        daysToKeep: 14,
        layout: patternLayout
      }
    },
    categories: {
      default: {
        appenders: ["stdout", "agentFile"],
        level: config.logLevel
      },
      agent: {
        appenders: ["stdout", "agentFile"],
        level: config.logLevel
      },
      command: {
        appenders: ["stdout", "commandFile"],
        level: config.logLevel
      }
    }
  });

  return {
    agentLogger: log4js.getLogger("agent"),
    commandLogger: log4js.getLogger("command"),
    logDir
  };
}

export function logEvent(logger, level, event, payload = {}) {
  logger[level](JSON.stringify({ event, ...payload }));
}

