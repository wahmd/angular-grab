#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { homedir } from "node:os";

/**
 * Local MCP + HTTP ingest for Angular Grab.
 * - POST http://127.0.0.1:4723/context  { content: string[], prompt?: string }
 * - MCP Streamable HTTP: http://127.0.0.1:4723/mcp
 * - Tool: get_element_context — returns latest submitted context (then clears)
 *
 * After POST /context we can optionally spawn the Cursor CLI `agent` with -p so work starts
 * without the user asking chat to call get_element_context. Set ANGULAR_GRAB_AUTO_AGENT=0 to disable.
 * Install: https://cursor.com/docs/cli/overview
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import fkill from "fkill";
import { z } from "zod";

export const CONTEXT_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_MCP_PORT = 4723;
const HEALTH_CHECK_TIMEOUT_MS = 1000;
/** After fkill, OS may need >100ms before bind() succeeds (esp. with --force). */
const POST_KILL_DELAY_MS = 350;
const POST_FORCE_EXTRA_DELAY_MS = 400;
const PORT_FREE_POLL_MS = 150;
const PORT_FREE_MAX_WAIT_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function abortAfter(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Returned when /health already succeeds — do not bind again */
const HTTP_ALREADY_UP = Symbol("angular-grab-mcp-http-already-up");

const agentContextSchema = z.object({
  content: z.array(z.string()),
  prompt: z.string().optional(),
});

/** @type {{ context: z.infer<typeof agentContextSchema>; submittedAt: number } | null} */
let latestContext = null;

const textResult = (text) => ({
  content: [{ type: "text", text }],
});

/** @param {z.infer<typeof agentContextSchema>} context */
const formatContext = (context) => {
  const parts = [];
  if (context.prompt) {
    parts.push(`Prompt: ${context.prompt}`);
  }
  parts.push(`Elements:\n${context.content.join("\n\n")}`);
  return parts.join("\n\n");
};

/** Avoid argv limits (esp. Windows ~8k); keep a safety margin */
const MAX_AGENT_PROMPT_CHARS = 12000;

const autoAgentDisabled = () => {
  const v = process.env.ANGULAR_GRAB_AUTO_AGENT;
  return v === "0" || v === "false";
};

/** Extra PATH segments so `agent` is found when MCP is started from GUI / IDE (minimal PATH). */
const augmentPathEnv = () => {
  const sep = process.platform === "win32" ? ";" : ":";
  const extra = [
    `${homedir()}/.local/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].join(sep);
  const p = process.env.PATH ?? "";
  return { ...process.env, PATH: `${extra}${sep}${p}` };
};

/**
 * Resolve full path to Cursor CLI `agent` (install: https://cursor.com/docs/cli/overview).
 * @returns {string | null}
 */
const resolveAgentExecutable = () => {
  if (process.env.ANGULAR_GRAB_AGENT_BIN) {
    return process.env.ANGULAR_GRAB_AGENT_BIN;
  }
  const names = ["agent", "cursor-agent"];
  for (const name of names) {
    try {
      if (process.platform === "win32") {
        const out = execFileSync("where", [name], { encoding: "utf8" });
        const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (first) return first;
      } else {
        const out = execFileSync("command", ["-v", name], { encoding: "utf8" });
        const line = out.trim().split("\n")[0];
        if (line) return line;
      }
    } catch {
      /* try next */
    }
  }
  return null;
};

/**
 * Spawn Cursor CLI `agent -p` so work starts without the user asking the IDE chat to run
 * MCP get_element_context.
 * @returns {"spawned" | "disabled" | "skipped" | "missing" | "error"}
 */
const trySpawnCursorAgent = (fullPrompt) => {
  if (autoAgentDisabled()) return "disabled";

  const resolved = resolveAgentExecutable();
  if (!resolved) {
    console.error(
      "[angular-grab-mcp] Cursor CLI `agent` not found on PATH. Install: https://cursor.com/docs/cli/overview — then restart this server from a shell where `which agent` works, or set ANGULAR_GRAB_AGENT_BIN."
    );
    return "missing";
  }

  let text = fullPrompt;
  if (text.length > MAX_AGENT_PROMPT_CHARS) {
    text =
      text.slice(0, MAX_AGENT_PROMPT_CHARS) +
      "\n\n[angular-grab-mcp: prompt truncated for CLI argv limits]";
  }

  const args = ["-p", text, "--output-format", "text"];
  try {
    const child = spawn(resolved, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: augmentPathEnv(),
    });
    child.unref();
    child.on("error", (err) => {
      console.error("[angular-grab-mcp] Cursor CLI spawn failed:", err.message);
    });
    console.log(
      `[angular-grab-mcp] Started Cursor CLI: ${resolved} (pid ${child.pid ?? "?"})`
    );
    return "spawned";
  } catch (e) {
    console.error("[angular-grab-mcp] Cursor CLI spawn error:", e);
    return "error";
  }
};

const createMcpServer = () => {
  const server = new McpServer(
    { name: "angular-grab-mcp", version: "0.1.0" },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    "get_element_context",
    {
      description:
        "Get the latest Angular Grab context that was submitted from the dev app. Returns the most recent UI element selection with optional instruction prompt.",
    },
    async () => {
      if (!latestContext) {
        return textResult("No context has been submitted yet.");
      }

      const isExpired = Date.now() - latestContext.submittedAt > CONTEXT_TTL_MS;
      if (isExpired) {
        latestContext = null;
        return textResult("No context has been submitted yet.");
      }

      const result = textResult(formatContext(latestContext.context));
      latestContext = null;
      return result;
    }
  );

  return server;
};

const checkIfServerIsRunning = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: abortAfter(HEALTH_CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Wait until nothing is accepting HTTP on /health (port actually free for bind).
 * Avoids EADDRINUSE right after fkill.
 * @param {number} port
 */
const waitUntilPortReleased = async (port) => {
  const deadline = Date.now() + PORT_FREE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const up = await checkIfServerIsRunning(port);
    if (!up) return;
    await sleep(PORT_FREE_POLL_MS);
  }
  console.warn(
    `[angular-grab-mcp] Port ${port} still answered /health after ${PORT_FREE_MAX_WAIT_MS}ms; attempting bind anyway.`
  );
};

/** @type {Map<string, { server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer; transport: StreamableHTTPServerTransport }>} */
const sessions = new Map();

/**
 * @param {number} port
 * @returns {import("node:http").Server}
 */
const createHttpServer = (port) => {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
    response.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    if (url.pathname === "/health") {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname === "/context" && request.method === "POST") {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const parsed = agentContextSchema.parse(body);
        latestContext = {
          context: parsed,
          submittedAt: Date.now(),
        };

        const formatted = formatContext(parsed);
        const agentPrompt = `You are editing this repo. Use the Angular Grab UI context below and fulfill the user's instruction by changing the right component/template/styles.\n\n${formatted}`;

        let cursorAgent = "skipped";
        if (parsed.prompt && String(parsed.prompt).trim().length > 0) {
          cursorAgent = trySpawnCursorAgent(agentPrompt);
        }

        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ status: "ok", cursorAgent }));
      } catch {
        response
          .writeHead(400, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: "Invalid context payload" }));
      }
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = request.headers["mcp-session-id"];
      const existingSession = sessionId ? sessions.get(sessionId) : undefined;

      if (existingSession) {
        await existingSession.transport.handleRequest(request, response);
        return;
      }

      if (request.method === "POST") {
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };

        await mcpServer.server.connect(transport);
        await transport.handleRequest(request, response);

        if (transport.sessionId) {
          sessions.set(transport.sessionId, { server: mcpServer, transport });
        }
        return;
      }

      response.writeHead(400, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: "No valid session. Send an initialize request first.",
        })
      );
      return;
    }

    response.writeHead(404).end("Not found");
  });
};

/**
 * Bind after optional fkill. After EADDRINUSE we create a **new** `http.Server` — Node does not
 * reliably allow re-listening on the same instance.
 * @param {number} port
 * @returns {Promise<import("node:http").Server | typeof HTTP_ALREADY_UP>}
 */
const startHttpServer = async (port) => {
  const forceRestart = process.argv.includes("--force");

  if (!forceRestart && (await checkIfServerIsRunning(port))) {
    console.log(
      `Angular Grab MCP already running on http://127.0.0.1:${port} (health OK). Not starting a second listener.`
    );
    console.log(
      `To run this process with your latest code, restart the server:\n` +
        `  npm run angular-grab-mcp -- --force\n` +
        `Or kill the old PID, then run npm run angular-grab-mcp again:\n` +
        `  lsof -ti :${port} | xargs kill`
    );
    return HTTP_ALREADY_UP;
  }

  if (forceRestart) {
    console.log(
      `[angular-grab-mcp] --force: replacing listener on port ${port} (old process will be stopped).`
    );
  }

  await fkill(`:${port}`, { force: true, silent: true }).catch(() => {});
  await sleep(POST_KILL_DELAY_MS);
  if (forceRestart) {
    await sleep(POST_FORCE_EXTRA_DELAY_MS);
  }
  await waitUntilPortReleased(port);

  const maxAttempts = 10;
  /** @type {import("node:http").Server | undefined} */
  let httpServer;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    httpServer = createHttpServer(port);
    try {
      await new Promise((resolve, reject) => {
        /** @param {Error & { code?: string }} err */
        const onErr = (err) => {
          httpServer?.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer?.off("error", onErr);
          resolve(undefined);
        };
        httpServer.once("error", onErr);
        httpServer.once("listening", onListening);
        httpServer.listen(port, "127.0.0.1");
      });
      break;
    } catch (e) {
      try {
        httpServer?.close();
      } catch (_) {
        /* ignore */
      }
      const err = /** @type {NodeJS.ErrnoException} */ (e);
      if (err.code !== "EADDRINUSE" || attempt === maxAttempts - 1) {
        throw err;
      }
      await fkill(`:${port}`, { force: true, silent: true }).catch(() => {});
      await sleep(POST_KILL_DELAY_MS);
      await waitUntilPortReleased(port);
    }
  }

  if (!httpServer) {
    throw new Error(`Failed to bind http server on port ${port}`);
  }

  const handleShutdown = () => {
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);

  return httpServer;
};

/**
 * @param {{ port?: number; stdio?: boolean }} [options]
 */
export const startMcpServer = async (options = {}) => {
  const port = options.port ?? DEFAULT_MCP_PORT;
  const useStdio = options.stdio ?? false;

  if (useStdio) {
    const mcpServer = createMcpServer();
    const transport = new StdioServerTransport();
    await mcpServer.server.connect(transport);

    startHttpServer(port).then(
      (result) => {
        if (result === HTTP_ALREADY_UP) return;
        console.error(`Angular Grab context server listening on http://127.0.0.1:${port}/context`);
      },
      (error) => console.error(`Failed to start context server: ${error}`)
    );
    return;
  }

  const result = await startHttpServer(port);
  if (result === HTTP_ALREADY_UP) {
    process.exit(0);
  }
  console.log(`Angular Grab MCP listening at http://127.0.0.1:${port}/mcp`);
  console.log(`Context ingest: POST http://127.0.0.1:${port}/context`);
};

const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? "") === resolve(__filename)) {
  startMcpServer({
    port: Number(process.env.PORT) || undefined,
    stdio: process.argv.includes("--stdio"),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
