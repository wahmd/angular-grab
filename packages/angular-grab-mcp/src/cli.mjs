#!/usr/bin/env node
/**
 * Angular Grab CLI — parity with `npx grab@latest init` / `add mcp`
 * Run from repo root: npm run angular-grab -- init | add mcp
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import prompts from "prompts";

const onCancel = () => {
  console.log("\nCancelled.");
  process.exit(0);
};
import {
  installMcpServers,
  getMcpClientNames,
} from "./install-mcp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = resolve(__dirname, "server.mjs");

/** Walk up from cwd to find angular.json (repo root). */
function findAngularProjectRoot(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "angular.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function printHelp() {
  console.log(`
Angular Grab CLI

  npm run angular-grab -- init          Verify Angular setup & MCP tool deps
  npm run angular-grab -- add mcp       Register MCP with Cursor, Claude Code, VS Code, …
  npm run angular-grab -- add mcp -y    Same, all clients, no prompts

Options:
  -y, --yes    Non-interactive (all MCP clients; skip prompts in init)
`);
}

async function cmdInit(startCwd, opts) {
  const cwd = findAngularProjectRoot(startCwd);
  if (!cwd) {
    console.error("No angular.json found. Run from the Angular project root (or a subfolder).");
    process.exit(1);
  }
  console.log("Angular Grab — init\n");

  const appModule = join(cwd, "src/app/app.module.ts");
  let hasModule = false;
  if (existsSync(appModule)) {
    const src = readFileSync(appModule, "utf8");
    hasModule = src.includes("AngularGrabModule");
  }

  if (hasModule) {
    console.log("✓ AngularGrabModule appears to be imported in app.module.ts");
  } else {
    console.log(
      "• Import AngularGrabModule in app.module.ts and wrap your root template with <app-angular-grab>…</app-angular-grab>."
    );
  }

  const rootNm = join(cwd, "node_modules/@modelcontextprotocol/sdk");
  if (!existsSync(rootNm)) {
    console.log(
      "\n• Run npm install at the repository root (workspace installs `packages/angular-grab-mcp` dependencies)."
    );
  } else {
    console.log("✓ MCP-related packages present in root node_modules");
  }

  if (opts.yes) {
    console.log("\nRegistering MCP (non-interactive)…");
    const results = installMcpServers(SERVER_MJS);
    printMcpResults(results);
    console.log("\nRestart Cursor / your agent to load MCP.");
    return;
  }

  const { addMcp } = await prompts(
    {
      type: "confirm",
      name: "addMcp",
      message:
        "Connect Angular Grab to your coding agent via MCP (writes ~/.cursor/mcp.json, etc.)?",
      initial: true,
    },
    { onCancel }
  );

  if (addMcp) {
    const names = getMcpClientNames(SERVER_MJS);
    const { selected } = await prompts(
      {
        type: "multiselect",
        name: "selected",
        message: "Which agents should get the MCP entry?",
        choices: names.map((n) => ({ title: n, value: n, selected: true })),
      },
      { onCancel }
    );
    if (selected?.length) {
      const results = installMcpServers(SERVER_MJS, selected);
      printMcpResults(results);
      console.log("\nRestart Cursor / your agent to load MCP.");
    }
  }

  console.log("\nStart the local server while developing: npm run angular-grab-mcp");
}

function printMcpResults(results) {
  const ok = results.filter((r) => r.success).length;
  console.log(`\nInstalled ${ok}/${results.length} agent config(s):`);
  for (const r of results) {
    const mark = r.success ? "✓" : "✗";
    console.log(`  ${mark} ${r.client} → ${r.configPath}${r.error ? ` (${r.error})` : ""}`);
  }
}

async function cmdAddMcp(opts) {
  console.log("Angular Grab — add MCP\n");

  const root = findAngularProjectRoot(process.cwd());
  if (!root) {
    console.error("No angular.json found. Run from the Angular project root.");
    process.exit(1);
  }
  const toolsPkg = join(root, "packages/angular-grab-mcp");
  if (!existsSync(join(toolsPkg, "package.json"))) {
    console.error("packages/angular-grab-mcp not found — expected at repo packages/angular-grab-mcp.");
    process.exit(1);
  }

  const rootNm = join(root, "node_modules/@modelcontextprotocol/sdk");
  if (!existsSync(rootNm)) {
    console.error(
      "Missing root node_modules (e.g. @modelcontextprotocol/sdk). Run npm install at the repository root first."
    );
    process.exit(1);
  }

  let selected = undefined;
  if (!opts.yes) {
    const names = getMcpClientNames(SERVER_MJS);
    const answer = await prompts(
      {
        type: "multiselect",
        name: "selected",
        message: "Select agents to install MCP server for:",
        choices: names.map((n) => ({ title: n, value: n, selected: true })),
      },
      { onCancel }
    );
    if (!answer.selected?.length) {
      console.log("Cancelled.");
      process.exit(0);
    }
    selected = answer.selected;
  }

  const results = installMcpServers(SERVER_MJS, selected);
  printMcpResults(results);

  const hasSuccess = results.some((r) => r.success);
  if (!hasSuccess) {
    console.error("\nFailed to install MCP server entries.");
    process.exit(1);
  }

  console.log("\nSuccess! MCP server has been configured.");
  console.log("Restart your agents to activate.");
  console.log("\nKeep the context server running: npm run angular-grab-mcp");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { yes: false, help: false };
  const rest = [];
  for (const a of args) {
    if (a === "-y" || a === "--yes") flags.yes = true;
    else if (a === "-h" || a === "--help") flags.help = true;
    else rest.push(a);
  }
  return { flags, rest };
}

async function main() {
  const { flags, rest } = parseArgs(process.argv);

  if (flags.help) {
    printHelp();
    process.exit(0);
  }
  if (rest.length === 0) {
    printHelp();
    process.exit(1);
  }

  const [cmd, sub] = rest;

  if (cmd === "init") {
    await cmdInit(process.cwd(), { yes: flags.yes });
    return;
  }

  if (cmd === "add" && sub === "mcp") {
    await cmdAddMcp({ yes: flags.yes });
    return;
  }

  console.error("Unknown command. Try: init | add mcp");
  printHelp();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
