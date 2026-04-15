/**
 * ng-add: print wiring steps. (Avoids writing a guessed MCP script into package.json.)
 * @returns {import("@angular-devkit/schematics").Rule}
 */
function ngAdd() {
  return (_tree, context) => {
    context.logger.info("");
    context.logger.info("Angular Grab — next steps:");
    context.logger.info("");
    context.logger.info(
      "  • Import AngularGrabModule in AppModule (from the angular-grab package)."
    );
    context.logger.info(
      '  • Wrap your root template with <app-angular-grab>…</app-angular-grab>.'
    );
    context.logger.info(
      "  • Optionally provide ANGULAR_GRAB_FEEDBACK (InjectionToken) for MCP success/error UI."
    );
    context.logger.info(
      "  • Install and run the MCP server from the angular-grab-mcp package (see README), then connect your agent."
    );
    context.logger.info("");
    return _tree;
  };
}

module.exports = { ngAdd };
