import fs from "node:fs";
import path from "node:path";

import log4js from "log4js";

export function configureLogging(config) {
  const logDir = path.resolve(config.logDir || "logs");
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
        level: config.logLevel || "info"
      },
      agent: {
        appenders: ["stdout", "agentFile"],
        level: config.logLevel || "info"
      },
      command: {
        appenders: ["stdout", "commandFile"],
        level: config.logLevel || "info"
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
