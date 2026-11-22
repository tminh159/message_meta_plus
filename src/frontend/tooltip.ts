import type { SpindleFrontendContext } from "lumiverse-spindle-types";

export interface TooltipRow {
  label: string;
  value: string;
  details?: string[];
}

let fallbackIdCounter = 0;

/**
 * Generates a unique DOM identifier using `ctx.uuid` when `frontend-uuid-v1` is
 * available, falling back to a monotonic counter.
 */
export function createSafeId(ctx: SpindleFrontendContext, prefix = "mmp"): string {
  const hasFrontendUuid = (ctx.host?.capabilities?.["frontend-uuid-v1"] ?? 0) >= 1;
  if (hasFrontendUuid && ctx.uuid && typeof ctx.uuid.v4 === "function") {
    return `${prefix}-${ctx.uuid.v4()}`;
  }
  if (ctx.uuid && typeof ctx.uuid.v7 === "function") {
    return `${prefix}-${ctx.uuid.v7()}`;
  }
  fallbackIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdCounter}`;
}

export interface PortalTooltipController {
  attach(anchorEl: HTMLElement, rows: ReadonlyArray<TooltipRow>, signal?: AbortSignal): void;
  hide(): void;
  destroy(): void;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

export function createPortalTooltipController(ctx: SpindleFrontendContext): PortalTooltipController {
  const tooltipId = createSafeId(ctx, "mmp-tooltip");
  let tooltipEl: HTMLElement | null = null;
  let activeAnchor: HTMLElement | null = null;
  let pinnedAnchor: HTMLElement | null = null;
  let destroyed = false;

  const ensureTooltipElement = (): HTMLElement => {
    if (tooltipEl && tooltipEl.isConnected) return tooltipEl;
    if (tooltipEl) {
      document.body.appendChild(tooltipEl);
      return tooltipEl;
    }
    const el =
      typeof ctx.dom?.createElement === "function"
        ? ctx.dom.createElement("div", {
            id: tooltipId,
            class: "mmp-tooltip",
            role: "tooltip",
          })
        : (() => {
            const node = document.createElement("div");
            node.id = tooltipId;
            node.className = "mmp-tooltip";
            node.setAttribute("role", "tooltip");
            return node;
          })();
    tooltipEl = el;
    document.body.appendChild(el);
    return el;
  };

  const renderRows = (el: HTMLElement, rows: ReadonlyArray<TooltipRow>): void => {
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const entry = document.createElement("div");
      entry.className = "mmp-tooltip-entry";

      const line = document.createElement("div");
      line.className = "mmp-tooltip-row";

      const label = document.createElement("span");
      label.className = "mmp-tooltip-label";
      label.textContent = row.label;

      const value = document.createElement("span");
      value.className = "mmp-tooltip-value";
      value.textContent = row.value;

      line.append(label, value);
      entry.appendChild(line);

      if (Array.isArray(row.details) && row.details.length > 0) {
        const details = document.createElement("div");
        details.className = "mmp-tooltip-details";
        for (const item of row.details) {
          const chip = document.createElement("span");
          chip.className = "mmp-tooltip-detail-chip";
          chip.textContent = item;
          chip.title = item;
          details.appendChild(chip);
        }
        entry.appendChild(details);
      }

      fragment.appendChild(entry);
    }
    el.replaceChildren(fragment);
  };

  const getUiScale = (): number => {
    try {
      const geomScale = ctx.ui?.geometry?.getUiScale?.();
      if (typeof geomScale === "number" && Number.isFinite(geomScale) && geomScale > 0) {
        return geomScale;
      }
    } catch {
      // Fall back to CSS variable
    }
    if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--lumiverse-ui-scale");
        const parsed = Number.parseFloat(raw);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      } catch {
        // Ignore
      }
    }
    return 1;
  };

  const getLayoutViewport = (uiScale: number): { width: number; height: number } => {
    try {
      const vp = ctx.ui?.geometry?.layoutViewportSize?.();
      if (vp && Number.isFinite(vp.width) && Number.isFinite(vp.height) && vp.width > 0 && vp.height > 0) {
        return vp;
      }
    } catch {
      // Fall back to window dimensions divided by uiScale
    }
    const rawW = window.innerWidth || document.documentElement?.clientWidth || 1024;
    const rawH = window.innerHeight || document.documentElement?.clientHeight || 768;
    return {
      width: rawW / uiScale,
      height: rawH / uiScale,
    };
  };

  const getLayoutRect = (
    element: HTMLElement,
    uiScale: number,
  ): { left: number; top: number; bottom: number; width: number; height: number } => {
    try {
      const lr = ctx.ui?.geometry?.layoutElementRect?.(element);
      if (lr && Number.isFinite(lr.x) && Number.isFinite(lr.y)) {
        return {
          left: lr.x,
          top: lr.y,
          bottom: lr.y + lr.height,
          width: lr.width,
          height: lr.height,
        };
      }
    } catch {
      // Fall back to getBoundingClientRect divided by uiScale
    }
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left / uiScale,
      top: rect.top / uiScale,
      bottom: rect.bottom / uiScale,
      width: rect.width / uiScale,
      height: rect.height / uiScale,
    };
  };

  const positionTooltip = (el: HTMLElement, anchorEl: HTMLElement): void => {
    const uiScale = getUiScale();
    const anchorRect = getLayoutRect(anchorEl, uiScale);
    const viewport = getLayoutViewport(uiScale);

    el.style.visibility = "hidden";
    el.style.left = "0px";
    el.style.top = "0px";

    const tipRect = getLayoutRect(el, uiScale);
    const tipWidth = tipRect.width || 220;
    const tipHeight = tipRect.height || 64;

    let left = anchorRect.left;
    if (left + tipWidth > viewport.width - VIEWPORT_MARGIN) {
      left = viewport.width - tipWidth - VIEWPORT_MARGIN;
    }
    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN;
    }

    let top = anchorRect.top - tipHeight - ANCHOR_GAP;
    if (top < VIEWPORT_MARGIN) {
      const belowTop = anchorRect.bottom + ANCHOR_GAP;
      if (belowTop + tipHeight <= viewport.height - VIEWPORT_MARGIN) {
        top = belowTop;
      } else {
        top = Math.max(VIEWPORT_MARGIN, Math.min(belowTop, viewport.height - tipHeight - VIEWPORT_MARGIN));
      }
    }

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = "visible";
  };

  const setExpanded = (anchorEl: HTMLElement | null, expanded: boolean): void => {
    if (!anchorEl) return;
    anchorEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (expanded) {
      anchorEl.setAttribute("aria-describedby", tooltipId);
    } else {
      anchorEl.removeAttribute("aria-describedby");
    }
  };

  const hide = (): void => {
    setExpanded(activeAnchor, false);
    setExpanded(pinnedAnchor, false);
    activeAnchor = null;
    pinnedAnchor = null;
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  };

  const show = (anchorEl: HTMLElement, rows: ReadonlyArray<TooltipRow>, pin = false): void => {
    if (destroyed || rows.length === 0 || !anchorEl.isConnected) return;
    if (activeAnchor && activeAnchor !== anchorEl) {
      setExpanded(activeAnchor, false);
    }
    if (pinnedAnchor && pinnedAnchor !== anchorEl) {
      setExpanded(pinnedAnchor, false);
      pinnedAnchor = null;
    }
    activeAnchor = anchorEl;
    if (pin) {
      pinnedAnchor = anchorEl;
    }
    setExpanded(anchorEl, true);
    const el = ensureTooltipElement();
    renderRows(el, rows);
    positionTooltip(el, anchorEl);
  };

  const onDocumentPointerDown = (event: Event): void => {
    if (!activeAnchor && !pinnedAnchor) return;
    const target = event.target as Node | null;
    if (!target) {
      hide();
      return;
    }
    if (tooltipEl?.contains(target)) return;
    if (activeAnchor?.contains(target) || pinnedAnchor?.contains(target)) return;
    hide();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && (activeAnchor || pinnedAnchor)) {
      hide();
    }
  };

  const onWindowScroll = (event: Event): void => {
    if (!activeAnchor && !pinnedAnchor) return;
    const target = event.target as Node | null;
    if (target && tooltipEl?.contains(target)) return;
    hide();
  };

  const onWindowResize = (): void => {
    if (activeAnchor && !activeAnchor.isConnected) {
      hide();
      return;
    }
    if (activeAnchor && tooltipEl) {
      positionTooltip(tooltipEl, activeAnchor);
    }
  };

  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  window.addEventListener("scroll", onWindowScroll, true);
  window.addEventListener("resize", onWindowResize);

  const attach = (
    anchorEl: HTMLElement,
    rows: ReadonlyArray<TooltipRow>,
    signal?: AbortSignal,
  ): void => {
    const listenerOpts: AddEventListenerOptions = signal ? { signal } : {};

    anchorEl.addEventListener(
      "mouseenter",
      () => {
        show(anchorEl, rows, false);
      },
      listenerOpts,
    );

    anchorEl.addEventListener(
      "mouseleave",
      (event: MouseEvent) => {
        if (pinnedAnchor === anchorEl) return;
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && tooltipEl?.contains(nextTarget)) return;
        if (activeAnchor === anchorEl) {
          hide();
        }
      },
      listenerOpts,
    );

    anchorEl.addEventListener(
      "focus",
      () => {
        show(anchorEl, rows, false);
      },
      listenerOpts,
    );

    anchorEl.addEventListener(
      "blur",
      (event: FocusEvent) => {
        if (pinnedAnchor === anchorEl) return;
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && tooltipEl?.contains(nextTarget)) return;
        if (activeAnchor === anchorEl) {
          hide();
        }
      },
      listenerOpts,
    );

    anchorEl.addEventListener(
      "click",
      (event: MouseEvent) => {
        event.stopPropagation();
        if (pinnedAnchor === anchorEl) {
          hide();
        } else {
          show(anchorEl, rows, true);
        }
      },
      listenerOpts,
    );
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    hide();
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    window.removeEventListener("scroll", onWindowScroll, true);
    window.removeEventListener("resize", onWindowResize);
  };

  return {
    attach,
    hide,
    destroy,
  };
}
