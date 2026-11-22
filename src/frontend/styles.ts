export const MMP_STYLES = `
/* Wrapper created by ctx.dom.inject inside message mount points */
[data-spindle-mount="message_header"] > div:has(> .mmp-pill),
[data-spindle-mount="message_body_before"] > div:has(> .mmp-pill),
[data-spindle-mount="message_footer"] > div:has(> .mmp-pill),
.mmp-inj-wrap {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  max-width: 100%;
  min-width: 0;
}

/* Position: next-to-pill (default) — pull next to native MetaPill, clear of .actionsPill */
[data-spindle-mount="message_header"] > div:has(> .mmp-pill--pos-next-to-pill.mmp-pill--bubble),
.mmp-inj-wrap--next-to-pill.mmp-inj-wrap--bubble {
  align-self: flex-end;
  flex-shrink: 1;
  min-width: 0;
  max-width: 100%;
  margin-right: auto;
  margin-left: 0;
}

[data-spindle-mount="message_header"] > div:has(> .mmp-pill--pos-next-to-pill.mmp-pill--bubble.mmp-pill--row-reverse),
.mmp-inj-wrap--next-to-pill.mmp-inj-wrap--bubble.mmp-inj-wrap--row-reverse {
  align-self: flex-end;
  flex-shrink: 1;
  min-width: 0;
  max-width: 100%;
  margin-left: auto;
  margin-right: 0;
}

[data-spindle-mount="message_header"] > div:has(> .mmp-pill--pos-next-to-pill.mmp-pill--minimal),
.mmp-inj-wrap--next-to-pill.mmp-inj-wrap--minimal {
  align-self: center;
  margin-left: 0;
  margin-right: 0;
}

/* Position: header-corner — far side of message_header */
[data-spindle-mount="message_header"] > div:has(> .mmp-pill--pos-header-corner),
.mmp-inj-wrap--header-corner {
  align-self: flex-start;
}

/* Position: below-header (message_body_before) */
[data-spindle-mount="message_body_before"] > div:has(> .mmp-pill--pos-below-header),
.mmp-inj-wrap--below-header {
  display: block;
  width: 100%;
  margin: 0 0 8px;
}

.mmp-inj-wrap--below-header.mmp-inj-wrap--minimal {
  margin: 2px 0 6px;
}

/* Position: footer (message_footer) */
[data-spindle-mount="message_footer"] > div:has(> .mmp-pill--pos-footer.mmp-pill--bubble),
.mmp-inj-wrap--footer.mmp-inj-wrap--bubble {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 0 24px 14px;
  margin-top: -6px;
}

[data-spindle-mount="message_footer"] > div:has(> .mmp-pill--pos-footer.mmp-pill--bubble.mmp-pill--row-reverse),
.mmp-inj-wrap--footer.mmp-inj-wrap--bubble.mmp-inj-wrap--row-reverse {
  justify-content: flex-end;
}

[data-spindle-mount="message_footer"] > div:has(> .mmp-pill--pos-footer.mmp-pill--minimal),
.mmp-inj-wrap--footer.mmp-inj-wrap--minimal {
  display: flex;
  align-items: center;
  margin-top: 6px;
  padding: 0;
}

/* Companion Pill — matches Lumiverse native MetaPill look */
.mmp-pill {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  margin-top: 5px;
  padding: 4px 10px;
  border-radius: 16px;
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-family: ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Code', Menlo, Consolas, monospace;
  color: var(--lumiverse-text-muted, #b4b7c0);
  letter-spacing: 0.02em;
  flex-wrap: wrap;
  gap: 0;
  max-width: 100%;
  background: var(--lumiverse-fill-deepest, rgba(16, 16, 22, 0.85));
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  line-height: 1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  user-select: none;
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease),
    box-shadow var(--lumiverse-transition-fast, 150ms ease);
}

.mmp-pill--pos-next-to-pill,
.mmp-pill--pos-below-header,
.mmp-pill--pos-footer {
  margin-top: 0;
}

.mmp-pill--pos-header-corner {
  margin-top: 5px;
}

.mmp-pill:hover,
.mmp-pill[aria-expanded="true"] {
  color: var(--lumiverse-text, #ececf1);
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.24));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.08));
}

.mmp-pill:focus-visible {
  outline: 2px solid var(--lumiverse-primary, var(--lumiverse-accent, #8b7cff));
  outline-offset: 2px;
  color: var(--lumiverse-text, #ececf1);
}

.mmp-pill--circle {
  width: 21px;
  height: 21px;
  min-width: 21px;
  padding: 0;
  border-radius: 999px;
  justify-content: center;
  font-weight: 700;
  flex-wrap: nowrap;
}

.mmp-pill-bang {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.mmp-segment {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.mmp-segment--abnormal {
  color: var(--lumiverse-warning, #b45309);
  font-weight: 600;
}

[data-theme-mode="dark"] .mmp-segment--abnormal {
  color: #f6b26b;
}

[data-theme-mode="light"] .mmp-segment--abnormal {
  color: #b45309;
}

.mmp-dot {
  margin: 0 6px;
  opacity: 0.35;
}

/* Portal Tooltip in document.body */
.mmp-tooltip {
  position: fixed;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 11px;
  border-radius: 10px;
  background: var(--lumiverse-bg-opaque, var(--lumiverse-bg-elevated, #181920));
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  color: var(--lumiverse-text, #ececf1);
  font-size: calc(10.5px * var(--lumiverse-font-scale, 1));
  font-family: ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Code', Menlo, Consolas, monospace;
  line-height: 1.35;
  max-width: min(320px, calc(100vw - 16px));
  pointer-events: auto;
}

.mmp-tooltip-entry {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mmp-tooltip-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 14px;
}

.mmp-tooltip-label {
  color: var(--lumiverse-text-muted, #9da0a8);
  white-space: nowrap;
}

.mmp-tooltip-value {
  color: var(--lumiverse-text, #ececf1);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  text-align: right;
}

.mmp-tooltip-details {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: 8px;
  border-left: 2px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  max-height: 112px;
  overflow-y: auto;
}

.mmp-tooltip-detail-chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.07));
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text-muted, #c4c7d0);
  font-size: calc(9.5px * var(--lumiverse-font-scale, 1));
  line-height: 1.35;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Settings Drawer Tab — borderless hairline layout */
.mmp-drawer {
  color: var(--lumiverse-text, #ececf1);
  font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 0;
  max-width: 680px;
}

.mmp-drawer *,
.mmp-drawer *::before,
.mmp-drawer *::after {
  box-sizing: border-box;
}

.mmp-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 12px;
}

.mmp-drawer-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--lumiverse-text, #ececf1);
}

.mmp-help-btn {
  appearance: none;
  -webkit-appearance: none;
  width: 21px;
  height: 21px;
  min-width: 21px;
  padding: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text-muted, #9da0a8);
  font: 700 11px/1 ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
  cursor: pointer;
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    background var(--lumiverse-transition-fast, 150ms ease);
}

.mmp-help-btn:hover,
.mmp-help-btn[aria-expanded="true"] {
  color: var(--lumiverse-text, #ececf1);
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.28));
  background: var(--lumiverse-fill, rgba(255, 255, 255, 0.08));
}

.mmp-help-btn:focus-visible {
  outline: 2px solid var(--lumiverse-primary, var(--lumiverse-accent, #8b7cff));
  outline-offset: 2px;
  color: var(--lumiverse-text, #ececf1);
}

.mmp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0;
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
}

.mmp-section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--lumiverse-text-muted, #9da0a8);
}

.mmp-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mmp-select {
  appearance: none;
  -webkit-appearance: none;
  flex-shrink: 0;
  min-width: 158px;
  padding: 6px 28px 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.14));
  background-color: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239da0a8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 14px 14px;
  color: var(--lumiverse-text, #ececf1);
  font: 500 12px/1.25 system-ui, sans-serif;
  cursor: pointer;
  transition:
    border-color var(--lumiverse-transition-fast, 150ms ease),
    background-color var(--lumiverse-transition-fast, 150ms ease);
}

.mmp-select--compact {
  min-width: 0;
  padding: 3px 22px 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  background-position: right 6px center;
  background-size: 12px 12px;
}

.mmp-select:hover {
  border-color: var(--lumiverse-border-hover, rgba(255, 255, 255, 0.28));
  background-color: var(--lumiverse-fill, rgba(255, 255, 255, 0.07));
}

.mmp-select:focus-visible {
  outline: 2px solid var(--lumiverse-primary, var(--lumiverse-accent, #8b7cff));
  outline-offset: 1px;
}

.mmp-select option {
  background: var(--lumiverse-bg-opaque, var(--lumiverse-bg-elevated, #1c1d22));
  color: var(--lumiverse-text, #ececf1);
}

.mmp-field-list {
  display: flex;
  flex-direction: column;
}

.mmp-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.06));
}

.mmp-field-row:first-child {
  padding-top: 2px;
  border-top: 0;
}

.mmp-field-label-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.mmp-field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lumiverse-text, #ececf1);
}

.mmp-row-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.mmp-order-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
}

.mmp-order-btn {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  background: transparent;
  color: var(--lumiverse-text-muted, #9da0a8);
  font: 600 11px/1 system-ui, sans-serif;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease),
    opacity var(--lumiverse-transition-fast, 150ms ease);
}

.mmp-order-btn:hover:not(:disabled) {
  color: var(--lumiverse-text, #ececf1);
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.08));
}

.mmp-order-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.mmp-order-btn:focus-visible {
  outline: 2px solid var(--lumiverse-primary, var(--lumiverse-accent, #8b7cff));
  outline-offset: 1px;
}

.mmp-segmented {
  display: inline-flex;
  flex-shrink: 0;
  padding: 2px;
  border-radius: 7px;
  background: transparent;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.12));
  gap: 2px;
}

.mmp-seg-btn {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  background: transparent;
  color: var(--lumiverse-text-muted, #9da0a8);
  font: 600 11px/1.2 system-ui, sans-serif;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  transition:
    background var(--lumiverse-transition-fast, 150ms ease),
    color var(--lumiverse-transition-fast, 150ms ease);
}

.mmp-seg-btn:hover {
  color: var(--lumiverse-text, #ececf1);
}

.mmp-seg-btn[aria-checked="true"] {
  background: var(--lumiverse-primary, var(--lumiverse-accent, #796bdf));
  color: var(--lumiverse-primary-contrast, #ffffff);
}

.mmp-seg-btn:focus-visible {
  outline: 2px solid var(--lumiverse-primary, var(--lumiverse-accent, #8b7cff));
  outline-offset: 1px;
}

.mmp-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 9px;
  border-top: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.06));
}

.mmp-toggle-label {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.mmp-toggle-input {
  width: 15px;
  height: 15px;
  accent-color: var(--lumiverse-primary, var(--lumiverse-accent, #796bdf));
  cursor: pointer;
  flex-shrink: 0;
}

.mmp-preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mmp-preview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 2px 0;
}

.mmp-preview-caption {
  font-size: 11.5px;
  color: var(--lumiverse-text-muted, #9da0a8);
}

.mmp-preview-empty {
  font-size: 11.5px;
  font-style: italic;
  color: var(--lumiverse-text-dim, #7e828c);
}

.mmp-preview-row .mmp-pill {
  margin-top: 0;
}

@media (max-width: 768px) {
  [data-spindle-mount="message_header"] > div:has(> .mmp-pill--pos-next-to-pill.mmp-pill--bubble),
  .mmp-inj-wrap--next-to-pill.mmp-inj-wrap--bubble {
    flex-shrink: 1;
    min-width: 0;
    max-width: 100%;
  }

  .mmp-pill--pos-next-to-pill.mmp-pill--bubble {
    max-width: 100%;
  }

  [data-spindle-mount="message_footer"] > div:has(> .mmp-pill--pos-footer.mmp-pill--bubble),
  .mmp-inj-wrap--footer.mmp-inj-wrap--bubble {
    padding: 0 12px 10px;
  }
}

@media (max-width: 480px) {
  .mmp-setting-row,
  .mmp-field-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .mmp-select {
    width: 100%;
  }

  .mmp-dot {
    margin: 0 4px;
  }

  [data-spindle-mount="message_footer"] > div:has(> .mmp-pill--pos-footer.mmp-pill--bubble),
  .mmp-inj-wrap--footer.mmp-inj-wrap--bubble {
    padding: 0 10px 8px;
  }
}
`;
