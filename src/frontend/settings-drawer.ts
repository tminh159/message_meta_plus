import type { SpindleDrawerTabHandle, SpindleFrontendContext } from "lumiverse-spindle-types";
import {
  DEFAULT_SETTINGS,
  DURATION_FORMATS,
  DurationFormat,
  ExtensionSettings,
  FIELD_KEYS,
  FIELD_LABELS,
  FieldKey,
  FieldMode,
  isDurationFormat,
  isPillPosition,
  MessageMetaRecord,
  PILL_POSITION_LABELS,
  PILL_POSITIONS,
  sanitizeFieldOrder,
  sanitizeSettings,
} from "../shared/types.js";
import { PillView, resolvePillView } from "../shared/format.js";
import { createSafeId, PortalTooltipController, TooltipRow } from "./tooltip.js";

const SETTINGS_TAB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r="0.8" fill="currentColor"/></svg>`;

const DURATION_FORMAT_SHORT_LABELS: Record<DurationFormat, string> = {
  hms: "HH:MM:SS",
  compact: "Compact",
};

const HELP_TOOLTIP_ROWS: readonly TooltipRow[] = [
  {
    label: "Pill rules",
    value: "Conditional & fallback",
    details: [
      "0 triggers, 0 macros, or unedited behave as Off",
      "All hover-only active fields collapse to (!)",
      "0 active fields hide the pill completely",
    ],
  },
  {
    label: "Generation Time",
    value: "HH:MM:SS or compact",
    details: ["AI messages only"],
  },
  {
    label: "Finish Reason",
    value: "Abnormal only option",
    details: ["Hides normal stops (stop, end_turn)", "AI messages only"],
  },
  {
    label: "Lorebook & Macros",
    value: "AI messages only",
    details: ["Hover/tap tooltip lists triggered entry & macro names"],
  },
  {
    label: "Word Count & Edited",
    value: "AI & user messages",
    details: ["Applies to user messages when Show on User Messages is enabled"],
  },
];

const MODE_OPTIONS: ReadonlyArray<{ mode: FieldMode; label: string }> = [
  { mode: "off", label: "Off" },
  { mode: "hover", label: "Hover" },
  { mode: "inline", label: "Inline" },
];

const SAMPLE_AI_RECORD: MessageMetaRecord = {
  durationMs: 14_000,
  finishReason: "length",
  lorebookTriggers: {
    count: 2,
    entries: ["Moonlit Citadel", "Arcane Pact"],
  },
  macrosApplied: {
    count: 2,
    names: ["{{char}}", "{{user}}"],
  },
  wordCount: 142,
  edited: true,
  isUser: false,
};

const CIRCLE_PREVIEW_SETTINGS: ExtensionSettings = {
  fields: {
    generationTime: "hover",
    finishReason: "hover",
    lorebookTriggers: "hover",
    macrosApplied: "hover",
    wordCount: "hover",
    editedBadge: "hover",
  },
  finishReasonAbnormalOnly: false,
  position: "next-to-pill",
  durationFormat: "hms",
  fieldOrder: [...FIELD_KEYS],
  showOnUserMessages: true,
};

export interface SettingsDrawerController {
  tab: SpindleDrawerTabHandle;
  setSettings(settings: ExtensionSettings): void;
  destroy(): void;
}

function buildPreviewPillElement(
  view: PillView,
  tooltip: PortalTooltipController,
  signal: AbortSignal,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = view.mode === "circle" ? "mmp-pill mmp-pill--circle" : "mmp-pill";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute(
    "aria-label",
    view.mode === "circle" ? "Message metadata (hover or tap for details)" : "Message metadata details",
  );

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
      span.className =
        seg.key === "finishReason" ? "mmp-segment mmp-segment--abnormal" : "mmp-segment";
      span.textContent = seg.text;
      button.appendChild(span);
    });
  }

  tooltip.attach(button, view.tooltipRows, signal);
  return button;
}

export function createSettingsDrawer(
  ctx: SpindleFrontendContext,
  initialSettings: ExtensionSettings,
  tooltip: PortalTooltipController,
  onSettingsChanged: (next: ExtensionSettings) => void,
): SettingsDrawerController {
  const tab = ctx.ui.registerDrawerTab({
    id: "settings",
    title: "Message Meta Plus",
    shortName: "Meta+",
    headerTitle: "Message Meta Plus",
    description: "Configure companion metadata pills, hover-only (!) badges, and tooltips",
    keywords: ["message", "meta", "pill", "lorebook", "macro", "finish", "words", "edited"],
    iconSvg: SETTINGS_TAB_ICON,
  });

  let currentSettings = sanitizeSettings(initialSettings);
  let destroyed = false;
  let previewAbort: AbortController | null = null;
  const helpAbort = new AbortController();

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

  const segmentButtons = new Map<FieldKey, Map<FieldMode, HTMLButtonElement>>();

  const commitSettings = (next: ExtensionSettings): void => {
    currentSettings = sanitizeSettings(next);
    syncControls();
    renderPreview();
    onSettingsChanged(currentSettings);
    ctx.sendToBackend({ type: "update-settings", settings: currentSettings });
  };

  // General display settings section (borderless hairline rows)
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
    if (destroyed) return;
    if (!isPillPosition(positionSelect.value)) return;
    if (currentSettings.position === positionSelect.value) return;
    commitSettings({
      ...currentSettings,
      position: positionSelect.value,
    });
  });

  positionRow.append(positionLabel, positionSelect);

  // User message visibility toggle
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
    if (destroyed) return;
    commitSettings({
      ...currentSettings,
      showOnUserMessages: userToggleInput.checked,
    });
  });

  userToggleRow.append(userToggleLabel, userToggleInput);
  positionSection.append(positionRow, userToggleRow);

  // Compact duration format select (nested inside generationTime row)
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
    if (destroyed) return;
    if (!isDurationFormat(durationSelect.value)) return;
    if (currentSettings.durationFormat === durationSelect.value) return;
    commitSettings({
      ...currentSettings,
      durationFormat: durationSelect.value as DurationFormat,
    });
  });

  // Field controls section
  const fieldsSection = document.createElement("section");
  fieldsSection.className = "mmp-section";
  const fieldsHeading = document.createElement("h3");
  fieldsHeading.className = "mmp-section-title";
  fieldsHeading.textContent = "Field Display & Order";
  fieldsSection.appendChild(fieldsHeading);

  const fieldList = document.createElement("div");
  fieldList.className = "mmp-field-list";

  const fieldRows = new Map<FieldKey, HTMLDivElement>();
  const orderButtons = new Map<FieldKey, { up: HTMLButtonElement; down: HTMLButtonElement }>();

  const moveField = (key: FieldKey, delta: -1 | 1): void => {
    if (destroyed) return;
    const order = sanitizeFieldOrder(currentSettings.fieldOrder);
    const idx = order.indexOf(key);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= order.length) return;
    const nextOrder = [...order];
    const currentItem = nextOrder[idx]!;
    nextOrder[idx] = nextOrder[targetIdx]!;
    nextOrder[targetIdx] = currentItem;
    commitSettings({
      ...currentSettings,
      fieldOrder: nextOrder,
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

    const btnMap = new Map<FieldMode, HTMLButtonElement>();
    for (const option of MODE_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mmp-seg-btn";
      btn.setAttribute("role", "radio");
      btn.dataset.mmpField = key;
      btn.dataset.mmpMode = option.mode;
      btn.textContent = option.label;
      btn.addEventListener("click", () => {
        if (destroyed) return;
        if (currentSettings.fields[key] === option.mode) return;
        commitSettings({
          ...currentSettings,
          fields: {
            ...currentSettings.fields,
            [key]: option.mode,
          },
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

  // Finish Reason abnormal-only toggle
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
    if (destroyed) return;
    commitSettings({
      ...currentSettings,
      finishReasonAbnormalOnly: toggleInput.checked,
    });
  });

  toggleRow.append(toggleLabel, toggleInput);
  fieldsSection.appendChild(toggleRow);

  // Live Preview section (borderless)
  const previewSection = document.createElement("section");
  previewSection.className = "mmp-section";
  const previewHeading = document.createElement("h3");
  previewHeading.className = "mmp-section-title";
  previewHeading.textContent = "Live Preview";
  const previewList = document.createElement("div");
  previewList.className = "mmp-preview-list";
  previewSection.append(previewHeading, previewList);

  root.append(header, positionSection, fieldsSection, previewSection);

  const syncControls = (): void => {
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
      if (!btnMap) return;
      for (const [optMode, btn] of btnMap) {
        const checked = optMode === mode;
        btn.setAttribute("aria-checked", checked ? "true" : "false");
      }
    });

    toggleInput.checked = currentSettings.finishReasonAbnormalOnly;
  };

  const renderPreview = (): void => {
    if (previewAbort) {
      tooltip.hide();
      previewAbort.abort();
    }
    previewAbort = new AbortController();
    const signal = previewAbort.signal;

    const liveView = resolvePillView(SAMPLE_AI_RECORD, currentSettings, { isUser: false });
    const inlinePreviewView =
      liveView.mode === "inline"
        ? liveView
        : resolvePillView(SAMPLE_AI_RECORD, {
            fields: {
              generationTime: "inline",
              finishReason: "inline",
              lorebookTriggers: "hover",
              macrosApplied: "hover",
              wordCount: "inline",
              editedBadge: "inline",
            },
            finishReasonAbnormalOnly: false,
            position: currentSettings.position,
            durationFormat: currentSettings.durationFormat,
            fieldOrder: currentSettings.fieldOrder,
            showOnUserMessages: currentSettings.showOnUserMessages,
          });
    const circlePreviewView = resolvePillView(
      SAMPLE_AI_RECORD,
      {
        ...CIRCLE_PREVIEW_SETTINGS,
        durationFormat: currentSettings.durationFormat,
        fieldOrder: currentSettings.fieldOrder,
      },
      { isUser: false },
    );

    const liveRow = document.createElement("div");
    liveRow.className = "mmp-preview-row";
    const liveCap = document.createElement("span");
    liveCap.className = "mmp-preview-caption";
    liveCap.textContent =
      liveView.mode === "inline"
        ? "Inline pill (active settings)"
        : liveView.mode === "circle"
          ? "Circle (!) badge (active settings)"
          : "Active settings (hidden — 0 active fields)";
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

  const setSettings = (settings: ExtensionSettings): void => {
    if (destroyed) return;
    currentSettings = sanitizeSettings(settings);
    syncControls();
    renderPreview();
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    helpAbort.abort();
    previewAbort?.abort();
    previewAbort = null;
    tab.destroy();
  };

  return {
    tab,
    setSettings,
    destroy,
  };
}
