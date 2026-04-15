import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  Inject,
  Optional,
} from "@angular/core";
import { Subscription } from "rxjs";
import {
  AngularGrabStateService,
  GrabState,
} from "./angular-grab-state.service";
import { AngularGrabEventsService } from "./angular-grab-events.service";
import { AngularGrabMcpService } from "./angular-grab-mcp.service";
import {
  ANGULAR_GRAB_FEEDBACK,
  AngularGrabFeedback,
} from "./angular-grab-feedback";

@Component({
  selector: "app-angular-grab",
  template: `
    <!-- Project the wrapped content -->
    <ng-content></ng-content>

    <!-- Grab overlay: crosshair + selection when grabbing -->
    <div *ngIf="state.isActive" class="grab-overlay">
      <div
        class="crosshair"
        [style.left.px]="state.mousePosition.x"
        [style.top.px]="state.mousePosition.y"
      >
        <div class="crosshair-inner"></div>
        <div class="crosshair-dot"></div>
      </div>

      <div
        *ngIf="state.detectedElement"
        class="selection-box"
        [style]="getSelectionBoxStyle()"
      >
        <div class="selection-box-corner selection-box-corner-tl"></div>
        <div class="selection-box-corner selection-box-corner-tr"></div>
        <div class="selection-box-corner selection-box-corner-bl"></div>
        <div class="selection-box-corner selection-box-corner-br"></div>
      </div>

      <div
        *ngIf="state.detectedElement"
        class="label"
        [style.left.px]="getLabelPosition().x"
        [style.top.px]="getLabelPosition().y"
      >
        <div class="label-content">
          <span class="tag-badge">{{ getTagName() }}</span>
          <span *ngIf="state.componentName" class="component-name">
            {{ state.componentName }}
          </span>
        </div>
        <div class="label-arrow"></div>
      </div>
      <div class="grab-hint" *ngIf="state.isActive">Shift+click: copy full page</div>
    </div>

    <!-- Selection box only when instruction panel is open (keep element highlighted) -->
    <div
      *ngIf="state.showInstructionPanel && state.detectedElement"
      class="grab-overlay selection-only-overlay"
    >
      <div
        class="selection-box selection-box-persist"
        [style]="getSelectionBoxStyle()"
      >
        <div class="selection-box-corner selection-box-corner-tl"></div>
        <div class="selection-box-corner selection-box-corner-tr"></div>
        <div class="selection-box-corner selection-box-corner-bl"></div>
        <div class="selection-box-corner selection-box-corner-br"></div>
      </div>
    </div>

    <!-- Instruction panel (after copy); mask cuts out selected element so it stays sharp -->
    <div
      *ngIf="state.showInstructionPanel"
      class="instruction-overlay"
      [style]="getInstructionOverlayStyle()"
      (click)="onInstructionBackdropClick($event)"
    >
      <div class="instruction-panel" (click)="$event.stopPropagation()">
        <div class="instruction-target" *ngIf="state.detectedElement || state.componentName">
          <span class="instruction-target-label">{{
            state.grabScope === 'page' ? 'Full page' : 'Selected element'
          }}</span>
          <p class="instruction-mcp-hint">
            Sent to MCP — your agent already has what you pointed at. In chat, say e.g. “address my feedback” or “fix annotation 3” (no paste).
          </p>
          <span class="instruction-target-value">
            <span class="instruction-target-tag">&lt;{{ getTagName() || 'element' }}&gt;</span>
            <span class="instruction-target-sep"> &bull; </span>
            <span class="instruction-target-component">{{ state.componentName || 'Unknown component' }}</span>
          </span>
        </div>
        <div class="instruction-row">
          <input
            type="text"
            class="instruction-input"
            [value]="instructionText"
            (input)="instructionText = $any($event.target).value"
            (keydown.enter)="submitInstruction()"
            placeholder="e.g. make it bold"
            #instructionInput
          />
          <button type="button" class="instruction-btn" (click)="submitInstruction()">
            Send
          </button>
        </div>
        <button
          type="button"
          class="instruction-close"
          (click)="closeInstructionPanel()"
          aria-label="Close"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .grab-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 2147483647;
      }

      .grab-hint {
        position: fixed;
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        color: rgba(255, 255, 255, 0.72);
        pointer-events: none;
        z-index: 2147483647;
        font-family: system-ui, sans-serif;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      .instruction-mcp-hint {
        margin: 0 0 10px 0;
        font-size: 12px;
        color: #a8a8a8;
        line-height: 1.45;
      }

      .selection-only-overlay {
        z-index: 2147483646;
      }

      .selection-box-persist {
        border-style: solid;
        box-shadow: 0 0 0 2px rgba(178, 28, 142, 0.25);
      }

      /* Modern Crosshair - VS Code/Dev Editor Style */
      .crosshair {
        position: absolute;
        width: 32px;
        height: 32px;
        transform: translate(-50%, -50%);
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .crosshair-inner {
        width: 100%;
        height: 100%;
        border: 1.5px solid rgba(178, 28, 142, 0.8);
        border-radius: 50%;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1),
          0 0 8px rgba(178, 28, 142, 0.3), inset 0 0 8px rgba(178, 28, 142, 0.1);
        animation: crosshair-pulse 2s ease-in-out infinite;
      }

      .crosshair-dot {
        position: absolute;
        width: 4px;
        height: 4px;
        background: rgba(178, 28, 142, 0.9);
        border-radius: 50%;
        box-shadow: 0 0 4px rgba(178, 28, 142, 0.6);
      }

      @keyframes crosshair-pulse {
        0%,
        100% {
          opacity: 0.8;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.05);
        }
      }

      /* Modern Selection Box - Clean, Precise */
      .selection-box {
        position: absolute;
        border: 2px solid rgba(178, 28, 142, 0.6);
        background: rgba(178, 28, 142, 0.08);
        pointer-events: none;
        box-sizing: border-box;
        transition: all 0.08s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05),
          inset 0 0 20px rgba(178, 28, 142, 0.1);
      }

      .selection-box-corner {
        position: absolute;
        width: 8px;
        height: 8px;
        border: 2px solid rgba(178, 28, 142, 0.9);
        background: rgba(255, 255, 255, 0.95);
        box-shadow: 0 0 4px rgba(178, 28, 142, 0.4);
      }

      .selection-box-corner-tl {
        top: -4px;
        left: -4px;
        border-right: none;
        border-bottom: none;
        border-radius: 2px 0 0 0;
      }

      .selection-box-corner-tr {
        top: -4px;
        right: -4px;
        border-left: none;
        border-bottom: none;
        border-radius: 0 2px 0 0;
      }

      .selection-box-corner-bl {
        bottom: -4px;
        left: -4px;
        border-right: none;
        border-top: none;
        border-radius: 0 0 0 2px;
      }

      .selection-box-corner-br {
        bottom: -4px;
        right: -4px;
        border-left: none;
        border-top: none;
        border-radius: 0 0 2px 0;
      }

      /* Modern Label - VS Code Popup Style */
      .label {
        position: absolute;
        pointer-events: none;
        filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.25));
        transform: translateY(-100%);
        margin-top: -8px;
      }

      .label-content {
        background: linear-gradient(135deg, #1e1e1e 0%, #252526 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        padding: 6px 10px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        font-family: "SF Mono", "Monaco", "Menlo", "Ubuntu Mono", "Consolas",
          "Courier New", monospace;
        font-weight: 500;
        letter-spacing: 0.2px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(8px);
      }

      .tag-badge {
        background: linear-gradient(
          135deg,
          rgba(178, 28, 142, 0.2) 0%,
          rgba(210, 57, 192, 0.15) 100%
        );
        border: 1px solid rgba(178, 28, 142, 0.4);
        color: #d239c0;
        padding: 2px 6px;
        border-radius: 3px;
        font-weight: 600;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .component-name {
        color: #d4d4d4;
        font-weight: 500;
        font-size: 11px;
      }

      .label-arrow {
        position: absolute;
        bottom: -4px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 5px solid #252526;
        filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.3));
      }

      .label-arrow::before {
        content: "";
        position: absolute;
        bottom: 1px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 4px solid rgba(255, 255, 255, 0.1);
      }

      /* Instruction panel */
      .instruction-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(4px);
        pointer-events: auto;
        animation: instruction-fade-in 0.2s ease-out;
      }

      @keyframes instruction-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .instruction-target {
        margin-bottom: 14px;
        padding: 10px 12px;
        background: rgba(178, 28, 142, 0.08);
        border: 1px solid rgba(178, 28, 142, 0.2);
        border-radius: 8px;
      }

      .instruction-target-label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #d239c0;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 4px;
      }

      .instruction-target-value {
        font-size: 13px;
        font-family: "SF Mono", "Monaco", "Menlo", "Ubuntu Mono", "Consolas",
          "Courier New", monospace;
        color: #e4e4e4;
      }

      .instruction-target-tag {
        color: #9cdcfe;
      }

      .instruction-target-sep {
        margin: 0 6px;
        color: rgba(255, 255, 255, 0.35);
      }

      .instruction-target-component {
        color: #d4d4d4;
      }

      .instruction-panel {
        position: relative;
        min-width: 380px;
        max-width: 90vw;
        padding: 20px 24px;
        background: linear-gradient(160deg, #1e1e1e 0%, #252526 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(178, 28, 142, 0.15),
          inset 0 1px 0 rgba(255, 255, 255, 0.04);
        animation: instruction-panel-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      @keyframes instruction-panel-in {
        from {
          opacity: 0;
          transform: scale(0.96) translateY(8px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .instruction-label {
        margin: 0 0 12px 0;
        font-size: 13px;
        font-weight: 500;
        color: #d4d4d4;
        letter-spacing: 0.01em;
      }

      .instruction-row {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .instruction-input {
        flex: 1;
        min-width: 0;
        height: 44px;
        padding: 0 14px;
        font-size: 14px;
        font-family: inherit;
        color: #e4e4e4;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }

      .instruction-input::placeholder {
        color: #808080;
      }

      .instruction-input:hover {
        border-color: rgba(255, 255, 255, 0.18);
      }

      .instruction-input:focus {
        border-color: rgba(178, 28, 142, 0.6);
        box-shadow: 0 0 0 3px rgba(178, 28, 142, 0.2);
      }

      .instruction-btn {
        flex-shrink: 0;
        height: 44px;
        padding: 0 20px;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        background: linear-gradient(
          135deg,
          rgba(178, 28, 142, 0.9) 0%,
          rgba(210, 57, 192, 0.85) 100%
        );
        border: none;
        border-radius: 8px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(178, 28, 142, 0.35),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
        transition: transform 0.1s, box-shadow 0.15s;
      }

      .instruction-btn:hover {
        box-shadow: 0 4px 12px rgba(178, 28, 142, 0.45),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .instruction-btn:active {
        transform: scale(0.98);
      }

      .instruction-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 28px;
        height: 28px;
        padding: 0;
        font-size: 20px;
        line-height: 1;
        color: #a0a0a0;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: color 0.15s, background 0.15s;
      }

      .instruction-close:hover {
        color: #e4e4e4;
        background: rgba(255, 255, 255, 0.08);
      }
    `,
  ],
})
export class AngularGrabComponent implements OnInit, OnDestroy {
  state: GrabState = {
    isActive: false,
    detectedElement: null,
    mousePosition: { x: 0, y: 0 },
    componentName: null,
    showInstructionPanel: false,
    lastCopiedContext: null,
    grabScope: "element",
  };

  instructionText = "";

  @ViewChild("instructionInput") instructionInputRef?: ElementRef<HTMLInputElement>;

  private subscription?: Subscription;
  private prevShowPanel = false;

  constructor(
    private stateService: AngularGrabStateService,
    private eventsService: AngularGrabEventsService,
    private mcpService: AngularGrabMcpService,
    @Optional()
    @Inject(ANGULAR_GRAB_FEEDBACK)
    private feedback: AngularGrabFeedback | null
  ) {}

  ngOnInit(): void {
    this.subscription = this.stateService.getState().subscribe((state) => {
      this.state = state;
      // Focus instruction input when panel opens
      if (state.showInstructionPanel && !this.prevShowPanel) {
        this.prevShowPanel = true;
        setTimeout(() => this.instructionInputRef?.nativeElement?.focus(), 80);
      }
      if (!state.showInstructionPanel) {
        this.prevShowPanel = false;
      }
    });

    this.eventsService.initialize();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  getSelectionBoxStyle(): Record<string, string> {
    if (!this.state.detectedElement) return {};

    const rect = this.state.detectedElement.getBoundingClientRect();
    return {
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  }

  /**
   * Overlay style with a mask cutout so the selected element stays unblurred
   * when the instruction panel is open (viewport coords for fixed overlay).
   */
  getInstructionOverlayStyle(): Record<string, string> {
    if (!this.state.showInstructionPanel || !this.state.detectedElement) {
      return {};
    }
    const rect = this.state.detectedElement.getBoundingClientRect();
    const left = Math.round(rect.left);
    const top = Math.round(rect.top);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const maskImage = "linear-gradient(white, white), linear-gradient(white, white)";
    const maskSize = `100% 100%, ${w}px ${h}px`;
    const maskPosition = `0 0, ${left}px ${top}px`;
    return {
      "mask-image": maskImage,
      "mask-size": maskSize,
      "mask-position": maskPosition,
      "mask-repeat": "no-repeat",
      "mask-composite": "exclude",
      "-webkit-mask-image": maskImage,
      "-webkit-mask-size": maskSize,
      "-webkit-mask-position": maskPosition,
      "-webkit-mask-repeat": "no-repeat",
      "-webkit-mask-composite": "xor",
    };
  }

  getTagName(): string {
    return this.state.detectedElement?.tagName.toLowerCase() || "";
  }

  getLabelPosition(): { x: number; y: number } {
    if (!this.state.detectedElement) {
      return {
        x: this.state.mousePosition.x + 15,
        y: this.state.mousePosition.y + 15,
      };
    }

    const rect = this.state.detectedElement.getBoundingClientRect();
    const labelX = rect.left + rect.width / 2;
    const labelY = rect.top - 8;

    // Keep label within viewport
    const padding = 10;
    const maxX = window.innerWidth - 200; // Approximate label width
    const minX = padding;
    const maxY = window.innerHeight - 100;
    const minY = padding;

    return {
      x: Math.max(minX, Math.min(maxX, labelX)),
      y: Math.max(minY, Math.min(maxY, labelY)),
    };
  }

  onInstructionBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains("instruction-overlay")) {
      this.closeInstructionPanel();
    }
  }

  closeInstructionPanel(): void {
    this.instructionText = "";
    this.stateService.closeInstructionPanel();
  }

  async submitInstruction(): Promise<void> {
    const instruction = this.instructionText.trim();
    const context = this.state.lastCopiedContext ?? "";
    const toCopy =
      instruction.length > 0
        ? `Instruction: ${instruction}\n\n${context}`
        : context;

    const mcp = await this.mcpService.trySendContext(
      [context],
      instruction.length > 0 ? instruction : undefined
    );

    if (mcp.success) {
      this.feedback?.onMcpSuccess();
    } else {
      this.feedback?.onMcpError(
        mcp.message ??
          "Start the Angular Grab MCP server (see your project README), then try again."
      );
    }

    if (!mcp.success) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(toCopy);
        }
      } catch (e) {
        console.warn("Angular Grab: Failed to copy instruction + context", e);
      }
    }

    this.closeInstructionPanel();
  }
}
