# Angular Grab

**Git repository name:** `angular-grab` — use this folder as the repo root when you push to GitHub/GitLab.

This monorepo contains:

| Package | Path |
|--------|------|
| Angular library (UI + context) | `packages/angular-grab` |
| MCP + HTTP server (Node) | `packages/angular-grab-mcp` |

Root `package.json` is named **`angular-grab-workspace`** (private) so it does not clash with the npm package name **`angular-grab`** inside `packages/angular-grab`.

## Prerequisites

- **Node.js** 18+ or 20+ ([`.nvmrc`](./.nvmrc))
- **npm** 9+ (workspaces)

## Setup

```bash
npm install
npm run build:angular-grab
```

Run the MCP server locally:

```bash
npm run angular-grab-mcp
```

## Push to your remote

After creating an empty **`angular-grab`** repository on GitHub:

```bash
git remote add origin https://github.com/YOUR_ORG/angular-grab.git
git branch -M main
git push -u origin main
```

(See [SETUP.md](./SETUP.md) if you are initializing Git from scratch.)

## Publishing to npm

1. Bump versions in `packages/angular-grab/package.json` and/or `packages/angular-grab-mcp/package.json`.
2. `npm run build:angular-grab` (output: `dist/angular-grab/`).
3. Publish from each package directory (set `"private": false` and your scope as needed).

## License

See [LICENSE](./LICENSE).
