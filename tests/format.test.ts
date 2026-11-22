import { describe, expect, test } from "bun:test";
import {
  countWords,
  formatDuration,
  formatDurationCompact,
  formatDurationHMS,
  isAbnormalFinishReason,
  resolvePillView,
} from "../src/shared/format.js";
import {
  DEFAULT_SETTINGS,
  DURATION_FORMATS,
  type DurationFormat,
  type ExtensionSettings,
  FIELD_KEYS,
  type FieldKey,
  isDurationFormat,
  isPillPosition,
  makeMetaKey,
  type MessageMetaRecord,
  PILL_POSITIONS,
  type PillPosition,
  sanitizeFieldOrder,
  sanitizeSettings,
} from "../src/shared/types.js";

function makeSettings(
  overrides: Partial<ExtensionSettings["fields"]> = {},
  finishReasonAbnormalOnly = true,
  position: PillPosition = "next-to-pill",
  extra: Partial<Pick<ExtensionSettings, "durationFormat" | "fieldOrder" | "showOnUserMessages">> = {},
): ExtensionSettings {
  return {
    fields: {
      generationTime: "off",
      finishReason: "off",
      lorebookTriggers: "off",
      macrosApplied: "off",
      wordCount: "off",
      editedBadge: "off",
      ...overrides,
    },
    finishReasonAbnormalOnly,
    position,
    durationFormat: extra.durationFormat ?? "hms",
    fieldOrder: extra.fieldOrder ?? [...FIELD_KEYS],
    showOnUserMessages: extra.showOnUserMessages ?? true,
  };
}

describe("formatDurationHMS", () => {
  test("formats 0ms, negative, and non-finite inputs as 00:00:00", () => {
    expect(formatDurationHMS(0)).toBe("00:00:00");
    expect(formatDurationHMS(-500)).toBe("00:00:00");
    expect(formatDurationHMS(Number.NaN)).toBe("00:00:00");
    expect(formatDurationHMS(Number.POSITIVE_INFINITY)).toBe("00:00:00");
  });

  test("formats 14_000ms as 00:00:14 and sub-second truncation", () => {
    expect(formatDurationHMS(14_000)).toBe("00:00:14");
    expect(formatDurationHMS(14_999)).toBe("00:00:14");
    expect(formatDurationHMS(999)).toBe("00:00:00");
  });

  test("formats 1h 2m 3s (3_723_000ms) as 01:02:03 and multi-hour values", () => {
    expect(formatDurationHMS(3_723_000)).toBe("01:02:03");
    expect(formatDurationHMS(360_000_000)).toBe("100:00:00");
  });
});

describe("formatDurationCompact & formatDuration", () => {
  test("formats 0ms, negative, and non-finite inputs as 0s", () => {
    expect(formatDurationCompact(0)).toBe("0s");
    expect(formatDurationCompact(-500)).toBe("0s");
    expect(formatDurationCompact(Number.NaN)).toBe("0s");
    expect(formatDurationCompact(Number.POSITIVE_INFINITY)).toBe("0s");
  });

  test("formats seconds, minutes, and hours cleanly", () => {
    expect(formatDurationCompact(14_000)).toBe("14s");
    expect(formatDurationCompact(60_000)).toBe("1m");
    expect(formatDurationCompact(74_000)).toBe("1m 14s");
    expect(formatDurationCompact(3_600_000)).toBe("1h");
    expect(formatDurationCompact(3_605_000)).toBe("1h 0m 5s");
    expect(formatDurationCompact(3_723_000)).toBe("1h 2m 3s");
  });

  test("dispatches between hms and compact formats", () => {
    expect(formatDuration(14_000, "hms")).toBe("00:00:14");
    expect(formatDuration(14_000, "compact")).toBe("14s");
  });
});

describe("countWords", () => {
  test("counts whitespace-delimited words accurately", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
    expect(countWords("hello")).toBe(1);
    expect(countWords("  hello   world\nfrom\tLumiverse  ")).toBe(4);
  });
});

describe("isAbnormalFinishReason", () => {
  test("treats normal stop reasons (case-insensitive) as non-abnormal", () => {
    expect(isAbnormalFinishReason("stop")).toBe(false);
    expect(isAbnormalFinishReason("STOP")).toBe(false);
    expect(isAbnormalFinishReason("end_turn")).toBe(false);
    expect(isAbnormalFinishReason("stop_sequence")).toBe(false);
    expect(isAbnormalFinishReason("eos")).toBe(false);
    expect(isAbnormalFinishReason("completed")).toBe(false);
    expect(isAbnormalFinishReason("")).toBe(false);
    expect(isAbnormalFinishReason("   ")).toBe(false);
    expect(isAbnormalFinishReason(undefined)).toBe(false);
  });

  test("treats length, max_tokens, content_filter, error, and stopped as abnormal", () => {
    expect(isAbnormalFinishReason("length")).toBe(true);
    expect(isAbnormalFinishReason("max_tokens")).toBe(true);
    expect(isAbnormalFinishReason("content_filter")).toBe(true);
    expect(isAbnormalFinishReason("error")).toBe(true);
    expect(isAbnormalFinishReason("stopped")).toBe(true);
    expect(isAbnormalFinishReason("SAFETY")).toBe(true);
  });
});

describe("shared types helpers", () => {
  test("makeMetaKey, isPillPosition, and sanitizeSettings normalize edge inputs", () => {
    expect(makeMetaKey("msg-1", 2)).toBe("msg-1:2");
    expect(makeMetaKey("msg-1", -3)).toBe("msg-1:0");
    expect(makeMetaKey("msg-1")).toBe("msg-1:0");

    expect(DEFAULT_SETTINGS.position).toBe("next-to-pill");
    expect(PILL_POSITIONS).toEqual(["next-to-pill", "below-header", "footer", "header-corner"]);
    for (const pos of PILL_POSITIONS) {
      expect(isPillPosition(pos)).toBe(true);
      const valid = sanitizeSettings({ position: pos });
      expect(valid.position).toBe(pos);
    }
    expect(isPillPosition("invalid-slot")).toBe(false);

    const sanitized = sanitizeSettings({
      fields: { generationTime: "invalid", wordCount: "inline" },
      finishReasonAbnormalOnly: "nope",
      position: "bogus",
      durationFormat: "bogus",
      fieldOrder: ["wordCount", "bogus", "wordCount", "generationTime"],
      showOnUserMessages: "yes",
    });
    expect(sanitized.fields.generationTime).toBe(DEFAULT_SETTINGS.fields.generationTime);
    expect(sanitized.fields.wordCount).toBe("inline");
    expect(sanitized.finishReasonAbnormalOnly).toBe(DEFAULT_SETTINGS.finishReasonAbnormalOnly);
    expect(sanitized.position).toBe("next-to-pill");
    expect(sanitized.durationFormat).toBe("hms");
    expect(sanitized.showOnUserMessages).toBe(true);
    expect(sanitized.fieldOrder).toEqual([
      "wordCount",
      "generationTime",
      "finishReason",
      "lorebookTriggers",
      "macrosApplied",
      "editedBadge",
    ]);

    expect(DURATION_FORMATS).toEqual(["hms", "compact"]);
    expect(isDurationFormat("compact")).toBe(true);
    expect(isDurationFormat("weird")).toBe(false);
    expect(sanitizeFieldOrder(null)).toEqual([...FIELD_KEYS]);
  });
});

describe("resolvePillView", () => {
  const fullAiRecord: MessageMetaRecord = {
    durationMs: 14_000,
    finishReason: "length",
    stopSequence: "###",
    stopDetails: "Hit max output tokens",
    lorebookTriggers: { count: 2, entries: ["Dragon Lore", "Citadel"] },
    macrosApplied: { count: 2, names: ["char", "user"] },
    wordCount: 42,
    edited: true,
    isUser: false,
  };

  test("renders inline segments joined conceptually by middot (·) in canonical field order", () => {
    const settings = makeSettings({
      generationTime: "inline",
      finishReason: "inline",
      lorebookTriggers: "inline",
      macrosApplied: "hover",
      wordCount: "inline",
      editedBadge: "inline",
    });

    const view = resolvePillView(fullAiRecord, settings, { isUser: false });
    expect(view.visible).toBe(true);
    expect(view.mode).toBe("inline");
    expect(view.inlineSegments).toEqual([
      { key: "generationTime", text: "00:00:14" },
      { key: "finishReason", text: "length" },
      { key: "lorebookTriggers", text: "2 LB" },
      { key: "wordCount", text: "42w" },
      { key: "editedBadge", text: "Edited" },
    ]);
    expect(view.inlineSegments.map((s) => s.text).join(" · ")).toBe(
      "00:00:14 · length · 2 LB · 42w · Edited",
    );
    // All active fields (inline + hover) are included in tooltipRows
    expect(view.tooltipRows.map((r) => r.key)).toEqual([
      "generationTime",
      "finishReason",
      "lorebookTriggers",
      "macrosApplied",
      "wordCount",
      "editedBadge",
    ]);
    expect(view.tooltipRows.find((r) => r.key === "lorebookTriggers")?.details).toEqual([
      "Dragon Lore",
      "Citadel",
    ]);
    expect(view.tooltipRows.find((r) => r.key === "macrosApplied")?.details).toEqual([
      "char",
      "user",
    ]);
    expect(view.tooltipRows.find((r) => r.key === "finishReason")?.details).toEqual([
      "Stop sequence: ###",
      "Hit max output tokens",
    ]);
  });

  test("all active fields set to hover-only resolves to circle (!) mode", () => {
    const settings = makeSettings({
      generationTime: "hover",
      lorebookTriggers: "hover",
      wordCount: "hover",
    });

    const view = resolvePillView(fullAiRecord, settings, { isUser: false });
    expect(view.visible).toBe(true);
    expect(view.mode).toBe("circle");
    expect(view.inlineSegments).toEqual([]);
    expect(view.tooltipRows.map((r) => r.key)).toEqual([
      "generationTime",
      "lorebookTriggers",
      "wordCount",
    ]);
  });

  test("conditional fields (lorebookTriggers=0, macrosApplied=0, edited=false) behave as Off even when Inline or Hover", () => {
    const emptyConditionalsRecord: MessageMetaRecord = {
      lorebookTriggers: { count: 0, entries: [] },
      macrosApplied: { count: 0, names: [] },
      edited: false,
      isUser: false,
    };

    const settings = makeSettings({
      lorebookTriggers: "inline",
      macrosApplied: "hover",
      editedBadge: "inline",
    });

    const view = resolvePillView(emptyConditionalsRecord, settings, { isUser: false });
    expect(view.visible).toBe(false);
    expect(view.mode).toBe("hidden");
    expect(view.inlineSegments).toEqual([]);
    expect(view.tooltipRows).toEqual([]);
  });

  test("when all Inline fields are conditional-empty while at least one Hover field has data -> collapses to circle (!)", () => {
    const record: MessageMetaRecord = {
      durationMs: 5_000,
      finishReason: "stop", // normal stop -> hidden when finishReasonAbnormalOnly is true
      lorebookTriggers: { count: 0, entries: [] },
      macrosApplied: { count: 0, names: [] },
      wordCount: 18,
      edited: false,
      isUser: false,
    };

    const settings = makeSettings(
      {
        generationTime: "hover", // has data -> hover-only active field
        finishReason: "inline", // normal -> conditional-empty when abnormalOnly=true
        lorebookTriggers: "inline", // 0 -> conditional-empty
        macrosApplied: "inline", // 0 -> conditional-empty
        editedBadge: "inline", // false -> conditional-empty
        wordCount: "hover", // has data -> hover-only active field
      },
      true,
    );

    const view = resolvePillView(record, settings, { isUser: false });
    expect(view.visible).toBe(true);
    expect(view.mode).toBe("circle");
    expect(view.inlineSegments).toEqual([]);
    expect(view.tooltipRows.map((r) => r.key)).toEqual([
      "generationTime",
      "wordCount",
    ]);
  });

  test("finishReasonAbnormalOnly=false surfaces normal finishReason inline", () => {
    const record: MessageMetaRecord = {
      finishReason: "stop",
      isUser: false,
    };
    const settings = makeSettings({ finishReason: "inline" }, false);
    const view = resolvePillView(record, settings, { isUser: false });
    expect(view.visible).toBe(true);
    expect(view.mode).toBe("inline");
    expect(view.inlineSegments).toEqual([{ key: "finishReason", text: "stop" }]);
  });

  test("when 0 active fields remain (e.g. user message with only AI fields enabled) -> hidden (no empty !)", () => {
    const userRecord: MessageMetaRecord = {
      durationMs: 12_000,
      finishReason: "length",
      lorebookTriggers: { count: 3, entries: ["ShouldBeIgnoredForUser"] },
      macrosApplied: { count: 2, names: ["char"] },
      wordCount: 15,
      edited: false,
      isUser: true,
    };

    const aiOnlySettings = makeSettings({
      generationTime: "inline",
      finishReason: "hover",
      lorebookTriggers: "inline",
      macrosApplied: "hover",
      wordCount: "off",
      editedBadge: "inline",
    });

    const view = resolvePillView(userRecord, aiOnlySettings, { isUser: true });
    expect(view.visible).toBe(false);
    expect(view.mode).toBe("hidden");
    expect(view.inlineSegments).toEqual([]);
    expect(view.tooltipRows).toEqual([]);
  });

  test("user message with wordCount or edited=true still renders allowed user fields", () => {
    const userRecord: MessageMetaRecord = {
      isUser: true,
      edited: true,
    };
    const settings = makeSettings({
      generationTime: "inline",
      wordCount: "hover",
      editedBadge: "inline",
    });

    const view = resolvePillView(userRecord, settings, {
      isUser: true,
      content: "Hello from user side",
    });
    expect(view.visible).toBe(true);
    expect(view.mode).toBe("inline");
    expect(view.inlineSegments).toEqual([{ key: "editedBadge", text: "Edited" }]);
    expect(view.tooltipRows.map((r) => r.key)).toEqual(["wordCount", "editedBadge"]);
    expect(view.tooltipRows.find((r) => r.key === "wordCount")?.value).toBe("4 words");
  });

  test("respects durationFormat='compact', custom fieldOrder, and showOnUserMessages=false", () => {
    const aiRecord: MessageMetaRecord = {
      durationMs: 74_000,
      wordCount: 88,
      edited: true,
      isUser: false,
    };
    const customOrder: FieldKey[] = [
      "wordCount",
      "editedBadge",
      "generationTime",
      "finishReason",
      "lorebookTriggers",
      "macrosApplied",
    ];
    const aiSettings = makeSettings(
      {
        generationTime: "inline",
        wordCount: "inline",
        editedBadge: "inline",
      },
      true,
      "next-to-pill",
      {
        durationFormat: "compact",
        fieldOrder: customOrder,
        showOnUserMessages: false,
      },
    );

    const aiView = resolvePillView(aiRecord, aiSettings, { isUser: false });
    expect(aiView.mode).toBe("inline");
    expect(aiView.inlineSegments).toEqual([
      { key: "wordCount", text: "88w" },
      { key: "editedBadge", text: "Edited" },
      { key: "generationTime", text: "1m 14s" },
    ]);
    expect(aiView.tooltipRows.map((r) => r.key)).toEqual([
      "wordCount",
      "editedBadge",
      "generationTime",
    ]);

    const userView = resolvePillView(
      { isUser: true, wordCount: 20, edited: true },
      aiSettings,
      { isUser: true, content: "Twenty words here" },
    );
    expect(userView.visible).toBe(false);
    expect(userView.mode).toBe("hidden");
    expect(userView.inlineSegments).toEqual([]);
    expect(userView.tooltipRows).toEqual([]);
  });
});
