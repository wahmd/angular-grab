import { Injectable } from "@angular/core";

interface ComponentFrame {
  componentName: string;
  filePath?: string;
  lineNumber?: number;
}

@Injectable({ providedIn: "root" })
export class AngularGrabContextService {
  /**
   * Get Angular component from DOM element using ng.probe()
   */
  getComponent(element: Element): any {
    if (typeof (window as any).ng === "undefined") {
      return null;
    }

    try {
      const ng = (window as any).ng;

      // Check if ng.probe exists and is a function
      if (!ng.probe || typeof ng.probe !== "function") {
        return null;
      }

      const probe = ng.probe(element);
      if (!probe) {
        return null;
      }

      // Try to get componentInstance directly (most common case)
      if (probe.componentInstance) {
        return probe.componentInstance;
      }

      // Try to get component from injector
      if (probe.injector) {
        try {
          // Get the component token from the injector
          // In Angular, components are typically provided via their class token
          const componentToken = probe.injector.get
            ? probe.injector.get(probe.injector.constructor, null)
            : null;

          if (componentToken && componentToken.constructor) {
            return componentToken;
          }

          // Alternative: try to get from view
          if (probe.injector._view) {
            const view = probe.injector._view;
            if (view.context && view.context.constructor) {
              return view.context;
            }
          }
        } catch (e) {
          // Ignore injector errors, try next method
        }
      }

      // Check if probe has a context property (some Angular versions)
      if (probe.context) {
        return probe.context;
      }

      // Walk up the probe parent chain to find the component that owns this element
      // (e.g. a <button> is not a component host; its parent component is)
      let current: any = probe.parent;
      let iterations = 0;
      const maxIterations = 50;
      while (current && iterations < maxIterations) {
        const component = this.getComponentFromProbe(current);
        if (component) {
          return component;
        }
        current = current.parent;
        iterations++;
      }

      return null;
    } catch (error) {
      // Log error for debugging
      console.debug("Angular Grab: getComponent error:", error);
      return null;
    }
  }

  /**
   * Helper to extract component from a probe object
   */
  private getComponentFromProbe(probe: any): any {
    if (!probe) return null;
    if (probe.componentInstance) return probe.componentInstance;
    if (probe.context) return probe.context;
    if (probe.injector?._view?.context) return probe.injector._view.context;
    return null;
  }

  /**
   * Get Angular DebugElement from DOM element using ng.probe()
   */
  private getDebugElement(element: Element): any {
    if (typeof (window as any).ng === "undefined") {
      return null;
    }

    try {
      const ng = (window as any).ng;
      if (!ng.probe || typeof ng.probe !== "function") {
        return null;
      }

      return ng.probe(element) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if element is likely to have an Angular component
   * (custom element tags, elements with Angular attributes, etc.)
   */
  private isLikelyAngularElement(element: Element): boolean {
    // Custom element tags (Angular components)
    if (element.tagName.includes("-")) {
      return true;
    }

    // Elements with Angular-specific attributes
    const angularAttrs = Array.from(element.attributes).some((attr) =>
      /^_ngcontent|^ng-reflect|^_nghost|^ng-version/.test(attr.name)
    );
    if (angularAttrs) {
      return true;
    }

    return false;
  }

  /**
   * Find the nearest element that has an Angular component
   * This helps when starting from deeply nested elements or text nodes
   */
  private findNearestComponentElement(element: Element | null): Element | null {
    if (!element) return null;

    // First, try to use ng.probe to traverse up the component tree
    try {
      const ng = (window as any).ng;
      if (ng && ng.probe && typeof ng.probe === "function") {
        let probe = ng.probe(element);
        let currentElement: Element | null = element;
        let iterations = 0;
        const maxIterations = 20;

        // Traverse up using probe's parent chain
        while (probe && currentElement && iterations < maxIterations) {
          const component = this.getComponentFromProbe(probe);
          if (component) {
            return currentElement;
          }

          // Try parent element's probe
          if (currentElement.parentElement) {
            currentElement = currentElement.parentElement;
            probe = ng.probe(currentElement);
          } else {
            break;
          }
          iterations++;
        }
      }
    } catch (e) {
      // Fall through to DOM traversal
    }

    // Fallback: DOM traversal
    let current: Element | null = element;
    let iterations = 0;
    const maxIterations = 20;

    while (current && iterations < maxIterations) {
      // Check if this element has a component
      const component = this.getComponent(current);
      if (component) {
        return current;
      }

      // Also check if this looks like an Angular component host
      if (this.isLikelyAngularElement(current)) {
        // Double-check it has a component
        const testComponent = this.getComponent(current);
        if (testComponent) {
          return current;
        }
      }

      current = current.parentElement;
      iterations++;
    }

    return element; // Return original element if we can't find a better one
  }

  /**
   * Get component name from element.
   * Walks up the tree (probe parent chain, then DOM) so that nested elements
   * (e.g. a <button> inside a component) resolve to the owning component.
   */
  getComponentName(element: Element): string | null {
    const component = this.getComponent(element);
    if (component) {
      const name = component.constructor?.name;
      if (name && this.isValidComponentName(name)) {
        return name;
      }
    }

    // Fallback: walk up DOM and use first custom element tag (e.g. app-my-button -> AppMyButtonComponent)
    return this.getComponentNameFromDomFallback(element);
  }

  /**
   * When ng.probe is unavailable or doesn't expose the component, infer name from
   * the nearest parent custom element (tag with hyphen).
   */
  private getComponentNameFromDomFallback(element: Element | null): string | null {
    let current: Element | null = element;
    const maxIterations = 30;
    let iterations = 0;

    while (current && iterations < maxIterations) {
      const tagName = current.tagName?.toLowerCase();
      if (tagName && tagName.includes("-")) {
        const inferred = this.tagNameToComponentName(tagName);
        if (inferred) return inferred;
      }
      current = current.parentElement;
      iterations++;
    }

    return null;
  }

  /**
   * Get component hierarchy by traversing up the Angular component tree
   * Similar to React's component stack, showing parent components
   */
  getComponentHierarchy(
    element: Element,
    maxDepth: number = 3
  ): ComponentFrame[] {
    const hierarchy: ComponentFrame[] = [];
    const seenComponents = new Set<any>(); // Avoid duplicates

    // Check if ng.probe is available
    const ng = (window as any).ng;

    // Debug: log what's available
    console.log("Angular Grab: Checking ng.probe availability:", {
      ngExists: typeof ng !== "undefined",
      ngType: typeof ng,
      ngKeys: ng ? Object.keys(ng) : [],
      hasProbe: ng && typeof ng.probe !== "undefined",
      probeType: ng && ng.probe ? typeof ng.probe : "N/A",
    });

    const hasNgProbe =
      typeof ng !== "undefined" && ng.probe && typeof ng.probe === "function";

    if (!hasNgProbe) {
      console.warn(
        "Angular Grab: ng.probe is not available. Trying alternative methods."
      );
      console.warn(
        "Angular Grab: Make sure you're running 'ng serve' (not 'ng build') and Angular is in dev mode."
      );

      // Prefer DOM-based detection first (more reliable for user components)
      console.log("Angular Grab: Using DOM-based fallback detection");
      const fallbackHierarchy = this.getComponentHierarchyFallback(
        element,
        maxDepth
      );

      // If DOM-based found components, use those
      if (fallbackHierarchy.length > 0) {
        console.log(
          "Angular Grab: DOM-based detection found",
          fallbackHierarchy.length,
          "component(s)"
        );
        return fallbackHierarchy;
      }

      // Otherwise, try __ngContext__ as a last resort
      console.log(
        "Angular Grab: DOM-based found no components, trying __ngContext__"
      );
      const hierarchyFromContext = this.getComponentHierarchyFromNgContext(
        element,
        maxDepth
      );
      if (hierarchyFromContext.length > 0) {
        console.log(
          "Angular Grab: Found components via __ngContext__, returning",
          hierarchyFromContext.length,
          "components"
        );
        return hierarchyFromContext;
      }

      return fallbackHierarchy; // Return empty or whatever we found
    }

    // Start from the nearest element that likely has a component
    // This helps when the initial element is deeply nested or a text node
    let currentElement: Element | null =
      this.findNearestComponentElement(element);
    let componentsFound = 0;
    let iterations = 0;
    const maxIterations = 100; // Safety limit to prevent infinite loops

    // Traverse using Angular's debug API parent chain (more reliable than DOM traversal)
    console.log(
      "Angular Grab: Starting traversal from element:",
      currentElement?.tagName,
      currentElement?.className
    );

    let probe = ng.probe(currentElement);
    let probeIterations = 0;
    const maxProbeIterations = 20;

    // First, try traversing using Angular's debug API parent chain
    while (
      probe &&
      componentsFound < maxDepth &&
      probeIterations < maxProbeIterations
    ) {
      const component = this.getComponentFromProbe(probe);

      if (component && !seenComponents.has(component)) {
        seenComponents.add(component);
        const name = component.constructor?.name;

        console.log(
          `Angular Grab: Found component "${name}" via probe traversal`
        );

        if (name && this.isValidComponentName(name)) {
          let filePath: string;
          try {
            filePath = this.getComponentFilePath(component);
            if (!filePath) {
              const kebabCase = name
                .replace(/Component$/, "")
                .replace(/([A-Z])/g, "-$1")
                .toLowerCase()
                .replace(/^-/, "");
              filePath = `src/app/${kebabCase}/${kebabCase}.component.ts`;
            }
          } catch (error) {
            console.warn(
              "Angular Grab: Failed to get file path for component",
              name,
              error
            );
            const kebabCase = name
              .replace(/Component$/, "")
              .replace(/([A-Z])/g, "-$1")
              .toLowerCase()
              .replace(/^-/, "");
            filePath = `src/app/${kebabCase}/${kebabCase}.component.ts`;
          }

          const frame: ComponentFrame = {
            componentName: name,
            filePath: filePath,
          };

          hierarchy.push(frame);
          componentsFound++;
        }
      }

      // Move to parent probe
      probe = probe.parent;
      probeIterations++;
    }

    // Fallback: DOM traversal if probe traversal didn't find enough components
    if (componentsFound < maxDepth) {
      console.log(
        `Angular Grab: Probe traversal found ${componentsFound} components, trying DOM traversal`
      );

      while (
        currentElement &&
        componentsFound < maxDepth &&
        iterations < maxIterations
      ) {
        const component = this.getComponent(currentElement);

        if (component && !seenComponents.has(component)) {
          seenComponents.add(component);
          const name = component.constructor?.name;

          if (name && this.isValidComponentName(name)) {
            let filePath: string;
            try {
              filePath = this.getComponentFilePath(component);
              if (!filePath) {
                const kebabCase = name
                  .replace(/Component$/, "")
                  .replace(/([A-Z])/g, "-$1")
                  .toLowerCase()
                  .replace(/^-/, "");
                filePath = `src/app/${kebabCase}/${kebabCase}.component.ts`;
              }
            } catch (error) {
              console.warn(
                "Angular Grab: Failed to get file path for component",
                name,
                error
              );
              const kebabCase = name
                .replace(/Component$/, "")
                .replace(/([A-Z])/g, "-$1")
                .toLowerCase()
                .replace(/^-/, "");
              filePath = `src/app/${kebabCase}/${kebabCase}.component.ts`;
            }

            const frame: ComponentFrame = {
              componentName: name,
              filePath: filePath,
            };

            hierarchy.push(frame);
            componentsFound++;
          }
        }

        currentElement = currentElement.parentElement;
        iterations++;
      }
    }

    if (hierarchy.length === 0) {
      console.warn(
        "Angular Grab: No components found in hierarchy after",
        iterations,
        "iterations"
      );
      console.warn(
        "Angular Grab: ng.probe available:",
        typeof (window as any).ng !== "undefined" &&
          (window as any).ng.probe &&
          typeof (window as any).ng.probe === "function"
      );

      // Try to test ng.probe on the root element
      try {
        const testProbe = ng.probe(document.body);
        console.log("Angular Grab: Test probe on body:", {
          found: !!testProbe,
          hasComponentInstance: !!testProbe?.componentInstance,
          hasInjector: !!testProbe?.injector,
        });
      } catch (e) {
        console.error("Angular Grab: Error testing ng.probe:", e);
      }
    }

    return hierarchy;
  }

  /**
   * Try to get component hierarchy using __ngContext__ property
   * This is available in some Angular versions even without ng.probe
   */
  private getComponentHierarchyFromNgContext(
    element: Element,
    maxDepth: number = 3
  ): ComponentFrame[] {
    const hierarchy: ComponentFrame[] = [];
    const seenComponents = new Set<any>();
    let currentElement: Element | null = element;
    let componentsFound = 0;
    let iterations = 0;
    const maxIterations = 50;

    while (
      currentElement &&
      componentsFound < maxDepth &&
      iterations < maxIterations
    ) {
      // Check for __ngContext__ property (available in Angular 9+)
      const ngContext = (currentElement as any).__ngContext__;
      if (ngContext && Array.isArray(ngContext)) {
        // In Angular's __ngContext__, component instances are typically stored
        // at specific indices. The structure is: [lView, tView, ...]
        // Component instances are usually in the lView array

        // Try to find component instance in the context
        // Method 1: Check if ngContext[8] or ngContext[9] contains the component (common in Angular 9+)
        const possibleComponentIndices = [8, 9, 10, 1];
        for (const idx of possibleComponentIndices) {
          if (ngContext[idx] && typeof ngContext[idx] === "object") {
            const candidate = ngContext[idx];
            // Check if it's a component instance (has constructor and looks like a component)
            if (
              candidate.constructor &&
              candidate.constructor.name &&
              !seenComponents.has(candidate)
            ) {
              const name = candidate.constructor.name;
              if (this.isValidComponentName(name)) {
                seenComponents.add(candidate);
                const filePath = this.getComponentFilePath(candidate);
                hierarchy.push({
                  componentName: name,
                  filePath: filePath,
                });
                componentsFound++;
                console.log(
                  `Angular Grab: Found component "${name}" via __ngContext__[${idx}]`
                );
                break; // Found a component on this element, move to next
              }
            }
          }
        }

        // Method 2: If no component found at known indices, iterate through all items
        // but be more selective about what we accept
        if (componentsFound === 0 || iterations === 0) {
          for (
            let i = 0;
            i < ngContext.length && componentsFound < maxDepth;
            i++
          ) {
            const item = ngContext[i];
            if (
              item &&
              typeof item === "object" &&
              item.constructor &&
              item.constructor.name &&
              !seenComponents.has(item)
            ) {
              const name = item.constructor.name;
              // Only accept if it's clearly a user component (ends with Component)
              if (
                name.endsWith("Component") &&
                name.length > 9 &&
                this.isValidComponentName(name)
              ) {
                seenComponents.add(item);
                const filePath = this.getComponentFilePath(item);
                hierarchy.push({
                  componentName: name,
                  filePath: filePath,
                });
                componentsFound++;
                console.log(
                  `Angular Grab: Found component "${name}" via __ngContext__[${i}]`
                );
              }
            }
          }
        }
      }

      currentElement = currentElement.parentElement;
      iterations++;
    }

    return hierarchy;
  }

  /**
   * Fallback method to detect components using DOM analysis when ng.probe is not available
   * This works by finding custom element tags (Angular components) and inferring component names
   */
  private getComponentHierarchyFallback(
    element: Element,
    maxDepth: number = 3
  ): ComponentFrame[] {
    const hierarchy: ComponentFrame[] = [];
    const seenTags = new Set<string>();
    let currentElement: Element | null = element;
    let componentsFound = 0;
    let iterations = 0;
    const maxIterations = 50;

    console.log("Angular Grab: Using fallback DOM-based component detection");
    console.log(
      "Angular Grab: Starting from element:",
      element.tagName,
      element.className
    );

    // Traverse up the DOM tree looking for Angular component host elements
    while (
      currentElement &&
      componentsFound < maxDepth &&
      iterations < maxIterations
    ) {
      const tagName = currentElement.tagName.toLowerCase();

      if (iterations < 10) {
        console.log(
          `Angular Grab: Checking element [${iterations}]:`,
          tagName,
          currentElement.className?.substring(0, 50)
        );
      }

      // Angular components are typically:
      // 1. Custom elements (contain a hyphen, e.g., "app-button", "my-component")
      // 2. Elements with Angular-specific attributes (ng-version, _ngcontent, etc.)
      const isCustomElement = tagName.includes("-");
      const hasAngularAttrs = this.isLikelyAngularElement(currentElement);

      if ((isCustomElement || hasAngularAttrs) && !seenTags.has(tagName)) {
        seenTags.add(tagName);

        // Convert tag name to component name
        // e.g., "app-button" -> "AppButtonComponent"
        const componentName = this.tagNameToComponentName(tagName);

        if (componentName) {
          // Generate file path from component name
          const filePath =
            this.generateFilePathFromComponentName(componentName);

          const frame: ComponentFrame = {
            componentName: componentName,
            filePath: filePath,
          };

          hierarchy.push(frame);
          componentsFound++;

          console.log(
            `Angular Grab: ✓ Detected component "${componentName}" from tag "${tagName}"`
          );
        } else {
          console.log(
            `Angular Grab: Skipped tag "${tagName}" (not a valid component name)`
          );
        }
      }

      // Also check for Angular component selectors in attributes
      // Some components might be rendered as standard HTML elements with component selectors
      const componentSelector =
        currentElement.getAttribute("ng-component") ||
        currentElement.getAttribute("data-component");

      if (componentSelector && !seenTags.has(componentSelector)) {
        seenTags.add(componentSelector);
        const componentName = this.tagNameToComponentName(componentSelector);
        if (componentName) {
          const filePath =
            this.generateFilePathFromComponentName(componentName);
          hierarchy.push({
            componentName: componentName,
            filePath: filePath,
          });
          componentsFound++;
        }
      }

      currentElement = currentElement.parentElement;
      iterations++;
    }

    // If we didn't find any components, try to infer from the element's context
    if (hierarchy.length === 0) {
      console.log(
        "Angular Grab: No custom elements found in parent chain, checking for Angular app root"
      );

      // Look for the Angular app root element (usually has ng-version attribute)
      const appRoot = document.querySelector("[ng-version]");
      if (appRoot) {
        const rootTag = appRoot.tagName.toLowerCase();
        console.log("Angular Grab: Found app root element:", rootTag);
        const componentName = this.tagNameToComponentName(rootTag);
        if (componentName) {
          hierarchy.push({
            componentName: componentName,
            filePath: this.generateFilePathFromComponentName(componentName),
          });
          console.log(`Angular Grab: Added root component "${componentName}"`);
        }
      } else {
        console.warn(
          "Angular Grab: Could not find Angular app root element with [ng-version] attribute"
        );
      }
    } else {
      console.log(
        `Angular Grab: Fallback detection found ${hierarchy.length} component(s)`
      );
    }

    return hierarchy;
  }

  /**
   * Convert HTML tag name to Angular component name
   * e.g., "app-button" -> "AppButtonComponent"
   */
  private tagNameToComponentName(tagName: string): string | null {
    // Skip standard HTML tags
    const standardTags = [
      "div",
      "span",
      "button",
      "input",
      "form",
      "a",
      "img",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "table",
      "tr",
      "td",
      "th",
      "tbody",
      "thead",
      "tfoot",
    ];

    if (standardTags.includes(tagName)) {
      return null;
    }

    // Convert kebab-case to PascalCase
    const parts = tagName.split("-");
    const pascalCase = parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");

    // Add "Component" suffix if not already present
    if (!pascalCase.endsWith("Component")) {
      return `${pascalCase}Component`;
    }

    return pascalCase;
  }

  /**
   * Generate file path from component name
   */
  private generateFilePathFromComponentName(componentName: string): string {
    // Remove "Component" suffix if present
    let baseName = componentName.replace(/Component$/, "");

    // Convert PascalCase to kebab-case
    const kebabCase = baseName
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");

    // Generate common Angular paths
    return `src/app/${kebabCase}/${kebabCase}.component.ts`;
  }

  /**
   * Normalize file path (remove webpack/ng-cli prefixes, make relative)
   */
  private normalizeFilePath(filePath: string): string {
    // Remove webpack:// prefixes
    let normalized = filePath.replace(/^webpack:\/\/\//g, "");

    // Remove ng:// prefixes
    normalized = normalized.replace(/^ng:\/\//g, "");

    // Remove absolute path prefixes (keep relative paths)
    normalized = normalized.replace(/^\/[^/]+/, "");

    // Remove leading ./ if present
    normalized = normalized.replace(/^\.\//, "");

    // Extract just the file path (remove line/column info if present)
    normalized = normalized.split(":")[0];

    return normalized;
  }

  /**
   * Try to extract file path from Angular component
   * This works if source maps are available or component metadata is accessible
   */
  private getComponentFilePath(component: any): string {
    // Ensure we always return a string (never undefined)
    if (!component || !component.constructor) {
      return `src/app/component.ts`;
    }

    try {
      const componentName = component.constructor.name;

      if (!componentName) {
        return `src/app/component.ts`;
      }

      // Method 1: Try to get from component constructor by accessing a property
      // This generates a real stack trace that includes the source file
      try {
        // Access a property to trigger getter which will show in stack trace
        const getter = Object.getOwnPropertyDescriptor(
          component.constructor.prototype,
          "ngOnInit"
        );
        if (getter && getter.get) {
          try {
            getter.get.call(component);
          } catch {
            // Expected to fail, we just want the stack trace
          }
        }

        // Now create error from within component context
        const error = new Error();
        const stack = error.stack || "";
        const lines = stack.split("\n");

        // Look for component name or constructor in stack trace
        for (const line of lines) {
          if (
            (line.includes(componentName) || line.includes("constructor")) &&
            line.includes(".ts")
          ) {
            // Match file paths in various formats
            const patterns = [
              /([^\s()]+\.ts)(?::\d+)?(?::\d+)?/, // Standard format
              /at\s+[^\s]+\s+\(([^\s]+\.ts)/, // "at FunctionName (file.ts:line)"
              /\(([^\s]+\.ts)/, // "(file.ts:line)"
            ];

            for (const pattern of patterns) {
              const match = line.match(pattern);
              if (match && match[1]) {
                const filePath = this.normalizeFilePath(match[1]);
                // Only return if it looks like a real file path
                if (filePath.includes("/") || filePath.includes("\\")) {
                  return filePath;
                }
              }
            }
          }
        }
      } catch {
        // Stack trace method failed, try next
      }

      // Method 2: Try to get from Angular ng.probe debug info
      try {
        const ng = (window as any).ng;
        if (ng && ng.probe && typeof ng.probe === "function") {
          // Try to get component factory from ng.probe
          const element =
            document.querySelector(`[ng-version]`) || document.body;
          const probe = ng.probe(element);
          if (probe && probe.componentFactory) {
            const factory = probe.componentFactory;
            if (factory.selector) {
              // Component factory might have source info
              const factoryStr = factory.toString();
              const sourceMatch = factoryStr.match(/@([^\s]+\.ts)/);
              if (sourceMatch) {
                return this.normalizeFilePath(sourceMatch[1]);
              }
            }
          }
        }
      } catch {
        // ng.probe method failed or not available
      }

      // Method 3: Try to get from component constructor source location
      const constructorString = component.constructor.toString();
      const sourceMatch = constructorString.match(/@([^\s]+\.ts)/);
      if (sourceMatch) {
        const filePath = this.normalizeFilePath(sourceMatch[1]);
        if (filePath.includes("/") || filePath.includes("\\")) {
          return filePath;
        }
      }

      // Method 4: Try to get from Angular decorator metadata (if available in dev mode)
      const annotations =
        (component.constructor as any).__annotations__ ||
        (component.constructor as any).__decorators__;
      if (annotations) {
        for (const annotation of Array.isArray(annotations)
          ? annotations
          : [annotations]) {
          if (annotation) {
            // Check various possible source locations
            if (annotation.source) {
              return this.normalizeFilePath(annotation.source);
            }
            if (annotation.filePath) {
              return this.normalizeFilePath(annotation.filePath);
            }
            if (annotation.__source) {
              return this.normalizeFilePath(annotation.__source);
            }
          }
        }
      }

      // Method 5: Try to infer from component name (fallback - always works)
      if (componentName) {
        let kebabCase: string;

        if (componentName.endsWith("Component")) {
          // Remove "Component" suffix
          kebabCase = componentName
            .replace(/Component$/, "")
            .replace(/([A-Z])/g, "-$1")
            .toLowerCase()
            .replace(/^-/, "");
        } else {
          // For non-Component classes, just convert to kebab-case
          kebabCase = componentName
            .replace(/([A-Z])/g, "-$1")
            .toLowerCase()
            .replace(/^-/, "");
        }

        // Common Angular project structures (try most common first)
        const possiblePaths = [
          `src/app/${kebabCase}/${kebabCase}.component.ts`,
          `src/app/components/${kebabCase}/${kebabCase}.component.ts`,
          `app/${kebabCase}/${kebabCase}.component.ts`,
          `src/${kebabCase}/${kebabCase}.component.ts`,
        ];

        // Return first plausible path (this is a best-guess fallback)
        return possiblePaths[0];
      }
    } catch (error) {
      // Log error in development for debugging
      if (typeof console !== "undefined" && console.warn) {
        console.warn("Angular Grab: Failed to extract file path", error);
      }
    }

    // Final fallback: return inferred path based on component name
    // This should always execute if componentName exists
    const finalComponentName = component?.constructor?.name;
    if (finalComponentName) {
      let kebabCase: string;

      if (finalComponentName.endsWith("Component")) {
        kebabCase = finalComponentName
          .replace(/Component$/, "")
          .replace(/([A-Z])/g, "-$1")
          .toLowerCase()
          .replace(/^-/, "");
      } else {
        kebabCase = finalComponentName
          .replace(/([A-Z])/g, "-$1")
          .toLowerCase()
          .replace(/^-/, "");
      }

      return `src/app/${kebabCase}/${kebabCase}.component.ts`;
    }

    // Absolute fallback - return a generic path (should never reach here, but ensures we always return)
    return `src/app/component.ts`;
  }

  /**
   * Generate context string for clipboard: HTML preview plus component stack lines.
   */
  async generateContext(
    element: Element,
    maxLines: number = 3
  ): Promise<string> {
    const html = this.getHTMLPreview(element);
    const hierarchy = this.getComponentHierarchy(element, maxLines);

    const stackContext: string[] = [];

    for (const frame of hierarchy) {
      let line = "\n  in ";

      // File path should always be set (getComponentFilePath has fallbacks)
      const filePath = frame.filePath;

      if (filePath) {
        line += `${frame.componentName} (at ${filePath}`;
        if (frame.lineNumber) {
          line += `:${frame.lineNumber}`;
        }
        line += ")";
      } else {
        // Fallback: show component name even without file path
        // This should rarely happen now since getComponentFilePath always returns a string
        console.warn(
          "Angular Grab: Frame missing filePath:",
          frame.componentName,
          frame
        );
        line += frame.componentName;
      }

      stackContext.push(line);
    }

    return `${html}${stackContext.join("")}`;
  }

  /**
   * Full-page capture for MCP: URL, title, visible text excerpt, component stack from body.
   */
  async generatePageContext(maxHierarchyDepth: number = 5): Promise<string> {
    const url =
      typeof window !== "undefined" ? window.location.href : "";
    const title =
      typeof document !== "undefined" ? document.title : "";
    const body = typeof document !== "undefined" ? document.body : null;
    const maxChars = 6000;
    let excerpt = "";
    if (body) {
      const raw = body.innerText ?? "";
      excerpt = raw.replace(/\s+/g, " ").trim();
      if (excerpt.length > maxChars) {
        excerpt = excerpt.slice(0, maxChars) + "\n…[truncated]";
      }
    }
    const hierarchy = body
      ? this.getComponentHierarchy(body, maxHierarchyDepth)
      : [];
    const stackContext: string[] = [];
    for (const frame of hierarchy) {
      let line = "\n  in ";
      const filePath = frame.filePath;
      if (filePath) {
        line += `${frame.componentName} (at ${filePath}`;
        if (frame.lineNumber) {
          line += `:${frame.lineNumber}`;
        }
        line += ")";
      } else {
        line += frame.componentName;
      }
      stackContext.push(line);
    }
    return (
      `Page\n  URL: ${url}\n  Title: ${title}\n\nElements:\n\nVisible text (excerpt):\n${excerpt}` +
      stackContext.join("")
    );
  }

  /**
   * Get a compact HTML-like preview of the element (Angular-specific attributes stripped).
   */
  private getHTMLPreview(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    if (!(element instanceof HTMLElement)) {
      return `<${tagName} />`;
    }

    const text = element.innerText?.trim() ?? element.textContent?.trim() ?? "";

    // Filter out Angular-specific attributes
    const angularAttributePatterns = [/^_ngcontent/, /^ng-reflect/, /^_nghost/];

    let attrsText = "";
    const attributes = Array.from(element.attributes);
    for (const attribute of attributes) {
      const name = attribute.name;

      // Skip Angular internal attributes
      if (angularAttributePatterns.some((pattern) => pattern.test(name))) {
        continue;
      }

      let value = attribute.value;
      // Truncate long attribute values for readability
      if (value.length > 20) {
        value = `${value.slice(0, 20)}...`;
      }
      attrsText += ` ${name}="${value}"`;
    }

    // Split child elements into lines above/below first text for a compact preview
    const topElements: Element[] = [];
    const bottomElements: Element[] = [];
    let foundFirstText = false;

    const childNodes = Array.from(element.childNodes);
    for (const node of childNodes) {
      if (node.nodeType === Node.COMMENT_NODE) continue;

      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent && node.textContent.trim().length > 0) {
          foundFirstText = true;
        }
      } else if (node instanceof Element) {
        if (!foundFirstText) {
          topElements.push(node);
        } else {
          bottomElements.push(node);
        }
      }
    }

    const formatElements = (elements: Element[]): string => {
      if (elements.length === 0) return "";
      if (elements.length <= 2) {
        return elements
          .map((el) => `<${el.tagName.toLowerCase()} ...>`)
          .join("\n  ");
      }
      return `(${elements.length} elements)`;
    };

    let content = "";
    const topElementsStr = formatElements(topElements);
    if (topElementsStr) content += `\n  ${topElementsStr}`;
    if (text.length > 0) {
      const truncatedText =
        text.length > 100 ? `${text.slice(0, 100)}...` : text;
      content += `\n  ${truncatedText}`;
    }
    const bottomElementsStr = formatElements(bottomElements);
    if (bottomElementsStr) content += `\n  ${bottomElementsStr}`;

    if (content.length > 0) {
      return `<${tagName}${attrsText}>${content}\n</${tagName}>`;
    }
    return `<${tagName}${attrsText} />`;
  }

  /**
   * Check if component name is valid (not Angular internal)
   */
  private isValidComponentName(name: string): boolean {
    // Filter Angular internals
    if (name.startsWith("_")) return false;
    if (name === "Object") return false;
    if (name.length < 2) return false;

    // Angular internal class patterns to exclude
    const angularInternals = [
      // Angular view/container classes
      "TView",
      "LView",
      "LContainer",
      "LComponentView",
      "LEmbeddedView",
      "TNode",
      "LCleanup",
      "TContainerNode",
      "TElementNode",
      "TTextNode",
      // Angular renderer classes
      "AnimationRendererFactory",
      "BaseAnimationRenderer",
      "Renderer2",
      "DefaultRenderer2",
      // Angular context classes
      "NgForOfContext",
      "NgIfContext",
      "NgSwitchContext",
      // Angular built-in directives (these are directives, not user components)
      "NgClass",
      "NgStyle",
      "NgIf",
      "NgFor",
      "NgForOf",
      "NgSwitch",
      "NgSwitchCase",
      "NgSwitchDefault",
      // DOM element types (not components)
      "HTMLDivElement",
      "HTMLElement",
      "HTMLButtonElement",
      "HTMLSpanElement",
      "HTMLInputElement",
      "Text",
      "Comment",
      "Document",
      "Window",
    ];

    if (angularInternals.includes(name)) {
      return false;
    }

    // Check for Angular internal patterns
    // Classes starting with T or L followed by capital letter are usually Angular internals
    if (/^[TL][A-Z]/.test(name) && !name.endsWith("Component")) {
      return false;
    }

    // Only accept names that end with Component or Directive (user-defined)
    // OR names that are clearly user components (PascalCase, not Angular internals)
    if (name.endsWith("Component") && name.length > 9) {
      // Make sure it's not an Angular internal component
      if (!name.startsWith("Ng") || name === "NgComponent") {
        return true;
      }
      // Allow user components that happen to start with Ng (like NgButtonComponent)
      // but exclude Angular built-ins
      const angularBuiltIns = ["NgClass", "NgIf", "NgFor", "NgSwitch"];
      return !angularBuiltIns.some((builtIn) => name.includes(builtIn));
    }

    if (name.endsWith("Directive") && name.length > 9) {
      // Exclude Angular built-in directives
      const angularDirectives = [
        "NgClass",
        "NgStyle",
        "NgIf",
        "NgFor",
        "NgForOf",
        "NgSwitch",
      ];
      return !angularDirectives.some((dir) => name.includes(dir));
    }

    // For other names, be very strict - only allow if they look like user components
    // and don't match Angular internal patterns
    if (
      name[0] === name[0].toUpperCase() &&
      name.length > 5 &&
      !/^[TL][A-Z]/.test(name) && // Not TView, LContainer, etc.
      !name.startsWith("Ng") && // Not NgClass, NgIf, etc. (unless it's NgSomethingComponent)
      !angularInternals.includes(name)
    ) {
      // Additional check: make sure it's not a DOM type
      if (!name.includes("Element") && !name.includes("Node")) {
        return true;
      }
    }

    return false;
  }
}
