/**
 * Fast O(n) single-pass scanner that extracts macro names from `{{...}}` tokens
 * in a prompt template without mutating the template.
 */
export function extractMacroNames(template: string): string[] {
  if (typeof template !== "string" || template.length === 0) {
    return [];
  }

  const names: string[] = [];
  const len = template.length;
  let pos = 0;

  while (pos < len) {
    const openIdx = template.indexOf("{{", pos);
    if (openIdx === -1) break;

    // Skip escaped opening braces (`\{{`).
    if (openIdx > 0 && template[openIdx - 1] === "\\") {
      pos = openIdx + 2;
      continue;
    }

    let i = openIdx + 2;

    // Skip leading whitespace inside `{{ ... }}`.
    while (
      i < len &&
      (template[i] === " " ||
        template[i] === "\t" ||
        template[i] === "\r" ||
        template[i] === "\n")
    ) {
      i++;
    }

    // Skip comments `{{// ...}}`.
    if (i + 1 < len && template[i] === "/" && template[i + 1] === "/") {
      const closeIdx = template.indexOf("}}", i + 2);
      pos = closeIdx === -1 ? len : closeIdx + 2;
      continue;
    }

    // Skip closing block tags `{{/if}}`, `{{/each}}`, etc.
    if (i < len && template[i] === "/") {
      const closeIdx = template.indexOf("}}", i + 1);
      pos = closeIdx === -1 ? len : closeIdx + 2;
      continue;
    }

    // Skip macro evaluation flags (`!`, `?`, `~`, `>`, `#`).
    while (i < len) {
      const ch = template[i];
      if (ch === "!" || ch === "?" || ch === "~" || ch === ">" || ch === "#") {
        i++;
      } else {
        break;
      }
    }

    while (i < len && (template[i] === " " || template[i] === "\t")) {
      i++;
    }

    const nameStart = i;
    if (
      i < len &&
      (template[i] === "." || template[i] === "$" || template[i] === "@")
    ) {
      i++;
    }

    while (i < len) {
      const code = template.charCodeAt(i);
      const isNameChar =
        (code >= 48 && code <= 57) || // 0-9
        (code >= 65 && code <= 90) || // A-Z
        (code >= 97 && code <= 122) || // a-z
        code === 95 || // _
        code === 45; // -
      if (!isNameChar) break;
      // Stop before `--` or `-=` operators on variable shorthands.
      if (
        code === 45 &&
        i + 1 < len &&
        (template[i + 1] === "-" || template[i + 1] === "=")
      ) {
        break;
      }
      i++;
    }

    if (i > nameStart) {
      const rawName = template.slice(nameStart, i);
      if (rawName !== "." && rawName !== "$" && rawName !== "@") {
        names.push(rawName);
      }
    }

    // Advance past `}}` unless a nested `{{` appears earlier.
    const nextOpen = template.indexOf("{{", i);
    const closeIdx = template.indexOf("}}", i);
    if (closeIdx !== -1 && (nextOpen === -1 || closeIdx < nextOpen)) {
      pos = closeIdx + 2;
    } else {
      pos = i > openIdx + 2 ? i : openIdx + 2;
    }
  }

  return names;
}

/**
 * Extracts clean, deduplicated lorebook entry names from a `WORLD_INFO_ACTIVATED`
 * `entries` payload, preserving activation order.
 */
export function extractLorebookEntryNames(entries: unknown): string[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawEntry of entries) {
    let label = "";
    if (typeof rawEntry === "string") {
      label = rawEntry.trim();
    } else if (rawEntry && typeof rawEntry === "object") {
      const entry = rawEntry as Record<string, unknown>;
      const candidates: unknown[] = [
        entry.comment,
        entry.name,
        entry.title,
        Array.isArray(entry.keys) ? entry.keys[0] : undefined,
        entry.id,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          label = candidate.trim();
          break;
        }
      }
    }

    if (label && !seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }

  return result;
}

/**
 * Extracts a clean display string from `stopDetails` / `stop_details`
 * (which may be a string or a structured provider object).
 */
export function extractStopDetails(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof obj.type === "string" && obj.type.trim()) {
    parts.push(obj.type.trim());
  }
  if (typeof obj.category === "string" && obj.category.trim()) {
    parts.push(obj.category.trim());
  }
  if (typeof obj.explanation === "string" && obj.explanation.trim()) {
    parts.push(obj.explanation.trim());
  }
  if (parts.length > 0) {
    return parts.join(": ");
  }
  try {
    const serialized = JSON.stringify(obj);
    return serialized && serialized !== "{}" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

export function extractFinishReason(
  payload: Record<string, unknown>,
): string | undefined {
  const raw = payload.finishReason ?? payload.finish_reason;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return "error";
  }
  return undefined;
}

export function extractStopSequence(
  payload: Record<string, unknown>,
): string | undefined {
  const raw = payload.stopSequence ?? payload.stop_sequence;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return undefined;
}

export function extractDurationMs(metrics: unknown): number | undefined {
  if (!metrics || typeof metrics !== "object") {
    return undefined;
  }
  const durationMs = (metrics as Record<string, unknown>).durationMs;
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 0
  ) {
    return Math.round(durationMs);
  }
  return undefined;
}
