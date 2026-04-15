import { Injectable } from "@angular/core";

/** Default port for packages/angular-grab-mcp HTTP ingest and MCP (must stay in sync with server). */
export const ANGULAR_GRAB_MCP_DEFAULT_PORT = 4723;

const HEALTH_TIMEOUT_MS = 1000;

function abortAfter(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

export interface AngularGrabMcpSendResult {
  success: boolean;
  /** Set when success is false */
  message?: string;
  /** From POST /context JSON: whether Cursor CLI `agent -p` was spawned by the local server. */
  cursorAgent?: "spawned" | "disabled" | "skipped" | "missing" | "error";
}

/**
 * POSTs grab context to the local MCP ingest (packages/angular-grab-mcp).
 * Agents read the payload via MCP; optional Cursor CLI spawn is server-side only.
 */
@Injectable({ providedIn: "root" })
export class AngularGrabMcpService {
  private readonly contextUrl = `http://127.0.0.1:${ANGULAR_GRAB_MCP_DEFAULT_PORT}/context`;
  private readonly healthUrl = `http://127.0.0.1:${ANGULAR_GRAB_MCP_DEFAULT_PORT}/health`;
  private static readonly REACH_KEY = "angular-grab-mcp-reachable";

  /**
   * Sends context to the local daemon when it is running.
   */
  async trySendContext(
    content: string[],
    prompt?: string
  ): Promise<AngularGrabMcpSendResult> {
    const reachable = await this.checkReachable();
    if (!reachable) {
      return {
        success: false,
        message:
          "Local MCP server not running. In a terminal run: npm run angular-grab-mcp",
      };
    }

    try {
      const res = await fetch(this.contextUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          prompt !== undefined && prompt.length > 0
            ? { content, prompt }
            : { content }
        ),
      });
      if (!res.ok) {
        return {
          success: false,
          message: `Context server returned ${res.status}`,
        };
      }
      let cursorAgent: AngularGrabMcpSendResult["cursorAgent"];
      try {
        const data = (await res.json()) as { cursorAgent?: string };
        if (
          data.cursorAgent === "spawned" ||
          data.cursorAgent === "disabled" ||
          data.cursorAgent === "skipped" ||
          data.cursorAgent === "missing" ||
          data.cursorAgent === "error"
        ) {
          cursorAgent = data.cursorAgent;
        }
      } catch {
        /* older server without cursorAgent field */
      }
      return { success: true, cursorAgent };
    } catch {
      return {
        success: false,
        message: "Could not POST to localhost (blocked or server stopped).",
      };
    }
  }

  private async checkReachable(): Promise<boolean> {
    if (typeof sessionStorage === "undefined") {
      return this.pingHealth();
    }
    const cached = sessionStorage.getItem(AngularGrabMcpService.REACH_KEY);
    if (cached === "true") return true;

    const ok = await this.pingHealth();
    if (ok) {
      sessionStorage.setItem(AngularGrabMcpService.REACH_KEY, "true");
    }
    return ok;
  }

  private async pingHealth(): Promise<boolean> {
    try {
      const response = await fetch(this.healthUrl, {
        signal: abortAfter(HEALTH_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
