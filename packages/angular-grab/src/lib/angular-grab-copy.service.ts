import { Injectable } from "@angular/core";
import { AngularGrabContextService } from "./angular-grab-context.service";

@Injectable({ providedIn: "root" })
export class AngularGrabCopyService {
  constructor(private contextService: AngularGrabContextService) {}

  async copyElement(
    element: Element,
    maxContextLines: number = 3
  ): Promise<{ success: boolean; context?: string }> {
    try {
      const context = await this.contextService.generateContext(
        element,
        maxContextLines
      );

      // Try modern Clipboard API first
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(context);
        return { success: true, context };
      }

      // Fallback to execCommand for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = context;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        return { success, context: success ? context : undefined };
      } catch (e) {
        document.body.removeChild(textarea);
        return { success: false };
      }
    } catch (error) {
      console.error("Angular Grab: Copy failed", error);
      return { success: false };
    }
  }

  /** Full page: URL, title, text excerpt, component stack (for MCP + clipboard). */
  async copyPage(): Promise<{ success: boolean; context?: string }> {
    try {
      const context = await this.contextService.generatePageContext();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(context);
        return { success: true, context };
      }
      const textarea = document.createElement("textarea");
      textarea.value = context;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        return { success, context: success ? context : undefined };
      } catch {
        document.body.removeChild(textarea);
        return { success: false };
      }
    } catch (error) {
      console.error("Angular Grab: Page copy failed", error);
      return { success: false };
    }
  }
}
