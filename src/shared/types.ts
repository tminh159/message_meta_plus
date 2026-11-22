export type FieldKey =
  | "generationTime"
  | "finishReason"
  | "lorebookTriggers"
  | "macrosApplied"
  | "wordCount"
  | "editedBadge";

export type FieldMode = "off" | "hover" | "inline";

export type DurationFormat = "hms" | "compact";

export const DURATION_FORMATS: readonly DurationFormat[] = ["hms", "compact"] as const;

export const DURATION_FORMAT_LABELS: Record<DurationFormat, string> = {
  hms: "HH:MM:SS (00:00:14)",
  compact: "Compact (14s / 1m 14s)",
};

export type PillPosition =
  | "next-to-pill"
  | "below-header"
  | "footer"
  | "header-corner";

export const PILL_POSITIONS: readonly PillPosition[] = [
  "next-to-pill",
  "below-header",
  "footer",
  "header-corner",
] as const;

export const PILL_POSITION_LABELS: Record<PillPosition, string> = {
  "next-to-pill": "Next to native pill",
  "below-header": "Below header",
  footer: "Message footer",
  "header-corner": "Header corner",
};

export const FIELD_KEYS: readonly FieldKey[] = [
  "generationTime",
  "finishReason",
  "lorebookTriggers",
  "macrosApplied",
  "wordCount",
  "editedBadge",
] as const;

export const FIELD_LABELS: Record<FieldKey, string> = {
  generationTime: "Generation Time",
  finishReason: "Finish Reason",
  lorebookTriggers: "Lorebook Triggers",
  macrosApplied: "Macros Applied",
  wordCount: "Word Count",
  editedBadge: "Edited Badge",
};

export interface ExtensionSettings {
  fields: Record<FieldKey, FieldMode>;
  finishReasonAbnormalOnly: boolean;
  position: PillPosition;
  durationFormat: DurationFormat;
  fieldOrder: FieldKey[];
  showOnUserMessages: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  fields: {
    generationTime: "inline",
    finishReason: "inline",
    lorebookTriggers: "hover",
    macrosApplied: "hover",
    wordCount: "hover",
    editedBadge: "inline",
  },
  finishReasonAbnormalOnly: true,
  position: "next-to-pill",
  durationFormat: "hms",
  fieldOrder: [...FIELD_KEYS],
  showOnUserMessages: true,
};

export interface LorebookTriggerSummary {
  count: number;
  entries: string[];
}

export interface MacrosAppliedSummary {
  count: number;
  names: string[];
}

export interface MessageMetaRecord {
  durationMs?: number;
  finishReason?: string;
  stopSequence?: string;
  stopDetails?: string;
  lorebookTriggers?: LorebookTriggerSummary;
  macrosApplied?: MacrosAppliedSummary;
  wordCount?: number;
  edited?: boolean;
  editedAt?: number;
  isUser?: boolean;
}

export type MessageMetaKey = `${string}:${number}`;

export type ChatMetaMap = Record<string, MessageMetaRecord>;

export function makeMetaKey(messageId: string, swipeId: number = 0): MessageMetaKey {
  const safeSwipe = Number.isFinite(swipeId) && swipeId >= 0 ? Math.floor(swipeId) : 0;
  return `${messageId}:${safeSwipe}`;
}

export function isFieldMode(value: unknown): value is FieldMode {
  return value === "off" || value === "hover" || value === "inline";
}

export function isDurationFormat(value: unknown): value is DurationFormat {
  return value === "hms" || value === "compact";
}

export function isFieldKey(value: unknown): value is FieldKey {
  return typeof value === "string" && (FIELD_KEYS as readonly string[]).includes(value);
}

/**
 * Normalizes a field-ordering array so each canonical FieldKey appears once.
 */
export function sanitizeFieldOrder(input: unknown): FieldKey[] {
  const seen = new Set<FieldKey>();
  const ordered: FieldKey[] = [];

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

export function isPillPosition(value: unknown): value is PillPosition {
  return (
    value === "next-to-pill" ||
    value === "below-header" ||
    value === "footer" ||
    value === "header-corner"
  );
}

export function sanitizeSettings(input: unknown): ExtensionSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawFields = (raw.fields && typeof raw.fields === "object" ? raw.fields : {}) as Record<string, unknown>;

  const fields = {} as Record<FieldKey, FieldMode>;
  for (const key of FIELD_KEYS) {
    const candidate = rawFields[key];
    fields[key] = isFieldMode(candidate) ? candidate : DEFAULT_SETTINGS.fields[key];
  }

  const finishReasonAbnormalOnly =
    typeof raw.finishReasonAbnormalOnly === "boolean"
      ? raw.finishReasonAbnormalOnly
      : DEFAULT_SETTINGS.finishReasonAbnormalOnly;

  const position = isPillPosition(raw.position)
    ? raw.position
    : DEFAULT_SETTINGS.position;

  const durationFormat = isDurationFormat(raw.durationFormat)
    ? raw.durationFormat
    : DEFAULT_SETTINGS.durationFormat;

  const fieldOrder = sanitizeFieldOrder(raw.fieldOrder);

  const showOnUserMessages =
    typeof raw.showOnUserMessages === "boolean"
      ? raw.showOnUserMessages
      : DEFAULT_SETTINGS.showOnUserMessages;

  return {
    fields,
    finishReasonAbnormalOnly,
    position,
    durationFormat,
    fieldOrder,
    showOnUserMessages,
  };
}

// ---------------------------------------------------------------------------
// Backend <-> Frontend IPC Message Types
// ---------------------------------------------------------------------------

export interface GetStateRequest {
  type: "get-state";
}

export interface UpdateSettingsRequest {
  type: "update-settings";
  settings: ExtensionSettings;
}

export interface GetChatMetaRequest {
  type: "get-chat-meta";
  chatId: string;
}

export interface HydrateChatRequest {
  type: "hydrate-chat";
  chatId: string;
}

export type FrontendToBackendMessage =
  | GetStateRequest
  | UpdateSettingsRequest
  | GetChatMetaRequest
  | HydrateChatRequest;

export interface MessageStateSummary {
  swipeId: number;
  isUser: boolean;
}

export interface StateUpdateMessage {
  type: "state-update";
  settings: ExtensionSettings;
  activeChatId: string | null;
  meta?: ChatMetaMap;
  messageStates?: Record<string, MessageStateSummary>;
}

export interface ChatMetaUpdateMessage {
  type: "chat-meta-update";
  chatId: string;
  meta: ChatMetaMap;
  messageStates?: Record<string, MessageStateSummary>;
}

export type BackendToFrontendMessage =
  | StateUpdateMessage
  | ChatMetaUpdateMessage;
