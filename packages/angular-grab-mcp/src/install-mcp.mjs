/**
 * MCP client registration: writes Cursor config so the IDE uses this project's local server.
 * Supports stdio or HTTP transport depending on how the server is started; see server.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import * as jsonc from "jsonc-parser";
import * as TOML from "smol-toml";

export const SERVER_NAME = "angular-grab-mcp";

/** Must match server.mjs DEFAULT_MCP_PORT and AngularGrabMcpService port */
const DEFAULT_PORT = 4723;

/**
 * Cursor must use HTTP MCP to the **same** process that serves POST /context.
 * Stdio spawns a second Node process with a separate in-memory `latestContext`, so
 * the agent never sees browser-submitted context.
 */
const CURSOR_MCP_HTTP = {
  url: `http://127.0.0.1:${DEFAULT_PORT}/mcp`,
};

const JSONC_FORMAT_OPTIONS = {
  tabSize: 2,
  insertSpaces: true,
};

const getXdgConfigHome = () =>
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

const getBaseDir = () => {
  const homeDir = os.homedir();
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support");
  }
  return getXdgConfigHome();
};

const getZedConfigPath = () => {
  if (process.platform === "win32") {
    return path.join(getBaseDir(), "Zed", "settings.json");
  }
  return path.join(os.homedir(), ".config", "zed", "settings.json");
};

const getOpenCodeConfigPath = () => {
  const configDir = path.join(getXdgConfigHome(), "opencode");
  const jsoncPath = path.join(configDir, "opencode.jsonc");
  const jsonPath = path.join(configDir, "opencode.json");

  if (fs.existsSync(jsoncPath)) return jsoncPath;
  if (fs.existsSync(jsonPath)) return jsonPath;
  return jsoncPath;
};

/**
 * @param {string} serverMjsAbsPath absolute path to server.mjs
 */
export const getClients = (serverMjsAbsPath) => {
  const homeDir = os.homedir();
  const baseDir = getBaseDir();

  const stdioConfig = {
    command: "node",
    args: [serverMjsAbsPath, "--stdio"],
  };

  return [
    {
      name: "Claude Code",
      configPath: path.join(homeDir, ".claude.json"),
      configKey: "mcpServers",
      format: "json",
      serverConfig: stdioConfig,
    },
    {
      name: "Codex",
      configPath: path.join(
        process.env.CODEX_HOME || path.join(homeDir, ".codex"),
        "config.toml"
      ),
      configKey: "mcp_servers",
      format: "toml",
      serverConfig: stdioConfig,
    },
    {
      name: "Cursor",
      configPath: path.join(homeDir, ".cursor", "mcp.json"),
      configKey: "mcpServers",
      format: "json",
      serverConfig: CURSOR_MCP_HTTP,
    },
    {
      name: "OpenCode",
      configPath: getOpenCodeConfigPath(),
      configKey: "mcp",
      format: "json",
      serverConfig: {
        type: "local",
        command: ["node", serverMjsAbsPath, "--stdio"],
      },
    },
    {
      name: "VS Code",
      configPath: path.join(baseDir, "Code", "User", "mcp.json"),
      configKey: "servers",
      format: "json",
      serverConfig: { type: "stdio", ...stdioConfig },
    },
    {
      name: "Amp",
      configPath: path.join(homeDir, ".config", "amp", "settings.json"),
      configKey: "amp.mcpServers",
      format: "json",
      serverConfig: stdioConfig,
    },
    {
      name: "Droid",
      configPath: path.join(homeDir, ".factory", "mcp.json"),
      configKey: "mcpServers",
      format: "json",
      serverConfig: { type: "stdio", ...stdioConfig },
    },
    {
      name: "Windsurf",
      configPath: path.join(homeDir, ".codeium", "windsurf", "mcp_config.json"),
      configKey: "mcpServers",
      format: "json",
      serverConfig: stdioConfig,
    },
    {
      name: "Zed",
      configPath: getZedConfigPath(),
      configKey: "context_servers",
      format: "json",
      serverConfig: { source: "custom", ...stdioConfig, env: {} },
    },
  ];
};

const ensureDirectory = (filePath) => {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

/** @param {string} configKey */
function configKeyToJsonPath(configKey) {
  if (configKey.includes(".")) {
    return configKey.split(".");
  }
  return [configKey];
}

/**
 * @param {string} filePath
 * @param {string} content
 * @param {string} configKey
 * @param {string} serverName
 * @param {Record<string, unknown>} serverConfig
 */
export const upsertIntoJsonc = (filePath, content, configKey, serverName, serverConfig) => {
  const jsonPath = [...configKeyToJsonPath(configKey), serverName];
  const edits = jsonc.modify(content, jsonPath, serverConfig, {
    formattingOptions: JSONC_FORMAT_OPTIONS,
  });
  fs.writeFileSync(filePath, jsonc.applyEdits(content, edits));
};

/**
 * @param {{ configPath: string; configKey: string; format: string; serverConfig: Record<string, unknown> }} client
 */
export const installJsonClient = (client) => {
  ensureDirectory(client.configPath);

  const content = fs.existsSync(client.configPath)
    ? fs.readFileSync(client.configPath, "utf8")
    : "{}";

  upsertIntoJsonc(
    client.configPath,
    content,
    client.configKey,
    SERVER_NAME,
    client.serverConfig
  );
};

/**
 * @param {{ configPath: string; configKey: string; serverConfig: Record<string, unknown> }} client
 */
export const installTomlClient = (client) => {
  ensureDirectory(client.configPath);

  /** @type {Record<string, unknown>} */
  const existingConfig = fs.existsSync(client.configPath)
    ? TOML.parse(fs.readFileSync(client.configPath, "utf8"))
    : {};

  const serverSection = /** @type {Record<string, unknown>} */ (
    existingConfig[client.configKey] ?? {}
  );
  serverSection[SERVER_NAME] = client.serverConfig;
  existingConfig[client.configKey] = serverSection;

  fs.writeFileSync(client.configPath, TOML.stringify(existingConfig));
};

export const getMcpClientNames = (serverMjsAbsPath) =>
  getClients(serverMjsAbsPath).map((c) => c.name);

/**
 * @param {string} serverMjsAbsPath
 * @param {string[] | undefined} selectedClients
 */
export const installMcpServers = (serverMjsAbsPath, selectedClients) => {
  const allClients = getClients(serverMjsAbsPath);
  const clients = selectedClients?.length
    ? allClients.filter((c) => selectedClients.includes(c.name))
    : allClients;

  /** @type {{ client: string; configPath: string; success: boolean; error?: string }[]} */
  const results = [];

  for (const client of clients) {
    try {
      if (client.format === "toml") {
        installTomlClient(client);
      } else {
        installJsonClient(client);
      }
      results.push({
        client: client.name,
        configPath: client.configPath,
        success: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        client: client.name,
        configPath: client.configPath,
        success: false,
        error: message,
      });
    }
  }

  return results;
};
