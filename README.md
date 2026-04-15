# Angular Grab

Grab UI context from a running Angular app and send it to a local MCP server for your coding agent.

**Repo:** [github.com/wahmd/angular-grab](https://github.com/wahmd/angular-grab)

---

## Use in any Angular app

### 1. Install the library

**After it is published to npm:**

```bash
npm install angular-grab
```

**Until then (install the built package from this repo):**

```bash
git clone https://github.com/wahmd/angular-grab.git
cd angular-grab && npm ci && npm run build:angular-grab
```

Then in your app (use the absolute path to `dist/angular-grab` on your machine):

```bash
npm install /path/to/angular-grab/dist/angular-grab
```

### 2. Import the module

**`AppModule`:**

```typescript
import { AngularGrabModule } from 'angular-grab';

@NgModule({
  imports: [
    /* ... */
    AngularGrabModule,
  ],
})
export class AppModule {}
```

**Standalone app** (root `App` component):

```typescript
import { AngularGrabModule } from 'angular-grab';

@Component({
  standalone: true,
  imports: [AngularGrabModule /* , ... */],
  // ...
})
export class AppComponent {}
```

### 3. Wrap your root template

Put your entire app shell inside the grab host (selector stays `app-angular-grab`):

```html
<app-angular-grab>
  <!-- routers, layout, everything you had at root -->
</app-angular-grab>
```

### 4. (Optional) Toasts when MCP send succeeds / fails

Provide `ANGULAR_GRAB_FEEDBACK` from your app (e.g. map to your toast service):

```typescript
import { ANGULAR_GRAB_FEEDBACK, AngularGrabFeedback } from 'angular-grab';

const feedback: AngularGrabFeedback = {
  onMcpSuccess: () => {
    /* toast */
  },
  onMcpError: (message?: string) => {
    /* toast */
  },
};

// In @NgModule providers: or provide in bootstrap for standalone
{ provide: ANGULAR_GRAB_FEEDBACK, useValue: feedback }
```

If you skip this, grab still works; you just won’t get UI feedback after send.

### 5. Run the MCP server (development)

Agents read grabs from **`http://127.0.0.1:4723`**. Install and run the Node package from this repo (or from npm when `angular-grab-mcp` is published):

```bash
npm install -D angular-grab-mcp
```

Add scripts to your app’s **`package.json`**:

```json
{
  "scripts": {
    "angular-grab-mcp": "angular-grab-mcp",
    "angular-grab-mcp:force": "angular-grab-mcp --force"
  }
}
```

Start it while you develop:

```bash
npm run angular-grab-mcp
```

Point your IDE’s MCP client at **`http://127.0.0.1:4723/mcp`** (same process as the browser `POST /context`). Optional: `npm exec angular-grab -- init` / `add mcp` from the `angular-grab-mcp` package for Cursor config helpers.

---

## Requirements

- **Angular** version compatible with the library’s `peerDependencies` in `packages/angular-grab/package.json` (currently **Angular 13** range; widen when you upgrade the lib).

---

## Monorepo (this repository)

| Package | Role |
|--------|------|
| `packages/angular-grab` | Angular library |
| `packages/angular-grab-mcp` | MCP + HTTP server |

```bash
npm install
npm run build:angular-grab
npm run angular-grab-mcp
```

Root `package.json` name is **`angular-grab-workspace`** (private). The installable Angular package name is **`angular-grab`**.

## License

MIT — see [LICENSE](./LICENSE).
