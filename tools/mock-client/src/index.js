import process from "node:process";

const CLOSED_SESSION_STATUSES = new Set(["completed", "failed", "terminated", "connection_lost"]);

async function main() {
  const { scenario, options } = parseArgs(process.argv.slice(2));

  switch (scenario) {
    case "local-health":
      await runLocalHealth(options);
      return;
    case "local-command":
      await runLocalCommand(options);
      return;
    case "local-session":
      await runLocalSession(options);
      return;
    case "local-smoke":
      await runLocalSmoke(options);
      return;
    case "web-command":
      await runWebCommand(options);
      return;
    case "web-session":
      await runWebSession(options);
      return;
    case "web-smoke":
      await runWebSmoke(options);
      return;
    case "help":
    default:
      printHelp();
  }
}

async function runLocalHealth(options) {
  const baseUrl = getLocalBaseUrl(options);
  const headers = buildLocalHeaders(options);
  const payload = await fetchJson(`${baseUrl}/api/debug/health`, {
    method: "GET",
    headers
  });

  printJson({
    scenario: "local-health",
    baseUrl,
    ok: payload.ok,
    profileCount: Array.isArray(payload.profiles) ? payload.profiles.length : 0,
    now: payload.now
  });
}

async function runLocalCommand(options) {
  const baseUrl = getLocalBaseUrl(options);
  const headers = buildLocalHeaders(options);
  const command = getOption(
    options,
    "command",
    process.env.MOCK_COMMAND || 'echo hello from mock-client'
  );
  const payload = await fetchJson(`${baseUrl}/api/debug/commands`, {
    method: "POST",
    headers,
    body: JSON.stringify({ command })
  });

  printJson({
    scenario: "local-command",
    command,
    status: payload.item?.status || "",
    exitCode: payload.item?.exitCode ?? null
  });

  if (payload.item?.stdout) {
    printSection("stdout", payload.item.stdout);
  }

  if (payload.item?.stderr) {
    printSection("stderr", payload.item.stderr);
  }
}

async function runLocalSession(options) {
  const context = await createLocalSession(options);
  await interactWithSession(context, {
    sendInput: true,
    autoTerminate: true
  });
}

async function runLocalSmoke(options) {
  await runLocalHealth(options);
  await runLocalCommand(options);
  await runLocalSession(options);
}

async function runWebCommand(options) {
  const baseUrl = getServerBaseUrl(options);
  const authHeaders = await buildWebAuthHeaders(options);
  const agentId = requireOption(options, "agent-id", "MOCK_AGENT_ID");
  const command = getOption(
    options,
    "command",
    process.env.MOCK_COMMAND || 'echo hello from mock-client'
  );

  const submit = await fetchJson(`${baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      agentId,
      command
    })
  });

  const requestId = submit.item?.requestId;

  if (!requestId) {
    throw new Error("web command response missing requestId");
  }

  const pollResult = await pollUntil(async () => {
    const listing = await fetchJson(`${baseUrl}/api/commands?limit=100`, {
      method: "GET",
      headers: authHeaders
    });
    const item = (listing.items || []).find((entry) => entry.requestId === requestId);
    if (!item) {
      return { done: false };
    }

    const done = ["completed", "failed", "timed_out", "connection_lost"].includes(item.status);
    return {
      done,
      value: item
    };
  }, options);

  printJson({
    scenario: "web-command",
    agentId,
    command,
    requestId,
    status: pollResult.status,
    exitCode: pollResult.exitCode ?? null
  });

  if (pollResult.stdout) {
    printSection("stdout", pollResult.stdout);
  }

  if (pollResult.stderr) {
    printSection("stderr", pollResult.stderr);
  }
}

async function runWebSession(options) {
  const context = await createWebSession(options);
  await interactWithSession(context, {
    sendInput: true,
    autoTerminate: true
  });
}

async function runWebSmoke(options) {
  await runWebCommand(options);
  await runWebSession(options);
}

async function createLocalSession(options) {
  const baseUrl = getLocalBaseUrl(options);
  const headers = buildLocalHeaders(options);
  const profile = getOption(
    options,
    "profile",
    process.env.MOCK_PROFILE || "default_shell_session"
  );
  const cwd = getOption(options, "cwd", process.env.MOCK_CWD || process.cwd());
  const body = {
    profile,
    cwd,
    env: {},
    cols: getNumberOption(options, "cols", 120),
    rows: getNumberOption(options, "rows", 30)
  };
  const created = await fetchJson(`${baseUrl}/api/debug/terminal-sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const session = created.item;

  if (!session?.sessionId) {
    throw new Error("local session response missing sessionId");
  }

  printJson({
    scenario: "local-session",
    sessionId: session.sessionId,
    profile,
    status: session.status
  });

  return {
    mode: "local",
    baseUrl,
    headers,
    sessionId: session.sessionId,
    profile,
    options
  };
}

async function createWebSession(options) {
  const baseUrl = getServerBaseUrl(options);
  const headers = await buildWebAuthHeaders(options);
  const agentId = requireOption(options, "agent-id", "MOCK_AGENT_ID");
  const profile = getOption(
    options,
    "profile",
    process.env.MOCK_PROFILE || "default_shell_session"
  );
  const cwd = getOption(options, "cwd", process.env.MOCK_CWD || process.cwd());
  const created = await fetchJson(`${baseUrl}/api/terminal-sessions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      agentId,
      profile,
      cwd,
      env: {},
      cols: getNumberOption(options, "cols", 120),
      rows: getNumberOption(options, "rows", 30)
    })
  });

  const session = created.item;

  if (!session?.sessionId) {
    throw new Error("web session response missing sessionId");
  }

  printJson({
    scenario: "web-session",
    sessionId: session.sessionId,
    agentId,
    profile,
    status: session.status
  });

  return {
    mode: "web",
    baseUrl,
    headers,
    sessionId: session.sessionId,
    profile,
    options
  };
}

async function interactWithSession(context, behavior) {
  const input = getOption(
    context.options,
    "input",
    process.env.MOCK_INPUT || "echo hello from mock-client\r"
  );
  const inputDelayMs = getNumberOption(context.options, "input-delay-ms", 300);
  const terminateDelayMs = getNumberOption(context.options, "terminate-delay-ms", 1200);
  const pollIntervalMs = getNumberOption(context.options, "poll-interval-ms", 400);
  const timeoutMs = getNumberOption(context.options, "timeout-ms", 20000);
  let lastPrintedSeq = 0;
  let inputSent = false;
  let terminateSent = false;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const session = await fetchSession(context);

    if (!session) {
      throw new Error(`session not found: ${context.sessionId}`);
    }

    const outputs = Array.isArray(session.outputs) ? session.outputs : [];
    const freshOutputs = outputs.filter((item) => Number(item.seq) > lastPrintedSeq);

    for (const item of freshOutputs) {
      lastPrintedSeq = Math.max(lastPrintedSeq, Number(item.seq) || 0);
      printOutputChunk(item);
    }

    if (behavior.sendInput && !inputSent && Date.now() - startedAt >= inputDelayMs) {
      await sendSessionInput(context, input);
      inputSent = true;
      printJson({
        event: "session.input.sent",
        sessionId: context.sessionId,
        inputLength: input.length
      });
    }

    if (
      behavior.autoTerminate &&
      inputSent &&
      !terminateSent &&
      Date.now() - startedAt >= terminateDelayMs &&
      !CLOSED_SESSION_STATUSES.has(String(session.status || ""))
    ) {
      await terminateSession(context);
      terminateSent = true;
      printJson({
        event: "session.terminate.sent",
        sessionId: context.sessionId
      });
    }

    if (CLOSED_SESSION_STATUSES.has(String(session.status || ""))) {
      printJson({
        event: "session.closed",
        sessionId: context.sessionId,
        status: session.status,
        exitCode: session.exitCode ?? null
      });
      return;
    }

    await delay(pollIntervalMs);
  }

  throw new Error(`session poll timed out: ${context.sessionId}`);
}

async function fetchSession(context) {
  const endpoint =
    context.mode === "local"
      ? `${context.baseUrl}/api/debug/terminal-sessions/${context.sessionId}`
      : `${context.baseUrl}/api/terminal-sessions/${context.sessionId}`;
  const payload = await fetchJson(endpoint, {
    method: "GET",
    headers: context.headers
  });
  return payload.item;
}

async function sendSessionInput(context, input) {
  const endpoint =
    context.mode === "local"
      ? `${context.baseUrl}/api/debug/terminal-sessions/${context.sessionId}/input`
      : `${context.baseUrl}/api/terminal-sessions/${context.sessionId}/input`;
  await fetchJson(endpoint, {
    method: "POST",
    headers: {
      ...context.headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input })
  });
}

async function terminateSession(context) {
  const endpoint =
    context.mode === "local"
      ? `${context.baseUrl}/api/debug/terminal-sessions/${context.sessionId}/terminate`
      : `${context.baseUrl}/api/terminal-sessions/${context.sessionId}/terminate`;
  await fetchJson(endpoint, {
    method: "POST",
    headers: {
      ...context.headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
}

function buildLocalHeaders(options) {
  const token = requireOption(options, "token", "LOCAL_DEBUG_TOKEN");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function buildWebAuthHeaders(options) {
  const baseUrl = getServerBaseUrl(options);
  const username = requireOption(options, "username", "MOCK_USERNAME");
  const password = requireOption(options, "password", "MOCK_PASSWORD");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
  const payload = await tryReadJson(response);

  if (!response.ok) {
    throw new Error(payload?.message || `login failed: ${response.status}`);
  }

  const cookieHeader = extractCookieHeader(response);

  if (!cookieHeader) {
    throw new Error("login response missing session cookie");
  }

  return {
    Cookie: cookieHeader
  };
}

function extractCookieHeader(response) {
  const headerValues =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);

  const cookies = headerValues
    .flatMap((item) => String(item || "").split(/,(?=[^;]+=[^;]+)/))
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean);

  return cookies.join("; ");
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await tryReadJson(response);

  if (!response.ok) {
    throw new Error(payload?.message || `${response.status} ${response.statusText}`);
  }

  return payload;
}

async function tryReadJson(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text
    };
  }
}

async function pollUntil(factory, options) {
  const pollIntervalMs = getNumberOption(options, "poll-interval-ms", 400);
  const timeoutMs = getNumberOption(options, "timeout-ms", 20000);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await factory();
    if (result.done) {
      return result.value;
    }

    await delay(pollIntervalMs);
  }

  throw new Error("poll timed out");
}

function parseArgs(argv) {
  const [scenario = "help", ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];

    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = rest[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return {
    scenario,
    options
  };
}

function getLocalBaseUrl(options) {
  return getOption(options, "base-url", process.env.LOCAL_DEBUG_BASE_URL || "http://127.0.0.1:3210");
}

function getServerBaseUrl(options) {
  return getOption(options, "base-url", process.env.SERVER_BASE_URL || "http://127.0.0.1:3100");
}

function getOption(options, key, fallback = "") {
  return options[key] ?? fallback;
}

function requireOption(options, key, envName) {
  const value = String(options[key] ?? process.env[envName] ?? "").trim();

  if (!value) {
    throw new Error(`missing required option --${key} or env ${envName}`);
  }

  return value;
}

function getNumberOption(options, key, fallback) {
  const raw = options[key];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printJson(payload) {
  console.log(JSON.stringify(payload));
}

function printSection(name, content) {
  console.log(`--- ${name} ---`);
  console.log(String(content));
}

function printOutputChunk(item) {
  const prefix = `[${item.stream || "stdout"}#${item.seq}]`;
  const chunk = String(item.chunk || "");
  process.stdout.write(`${prefix} ${chunk}`);
  if (!chunk.endsWith("\n") && !chunk.endsWith("\r")) {
    process.stdout.write("\n");
  }
}

function printHelp() {
  console.log(`Usage:
  node tools/mock-client/src/index.js <scenario> [options]

Scenarios:
  local-health
  local-command
  local-session
  local-smoke
  web-command
  web-session
  web-smoke

Common options:
  --base-url <url>
  --timeout-ms <ms>
  --poll-interval-ms <ms>

Local options:
  --token <LOCAL_DEBUG_TOKEN>
  --command <command>
  --profile <profile>
  --cwd <cwd>
  --input <input>

Web options:
  --username <username>
  --password <password>
  --agent-id <agentId>
  --command <command>
  --profile <profile>
  --cwd <cwd>
  --input <input>
`);
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
