import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { AngularGrabComponent } from "./angular-grab.component";
import { AngularGrabStateService } from "./angular-grab-state.service";
import { AngularGrabEventsService } from "./angular-grab-events.service";
import { AngularGrabContextService } from "./angular-grab-context.service";
import { AngularGrabCopyService } from "./angular-grab-copy.service";

@NgModule({
  declarations: [AngularGrabComponent],
  imports: [CommonModule],
  providers: [
    AngularGrabStateService,
    AngularGrabEventsService,
    AngularGrabContextService,
    AngularGrabCopyService,
  ],
  exports: [AngularGrabComponent],
})
export class AngularGrabModule {}
