import {
  DurationFormat,
  ExtensionSettings,
  FieldKey,
  MessageMetaRecord,
  sanitizeFieldOrder,
} from "./types.js";

export type PillViewMode = "hidden" | "circle" | "inline";

export interface PillInlineSegment {
  key: FieldKey;
  text: string;
}

export interface PillTooltipRow {
  key: FieldKey;
  label: string;
  value: string;
  details?: string[];
}

export interface PillResolveContext {
  isUser?: boolean;
  content?: string;
}

export interface PillView {
  visible: boolean;
  mode: PillViewMode;
  inlineSegments: PillInlineSegment[];
  tooltipRows: PillTooltipRow[];
}

const NORMAL_FINISH_REASONS = new Set([
  "stop",
  "end_turn",
  "stop_sequence",
  "eos",
  "normal",
  "complete",
  "completed",
  "finish",
  "finished",
]);

/**
 * Formats a duration in milliseconds strictly as `HH:MM:SS` (e.g. `00:00:14`).
 */
export function formatDurationHMS(ms: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return "00:00:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":");
}

/**
 * Formats a duration in milliseconds in compact human units (e.g. `14s`, `1m 14s`, `1h 2m 3s`).
 */
export function formatDurationCompact(ms: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    const parts = [`${hours}h`];
    if (minutes > 0 || seconds > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    return parts.join(" ");
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Formats a duration using the configured display style.
 */
export function formatDuration(ms: number, format: DurationFormat = "hms"): string {
  return format === "compact" ? formatDurationCompact(ms) : formatDurationHMS(ms);
}

/**
 * Counts whitespace-delimited words in text.
 */
export function countWords(text: string): number {
  if (typeof text !== "string") return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Returns true if a finish reason indicates non-normal termination
 * (e.g. length, max_tokens, content_filter, error, stopped).
 */
export function isAbnormalFinishReason(reason?: string): boolean {
  if (typeof reason !== "string") return false;
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return false;
  return !NORMAL_FINISH_REASONS.has(normalized);
}

interface ResolvedField {
  inlineText: string;
  tooltipRow: PillTooltipRow;
}

function resolveField(
  key: FieldKey,
  record: MessageMetaRecord | null | undefined,
  settings: ExtensionSettings,
  isUser: boolean,
  context?: PillResolveContext,
): ResolvedField | null {
  switch (key) {
    case "generationTime": {
      if (isUser) return null;
      const ms = record?.durationMs;
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
      const formatted = formatDuration(ms, settings.durationFormat);
      return {
        inlineText: formatted,
        tooltipRow: {
          key,
          label: "Generation Time",
          value: formatted,
        },
      };
    }

    case "finishReason": {
      if (isUser) return null;
      const rawReason = record?.finishReason;
      if (typeof rawReason !== "string") return null;
      const reason = rawReason.trim();
      if (!reason) return null;
      if (settings.finishReasonAbnormalOnly && !isAbnormalFinishReason(reason)) {
        return null;
      }
      const details: string[] = [];
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
          ...(details.length > 0 ? { details } : {}),
        },
      };
    }

    case "lorebookTriggers": {
      if (isUser) return null;
      const triggers = record?.lorebookTriggers;
      if (!triggers || typeof triggers.count !== "number" || !Number.isFinite(triggers.count) || triggers.count <= 0) {
        return null;
      }
      const count = Math.floor(triggers.count);
      const entries = Array.isArray(triggers.entries)
        ? triggers.entries.filter((e): e is string => typeof e === "string" && e.length > 0)
        : [];
      return {
        inlineText: `${count} LB`,
        tooltipRow: {
          key,
          label: "Lorebook Triggers",
          value: `${count} ${count === 1 ? "entry" : "entries"}`,
          ...(entries.length > 0 ? { details: entries } : {}),
        },
      };
    }

    case "macrosApplied": {
      if (isUser) return null;
      const macros = record?.macrosApplied;
      if (!macros || typeof macros.count !== "number" || !Number.isFinite(macros.count) || macros.count <= 0) {
        return null;
      }
      const count = Math.floor(macros.count);
      const names = Array.isArray(macros.names)
        ? macros.names.filter((n): n is string => typeof n === "string" && n.length > 0)
        : [];
      return {
        inlineText: `${count} ${count === 1 ? "macro" : "macros"}`,
        tooltipRow: {
          key,
          label: "Macros Applied",
          value: `${count} ${count === 1 ? "macro" : "macros"}`,
          ...(names.length > 0 ? { details: names } : {}),
        },
      };
    }

    case "wordCount": {
      let words: number | undefined;
      if (typeof record?.wordCount === "number" && Number.isFinite(record.wordCount) && record.wordCount >= 0) {
        words = Math.floor(record.wordCount);
      } else if (typeof context?.content === "string") {
        words = countWords(context.content);
      }
      if (words === undefined) return null;
      return {
        inlineText: `${words}w`,
        tooltipRow: {
          key,
          label: "Word Count",
          value: `${words} ${words === 1 ? "word" : "words"}`,
        },
      };
    }

    case "editedBadge": {
      if (record?.edited !== true) return null;
      return {
        inlineText: "Edited",
        tooltipRow: {
          key,
          label: "Edited",
          value: "Edited",
        },
      };
    }
  }
}

/**
 * Resolves the pill display mode, inline segments, and tooltip rows for a message.
 *
 * Rules:
 * 1. Conditional fields with no data (0 lorebook triggers, 0 macros, edited !== true,
 *    AI-only fields missing or on user messages, or normal finishReason when
 *    finishReasonAbnormalOnly is true) behave as Off for that message.
 * 2. If >= 1 active field is Inline -> mode: 'inline' with inlineSegments and all
 *    active fields in tooltipRows.
 * 3. If all active fields are Hover-only -> mode: 'circle' with tooltipRows.
 * 4. If 0 active fields -> visible: false, mode: 'hidden'.
 */
export function resolvePillView(
  record: MessageMetaRecord | null | undefined,
  settings: ExtensionSettings,
  context?: PillResolveContext,
): PillView {
  const isUser = context?.isUser ?? record?.isUser ?? false;
  if (isUser && settings.showOnUserMessages === false) {
    return {
      visible: false,
      mode: "hidden",
      inlineSegments: [],
      tooltipRows: [],
    };
  }

  const inlineSegments: PillInlineSegment[] = [];
  const tooltipRows: PillTooltipRow[] = [];

  for (const key of sanitizeFieldOrder(settings.fieldOrder)) {
    const mode = settings.fields[key] ?? "off";
    if (mode === "off") continue;

    const resolved = resolveField(key, record, settings, isUser, context);
    if (!resolved) continue;

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
      tooltipRows: [],
    };
  }

  if (inlineSegments.length > 0) {
    return {
      visible: true,
      mode: "inline",
      inlineSegments,
      tooltipRows,
    };
  }

  return {
    visible: true,
    mode: "circle",
    inlineSegments: [],
    tooltipRows,
  };
}
