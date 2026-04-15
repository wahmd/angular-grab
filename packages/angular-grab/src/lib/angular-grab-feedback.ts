import { InjectionToken } from "@angular/core";

/**
 * Optional host-app notifications after MCP send (e.g. toast).
 * Provide via {@link ANGULAR_GRAB_FEEDBACK} from your AppModule if you want UI feedback.
 */
export interface AngularGrabFeedback {
  onMcpSuccess(): void;
  /** @param message Server hint when unreachable; may be undefined */
  onMcpError(message?: string): void;
}

export const ANGULAR_GRAB_FEEDBACK = new InjectionToken<AngularGrabFeedback>(
  "ANGULAR_GRAB_FEEDBACK"
);
