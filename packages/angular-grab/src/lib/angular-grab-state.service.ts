import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";

export type GrabScope = "element" | "page";

export interface GrabState {
  isActive: boolean;
  detectedElement: Element | null;
  mousePosition: { x: number; y: number };
  componentName: string | null;
  showInstructionPanel: boolean;
  lastCopiedContext: string | null;
  grabScope: GrabScope;
}

@Injectable({ providedIn: "root" })
export class AngularGrabStateService {
  private state$ = new BehaviorSubject<GrabState>({
    isActive: false,
    detectedElement: null,
    mousePosition: { x: 0, y: 0 },
    componentName: null,
    showInstructionPanel: false,
    lastCopiedContext: null,
    grabScope: "element",
  });

  getState(): Observable<GrabState> {
    return this.state$.asObservable();
  }

  getCurrentState(): GrabState {
    return this.state$.value;
  }

  updateState(updates: Partial<GrabState>): void {
    this.state$.next({ ...this.state$.value, ...updates });
  }

  activate(): void {
    this.updateState({ isActive: true });
  }

  deactivate(): void {
    this.updateState({
      isActive: false,
      detectedElement: null,
      componentName: null,
      grabScope: "element",
    });
  }

  openInstructionPanel(context: string, grabScope: GrabScope = "element"): void {
    this.updateState({
      showInstructionPanel: true,
      lastCopiedContext: context,
      grabScope,
    });
  }

  /**
   * End the grab workflow (modal closed or copy completed).
   * Fully deactivates so grab stays off until next 2-sec Ctrl+C hold.
   */
  closeInstructionPanel(): void {
    this.updateState({
      isActive: false,
      showInstructionPanel: false,
      lastCopiedContext: null,
      detectedElement: null,
      componentName: null,
      grabScope: "element",
    });
  }
}
