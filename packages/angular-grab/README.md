# Angular Grab

Dev-only tool: grab DOM context from a running Angular app and send it to a local MCP server for coding agents.

## Quick install (any Angular app)

1. **Install the library**

   ```bash
   npm install angular-grab
   ```

2. **Register the module and wrapper** — import `AngularGrabModule` in `AppModule` and wrap your root template with `<app-angular-grab>…</app-angular-grab>`.

3. **Optional: toasts after MCP send** — provide `ANGULAR_GRAB_FEEDBACK` (see `public-api.ts`).

4. **MCP server** — install and run the companion **`angular-grab-mcp`** package (separate repo/npm package), then connect your IDE/agent to its HTTP MCP URL as documented there.

Optional: **`ng add angular-grab`** (after the package is published) prints the same wiring checklist.

## Build this library (from a workspace that contains `packages/angular-grab`)

```bash
ng build angular-grab
```

Output: `dist/angular-grab/` (publishable npm package).

## Peer dependencies

`@angular/core` and `@angular/common` (match your app’s major version).
