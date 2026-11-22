// src/shared/types.ts
var DURATION_FORMATS = ["hms", "compact"];
var PILL_POSITIONS = [
  "next-to-pill",
  "below-header",
  "footer",
  "header-corner"
];
var PILL_POSITION_LABELS = {
  "next-to-pill": "Next to native pill",
  "below-header": "Below header",
  footer: "Message footer",
  "header-corner": "Header corner"
};
var FIELD_KEYS = [
  "generationTime",
  "finishReason",
  "lorebookTriggers",
  "macrosApplied",
  "wordCount",
  "editedBadge"
];
var FIELD_LABELS = {
  generationTime: "Generation Time",
  finishReason: "Finish Reason",
  lorebookTriggers: "Lorebook Triggers",
  macrosApplied: "Macros Applied",
  wordCount: "Word Count",
  editedBadge: "Edited Badge"
};
var DEFAULT_SETTINGS = {
  fields: {
    generationTime: "inline",
    finishReason: "inline",
    lorebookTriggers: "hover",
    macrosApplied: "hover",
    wordCount: "hover",
    editedBadge: "inline"
  },
  finishReasonAbnormalOnly: true,
  position: "next-to-pill",
  durationFormat: "hms",
  fieldOrder: [...FIELD_KEYS],
  showOnUserMessages: true
};
function makeMetaKey(messageId, swipeId = 0) {
  const safeSwipe = Number.isFinite(swipeId) && swipeId >= 0 ? Math.floor(swipeId) : 0;
  return `${messageId}:${safeSwipe}`;
}
function isFieldMode(value) {
  return value === "off" || value === "hover" || value === "inline";
}
function isDurationFormat(value) {
  return value === "hms" || value === "compact";
}
function isFieldKey(value) {
  return typeof value === "string" && FIELD_KEYS.includes(value);
}
function sanitizeFieldOrder(input) {
  const seen = new Set;
  const ordered = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (isFieldKey(item) && !seen.has(item)) {
        seen.add(item);
        ordered.push(item);
      }
    }
  }
  for (const key of FIELD_KEYS) {
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered;
}
function isPillPosition(value) {
  return value === "next-to-pill" || value === "below-header" || value === "footer" || value === "header-corner";
}
function sanitizeSettings(input) {
  const raw = input && typeof input === "object" ? input : {};
  const rawFields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  const fields = {};
  for (const key of FIELD_KEYS) {
    const candidate = rawFields[key];
    fields[key] = isFieldMode(candidate) ? candidate : DEFAULT_SETTINGS.fields[key];
  }
  const finishReasonAbnormalOnly = typeof raw.finishReasonAbnormalOnly === "boolean" ? raw.finishReasonAbnormalOnly : DEFAULT_SETTINGS.finishReasonAbnormalOnly;
  const position = isPillPosition(raw.position) ? raw.position : DEFAULT_SETTINGS.position;
  const durationFormat = isDurationFormat(raw.durationFormat) ? raw.durationFormat : DEFAULT_SETTINGS.durationFormat;
  const fieldOrder = sanitizeFieldOrder(raw.fieldOrder);
  const showOnUserMessages = typeof raw.showOnUserMessages === "boolean" ? raw.showOnUserMessages : DEFAULT_SETTINGS.showOnUserMessages;
  return {
    fields,
    finishReasonAbnormalOnly,
    position,
    durationFormat,
    fieldOrder,
    showOnUserMessages
  };
}

// src/shared/format.ts
var NORMAL_FINISH_REASONS = new Set([
  "stop",
  "end_turn",
  "stop_sequence",
  "eos",
  "normal",
  "complete",
  "completed",
  "finish",
  "finished"
]);
function formatDurationHMS(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return "00:00:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":");
}
function formatDurationCompact(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    const parts = [`${hours}h`];
    if (minutes > 0 || seconds > 0)
      parts.push(`${minutes}m`);
    if (seconds > 0)
      parts.push(`${seconds}s`);
    return parts.join(" ");
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
function formatDuration(ms, format = "hms") {
  return format === "compact" ? formatDurationCompact(ms) : formatDurationHMS(ms);
}
function countWords(text) {
  if (typeof text !== "string")
    return 0;
  const trimmed = text.trim();
  if (!trimmed)
    return 0;
  return trimmed.split(/\s+/).length;
}
function isAbnormalFinishReason(reason) {
  if (typeof reason !== "string")
    return false;
  const normalized = reason.trim().toLowerCase();
  if (!normalized)
    return false;
  return !NORMAL_FINISH_REASONS.has(normalized);
}
function resolveField(key, record, settings, isUser, context) {
  switch (key) {
    case "generationTime": {
      if (isUser)
        return null;
      const ms = record?.durationMs;
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)
        return null;
      const formatted = formatDuration(ms, settings.durationFormat);
      return {
        inlineText: formatted,
        tooltipRow: {
          key,
          label: "Generation Time",
          value: formatted
        }
      };
    }
    case "finishReason": {
      if (isUser)
        return null;
      const rawReason = record?.finishReason;
      if (typeof rawReason !== "string")
        return null;
      const reason = rawReason.trim();
      if (!reason)
        return null;
      if (settings.finishReasonAbnormalOnly && !isAbnormalFinishReason(reason)) {
        return null;
      }
      const details = [];
      if (typeof record?.stopSequence === "string" && record.stopSequence.trim()) {
        details.push(`Stop sequence: ${record.stopSequence.trim()}`);
      }
      if (typeof record?.stopDetails === "string" && record.stopDetails.trim()) {
        details.push(record.stopDetails.trim());
      }
      return {
        inlineText: reason,
        tooltipRow: {
          key,
          label: "Finish Reason",
          value: reason,
          ...details.length > 0 ? { details } : {}
        }
      };
    }
    case "lorebookTriggers": {
      if (isUser)
        return null;
      const triggers = record?.lorebookTriggers;
      if (!triggers || typeof triggers.count !== "number" || !Number.isFinite(triggers.count) || triggers.count <= 0) {
        return null;
      }
      const count = Math.floor(triggers.count);
      const entries = Array.isArray(triggers.entries) ? triggers.entries.filter((e) => typeof e === "string" && e.length > 0) : [];
      return {
        inlineText: `${count} LB`,
        tooltipRow: {
          key,
          label: "Lorebook Triggers",
          value: `${count} ${count === 1 ? "entry" : "entries"}`,
          ...entries.length > 0 ? { details: entries } : {}
        }
      };
    }
    case "macrosApplied": {
      if (isUser)
        return null;
      const macros = record?.macrosApplied;
      if (!macros || typeof macros.count !== "number" || !Number.isFinite(macros.count) || macros.count <= 0) {
        return null;
      }
      const count = Math.floor(macros.count);
      const names = Array.isArray(macros.names) ? macros.names.filter((n) => typeof n === "string" && n.length > 0) : [];
      return {
        inlineText: `${count} ${count === 1 ? "macro" : "macros"}`,
        tooltipRow: {
          key,
          label: "Macros Applied",
          value: `${count} ${count === 1 ? "macro" : "macros"}`,
          ...names.length > 0 ? { details: names } : {}
        }
      };
    }
    case "wordCount": {
      let words;
      if (typeof record?.wordCount === "number" && Number.isFinite(record.wordCount) && record.wordCount >= 0) {
        words = Math.floor(record.wordCount);
      } else if (typeof context?.content === "string") {
        words = countWords(context.content);
      }
      if (words === undefined)
        return null;
      return {
        inlineText: `${words}w`,
        tooltipRow: {
          key,
          label: "Word Count",
          value: `${words} ${words === 1 ? "word" : "words"}`
        }
      };
    }
    case "editedBadge": {
      if (record?.edited !== true)
        return null;
      return {
        inlineText: "Edited",
        tooltipRow: {
          key,
          label: "Edited",
          value: "Edited"
        }
      };
    }
  }
}
function resolvePillView(record, settings, context) {
  const isUser = context?.isUser ?? record?.isUser ?? false;
  if (isUser && settings.showOnUserMessages === false) {
    return {
      visible: false,
      mode: "hidden",
      inlineSegments: [],
      tooltipRows: []
    };
  }
  const inlineSegments = [];
  const tooltipRows = [];
  for (const key of sanitizeFieldOrder(settings.fieldOrder)) {
    const mode = settings.fields[key] ?? "off";
    if (mode === "off")
      continue;
    const resolved = resolveField(key, record, settings, isUser, context);
    if (!resolved)
      continue;
    tooltipRows.push(resolved.tooltipRow);
    if (mode === "inline") {
      inlineSegments.push({ key, text: resolved.inlineText });
    }
  }
  if (tooltipRows.length === 0) {
    return {
      visible: false,
      mode: "hidden",
      inlineSegments: [],
      tooltipRows: []
    };
  }
  if (inlineSegments.length > 0) {
    return {
      visible: true,
      mode: "inline",
      inlineSegments,
      tooltipRows
    };
  }
  return {
    visible: true,
    mode: "circle",
    inlineSegments: [],
    tooltipRows
  };
}

// src/frontend/styles.ts
var MMP_STYLES = `
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

// src/frontend/tooltip.ts
var fallbackIdCounter = 0;
function createSafeId(ctx, prefix = "mmp") {
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
var VIEWPORT_MARGIN = 8;
var ANCHOR_GAP = 6;
function createPortalTooltipController(ctx) {
  const tooltipId = createSafeId(ctx, "mmp-tooltip");
  let tooltipEl = null;
  let activeAnchor = null;
  let pinnedAnchor = null;
  let destroyed = false;
  const ensureTooltipElement = () => {
    if (tooltipEl && tooltipEl.isConnected)
      return tooltipEl;
    if (tooltipEl) {
      document.body.appendChild(tooltipEl);
      return tooltipEl;
    }
    const el = typeof ctx.dom?.createElement === "function" ? ctx.dom.createElement("div", {
      id: tooltipId,
      class: "mmp-tooltip",
      role: "tooltip"
    }) : (() => {
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
  const renderRows = (el, rows) => {
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
  const getUiScale = () => {
    try {
      const geomScale = ctx.ui?.geometry?.getUiScale?.();
      if (typeof geomScale === "number" && Number.isFinite(geomScale) && geomScale > 0) {
        return geomScale;
      }
    } catch {}
    if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--lumiverse-ui-scale");
        const parsed = Number.parseFloat(raw);
        if (Number.isFinite(parsed) && parsed > 0)
          return parsed;
      } catch {}
    }
    return 1;
  };
  const getLayoutViewport = (uiScale) => {
    try {
      const vp = ctx.ui?.geometry?.layoutViewportSize?.();
      if (vp && Number.isFinite(vp.width) && Number.isFinite(vp.height) && vp.width > 0 && vp.height > 0) {
        return vp;
      }
    } catch {}
    const rawW = window.innerWidth || document.documentElement?.clientWidth || 1024;
    const rawH = window.innerHeight || document.documentElement?.clientHeight || 768;
    return {
      width: rawW / uiScale,
      height: rawH / uiScale
    };
  };
  const getLayoutRect = (element, uiScale) => {
    try {
      const lr = ctx.ui?.geometry?.layoutElementRect?.(element);
      if (lr && Number.isFinite(lr.x) && Number.isFinite(lr.y)) {
        return {
          left: lr.x,
          top: lr.y,
          bottom: lr.y + lr.height,
          width: lr.width,
          height: lr.height
        };
      }
    } catch {}
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left / uiScale,
      top: rect.top / uiScale,
      bottom: rect.bottom / uiScale,
      width: rect.width / uiScale,
      height: rect.height / uiScale
    };
  };
  const positionTooltip = (el, anchorEl) => {
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
  const setExpanded = (anchorEl, expanded) => {
    if (!anchorEl)
      return;
    anchorEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (expanded) {
      anchorEl.setAttribute("aria-describedby", tooltipId);
    } else {
      anchorEl.removeAttribute("aria-describedby");
    }
  };
  const hide = () => {
    setExpanded(activeAnchor, false);
    setExpanded(pinnedAnchor, false);
    activeAnchor = null;
    pinnedAnchor = null;
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  };
  const show = (anchorEl, rows, pin = false) => {
    if (destroyed || rows.length === 0 || !anchorEl.isConnected)
      return;
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
  const onDocumentPointerDown = (event) => {
    if (!activeAnchor && !pinnedAnchor)
      return;
    const target = event.target;
    if (!target) {
      hide();
      return;
    }
    if (tooltipEl?.contains(target))
      return;
    if (activeAnchor?.contains(target) || pinnedAnchor?.contains(target))
      return;
    hide();
  };
  const onDocumentKeyDown = (event) => {
    if (event.key === "Escape" && (activeAnchor || pinnedAnchor)) {
      hide();
    }
  };
  const onWindowScroll = (event) => {
    if (!activeAnchor && !pinnedAnchor)
      return;
    const target = event.target;
    if (target && tooltipEl?.contains(target))
      return;
    hide();
  };
  const onWindowResize = () => {
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
  const attach = (anchorEl, rows, signal) => {
    const listenerOpts = signal ? { signal } : {};
    anchorEl.addEventListener("mouseenter", () => {
      show(anchorEl, rows, false);
    }, listenerOpts);
    anchorEl.addEventListener("mouseleave", (event) => {
      if (pinnedAnchor === anchorEl)
        return;
      const nextTarget = event.relatedTarget;
      if (nextTarget && tooltipEl?.contains(nextTarget))
        return;
      if (activeAnchor === anchorEl) {
        hide();
      }
    }, listenerOpts);
    anchorEl.addEventListener("focus", () => {
      show(anchorEl, rows, false);
    }, listenerOpts);
    anchorEl.addEventListener("blur", (event) => {
      if (pinnedAnchor === anchorEl)
        return;
      const nextTarget = event.relatedTarget;
      if (nextTarget && tooltipEl?.contains(nextTarget))
        return;
      if (activeAnchor === anchorEl) {
        hide();
      }
    }, listenerOpts);
    anchorEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (pinnedAnchor === anchorEl) {
        hide();
      } else {
        show(anchorEl, rows, true);
      }
    }, listenerOpts);
  };
  const destroy = () => {
    if (destroyed)
      return;
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
    destroy
  };
}

// src/frontend/settings-drawer.ts
var SETTINGS_TAB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r="0.8" fill="currentColor"/></svg>`;
var DURATION_FORMAT_SHORT_LABELS = {
  hms: "HH:MM:SS",
  compact: "Compact"
};
var HELP_TOOLTIP_ROWS = [
  {
    label: "Pill rules",
    value: "Conditional & fallback",
    details: [
      "0 triggers, 0 macros, or unedited behave as Off",
      "All hover-only active fields collapse to (!)",
      "0 active fields hide the pill completely"
    ]
  },
  {
    label: "Generation Time",
    value: "HH:MM:SS or compact",
    details: ["AI messages only"]
  },
  {
    label: "Finish Reason",
    value: "Abnormal only option",
    details: ["Hides normal stops (stop, end_turn)", "AI messages only"]
  },
  {
    label: "Lorebook & Macros",
    value: "AI messages only",
    details: ["Hover/tap tooltip lists triggered entry & macro names"]
  },
  {
    label: "Word Count & Edited",
    value: "AI & user messages",
    details: ["Applies to user messages when Show on User Messages is enabled"]
  }
];
var MODE_OPTIONS = [
  { mode: "off", label: "Off" },
  { mode: "hover", label: "Hover" },
  { mode: "inline", label: "Inline" }
];
var SAMPLE_AI_RECORD = {
  durationMs: 14000,
  finishReason: "length",
  lorebookTriggers: {
    count: 2,
    entries: ["Moonlit Citadel", "Arcane Pact"]
  },
  macrosApplied: {
    count: 2,
    names: ["{{char}}", "{{user}}"]
  },
  wordCount: 142,
  edited: true,
  isUser: false
};
var CIRCLE_PREVIEW_SETTINGS = {
  fields: {
    generationTime: "hover",
    finishReason: "hover",
    lorebookTriggers: "hover",
    macrosApplied: "hover",
    wordCount: "hover",
    editedBadge: "hover"
  },
  finishReasonAbnormalOnly: false,
  position: "next-to-pill",
  durationFormat: "hms",
  fieldOrder: [...FIELD_KEYS],
  showOnUserMessages: true
};
function buildPreviewPillElement(view, tooltip, signal) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = view.mode === "circle" ? "mmp-pill mmp-pill--circle" : "mmp-pill";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", view.mode === "circle" ? "Message metadata (hover or tap for details)" : "Message metadata details");
  if (view.mode === "circle") {
    const bang = document.createElement("span");
    bang.className = "mmp-pill-bang";
    bang.textContent = "!";
    button.appendChild(bang);
  } else {
    view.inlineSegments.forEach((seg, index) => {
      if (index > 0) {
        const dot = document.createElement("span");
        dot.className = "mmp-dot";
        dot.textContent = "·";
        button.appendChild(dot);
      }
      const span = document.createElement("span");
      span.className = seg.key === "finishReason" ? "mmp-segment mmp-segment--abnormal" : "mmp-segment";
      span.textContent = seg.text;
      button.appendChild(span);
    });
  }
  tooltip.attach(button, view.tooltipRows, signal);
  return button;
}
function createSettingsDrawer(ctx, initialSettings, tooltip, onSettingsChanged) {
  const tab = ctx.ui.registerDrawerTab({
    id: "settings",
    title: "Message Meta Plus",
    shortName: "Meta+",
    headerTitle: "Message Meta Plus",
    description: "Configure companion metadata pills, hover-only (!) badges, and tooltips",
    keywords: ["message", "meta", "pill", "lorebook", "macro", "finish", "words", "edited"],
    iconSvg: SETTINGS_TAB_ICON
  });
  let currentSettings = sanitizeSettings(initialSettings);
  let destroyed = false;
  let previewAbort = null;
  const helpAbort = new AbortController;
  const root = document.createElement("div");
  root.className = "mmp-drawer";
  tab.root.replaceChildren(root);
  const header = document.createElement("div");
  header.className = "mmp-drawer-header";
  const title = document.createElement("h2");
  title.className = "mmp-drawer-title";
  title.textContent = "Message Meta Plus";
  const helpBtn = document.createElement("button");
  helpBtn.type = "button";
  helpBtn.className = "mmp-help-btn";
  helpBtn.dataset.mmpHelpBtn = "1";
  helpBtn.setAttribute("aria-label", "About Message Meta Plus settings");
  helpBtn.setAttribute("aria-expanded", "false");
  helpBtn.textContent = "?";
  tooltip.attach(helpBtn, HELP_TOOLTIP_ROWS, helpAbort.signal);
  header.append(title, helpBtn);
  const segmentButtons = new Map;
  const commitSettings = (next) => {
    currentSettings = sanitizeSettings(next);
    syncControls();
    renderPreview();
    onSettingsChanged(currentSettings);
    ctx.sendToBackend({ type: "update-settings", settings: currentSettings });
  };
  const positionSection = document.createElement("section");
  positionSection.className = "mmp-section";
  const positionRow = document.createElement("div");
  positionRow.className = "mmp-setting-row";
  const positionSelectId = createSafeId(ctx, "mmp-position-select");
  const positionLabel = document.createElement("label");
  positionLabel.className = "mmp-field-label";
  positionLabel.htmlFor = positionSelectId;
  positionLabel.textContent = "Pill Position";
  const positionSelect = document.createElement("select");
  positionSelect.id = positionSelectId;
  positionSelect.className = "mmp-select";
  positionSelect.dataset.mmpPositionSelect = "1";
  positionSelect.setAttribute("aria-label", "Pill Position");
  for (const pos of PILL_POSITIONS) {
    const option = document.createElement("option");
    option.value = pos;
    option.textContent = PILL_POSITION_LABELS[pos];
    positionSelect.appendChild(option);
  }
  positionSelect.addEventListener("change", () => {
    if (destroyed)
      return;
    if (!isPillPosition(positionSelect.value))
      return;
    if (currentSettings.position === positionSelect.value)
      return;
    commitSettings({
      ...currentSettings,
      position: positionSelect.value
    });
  });
  positionRow.append(positionLabel, positionSelect);
  const userToggleRow = document.createElement("div");
  userToggleRow.className = "mmp-toggle-row";
  const userToggleId = createSafeId(ctx, "mmp-user-messages-toggle");
  const userToggleLabel = document.createElement("label");
  userToggleLabel.className = "mmp-toggle-label";
  userToggleLabel.htmlFor = userToggleId;
  const userToggleTitle = document.createElement("span");
  userToggleTitle.className = "mmp-field-label";
  userToggleTitle.textContent = "Show on User Messages";
  userToggleLabel.appendChild(userToggleTitle);
  const userToggleInput = document.createElement("input");
  userToggleInput.type = "checkbox";
  userToggleInput.id = userToggleId;
  userToggleInput.className = "mmp-toggle-input";
  userToggleInput.dataset.mmpUserMessagesToggle = "1";
  userToggleInput.addEventListener("change", () => {
    if (destroyed)
      return;
    commitSettings({
      ...currentSettings,
      showOnUserMessages: userToggleInput.checked
    });
  });
  userToggleRow.append(userToggleLabel, userToggleInput);
  positionSection.append(positionRow, userToggleRow);
  const durationSelect = document.createElement("select");
  durationSelect.className = "mmp-select mmp-select--compact";
  durationSelect.dataset.mmpDurationFormatSelect = "1";
  durationSelect.setAttribute("aria-label", "Duration Format");
  for (const fmt of DURATION_FORMATS) {
    const option = document.createElement("option");
    option.value = fmt;
    option.textContent = DURATION_FORMAT_SHORT_LABELS[fmt];
    durationSelect.appendChild(option);
  }
  durationSelect.addEventListener("change", () => {
    if (destroyed)
      return;
    if (!isDurationFormat(durationSelect.value))
      return;
    if (currentSettings.durationFormat === durationSelect.value)
      return;
    commitSettings({
      ...currentSettings,
      durationFormat: durationSelect.value
    });
  });
  const fieldsSection = document.createElement("section");
  fieldsSection.className = "mmp-section";
  const fieldsHeading = document.createElement("h3");
  fieldsHeading.className = "mmp-section-title";
  fieldsHeading.textContent = "Field Display & Order";
  fieldsSection.appendChild(fieldsHeading);
  const fieldList = document.createElement("div");
  fieldList.className = "mmp-field-list";
  const fieldRows = new Map;
  const orderButtons = new Map;
  const moveField = (key, delta) => {
    if (destroyed)
      return;
    const order = sanitizeFieldOrder(currentSettings.fieldOrder);
    const idx = order.indexOf(key);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= order.length)
      return;
    const nextOrder = [...order];
    const currentItem = nextOrder[idx];
    nextOrder[idx] = nextOrder[targetIdx];
    nextOrder[targetIdx] = currentItem;
    commitSettings({
      ...currentSettings,
      fieldOrder: nextOrder
    });
  };
  for (const key of FIELD_KEYS) {
    const row = document.createElement("div");
    row.className = "mmp-field-row";
    row.dataset.mmpFieldRow = key;
    const labelWrap = document.createElement("div");
    labelWrap.className = "mmp-field-label-wrap";
    const label = document.createElement("span");
    label.className = "mmp-field-label";
    label.textContent = FIELD_LABELS[key];
    labelWrap.appendChild(label);
    if (key === "generationTime") {
      labelWrap.appendChild(durationSelect);
    }
    const controls = document.createElement("div");
    controls.className = "mmp-row-controls";
    const orderGroup = document.createElement("div");
    orderGroup.className = "mmp-order-group";
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "mmp-order-btn";
    upBtn.dataset.mmpMoveUp = key;
    upBtn.setAttribute("aria-label", `Move ${FIELD_LABELS[key]} up`);
    upBtn.title = "Move up";
    upBtn.textContent = "↑";
    upBtn.addEventListener("click", () => moveField(key, -1));
    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "mmp-order-btn";
    downBtn.dataset.mmpMoveDown = key;
    downBtn.setAttribute("aria-label", `Move ${FIELD_LABELS[key]} down`);
    downBtn.title = "Move down";
    downBtn.textContent = "↓";
    downBtn.addEventListener("click", () => moveField(key, 1));
    orderGroup.append(upBtn, downBtn);
    orderButtons.set(key, { up: upBtn, down: downBtn });
    const group = document.createElement("div");
    group.className = "mmp-segmented";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", FIELD_LABELS[key]);
    const btnMap = new Map;
    for (const option of MODE_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mmp-seg-btn";
      btn.setAttribute("role", "radio");
      btn.dataset.mmpField = key;
      btn.dataset.mmpMode = option.mode;
      btn.textContent = option.label;
      btn.addEventListener("click", () => {
        if (destroyed)
          return;
        if (currentSettings.fields[key] === option.mode)
          return;
        commitSettings({
          ...currentSettings,
          fields: {
            ...currentSettings.fields,
            [key]: option.mode
          }
        });
      });
      btnMap.set(option.mode, btn);
      group.appendChild(btn);
    }
    segmentButtons.set(key, btnMap);
    controls.append(orderGroup, group);
    row.append(labelWrap, controls);
    fieldRows.set(key, row);
    fieldList.appendChild(row);
  }
  fieldsSection.appendChild(fieldList);
  const toggleRow = document.createElement("div");
  toggleRow.className = "mmp-toggle-row";
  const toggleId = createSafeId(ctx, "mmp-abnormal-toggle");
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "mmp-toggle-label";
  toggleLabel.htmlFor = toggleId;
  const toggleTitle = document.createElement("span");
  toggleTitle.className = "mmp-field-label";
  toggleTitle.textContent = "Finish Reason: Inline only when abnormal";
  toggleLabel.appendChild(toggleTitle);
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.id = toggleId;
  toggleInput.className = "mmp-toggle-input";
  toggleInput.dataset.mmpAbnormalToggle = "1";
  toggleInput.addEventListener("change", () => {
    if (destroyed)
      return;
    commitSettings({
      ...currentSettings,
      finishReasonAbnormalOnly: toggleInput.checked
    });
  });
  toggleRow.append(toggleLabel, toggleInput);
  fieldsSection.appendChild(toggleRow);
  const previewSection = document.createElement("section");
  previewSection.className = "mmp-section";
  const previewHeading = document.createElement("h3");
  previewHeading.className = "mmp-section-title";
  previewHeading.textContent = "Live Preview";
  const previewList = document.createElement("div");
  previewList.className = "mmp-preview-list";
  previewSection.append(previewHeading, previewList);
  root.append(header, positionSection, fieldsSection, previewSection);
  const syncControls = () => {
    positionSelect.value = currentSettings.position;
    durationSelect.value = currentSettings.durationFormat;
    userToggleInput.checked = currentSettings.showOnUserMessages;
    const orderedKeys = sanitizeFieldOrder(currentSettings.fieldOrder);
    orderedKeys.forEach((key, index) => {
      const row = fieldRows.get(key);
      if (row) {
        fieldList.appendChild(row);
      }
      const orderPair = orderButtons.get(key);
      if (orderPair) {
        orderPair.up.disabled = index === 0;
        orderPair.down.disabled = index === orderedKeys.length - 1;
      }
      const mode = currentSettings.fields[key] ?? DEFAULT_SETTINGS.fields[key];
      const btnMap = segmentButtons.get(key);
      if (!btnMap)
        return;
      for (const [optMode, btn] of btnMap) {
        const checked = optMode === mode;
        btn.setAttribute("aria-checked", checked ? "true" : "false");
      }
    });
    toggleInput.checked = currentSettings.finishReasonAbnormalOnly;
  };
  const renderPreview = () => {
    if (previewAbort) {
      tooltip.hide();
      previewAbort.abort();
    }
    previewAbort = new AbortController;
    const signal = previewAbort.signal;
    const liveView = resolvePillView(SAMPLE_AI_RECORD, currentSettings, { isUser: false });
    const inlinePreviewView = liveView.mode === "inline" ? liveView : resolvePillView(SAMPLE_AI_RECORD, {
      fields: {
        generationTime: "inline",
        finishReason: "inline",
        lorebookTriggers: "hover",
        macrosApplied: "hover",
        wordCount: "inline",
        editedBadge: "inline"
      },
      finishReasonAbnormalOnly: false,
      position: currentSettings.position,
      durationFormat: currentSettings.durationFormat,
      fieldOrder: currentSettings.fieldOrder,
      showOnUserMessages: currentSettings.showOnUserMessages
    });
    const circlePreviewView = resolvePillView(SAMPLE_AI_RECORD, {
      ...CIRCLE_PREVIEW_SETTINGS,
      durationFormat: currentSettings.durationFormat,
      fieldOrder: currentSettings.fieldOrder
    }, { isUser: false });
    const liveRow = document.createElement("div");
    liveRow.className = "mmp-preview-row";
    const liveCap = document.createElement("span");
    liveCap.className = "mmp-preview-caption";
    liveCap.textContent = liveView.mode === "inline" ? "Inline pill (active settings)" : liveView.mode === "circle" ? "Circle (!) badge (active settings)" : "Active settings (hidden — 0 active fields)";
    liveRow.appendChild(liveCap);
    if (liveView.visible) {
      liveRow.appendChild(buildPreviewPillElement(liveView, tooltip, signal));
    } else {
      const emptyLabel = document.createElement("span");
      emptyLabel.className = "mmp-preview-empty";
      emptyLabel.textContent = "Hidden";
      liveRow.appendChild(emptyLabel);
    }
    const inlineSampleRow = document.createElement("div");
    inlineSampleRow.className = "mmp-preview-row";
    const inlineCap = document.createElement("span");
    inlineCap.className = "mmp-preview-caption";
    inlineCap.textContent = "Inline pill sample";
    inlineSampleRow.append(inlineCap, buildPreviewPillElement(inlinePreviewView, tooltip, signal));
    const circleSampleRow = document.createElement("div");
    circleSampleRow.className = "mmp-preview-row";
    const circleCap = document.createElement("span");
    circleCap.className = "mmp-preview-caption";
    circleCap.textContent = "Hover-only (!) circle badge";
    circleSampleRow.append(circleCap, buildPreviewPillElement(circlePreviewView, tooltip, signal));
    if (liveView.mode === "inline") {
      previewList.replaceChildren(liveRow, circleSampleRow);
    } else {
      previewList.replaceChildren(liveRow, inlineSampleRow, circleSampleRow);
    }
  };
  syncControls();
  renderPreview();
  const setSettings = (settings) => {
    if (destroyed)
      return;
    currentSettings = sanitizeSettings(settings);
    syncControls();
    renderPreview();
  };
  const destroy = () => {
    if (destroyed)
      return;
    destroyed = true;
    helpAbort.abort();
    previewAbort?.abort();
    previewAbort = null;
    tab.destroy();
  };
  return {
    tab,
    setSettings,
    destroy
  };
}

// src/frontend.ts
var MESSAGE_HEADER_SELECTOR = '[data-spindle-mount="message_header"]';
var MESSAGE_BODY_BEFORE_SELECTOR = '[data-spindle-mount="message_body_before"]';
var MESSAGE_FOOTER_SELECTOR = '[data-spindle-mount="message_footer"]';
var ANY_MESSAGE_MOUNT_SELECTOR = `${MESSAGE_HEADER_SELECTOR}, ${MESSAGE_BODY_BEFORE_SELECTOR}, ${MESSAGE_FOOTER_SELECTOR}`;
var CHAT_CONTAINER_SELECTOR = '[data-chat-scroll="true"]';
var STREAMING_TEXT_TAGS = new Set([
  "P",
  "SPAN",
  "STRONG",
  "EM",
  "B",
  "I",
  "U",
  "S",
  "CODE",
  "PRE",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
  "A",
  "BR",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6"
]);
var REFRESH_EVENTS = [
  "MESSAGE_SENT",
  "MESSAGE_EDITED",
  "MESSAGE_SWIPED",
  "SWIPE_EDITED",
  "CHAT_SWITCHED",
  "CHAT_CHANGED",
  "MESSAGE_DELETED",
  "GENERATION_ENDED",
  "GENERATION_METRICS_READY",
  "CHARACTER_MESSAGE_RENDERED",
  "USER_MESSAGE_RENDERED"
];
var activeTeardown = null;
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function getMountSelectorForPosition(position) {
  switch (position) {
    case "below-header":
      return MESSAGE_BODY_BEFORE_SELECTOR;
    case "footer":
      return MESSAGE_FOOTER_SELECTOR;
    case "header-corner":
    case "next-to-pill":
    default:
      return MESSAGE_HEADER_SELECTOR;
  }
}
function detectMessageVariant(mountEl, bubbleEl) {
  const scope = mountEl.getAttribute("data-spindle-scope") ?? "";
  if (scope.includes(":minimal:"))
    return "minimal";
  if (scope.includes(":bubble:"))
    return "bubble";
  if (bubbleEl.querySelector('[data-spindle-scope*=":minimal:"]'))
    return "minimal";
  return "bubble";
}
function detectHeaderRowReverse(mountEl, bubbleEl, variant, isUser) {
  const headerSlot = bubbleEl.querySelector(MESSAGE_HEADER_SELECTOR) ?? mountEl;
  const headerEl = headerSlot.parentElement;
  if (headerEl && typeof getComputedStyle === "function") {
    try {
      const flexDirection = getComputedStyle(headerEl).flexDirection;
      if (flexDirection === "row-reverse")
        return true;
      if (flexDirection === "row")
        return false;
    } catch {}
  }
  if (variant !== "bubble")
    return false;
  const cls = typeof bubbleEl.className === "string" ? bubbleEl.className : "";
  if (cls.includes("userLeft") || bubbleEl.getAttribute("data-user-align") === "left") {
    return false;
  }
  return isUser && (cls.includes("user") || bubbleEl.getAttribute("data-is-user") === "true");
}
function computePillSignature(view, messageId, swipeId, layout) {
  return JSON.stringify({
    messageId,
    swipeId,
    position: layout.position,
    variant: layout.variant,
    rowReverse: layout.rowReverse,
    mode: view.mode,
    inlineSegments: view.inlineSegments,
    tooltipRows: view.tooltipRows
  });
}
function buildPillHtml(view, messageId, swipeId, layout) {
  const safeId = escapeHtml(messageId);
  const safeSwipe = String(swipeId);
  const layoutClasses = [
    `mmp-pill--pos-${layout.position}`,
    `mmp-pill--${layout.variant}`,
    ...layout.rowReverse ? ["mmp-pill--row-reverse"] : []
  ].join(" ");
  const dataAttrs = `data-mmp-pill="1" data-mmp-msg-id="${safeId}" data-mmp-swipe-id="${safeSwipe}" data-mmp-pos="${layout.position}" data-mmp-variant="${layout.variant}"`;
  if (view.mode === "circle") {
    return `<button type="button" class="mmp-pill mmp-pill--circle ${layoutClasses}" ${dataAttrs} aria-expanded="false" aria-label="Message metadata (hover or tap for details)"><span class="mmp-pill-bang">!</span></button>`;
  }
  const parts = view.inlineSegments.map((seg, idx) => {
    const dot = idx > 0 ? `<span class="mmp-dot" aria-hidden="true">·</span>` : "";
    const isAbnormal = seg.key === "finishReason" && isAbnormalFinishReason(seg.text);
    const segClass = isAbnormal ? "mmp-segment mmp-segment--abnormal" : "mmp-segment";
    return `${dot}<span class="${segClass}">${escapeHtml(seg.text)}</span>`;
  }).join("");
  return `<button type="button" class="mmp-pill ${layoutClasses}" ${dataAttrs} aria-expanded="false" aria-label="Message metadata details">${parts}</button>`;
}
function applyWrapperClasses(wrapper, layout) {
  if (!wrapper.classList)
    return;
  wrapper.classList.add("mmp-inj-wrap", `mmp-inj-wrap--${layout.position}`, `mmp-inj-wrap--${layout.variant}`);
  if (layout.rowReverse) {
    wrapper.classList.add("mmp-inj-wrap--row-reverse");
  }
}
function findMountElement(bubbleEl, selector) {
  if (bubbleEl.matches(selector)) {
    return bubbleEl;
  }
  return bubbleEl.querySelector(selector);
}
function resolveInnerCardElement(element) {
  if (element.hasAttribute("data-part") || element.hasAttribute("data-component")) {
    return element;
  }
  const inner = element.querySelector?.("[data-message-id][data-part], [data-message-id][data-component]");
  return inner ?? element;
}
function selectPreferredBubbleElements(mounted, mountSelector) {
  const byId = new Map;
  for (const { messageId, element } of mounted) {
    const existing = byId.get(messageId);
    if (!existing) {
      byId.set(messageId, element);
      continue;
    }
    const existingIsInner = existing.hasAttribute("data-part") || existing.hasAttribute("data-component");
    const candidateIsInner = element.hasAttribute("data-part") || element.hasAttribute("data-component");
    if (!existingIsInner && candidateIsInner) {
      byId.set(messageId, element);
    } else if (existingIsInner === candidateIsInner) {
      const existingHasMount = Boolean(findMountElement(existing, mountSelector));
      const candidateHasMount = Boolean(findMountElement(element, mountSelector));
      if (!existingHasMount && candidateHasMount) {
        byId.set(messageId, element);
      }
    }
  }
  return byId;
}
function findChatObserveRoot() {
  if (typeof document === "undefined")
    return null;
  const streamBeforeParent = document.querySelector('[data-spindle-mount="chat_stream_before"]')?.parentElement ?? null;
  if (streamBeforeParent)
    return streamBeforeParent;
  const chatScroll = document.querySelector(CHAT_CONTAINER_SELECTOR);
  if (chatScroll)
    return chatScroll;
  return null;
}
function nodeContainsMessageMount(node) {
  if (node.nodeType !== 1)
    return false;
  const el = node;
  if (el.classList.contains("mmp-inj-wrap") || el.hasAttribute("data-mmp-pill") || el.classList.contains("mmp-tooltip")) {
    return false;
  }
  if (el.matches(ANY_MESSAGE_MOUNT_SELECTOR) || el.hasAttribute("data-message-id")) {
    return true;
  }
  if (STREAMING_TEXT_TAGS.has(el.tagName) && !el.hasAttribute("data-spindle-mount") && el.closest?.("[data-message-id]")) {
    return false;
  }
  return Boolean(el.querySelector(ANY_MESSAGE_MOUNT_SELECTOR) || el.querySelector("[data-message-id]"));
}
function setup(ctx) {
  if (activeTeardown) {
    try {
      activeTeardown();
    } catch {}
    activeTeardown = null;
  }
  let destroyed = false;
  let settings = sanitizeSettings(DEFAULT_SETTINGS);
  let activeChatId = ctx.getActiveChat?.().chatId ?? null;
  const metaByChatId = new Map;
  const messageStatesByChatId = new Map;
  const messageInfoCache = new Map;
  const injectedByMessageId = new Map;
  const removeStyle = ctx.dom.addStyle(MMP_STYLES);
  const tooltip = createPortalTooltipController(ctx);
  const drawer = createSettingsDrawer(ctx, settings, tooltip, (next) => {
    settings = next;
    renderAllMountedMessages();
  });
  const getCurrentMetaMap = () => {
    if (!activeChatId)
      return {};
    return metaByChatId.get(activeChatId) ?? {};
  };
  const getCurrentMessageStates = () => {
    if (!activeChatId)
      return {};
    return messageStatesByChatId.get(activeChatId) ?? {};
  };
  const cacheMessageDto = (msg) => {
    if (!msg || typeof msg.id !== "string" || !msg.id)
      return;
    const prev = messageInfoCache.get(msg.id);
    const swipeId = typeof msg.swipe_id === "number" && Number.isFinite(msg.swipe_id) && msg.swipe_id >= 0 ? Math.floor(msg.swipe_id) : prev?.swipeId ?? 0;
    const isUser = typeof msg.is_user === "boolean" ? msg.is_user : prev?.isUser ?? false;
    const content = typeof msg.content === "string" ? msg.content : prev?.content;
    messageInfoCache.set(msg.id, { swipeId, isUser, content });
  };
  const syncRecentMessagesIntoCache = () => {
    try {
      const recent = ctx.messages?.getRecent?.(200);
      if (Array.isArray(recent)) {
        for (const msg of recent)
          cacheMessageDto(msg);
      }
    } catch {}
  };
  const hydrateMessageCacheFromHost = async (chatId) => {
    if (destroyed)
      return;
    syncRecentMessagesIntoCache();
    if (!chatId)
      return;
    try {
      const getMessages = ctx.chats?.getMessages;
      if (typeof getMessages === "function") {
        const page = await getMessages(chatId, { limit: 200, tail: true });
        if (destroyed)
          return;
        if (Array.isArray(page?.data)) {
          for (const msg of page.data)
            cacheMessageDto(msg);
          renderAllMountedMessages();
        }
      }
    } catch {}
  };
  const resolveMessageInputs = (messageId, bubbleEl, metaMap, messageStates) => {
    const cached = messageInfoCache.get(messageId);
    const backendState = messageStates[messageId];
    const domSwipeRaw = bubbleEl.getAttribute("data-swipe-id");
    const domSwipe = domSwipeRaw !== null && Number.isFinite(Number(domSwipeRaw)) && Number(domSwipeRaw) >= 0 ? Math.floor(Number(domSwipeRaw)) : undefined;
    let swipeId = cached?.swipeId ?? backendState?.swipeId ?? domSwipe ?? 0;
    let record = metaMap[makeMetaKey(messageId, swipeId)];
    if (!record && cached === undefined && backendState === undefined && domSwipe === undefined) {
      const prefix = `${messageId}:`;
      for (const key of Object.keys(metaMap)) {
        if (key.startsWith(prefix)) {
          const parsedSwipe = Number(key.slice(prefix.length));
          if (Number.isFinite(parsedSwipe) && parsedSwipe >= 0) {
            swipeId = Math.floor(parsedSwipe);
            record = metaMap[key];
            break;
          }
        }
      }
    }
    const domDataPart = bubbleEl.getAttribute("data-part") ?? bubbleEl.querySelector?.("[data-part]")?.getAttribute("data-part") ?? null;
    const domIsUserFromPart = domDataPart === "user" ? true : domDataPart === "character" || domDataPart === "streaming" ? false : undefined;
    const domIsUserAttr = bubbleEl.getAttribute("data-is-user");
    const domIsUser = domIsUserFromPart ?? (domIsUserAttr !== null ? domIsUserAttr === "true" : undefined);
    const isUser = cached?.isUser ?? backendState?.isUser ?? record?.isUser ?? domIsUser ?? false;
    let content = cached?.content;
    if (content === undefined) {
      try {
        const getContent = ctx.messages?.getContent;
        const hostContent = typeof getContent === "function" ? getContent(messageId) : null;
        if (typeof hostContent === "string")
          content = hostContent;
      } catch {}
    }
    return { swipeId, record, isUser, content };
  };
  const cleanupEntry = (entry) => {
    entry.abortController.abort();
    try {
      ctx.dom.uninject(entry.wrapper);
    } catch {
      entry.wrapper.remove();
    }
  };
  const removeOrphanPillsInMount = (mountEl, keepWrapper) => {
    const existingPills = mountEl.querySelectorAll("[data-mmp-pill]");
    for (const pill of existingPills) {
      const wrapper = pill.parentElement;
      if (wrapper && wrapper === keepWrapper)
        continue;
      if (wrapper && wrapper.hasAttribute("data-spindle-inj-id")) {
        try {
          ctx.dom.uninject(wrapper);
        } catch {
          wrapper.remove();
        }
      } else {
        pill.remove();
      }
    }
  };
  const renderMessageBubble = (messageId, rawBubbleEl) => {
    if (destroyed)
      return;
    const bubbleEl = resolveInnerCardElement(rawBubbleEl);
    const mountSelector = getMountSelectorForPosition(settings.position);
    const mountEl = findMountElement(bubbleEl, mountSelector);
    if (!mountEl)
      return;
    const metaMap = getCurrentMetaMap();
    const messageStates = getCurrentMessageStates();
    const { swipeId, record, isUser, content } = resolveMessageInputs(messageId, bubbleEl, metaMap, messageStates);
    const view = resolvePillView(record, settings, { isUser, content });
    const existing = injectedByMessageId.get(messageId);
    if (!view.visible || view.mode === "hidden") {
      if (existing) {
        cleanupEntry(existing);
        injectedByMessageId.delete(messageId);
      }
      removeOrphanPillsInMount(bubbleEl);
      return;
    }
    const variant = detectMessageVariant(mountEl, bubbleEl);
    const rowReverse = detectHeaderRowReverse(mountEl, bubbleEl, variant, isUser);
    const layout = {
      position: settings.position,
      variant,
      rowReverse
    };
    const signature = computePillSignature(view, messageId, swipeId, layout);
    if (existing && existing.wrapper.isConnected && mountEl.contains(existing.wrapper) && existing.signature === signature) {
      existing.mountEl = mountEl;
      removeOrphanPillsInMount(bubbleEl, existing.wrapper);
      return;
    }
    if (existing) {
      cleanupEntry(existing);
      injectedByMessageId.delete(messageId);
    }
    removeOrphanPillsInMount(bubbleEl);
    const html = buildPillHtml(view, messageId, swipeId, layout);
    const wrapper = ctx.dom.inject(mountEl, html, "beforeend");
    applyWrapperClasses(wrapper, layout);
    const abortController = new AbortController;
    const pillEl = wrapper.querySelector("[data-mmp-pill]");
    if (pillEl) {
      tooltip.attach(pillEl, view.tooltipRows, abortController.signal);
    }
    injectedByMessageId.set(messageId, {
      wrapper,
      mountEl,
      signature,
      abortController
    });
  };
  function renderAllMountedMessages() {
    if (destroyed)
      return;
    syncRecentMessagesIntoCache();
    const mountSelector = getMountSelectorForPosition(settings.position);
    const preferredById = selectPreferredBubbleElements(ctx.dom.listMessageElements(), mountSelector);
    for (const [messageId, element] of preferredById) {
      renderMessageBubble(messageId, element);
    }
  }
  let scheduledScanRaf = null;
  let scheduledScanTimer = null;
  const scheduleScan = () => {
    if (destroyed)
      return;
    if (typeof requestAnimationFrame === "function") {
      if (scheduledScanRaf !== null)
        return;
      scheduledScanRaf = requestAnimationFrame(() => {
        scheduledScanRaf = null;
        renderAllMountedMessages();
      });
    } else {
      if (scheduledScanTimer !== null)
        return;
      scheduledScanTimer = setTimeout(() => {
        scheduledScanTimer = null;
        renderAllMountedMessages();
      }, 0);
    }
  };
  let observer = null;
  let currentObserveRoot = null;
  const ensureObserverBound = () => {
    if (destroyed || typeof MutationObserver === "undefined" || typeof document === "undefined") {
      return;
    }
    const targetRoot = findChatObserveRoot() ?? document.body;
    if (!targetRoot)
      return;
    if (observer && currentObserveRoot === targetRoot)
      return;
    if (observer) {
      try {
        observer.disconnect();
      } catch {}
    } else {
      observer = new MutationObserver((mutations) => {
        if (destroyed)
          return;
        let shouldScan = false;
        for (const mutation of mutations) {
          for (const added of mutation.addedNodes) {
            if (nodeContainsMessageMount(added)) {
              shouldScan = true;
              break;
            }
          }
          if (shouldScan)
            break;
        }
        if (shouldScan) {
          if (currentObserveRoot === document.body && findChatObserveRoot()) {
            ensureObserverBound();
          }
          scheduleScan();
        }
      });
    }
    currentObserveRoot = targetRoot;
    observer.observe(targetRoot, { childList: true, subtree: true });
  };
  const handleEventPayload = (eventName, payload) => {
    if (destroyed)
      return;
    const data = isRecord(payload) ? payload : {};
    if (eventName === "CHAT_SWITCHED") {
      const nextChatId = typeof data.chatId === "string" ? data.chatId : ctx.getActiveChat?.().chatId ?? null;
      if (nextChatId !== activeChatId) {
        activeChatId = nextChatId;
        tooltip.hide();
        messageInfoCache.clear();
        for (const entry of injectedByMessageId.values()) {
          cleanupEntry(entry);
        }
        injectedByMessageId.clear();
        if (activeChatId) {
          ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
          hydrateMessageCacheFromHost(activeChatId);
        }
      }
      ensureObserverBound();
      scheduleScan();
      return;
    }
    if (eventName === "CHAT_CHANGED") {
      const chatObj = isRecord(data.chat) ? data.chat : null;
      const nextChatId = typeof chatObj?.id === "string" ? chatObj.id : typeof data.chatId === "string" ? data.chatId : ctx.getActiveChat?.().chatId ?? activeChatId;
      if (nextChatId && nextChatId !== activeChatId) {
        activeChatId = nextChatId;
        tooltip.hide();
        messageInfoCache.clear();
        ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
        hydrateMessageCacheFromHost(activeChatId);
      }
      ensureObserverBound();
      scheduleScan();
      return;
    }
    if (eventName === "MESSAGE_DELETED") {
      const deletedId = typeof data.messageId === "string" ? data.messageId : isRecord(data.message) && typeof data.message.id === "string" ? data.message.id : null;
      if (deletedId) {
        messageInfoCache.delete(deletedId);
        const existing = injectedByMessageId.get(deletedId);
        if (existing) {
          cleanupEntry(existing);
          injectedByMessageId.delete(deletedId);
        }
      }
      scheduleScan();
      return;
    }
    if (isRecord(data.message)) {
      cacheMessageDto(data.message);
    } else if (typeof data.messageId === "string") {
      cacheMessageDto({
        id: data.messageId,
        swipe_id: typeof data.swipeId === "number" ? data.swipeId : undefined,
        is_user: typeof data.isUser === "boolean" ? data.isUser : undefined,
        content: typeof data.content === "string" ? data.content : undefined
      });
    }
    const targetMessageId = isRecord(data.message) && typeof data.message.id === "string" ? data.message.id : typeof data.messageId === "string" ? data.messageId : null;
    if (targetMessageId) {
      const bubbleEl = ctx.dom.findMessageElement(targetMessageId);
      if (bubbleEl) {
        renderMessageBubble(targetMessageId, bubbleEl);
        return;
      }
    }
    if (eventName === "GENERATION_ENDED" || eventName === "GENERATION_METRICS_READY") {
      if (activeChatId) {
        ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
      }
    }
    scheduleScan();
  };
  const unsubBackend = ctx.onBackendMessage((rawPayload) => {
    if (destroyed || !isRecord(rawPayload))
      return;
    const msg = rawPayload;
    if (msg.type === "state-update") {
      settings = sanitizeSettings(msg.settings);
      drawer.setSettings(settings);
      const nextChatId = msg.activeChatId ?? ctx.getActiveChat?.().chatId ?? activeChatId;
      activeChatId = nextChatId;
      if (activeChatId && isRecord(msg.meta)) {
        metaByChatId.set(activeChatId, msg.meta);
      }
      if (activeChatId && isRecord(msg.messageStates)) {
        messageStatesByChatId.set(activeChatId, msg.messageStates);
      }
      ensureObserverBound();
      renderAllMountedMessages();
      return;
    }
    if (msg.type === "chat-meta-update" && typeof msg.chatId === "string") {
      if (isRecord(msg.meta)) {
        metaByChatId.set(msg.chatId, msg.meta);
      }
      if (isRecord(msg.messageStates)) {
        messageStatesByChatId.set(msg.chatId, msg.messageStates);
      }
      if (!activeChatId) {
        activeChatId = ctx.getActiveChat?.().chatId ?? msg.chatId;
      }
      if (msg.chatId === activeChatId) {
        renderAllMountedMessages();
      }
    }
  });
  const unsubscribers = [unsubBackend];
  const subscribeEvent = (eventName, handler) => {
    if (ctx.events && typeof ctx.events.on === "function") {
      return ctx.events.on(eventName, handler);
    }
    const legacyOn = ctx.on;
    if (typeof legacyOn === "function") {
      return legacyOn(eventName, handler);
    }
    return null;
  };
  for (const eventName of REFRESH_EVENTS) {
    const unsub = subscribeEvent(eventName, (payload) => handleEventPayload(eventName, payload));
    if (unsub)
      unsubscribers.push(unsub);
  }
  try {
    if (ctx.state && typeof ctx.state.subscribe === "function") {
      const unsubChatState = ctx.state.subscribe("chat.active", (val) => {
        const nextId = val?.chatId ?? null;
        if (nextId !== activeChatId) {
          handleEventPayload("CHAT_SWITCHED", { chatId: nextId });
        }
      });
      unsubscribers.push(unsubChatState);
    }
  } catch {}
  ensureObserverBound();
  ctx.sendToBackend({ type: "get-state" });
  if (activeChatId) {
    ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
    hydrateMessageCacheFromHost(activeChatId);
  }
  renderAllMountedMessages();
  const cleanup = () => {
    if (destroyed)
      return;
    destroyed = true;
    if (scheduledScanRaf !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(scheduledScanRaf);
      scheduledScanRaf = null;
    }
    if (scheduledScanTimer !== null) {
      clearTimeout(scheduledScanTimer);
      scheduledScanTimer = null;
    }
    if (observer) {
      try {
        observer.disconnect();
      } catch {}
      observer = null;
    }
    currentObserveRoot = null;
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {}
    }
    unsubscribers.length = 0;
    for (const entry of injectedByMessageId.values()) {
      cleanupEntry(entry);
    }
    injectedByMessageId.clear();
    try {
      tooltip.destroy();
    } catch {}
    try {
      drawer.destroy();
    } catch {}
    try {
      ctx.dom.cleanup();
    } catch {}
    try {
      removeStyle();
    } catch {}
    if (activeTeardown === cleanup) {
      activeTeardown = null;
    }
  };
  activeTeardown = cleanup;
  return cleanup;
}
function teardown() {
  if (activeTeardown) {
    activeTeardown();
    activeTeardown = null;
  }
}
export {
  setup,
  teardown
};
