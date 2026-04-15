import { Injectable, NgZone } from '@angular/core';
import { AngularGrabStateService } from './angular-grab-state.service';
import { AngularGrabContextService } from './angular-grab-context.service';
import { AngularGrabCopyService } from './angular-grab-copy.service';
import { AngularGrabMcpService } from './angular-grab-mcp.service';

const LONG_PRESS_MS = 500;

@Injectable({ providedIn: 'root' })
export class AngularGrabEventsService {
    private isInitialized = false;
    private lastElementDetectionTime = 0;
    private readonly THROTTLE_MS = 16; // ~60fps
    private longPressTimerId: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private stateService: AngularGrabStateService,
        private contextService: AngularGrabContextService,
        private copyService: AngularGrabCopyService,
        private mcpService: AngularGrabMcpService,
        private ngZone: NgZone
    ) {}

    initialize(): void {
        if (this.isInitialized) {
            return;
        }
        this.isInitialized = true;

        this.ngZone.runOutsideAngular(() => {
            window.addEventListener('keydown', this.handleKeyDown.bind(this), true);
            window.addEventListener('keyup', this.handleKeyUp.bind(this), true);
            window.addEventListener('mousemove', this.handleMouseMove.bind(this));
            window.addEventListener('click', this.handleClick.bind(this), true);
        });
    }

    /**
     * Native copy is suppressed while Ctrl/Cmd+C is held so we can distinguish a quick copy
     * from a 2s hold (grab). On release before the timer fires, we run execCommand("copy")
     * so normal copy still works.
     */
    private flushPendingNativeCopy(): void {
        if (this.longPressTimerId == null) return;
        clearTimeout(this.longPressTimerId);
        this.longPressTimerId = null;
        const state = this.stateService.getCurrentState();
        if (state.isActive || state.showInstructionPanel) return;
        document.execCommand('copy');
    }

    private handleKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            const state = this.stateService.getCurrentState();
            if (state.isActive || state.showInstructionPanel) {
                event.preventDefault();
                event.stopPropagation();
                if (this.longPressTimerId != null) {
                    clearTimeout(this.longPressTimerId);
                    this.longPressTimerId = null;
                }
                this.ngZone.run(() => this.stateService.closeInstructionPanel());
            }
            return;
        }

        const isModifier = event.metaKey || event.ctrlKey;
        const isCKey = event.key?.toLowerCase() === 'c';

        if (isModifier && isCKey) {
            const currentState = this.stateService.getCurrentState();
            if (currentState.isActive || currentState.showInstructionPanel) {
                return; // Already in workflow; do not start another long-press
            }
            // Key repeat: keep blocking native copy; do not start another timer
            if (event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (this.longPressTimerId != null) return;
            this.longPressTimerId = setTimeout(() => {
                this.longPressTimerId = null;
                this.ngZone.run(() => {
                    this.stateService.activate();
                });
            }, LONG_PRESS_MS);
        }
    }

    private handleKeyUp(event: KeyboardEvent): void {
        const isCKey = event.key?.toLowerCase() === 'c';
        const isModifierEdgeKey =
            event.key === 'Control' ||
            event.key === 'Meta' ||
            event.code === 'ControlLeft' ||
            event.code === 'ControlRight' ||
            event.code === 'MetaLeft' ||
            event.code === 'MetaRight';

        // Release C or modifier before 2s: restore normal copy via execCommand
        if (this.longPressTimerId != null && (isCKey || isModifierEdgeKey)) {
            this.flushPendingNativeCopy();
        }
        // Do not deactivate on keyup; workflow ends only when modal is closed or copy is completed
    }

    private handleMouseMove(event: MouseEvent): void {
        const now = performance.now();
        if (now - this.lastElementDetectionTime < this.THROTTLE_MS) {
            return;
        }
        this.lastElementDetectionTime = now;

        this.ngZone.run(() => {
            const state = this.stateService.getCurrentState();
            if (!state.isActive) return;

            // Update mouse position
            this.stateService.updateState({
                mousePosition: { x: event.clientX, y: event.clientY },
            });

            // Detect element at cursor position
            const element = document.elementFromPoint(event.clientX, event.clientY);
            if (element) {
                const componentName = this.contextService.getComponentName(element);
                this.stateService.updateState({
                    detectedElement: element,
                    componentName,
                });
            }
        });
    }

    private handleClick(event: MouseEvent): void {
        this.ngZone.run(async () => {
            const state = this.stateService.getCurrentState();
            if (!state.isActive) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            // Shift+click: full page (URL + excerpt + stack) for MCP
            if (event.shiftKey) {
                const result = await this.copyService.copyPage();
                if (result.success && result.context) {
                    const body = document.body;
                    this.stateService.updateState({
                        isActive: false,
                        detectedElement: body,
                        componentName: body
                            ? this.contextService.getComponentName(body)
                            : null,
                    });
                    void this.mcpService.trySendContext([result.context]);
                    this.stateService.openInstructionPanel(result.context, 'page');
                } else {
                    this.stateService.deactivate();
                }
                return;
            }

            if (!state.detectedElement) return;

            const result = await this.copyService.copyElement(state.detectedElement);

            if (result.success) {
                this.stateService.updateState({ isActive: false });
                if (result.context) {
                    void this.mcpService.trySendContext([result.context]);
                    this.stateService.openInstructionPanel(result.context, 'element');
                }
            } else {
                this.stateService.deactivate();
            }
        });
    }
}
