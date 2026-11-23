// @bun
// src/shared/types.ts
var FIELD_KEYS = [
  "generationTime",
  "finishReason",
  "lorebookTriggers",
  "macrosApplied",
  "wordCount",
  "editedBadge"
];
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
function countWords(text) {
  if (typeof text !== "string")
    return 0;
  const trimmed = text.trim();
  if (!trimmed)
    return 0;
  return trimmed.split(/\s+/).length;
}

// src/backend/extractors.ts
function extractMacroNames(template) {
  if (typeof template !== "string" || template.length === 0) {
    return [];
  }
  const names = [];
  const len = template.length;
  let pos = 0;
  while (pos < len) {
    const openIdx = template.indexOf("{{", pos);
    if (openIdx === -1)
      break;
    if (openIdx > 0 && template[openIdx - 1] === "\\") {
      pos = openIdx + 2;
      continue;
    }
    let i = openIdx + 2;
    while (i < len && (template[i] === " " || template[i] === "\t" || template[i] === "\r" || template[i] === `
`)) {
      i++;
    }
    if (i + 1 < len && template[i] === "/" && template[i + 1] === "/") {
      const closeIdx = template.indexOf("}}", i + 2);
      pos = closeIdx === -1 ? len : closeIdx + 2;
      continue;
    }
    if (i < len && template[i] === "/") {
      const closeIdx = template.indexOf("}}", i + 1);
      pos = closeIdx === -1 ? len : closeIdx + 2;
      continue;
    }
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
    if (i < len && (template[i] === "." || template[i] === "$" || template[i] === "@")) {
      i++;
    }
    while (i < len) {
      const code = template.charCodeAt(i);
      const isNameChar = code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95 || code === 45;
      if (!isNameChar)
        break;
      if (code === 45 && i + 1 < len && (template[i + 1] === "-" || template[i + 1] === "=")) {
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
function extractLorebookEntryNames(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  const seen = new Set;
  const result = [];
  for (const rawEntry of entries) {
    let label = "";
    if (typeof rawEntry === "string") {
      label = rawEntry.trim();
    } else if (rawEntry && typeof rawEntry === "object") {
      const entry = rawEntry;
      const candidates = [
        entry.comment,
        entry.name,
        entry.title,
        Array.isArray(entry.keys) ? entry.keys[0] : undefined,
        entry.id
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
function extractStopDetails(raw) {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!raw || typeof raw !== "object") {
    return;
  }
  const obj = raw;
  const parts = [];
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
    return;
  }
}
function extractFinishReason(payload) {
  const raw = payload.finishReason ?? payload.finish_reason;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return "error";
  }
  return;
}
function extractStopSequence(payload) {
  const raw = payload.stopSequence ?? payload.stop_sequence;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return;
}
function extractDurationMs(metrics) {
  if (!metrics || typeof metrics !== "object") {
    return;
  }
  const durationMs = metrics.durationMs;
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
    return Math.round(durationMs);
  }
  return;
}

// src/backend/store.ts
var SETTINGS_FILE = "settings.json";
var CHATS_DIR = "chats";
var DEFAULT_USER_SCOPE = "__default__";
function sanitizeChatStorageKey(chatId) {
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${CHATS_DIR}/${safe || "unknown"}.json`;
}
function resolveUserScopeKey(userId) {
  return typeof userId === "string" && userId.length > 0 ? userId : DEFAULT_USER_SCOPE;
}
function cloneRecord(record) {
  return {
    ...record,
    ...record.lorebookTriggers ? {
      lorebookTriggers: {
        count: record.lorebookTriggers.count,
        entries: [...record.lorebookTriggers.entries]
      }
    } : {},
    ...record.macrosApplied ? {
      macrosApplied: {
        count: record.macrosApplied.count,
        names: [...record.macrosApplied.names]
      }
    } : {}
  };
}
function cloneChatMeta(meta) {
  const copy = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value && typeof value === "object") {
      copy[key] = cloneRecord(value);
    }
  }
  return copy;
}

class BackendStore {
  storage;
  userStorage;
  settingsCache = new Map;
  chatMetaCache = new Map;
  writeChains = new Map;
  constructor(storage, userStorage) {
    this.storage = storage;
    this.userStorage = userStorage;
  }
  shouldUseUserStorage(userId) {
    return typeof userId === "string" && userId.length > 0 && this.userStorage !== undefined && this.userStorage !== null;
  }
  chatCacheKey(chatId, userId) {
    const scope = this.shouldUseUserStorage(userId) ? resolveUserScopeKey(userId) : "__shared__";
    return `${scope}:${chatId}`;
  }
  enqueueWrite(key, task) {
    const prev = this.writeChains.get(key) ?? Promise.resolve();
    const next = prev.then(task, task).finally(() => {
      if (this.writeChains.get(key) === next) {
        this.writeChains.delete(key);
      }
    });
    this.writeChains.set(key, next);
    return next;
  }
  async readJson(path, fallback, userId) {
    const useUser = this.shouldUseUserStorage(userId);
    const backend = useUser ? this.userStorage : this.storage;
    try {
      if (typeof backend.getJson === "function") {
        const result = useUser ? await backend.getJson(path, { fallback, userId }) : await backend.getJson(path, {
          fallback
        });
        return result ?? fallback;
      }
      if (typeof backend.exists === "function") {
        const present = useUser ? await backend.exists(path, userId) : await backend.exists(path);
        if (!present)
          return fallback;
      }
      if (typeof backend.read === "function") {
        const raw = useUser ? await backend.read(path, userId) : await backend.read(path);
        if (!raw)
          return fallback;
        return JSON.parse(raw);
      }
    } catch {
      return fallback;
    }
    return fallback;
  }
  async writeJson(path, value, userId) {
    const useUser = this.shouldUseUserStorage(userId);
    const backend = useUser ? this.userStorage : this.storage;
    if (typeof backend.setJson === "function") {
      if (useUser) {
        await backend.setJson(path, value, { userId });
      } else {
        await backend.setJson(path, value);
      }
      return;
    }
    if (typeof backend.write === "function") {
      const serialized = JSON.stringify(value);
      if (useUser) {
        await backend.write(path, serialized, userId);
      } else {
        await backend.write(path, serialized);
      }
    }
  }
  async loadSettings(userId) {
    const scopeKey = resolveUserScopeKey(userId);
    const cached = this.settingsCache.get(scopeKey);
    if (cached) {
      return sanitizeSettings(cached);
    }
    const raw = await this.readJson(SETTINGS_FILE, DEFAULT_SETTINGS, userId);
    const sanitized = sanitizeSettings(raw);
    if (!this.settingsCache.has(scopeKey)) {
      this.settingsCache.set(scopeKey, sanitized);
    }
    return sanitizeSettings(this.settingsCache.get(scopeKey) ?? sanitized);
  }
  async saveSettings(input, userId) {
    const scopeKey = resolveUserScopeKey(userId);
    const sanitized = sanitizeSettings(input);
    this.settingsCache.set(scopeKey, sanitized);
    const chainKey = `${this.shouldUseUserStorage(userId) ? scopeKey : "__shared__"}:${SETTINGS_FILE}`;
    await this.enqueueWrite(chainKey, () => this.writeJson(SETTINGS_FILE, sanitized, userId));
    return sanitizeSettings(sanitized);
  }
  async loadChatMeta(chatId, userId) {
    const cacheKey = this.chatCacheKey(chatId, userId);
    const cached = this.chatMetaCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const path = sanitizeChatStorageKey(chatId);
    const raw = await this.readJson(path, {}, userId);
    const map = raw && typeof raw === "object" && !Array.isArray(raw) ? cloneChatMeta(raw) : {};
    const existing = this.chatMetaCache.get(cacheKey);
    if (existing) {
      return existing;
    }
    this.chatMetaCache.set(cacheKey, map);
    return map;
  }
  getCachedChatMeta(chatId, userId) {
    return this.chatMetaCache.get(this.chatCacheKey(chatId, userId));
  }
  async saveChatMeta(chatId, meta, userId) {
    const cacheKey = this.chatCacheKey(chatId, userId);
    this.chatMetaCache.set(cacheKey, meta);
    const path = sanitizeChatStorageKey(chatId);
    const snapshot = cloneChatMeta(meta);
    await this.enqueueWrite(cacheKey, () => this.writeJson(path, snapshot, userId));
  }
}

// src/backend/controller.ts
var MAX_COMPLETED_REFS = 500;
var STALE_BUFFER_TTL_MS = 60 * 60 * 1000;
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function parseMetaKey(key) {
  const sepIdx = key.lastIndexOf(":");
  if (sepIdx <= 0)
    return null;
  const messageId = key.slice(0, sepIdx);
  const swipeId = Number(key.slice(sepIdx + 1));
  if (!Number.isInteger(swipeId) || swipeId < 0)
    return null;
  return { messageId, swipeId };
}
function parseSwipeIndexFromKey(key, messageId) {
  const prefix = `${messageId}:`;
  if (!key.startsWith(prefix))
    return null;
  const suffix = key.slice(prefix.length);
  const parsed = Number(suffix);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
function getSwipeValue(bySwipe, fallbackSingle, swipeIndex, activeSwipeId) {
  if (Array.isArray(bySwipe) && swipeIndex >= 0 && swipeIndex < bySwipe.length) {
    const val = bySwipe[swipeIndex];
    if (val !== null && val !== undefined)
      return val;
  }
  if (swipeIndex === activeSwipeId && fallbackSingle !== null && fallbackSingle !== undefined) {
    return fallbackSingle;
  }
  return;
}
function cloneMessageStates(states) {
  if (!states)
    return;
  const copy = {};
  for (const [id, summary] of Object.entries(states)) {
    copy[id] = { swipeId: summary.swipeId, isUser: summary.isUser };
  }
  return copy;
}
function createBackend(spindle2) {
  const store = new BackendStore(spindle2.storage, spindle2.userStorage);
  const activeBuffersByChat = new Map;
  const activeBuffersByGenId = new Map;
  const completedRefsByGenId = new Map;
  const hydrationInFlight = new Map;
  const chatMutationEpoch = new Map;
  const activeChatIdByUser = new Map;
  const lastKnownContentByChat = new Map;
  const messageStatesByChat = new Map;
  let macroInterceptorRegistered = false;
  let generationUnsubs = [];
  const permanentUnsubs = [];
  function hasPermission(permission) {
    if (typeof spindle2.permissions?.has === "function") {
      return spindle2.permissions.has(permission);
    }
    return true;
  }
  function logWarn(msg) {
    if (typeof spindle2.log?.warn === "function") {
      spindle2.log.warn(`[MessageMetaPlus] ${msg}`);
    }
  }
  function chatScopeKey(chatId, userId) {
    const useUser = typeof userId === "string" && userId.length > 0 && spindle2.userStorage !== undefined && spindle2.userStorage !== null;
    return `${useUser ? resolveUserScopeKey(userId) : "__shared__"}:${chatId}`;
  }
  function getLastKnownContentMap(chatId, userId) {
    const scope = chatScopeKey(chatId, userId);
    let map = lastKnownContentByChat.get(scope);
    if (!map) {
      map = new Map;
      lastKnownContentByChat.set(scope, map);
    }
    return map;
  }
  function getLastKnownContent(chatId, key, userId) {
    return lastKnownContentByChat.get(chatScopeKey(chatId, userId))?.get(key);
  }
  function setLastKnownContent(chatId, key, content, userId) {
    getLastKnownContentMap(chatId, userId).set(key, content);
  }
  function getMessageStatesMap(chatId, userId) {
    const scope = chatScopeKey(chatId, userId);
    let states = messageStatesByChat.get(scope);
    if (!states) {
      states = {};
      messageStatesByChat.set(scope, states);
    }
    return states;
  }
  function setMessageState(chatId, messageId, summary, userId) {
    getMessageStatesMap(chatId, userId)[messageId] = {
      swipeId: summary.swipeId,
      isUser: summary.isUser
    };
  }
  function deleteMessageState(chatId, messageId, userId) {
    const states = messageStatesByChat.get(chatScopeKey(chatId, userId));
    if (states) {
      delete states[messageId];
    }
  }
  function getChatMutationEpoch(chatId, userId) {
    return chatMutationEpoch.get(chatScopeKey(chatId, userId)) ?? 0;
  }
  function bumpChatMutationEpoch(chatId, userId) {
    const scope = chatScopeKey(chatId, userId);
    const next = (chatMutationEpoch.get(scope) ?? 0) + 1;
    chatMutationEpoch.set(scope, next);
    return next;
  }
  function sendToFrontend(msg, userId) {
    spindle2.sendToFrontend(msg, userId);
  }
  function pushChatMeta(chatId, meta, userId) {
    const messageStates = cloneMessageStates(messageStatesByChat.get(chatScopeKey(chatId, userId)));
    sendToFrontend({
      type: "chat-meta-update",
      chatId,
      meta: cloneChatMeta(meta),
      ...messageStates ? { messageStates } : {}
    }, userId);
  }
  function pushState(settings, chatId, meta, userId) {
    const messageStates = chatId ? cloneMessageStates(messageStatesByChat.get(chatScopeKey(chatId, userId))) : undefined;
    sendToFrontend({
      type: "state-update",
      settings,
      activeChatId: chatId,
      ...meta ? { meta: cloneChatMeta(meta) } : {},
      ...messageStates ? { messageStates } : {}
    }, userId);
  }
  function pruneStaleBuffers(now = Date.now()) {
    const cutoff = now - STALE_BUFFER_TTL_MS;
    for (const [genId, buf] of activeBuffersByGenId.entries()) {
      if (buf.lastActivityAt < cutoff) {
        activeBuffersByGenId.delete(genId);
        if (activeBuffersByChat.get(buf.chatId) === buf) {
          activeBuffersByChat.delete(buf.chatId);
        }
      }
    }
    for (const [chatId, buf] of activeBuffersByChat.entries()) {
      if (buf.lastActivityAt < cutoff) {
        activeBuffersByChat.delete(chatId);
      }
    }
  }
  function getOrCreateBuffer(chatId, generationId) {
    const now = Date.now();
    pruneStaleBuffers(now);
    if (generationId) {
      const byId = activeBuffersByGenId.get(generationId);
      if (byId) {
        byId.lastActivityAt = now;
        return byId;
      }
    }
    const existing = activeBuffersByChat.get(chatId);
    if (existing && (!generationId || !existing.generationId || existing.generationId === generationId)) {
      if (generationId && !existing.generationId) {
        existing.generationId = generationId;
        activeBuffersByGenId.set(generationId, existing);
      }
      existing.lastActivityAt = now;
      return existing;
    }
    const created = {
      generationId,
      chatId,
      startedAt: now,
      lastActivityAt: now,
      streamedMessageIds: new Set,
      lorebookEntries: [],
      macroNames: new Set
    };
    activeBuffersByChat.set(chatId, created);
    if (generationId) {
      activeBuffersByGenId.set(generationId, created);
    }
    return created;
  }
  function clearBuffer(buffer) {
    if (!buffer)
      return;
    if (activeBuffersByChat.get(buffer.chatId) === buffer) {
      activeBuffersByChat.delete(buffer.chatId);
    }
    if (buffer.generationId && activeBuffersByGenId.get(buffer.generationId) === buffer) {
      activeBuffersByGenId.delete(buffer.generationId);
    }
  }
  function recordCompletedRef(generationId, ref) {
    if (completedRefsByGenId.size >= MAX_COMPLETED_REFS) {
      const oldest = completedRefsByGenId.keys().next().value;
      if (oldest !== undefined) {
        completedRefsByGenId.delete(oldest);
      }
    }
    completedRefsByGenId.set(generationId, ref);
  }
  function isRecentlyCompletedTarget(chatId, messageId, swipeId, windowMs = 30000) {
    const cutoff = Date.now() - windowMs;
    for (const ref of completedRefsByGenId.values()) {
      if (ref.chatId === chatId && ref.messageId === messageId && ref.swipeId === swipeId && ref.completedAt >= cutoff) {
        return true;
      }
    }
    return false;
  }
  function mergeExtraIntoRecord(existing, params) {
    const next = existing ? { ...existing } : {};
    next.isUser = params.isUser;
    if (typeof params.content === "string") {
      next.wordCount = countWords(params.content);
    }
    const durationMs = extractDurationMs(params.metrics);
    if (durationMs !== undefined) {
      next.durationMs = durationMs;
    }
    const outcome = asRecord(params.outcome);
    if (outcome) {
      const finishReason = extractFinishReason(outcome);
      if (finishReason && !next.finishReason) {
        next.finishReason = finishReason;
      }
      const stopSequence = extractStopSequence(outcome);
      if (stopSequence && !next.stopSequence) {
        next.stopSequence = stopSequence;
      }
      const stopDetails = extractStopDetails(outcome.stopDetails ?? outcome.stop_details);
      if (stopDetails && !next.stopDetails) {
        next.stopDetails = stopDetails;
      }
    }
    return next;
  }
  async function hydrateChat(chatId, userId) {
    const flightKey = chatScopeKey(chatId, userId);
    const startEpoch = getChatMutationEpoch(chatId, userId);
    const existingFlight = hydrationInFlight.get(flightKey);
    if (existingFlight) {
      if (existingFlight.epoch >= startEpoch) {
        return existingFlight.promise;
      }
      await existingFlight.promise.catch(() => {
        return;
      });
      return hydrateChat(chatId, userId);
    }
    const runEpoch = getChatMutationEpoch(chatId, userId);
    const job = (async () => {
      const initialMeta = await store.loadChatMeta(chatId, userId);
      if (!hasPermission("chat_mutation") || typeof spindle2.chat?.getMessages !== "function") {
        return initialMeta;
      }
      let meta = initialMeta;
      try {
        const messages = await spindle2.chat.getMessages(chatId);
        if (!Array.isArray(messages)) {
          return meta;
        }
        const mutatedDuringFetch = getChatMutationEpoch(chatId, userId) !== runEpoch;
        meta = await store.loadChatMeta(chatId, userId);
        const activeBuf = activeBuffersByChat.get(chatId);
        const activeProtectedIds = new Set;
        if (activeBuf?.targetMessageId) {
          activeProtectedIds.add(activeBuf.targetMessageId);
        }
        if (activeBuf) {
          for (const id of activeBuf.streamedMessageIds) {
            activeProtectedIds.add(id);
          }
        }
        const recentlyCompletedIds = new Set;
        const recentCutoff = Date.now() - 60000;
        for (const ref of completedRefsByGenId.values()) {
          if (ref.chatId === chatId && ref.completedAt >= recentCutoff) {
            recentlyCompletedIds.add(ref.messageId);
          }
        }
        const liveSwipeCounts = new Map;
        const existingStates = messageStatesByChat.get(flightKey);
        const nextStates = {};
        const contentMap = getLastKnownContentMap(chatId, userId);
        for (const rawMsg of messages) {
          if (!rawMsg || typeof rawMsg.id !== "string")
            continue;
          const msg = rawMsg;
          const isUser = typeof msg.is_user === "boolean" ? msg.is_user : msg.role === "user";
          const activeSwipeId = typeof msg.swipe_id === "number" && Number.isInteger(msg.swipe_id) && msg.swipe_id >= 0 ? msg.swipe_id : 0;
          const extra = asRecord(msg.extra);
          const swipes = Array.isArray(msg.swipes) ? msg.swipes : [];
          liveSwipeCounts.set(msg.id, swipes.length > 0 ? swipes.length : activeSwipeId + 1);
          const prevLiveState = mutatedDuringFetch ? existingStates?.[msg.id] : undefined;
          nextStates[msg.id] = prevLiveState && meta[makeMetaKey(msg.id, prevLiveState.swipeId)] ? { swipeId: prevLiveState.swipeId, isUser: prevLiveState.isUser } : { swipeId: activeSwipeId, isUser };
          if (swipes.length > 0) {
            for (let idx = 0;idx < swipes.length; idx++) {
              const swipeText = swipes[idx];
              const content = typeof swipeText === "string" ? swipeText : idx === activeSwipeId && typeof msg.content === "string" ? msg.content : undefined;
              const key = makeMetaKey(msg.id, idx);
              const existingRecord = meta[key];
              const preserveLiveWords = mutatedDuringFetch && existingRecord?.wordCount !== undefined && existingRecord.wordCount > 0 && (!content || content.trim().length === 0);
              if (typeof content === "string" && !preserveLiveWords) {
                contentMap.set(key, content);
              }
              const metrics = getSwipeValue(extra?.generationMetricsBySwipe, extra?.generationMetrics, idx, activeSwipeId);
              const outcome = getSwipeValue(extra?.generationOutcomeBySwipe, extra?.generationOutcome, idx, activeSwipeId);
              meta[key] = mergeExtraIntoRecord(existingRecord, {
                isUser,
                content: preserveLiveWords ? undefined : content,
                metrics,
                outcome
              });
            }
          } else {
            const key = makeMetaKey(msg.id, activeSwipeId);
            const rawContent = typeof msg.content === "string" ? msg.content : undefined;
            const existingRecord = meta[key];
            const preserveLiveWords = mutatedDuringFetch && existingRecord?.wordCount !== undefined && existingRecord.wordCount > 0 && (!rawContent || rawContent.trim().length === 0);
            if (typeof rawContent === "string" && !preserveLiveWords) {
              contentMap.set(key, rawContent);
            }
            meta[key] = mergeExtraIntoRecord(existingRecord, {
              isUser,
              content: preserveLiveWords ? undefined : rawContent,
              metrics: extra?.generationMetrics,
              outcome: extra?.generationOutcome
            });
          }
        }
        for (const key of Object.keys(meta)) {
          const parsed = parseMetaKey(key);
          if (!parsed)
            continue;
          if (activeProtectedIds.has(parsed.messageId))
            continue;
          const swipeBound = liveSwipeCounts.get(parsed.messageId);
          if (swipeBound !== undefined ? parsed.swipeId >= swipeBound : !mutatedDuringFetch && !recentlyCompletedIds.has(parsed.messageId)) {
            delete meta[key];
            contentMap.delete(key);
          }
        }
        for (const key of contentMap.keys()) {
          const parsed = parseMetaKey(key);
          if (!parsed)
            continue;
          if (activeProtectedIds.has(parsed.messageId))
            continue;
          const swipeBound = liveSwipeCounts.get(parsed.messageId);
          if (swipeBound !== undefined ? parsed.swipeId >= swipeBound : !mutatedDuringFetch && !recentlyCompletedIds.has(parsed.messageId)) {
            contentMap.delete(key);
          }
        }
        messageStatesByChat.set(flightKey, nextStates);
        await store.saveChatMeta(chatId, meta, userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.startsWith("PERMISSION_DENIED:")) {
          logWarn(`hydrateChat(${chatId}) failed: ${msg}`);
        }
      }
      return meta;
    })().finally(() => {
      if (hydrationInFlight.get(flightKey)?.promise === job) {
        hydrationInFlight.delete(flightKey);
      }
    });
    hydrationInFlight.set(flightKey, { epoch: runEpoch, promise: job });
    return job;
  }
  async function verifyStoppedTargetMessage(chatId, targetMessageId, payload, buffer) {
    if (!hasPermission("chat_mutation") || typeof spindle2.chat?.getMessages !== "function") {
      return null;
    }
    try {
      const messages = await spindle2.chat.getMessages(chatId);
      if (!Array.isArray(messages))
        return null;
      const target = messages.find((m) => m && m.id === targetMessageId);
      if (!target || typeof target.id !== "string")
        return null;
      const activeSwipeId = typeof target.swipe_id === "number" && Number.isInteger(target.swipe_id) && target.swipe_id >= 0 ? target.swipe_id : 0;
      const candidateSwipe = typeof payload.swipeId === "number" ? payload.swipeId : typeof payload.targetSwipeId === "number" ? payload.targetSwipeId : buffer.targetSwipeId ?? activeSwipeId;
      const safeSwipeId = typeof candidateSwipe === "number" && Number.isInteger(candidateSwipe) && candidateSwipe >= 0 ? candidateSwipe : activeSwipeId;
      const swipeText = Array.isArray(target.swipes) && typeof target.swipes[safeSwipeId] === "string" ? target.swipes[safeSwipeId] : undefined;
      const resolvedContent = typeof payload.content === "string" && payload.content.trim().length > 0 ? payload.content : typeof swipeText === "string" && swipeText.trim().length > 0 ? swipeText : typeof target.content === "string" && target.content.trim().length > 0 ? target.content : "";
      if (resolvedContent.trim().length === 0) {
        return null;
      }
      return {
        messageId: target.id,
        swipeId: safeSwipeId,
        content: resolvedContent
      };
    } catch {
      return null;
    }
  }
  async function finalizeGeneration(kind, rawPayload, userId) {
    const payload = asRecord(rawPayload);
    if (!payload)
      return;
    const chatId = typeof payload.chatId === "string" ? payload.chatId : undefined;
    if (!chatId)
      return;
    const generationId = typeof payload.generationId === "string" ? payload.generationId : undefined;
    const buffer = (generationId ? activeBuffersByGenId.get(generationId) : undefined) ?? activeBuffersByChat.get(chatId);
    clearBuffer(buffer);
    const explicitMessageId = typeof payload.messageId === "string" && payload.messageId.length > 0 ? payload.messageId : undefined;
    const hasError = typeof payload.error === "string" && payload.error.trim().length > 0 || payload.errorCode !== undefined || typeof payload.errorMessage === "string" && payload.errorMessage.trim().length > 0;
    if (kind === "ended" && hasError && !explicitMessageId) {
      return;
    }
    let messageId = explicitMessageId;
    const knownStateForExplicit = messageId ? getMessageStatesMap(chatId, userId)[messageId] : undefined;
    let swipeId = typeof payload.swipeId === "number" ? payload.swipeId : typeof payload.targetSwipeId === "number" ? payload.targetSwipeId : buffer?.targetSwipeId ?? knownStateForExplicit?.swipeId ?? 0;
    let content = typeof payload.content === "string" ? payload.content : undefined;
    if (kind === "ended" && !messageId) {
      messageId = buffer?.targetMessageId;
      if (messageId && typeof payload.swipeId !== "number" && typeof payload.targetSwipeId !== "number" && buffer?.targetSwipeId === undefined) {
        const tracked = getMessageStatesMap(chatId, userId)[messageId];
        if (tracked) {
          swipeId = tracked.swipeId;
        }
      }
    } else if (kind === "stopped" && !messageId) {
      if (!buffer?.targetMessageId) {
        return;
      }
      const verified = await verifyStoppedTargetMessage(chatId, buffer.targetMessageId, payload, buffer);
      if (!verified) {
        return;
      }
      messageId = verified.messageId;
      swipeId = verified.swipeId;
      content = verified.content;
    }
    if (!messageId) {
      return;
    }
    const safeSwipeId = typeof swipeId === "number" && Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : 0;
    const key = makeMetaKey(messageId, safeSwipeId);
    bumpChatMutationEpoch(chatId, userId);
    const meta = await store.loadChatMeta(chatId, userId);
    const existing = meta[key];
    const startedAt = buffer?.startedAt;
    const metricsDuration = extractDurationMs(payload.generationMetrics);
    const wallDuration = startedAt !== undefined ? Math.max(0, Math.round(Date.now() - startedAt)) : undefined;
    const durationMs = metricsDuration ?? wallDuration ?? existing?.durationMs;
    const finishReason = kind === "stopped" ? extractFinishReason(payload) ?? "stopped" : extractFinishReason(payload) ?? existing?.finishReason;
    const stopSequence = extractStopSequence(payload) ?? existing?.stopSequence;
    const stopDetails = extractStopDetails(payload.stopDetails ?? payload.stop_details) ?? existing?.stopDetails;
    const hasBuffer = buffer !== undefined;
    const lorebookEntries = buffer?.lorebookEntries ?? [];
    const macroNames = buffer ? Array.from(buffer.macroNames) : [];
    const isImpersonate = payload.generationType === "impersonate";
    const isUser = isImpersonate ? true : existing?.isUser ?? false;
    const record = {
      ...existing ?? {},
      isUser,
      ...durationMs !== undefined ? { durationMs } : {},
      ...finishReason ? { finishReason } : {},
      ...stopSequence ? { stopSequence } : {},
      ...stopDetails ? { stopDetails } : {},
      ...typeof content === "string" ? { wordCount: countWords(content) } : {},
      ...lorebookEntries.length > 0 ? {
        lorebookTriggers: {
          count: lorebookEntries.length,
          entries: [...lorebookEntries]
        }
      } : {},
      ...macroNames.length > 0 ? {
        macrosApplied: {
          count: macroNames.length,
          names: macroNames
        }
      } : {}
    };
    if (hasBuffer && lorebookEntries.length === 0) {
      delete record.lorebookTriggers;
    }
    if (hasBuffer && macroNames.length === 0) {
      delete record.macrosApplied;
    }
    meta[key] = record;
    if (typeof content === "string") {
      setLastKnownContent(chatId, key, content, userId);
    }
    setMessageState(chatId, messageId, { swipeId: safeSwipeId, isUser }, userId);
    if (generationId) {
      const now = Date.now();
      recordCompletedRef(generationId, {
        chatId,
        messageId,
        swipeId: safeSwipeId,
        startedAt: startedAt ?? now,
        completedAt: now
      });
    }
    await store.saveChatMeta(chatId, meta, userId);
    pushChatMeta(chatId, meta, userId);
    if (!hasBuffer || typeof content !== "string" || !finishReason) {
      hydrateChat(chatId, userId).then((hydrated) => {
        pushChatMeta(chatId, hydrated, userId);
      });
    }
  }
  async function handleMetricsReady(rawPayload, userId) {
    const payload = asRecord(rawPayload);
    if (!payload)
      return;
    const generationId = typeof payload.generationId === "string" ? payload.generationId : undefined;
    const completedRef = generationId ? completedRefsByGenId.get(generationId) : undefined;
    const chatId = typeof payload.chatId === "string" ? payload.chatId : completedRef?.chatId;
    const messageId = typeof payload.messageId === "string" ? payload.messageId : completedRef?.messageId;
    if (!chatId || !messageId)
      return;
    const swipeId = typeof payload.swipeId === "number" && Number.isInteger(payload.swipeId) && payload.swipeId >= 0 ? payload.swipeId : completedRef?.swipeId ?? 0;
    const durationMs = extractDurationMs(payload.generationMetrics);
    if (durationMs === undefined)
      return;
    bumpChatMutationEpoch(chatId, userId);
    const meta = await store.loadChatMeta(chatId, userId);
    const key = makeMetaKey(messageId, swipeId);
    let existing = meta[key];
    if (!existing && completedRef && completedRef.swipeId !== swipeId) {
      const prevKey = makeMetaKey(completedRef.messageId, completedRef.swipeId);
      const prev = meta[prevKey];
      if (prev) {
        existing = { ...prev };
      }
    }
    const isUser = existing?.isUser ?? false;
    meta[key] = {
      ...existing ?? {},
      isUser,
      durationMs
    };
    if (completedRef && completedRef.swipeId !== swipeId) {
      completedRef.swipeId = swipeId;
    }
    setMessageState(chatId, messageId, { swipeId, isUser }, userId);
    await store.saveChatMeta(chatId, meta, userId);
    pushChatMeta(chatId, meta, userId);
    if (!existing || existing.wordCount === undefined || !existing.finishReason) {
      hydrateChat(chatId, userId).then((hydrated) => {
        pushChatMeta(chatId, hydrated, userId);
      });
    }
  }
  function registerMacroInterceptorIfPermitted() {
    if (macroInterceptorRegistered)
      return;
    if (!hasPermission("macro_interceptor"))
      return;
    if (typeof spindle2.registerMacroInterceptor !== "function")
      return;
    spindle2.registerMacroInterceptor(async (ctx) => {
      if (!hasPermission("macro_interceptor"))
        return;
      if (!ctx || ctx.phase !== "prompt" && ctx.phase !== "other" || ctx.commit === false) {
        return;
      }
      const chatId = typeof ctx.env?.chat?.id === "string" && ctx.env.chat.id.length > 0 ? ctx.env.chat.id : undefined;
      if (!chatId)
        return;
      pruneStaleBuffers();
      const buffer = activeBuffersByChat.get(chatId);
      if (!buffer)
        return;
      buffer.lastActivityAt = Date.now();
      const names = extractMacroNames(ctx.template);
      if (names.length === 0)
        return;
      for (const name of names) {
        buffer.macroNames.add(name);
      }
    }, 100);
    macroInterceptorRegistered = true;
  }
  function unsubscribeGenerationEvents() {
    for (const unsub of generationUnsubs) {
      unsub();
    }
    generationUnsubs = [];
  }
  function subscribeGenerationEventsIfPermitted() {
    if (generationUnsubs.length > 0)
      return;
    if (!hasPermission("generation"))
      return;
    generationUnsubs.push(spindle2.on("GENERATION_STARTED", (payload) => {
      if (!payload?.chatId)
        return;
      const now = Date.now();
      pruneStaleBuffers(now);
      const raw = payload;
      const fresh = {
        generationId: payload.generationId,
        chatId: payload.chatId,
        startedAt: now,
        lastActivityAt: now,
        targetMessageId: typeof payload.targetMessageId === "string" ? payload.targetMessageId : undefined,
        targetSwipeId: typeof raw.targetSwipeId === "number" && raw.targetSwipeId >= 0 ? Math.floor(raw.targetSwipeId) : undefined,
        streamedMessageIds: new Set,
        lorebookEntries: [],
        macroNames: new Set
      };
      const previous = activeBuffersByChat.get(payload.chatId);
      if (previous?.generationId) {
        activeBuffersByGenId.delete(previous.generationId);
      }
      activeBuffersByChat.set(payload.chatId, fresh);
      if (payload.generationId) {
        activeBuffersByGenId.set(payload.generationId, fresh);
      }
    }));
    generationUnsubs.push(spindle2.on("GENERATION_IN_PROGRESS", (rawPayload) => {
      const payload = asRecord(rawPayload);
      const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
      if (!chatId)
        return;
      const generationId = typeof payload?.generationId === "string" ? payload.generationId : undefined;
      const buffer = getOrCreateBuffer(chatId, generationId);
      buffer.lastActivityAt = Date.now();
      const targetMsgId = typeof payload?.targetMessageId === "string" && payload.targetMessageId.length > 0 ? payload.targetMessageId : typeof payload?.messageId === "string" && payload.messageId.length > 0 ? payload.messageId : undefined;
      if (targetMsgId && !buffer.targetMessageId) {
        buffer.targetMessageId = targetMsgId;
      }
      const rawSwipeId = typeof payload?.targetSwipeId === "number" ? payload.targetSwipeId : typeof payload?.swipeId === "number" ? payload.swipeId : undefined;
      if (typeof rawSwipeId === "number" && Number.isInteger(rawSwipeId) && rawSwipeId >= 0 && buffer.targetSwipeId === undefined) {
        buffer.targetSwipeId = rawSwipeId;
      }
    }));
    generationUnsubs.push(spindle2.on("GENERATION_ENDED", (payload, userId) => {
      finalizeGeneration("ended", payload, userId);
    }));
    generationUnsubs.push(spindle2.on("GENERATION_STOPPED", (payload, userId) => {
      finalizeGeneration("stopped", payload, userId);
    }));
  }
  permanentUnsubs.push(spindle2.on("WORLD_INFO_ACTIVATED", (rawPayload) => {
    const payload = asRecord(rawPayload);
    if (!payload)
      return;
    const entries = extractLorebookEntryNames(payload.entries);
    const chatId = typeof payload.chatId === "string" ? payload.chatId : undefined;
    if (chatId) {
      const buffer = getOrCreateBuffer(chatId);
      buffer.lastActivityAt = Date.now();
      buffer.lorebookEntries = entries;
    } else if (activeBuffersByChat.size === 1) {
      const only = activeBuffersByChat.values().next().value;
      if (only) {
        only.lastActivityAt = Date.now();
        only.lorebookEntries = entries;
      }
    }
  }));
  permanentUnsubs.push(spindle2.on("GENERATION_METRICS_READY", (rawPayload, userId) => {
    handleMetricsReady(rawPayload, userId);
  }));
  permanentUnsubs.push(spindle2.on("CHAT_SWITCHED", (rawPayload, userId) => {
    const payload = asRecord(rawPayload);
    const nextChatId = typeof payload?.chatId === "string" && payload.chatId.length > 0 ? payload.chatId : null;
    activeChatIdByUser.set(resolveUserScopeKey(userId), nextChatId);
    if (nextChatId) {
      hydrateChat(nextChatId, userId).then((meta) => {
        pushChatMeta(nextChatId, meta, userId);
      });
    } else {
      store.loadSettings(userId).then((settings) => {
        pushState(settings, null, undefined, userId);
      });
    }
  }));
  permanentUnsubs.push(spindle2.on("CHAT_CHANGED", (rawPayload, userId) => {
    const payload = asRecord(rawPayload);
    const nestedChat = asRecord(payload?.chat);
    const chatId = typeof payload?.chatId === "string" && payload.chatId.length > 0 ? payload.chatId : typeof nestedChat?.id === "string" && nestedChat.id.length > 0 ? nestedChat.id : undefined;
    if (!chatId)
      return;
    hydrateChat(chatId, userId).then((meta) => {
      pushChatMeta(chatId, meta, userId);
    });
  }));
  permanentUnsubs.push(spindle2.on("MESSAGE_SENT", (rawPayload, userId) => {
    const payload = asRecord(rawPayload);
    const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
    const message = asRecord(payload?.message);
    if (!chatId || !message || typeof message.id !== "string")
      return;
    const swipeId = typeof message.swipe_id === "number" && message.swipe_id >= 0 ? Math.floor(message.swipe_id) : 0;
    const isUser = typeof message.is_user === "boolean" ? message.is_user : message.role === "user";
    if (!isUser) {
      const activeBuf = activeBuffersByChat.get(chatId);
      if (activeBuf) {
        activeBuf.lastActivityAt = Date.now();
        activeBuf.streamedMessageIds.add(message.id);
      }
    }
    (async () => {
      bumpChatMutationEpoch(chatId, userId);
      const meta = await store.loadChatMeta(chatId, userId);
      const key = makeMetaKey(message.id, swipeId);
      if (typeof message.content === "string") {
        setLastKnownContent(chatId, key, message.content, userId);
      }
      setMessageState(chatId, message.id, { swipeId, isUser }, userId);
      meta[key] = {
        ...meta[key] ?? {},
        isUser,
        ...typeof message.content === "string" ? { wordCount: countWords(message.content) } : {}
      };
      await store.saveChatMeta(chatId, meta, userId);
      pushChatMeta(chatId, meta, userId);
    })();
  }));
  permanentUnsubs.push(spindle2.on("MESSAGE_EDITED", (rawPayload, userId) => {
    const payload = asRecord(rawPayload);
    const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
    const message = asRecord(payload?.message);
    if (!chatId || !message || typeof message.id !== "string")
      return;
    const swipeId = typeof message.swipe_id === "number" && message.swipe_id >= 0 ? Math.floor(message.swipe_id) : 0;
    const isUser = typeof message.is_user === "boolean" ? message.is_user : message.role === "user";
    const activeBuf = activeBuffersByChat.get(chatId);
    const isGeneratingTarget = activeBuf !== undefined && (activeBuf.targetMessageId === message.id || activeBuf.streamedMessageIds.has(message.id));
    if (isGeneratingTarget && activeBuf) {
      activeBuf.lastActivityAt = Date.now();
    }
    (async () => {
      bumpChatMutationEpoch(chatId, userId);
      const meta = await store.loadChatMeta(chatId, userId);
      const key = makeMetaKey(message.id, swipeId);
      const existing = meta[key];
      const prevContent = getLastKnownContent(chatId, key, userId);
      const hasContent = typeof message.content === "string";
      const contentUnchanged = !hasContent || prevContent !== undefined && message.content === prevContent;
      const markEdited = !isGeneratingTarget && !contentUnchanged;
      const resolvedIsUser = existing?.isUser ?? isUser;
      if (hasContent) {
        setLastKnownContent(chatId, key, message.content, userId);
      }
      setMessageState(chatId, message.id, { swipeId, isUser: resolvedIsUser }, userId);
      meta[key] = {
        ...existing ?? {},
        isUser: resolvedIsUser,
        ...markEdited ? { edited: true, editedAt: Date.now() } : {},
        ...hasContent ? { wordCount: countWords(message.content) } : {}
      };
      await store.saveChatMeta(chatId, meta, userId);
      pushChatMeta(chatId, meta, userId);
    })();
  }));
  permanentUnsubs.push(spindle2.on("MESSAGE_DELETED", (rawPayload, userId) => {
    const payload = asRecord(rawPayload);
    const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
    const messageId = typeof payload?.messageId === "string" ? payload.messageId : undefined;
    if (!chatId || !messageId)
      return;
    (async () => {
      bumpChatMutationEpoch(chatId, userId);
      const meta = await store.loadChatMeta(chatId, userId);
      const contentMap = getLastKnownContentMap(chatId, userId);
      const prefix = `${messageId}:`;
      let changed = false;
      for (const key of Object.keys(meta)) {
        if (key.startsWith(prefix)) {
          delete meta[key];
          changed = true;
        }
      }
      for (const key of contentMap.keys()) {
        if (key.startsWith(prefix)) {
          contentMap.delete(key);
        }
      }
      deleteMessageState(chatId, messageId, userId);
      for (const [genId, ref] of completedRefsByGenId.entries()) {
        if (ref.chatId === chatId && ref.messageId === messageId) {
          completedRefsByGenId.delete(genId);
        }
      }
      if (changed) {
        await store.saveChatMeta(chatId, meta, userId);
      }
      pushChatMeta(chatId, meta, userId);
    })();
  }));
  permanentUnsubs.push(spindle2.on("MESSAGE_SWIPED", (payload, userId) => {
    if (!payload?.chatId || !payload.message?.id)
      return;
    const { chatId, message, action, swipeId } = payload;
    const isUser = typeof message.is_user === "boolean" ? message.is_user : message.role === "user";
    const activeSwipeId = typeof message.swipe_id === "number" && message.swipe_id >= 0 ? Math.floor(message.swipe_id) : 0;
    const targetSwipe = action === "updated" && Number.isInteger(swipeId) && swipeId >= 0 ? swipeId : activeSwipeId;
    const activeBuf = activeBuffersByChat.get(chatId);
    if (!isUser && activeBuf) {
      activeBuf.lastActivityAt = Date.now();
      if (action === "added") {
        if (!activeBuf.targetMessageId) {
          activeBuf.targetMessageId = message.id;
        }
        if (activeBuf.targetMessageId === message.id) {
          activeBuf.targetSwipeId = activeSwipeId;
        }
      }
    }
    const isGeneratingTarget = activeBuf !== undefined && (activeBuf.targetMessageId === message.id || activeBuf.streamedMessageIds.has(message.id) || !isUser && typeof activeBuf.targetSwipeId === "number" && activeBuf.targetSwipeId === targetSwipe);
    (async () => {
      bumpChatMutationEpoch(chatId, userId);
      const meta = await store.loadChatMeta(chatId, userId);
      const contentMap = getLastKnownContentMap(chatId, userId);
      const extra = asRecord(message.extra);
      if (action === "deleted" && Number.isInteger(swipeId) && swipeId >= 0) {
        const shiftedEntries = [];
        for (const key of Object.keys(meta)) {
          const idx = parseSwipeIndexFromKey(key, message.id);
          if (idx === null)
            continue;
          const rec = meta[key];
          delete meta[key];
          if (idx < swipeId && rec) {
            shiftedEntries.push([idx, rec]);
          } else if (idx > swipeId && rec) {
            shiftedEntries.push([idx - 1, rec]);
          }
        }
        for (const [idx, rec] of shiftedEntries) {
          meta[makeMetaKey(message.id, idx)] = rec;
        }
        const shiftedContents = [];
        for (const [key, val] of contentMap.entries()) {
          const idx = parseSwipeIndexFromKey(key, message.id);
          if (idx === null)
            continue;
          contentMap.delete(key);
          if (idx < swipeId) {
            shiftedContents.push([idx, val]);
          } else if (idx > swipeId) {
            shiftedContents.push([idx - 1, val]);
          }
        }
        for (const [idx, val] of shiftedContents) {
          contentMap.set(makeMetaKey(message.id, idx), val);
        }
      }
      const swipeContent = Array.isArray(message.swipes) && typeof message.swipes[targetSwipe] === "string" ? message.swipes[targetSwipe] : targetSwipe === message.swipe_id && typeof message.content === "string" ? message.content : undefined;
      const key = makeMetaKey(message.id, targetSwipe);
      const prevContent = contentMap.get(key);
      if (typeof swipeContent === "string") {
        contentMap.set(key, swipeContent);
      }
      const metrics = getSwipeValue(extra?.generationMetricsBySwipe, extra?.generationMetrics, targetSwipe, activeSwipeId);
      const outcome = getSwipeValue(extra?.generationOutcomeBySwipe, extra?.generationOutcome, targetSwipe, activeSwipeId);
      meta[key] = mergeExtraIntoRecord(meta[key], {
        isUser,
        content: swipeContent,
        metrics,
        outcome
      });
      const wasStagedBlank = !isUser && prevContent === "";
      const recentlyGenerated = isRecentlyCompletedTarget(chatId, message.id, targetSwipe);
      if (action === "updated" && !isGeneratingTarget && !wasStagedBlank && !recentlyGenerated && typeof swipeContent === "string" && (prevContent === undefined ? isUser : swipeContent !== prevContent)) {
        meta[key].edited = true;
        meta[key].editedAt = Date.now();
      }
      setMessageState(chatId, message.id, { swipeId: activeSwipeId, isUser }, userId);
      await store.saveChatMeta(chatId, meta, userId);
      pushChatMeta(chatId, meta, userId);
    })();
  }));
  permanentUnsubs.push(spindle2.on("SWIPE_EDITED", (payload, userId) => {
    if (!payload?.chatId || !payload.message?.id)
      return;
    const { chatId, message } = payload;
    (async () => {
      bumpChatMutationEpoch(chatId, userId);
      const meta = await store.loadChatMeta(chatId, userId);
      const contentMap = getLastKnownContentMap(chatId, userId);
      const isUser = typeof message.is_user === "boolean" ? message.is_user : message.role === "user";
      const extra = asRecord(message.extra);
      const swipes = Array.isArray(message.swipes) ? message.swipes : [];
      const activeSwipeId = typeof message.swipe_id === "number" && message.swipe_id >= 0 ? Math.floor(message.swipe_id) : 0;
      if (swipes.length > 0) {
        for (const key of Object.keys(meta)) {
          const idx = parseSwipeIndexFromKey(key, message.id);
          if (idx !== null && idx >= swipes.length) {
            delete meta[key];
            contentMap.delete(key);
          }
        }
        for (let idx = 0;idx < swipes.length; idx++) {
          const swipeContent = typeof swipes[idx] === "string" ? swipes[idx] : idx === activeSwipeId && typeof message.content === "string" ? message.content : undefined;
          const key = makeMetaKey(message.id, idx);
          if (typeof swipeContent === "string") {
            contentMap.set(key, swipeContent);
          }
          const metrics = getSwipeValue(extra?.generationMetricsBySwipe, extra?.generationMetrics, idx, activeSwipeId);
          const outcome = getSwipeValue(extra?.generationOutcomeBySwipe, extra?.generationOutcome, idx, activeSwipeId);
          meta[key] = mergeExtraIntoRecord(meta[key], {
            isUser,
            content: swipeContent,
            metrics,
            outcome
          });
        }
      } else {
        const key = makeMetaKey(message.id, activeSwipeId);
        if (typeof message.content === "string") {
          contentMap.set(key, message.content);
        }
        meta[key] = mergeExtraIntoRecord(meta[key], {
          isUser,
          content: typeof message.content === "string" ? message.content : undefined,
          metrics: extra?.generationMetrics,
          outcome: extra?.generationOutcome
        });
      }
      setMessageState(chatId, message.id, { swipeId: activeSwipeId, isUser }, userId);
      await store.saveChatMeta(chatId, meta, userId);
      pushChatMeta(chatId, meta, userId);
    })();
  }));
  permanentUnsubs.push(spindle2.onFrontendMessage((raw, userId) => {
    const msg = asRecord(raw);
    if (!msg || typeof msg.type !== "string")
      return;
    (async () => {
      const userScope = resolveUserScopeKey(userId);
      switch (msg.type) {
        case "get-state": {
          const settings = await store.loadSettings(userId);
          let currentActiveChatId = activeChatIdByUser.get(userScope) ?? null;
          if (hasPermission("chats") && typeof spindle2.chats?.getActive === "function") {
            try {
              const active = await spindle2.chats.getActive(userId);
              currentActiveChatId = active?.id ?? null;
              activeChatIdByUser.set(userScope, currentActiveChatId);
            } catch {}
          }
          const meta = currentActiveChatId ? await hydrateChat(currentActiveChatId, userId) : undefined;
          pushState(settings, currentActiveChatId, meta, userId);
          break;
        }
        case "update-settings": {
          const settings = await store.saveSettings(msg.settings, userId);
          const currentActiveChatId = activeChatIdByUser.get(userScope) ?? null;
          const meta = currentActiveChatId ? store.getCachedChatMeta(currentActiveChatId, userId) : undefined;
          pushState(settings, currentActiveChatId, meta, userId);
          break;
        }
        case "get-chat-meta":
        case "hydrate-chat": {
          const chatId = msg.chatId;
          if (typeof chatId !== "string" || chatId.length === 0)
            return;
          const meta = await hydrateChat(chatId, userId);
          pushChatMeta(chatId, meta, userId);
          break;
        }
      }
    })();
  }));
  if (typeof spindle2.permissions?.onChanged === "function") {
    permanentUnsubs.push(spindle2.permissions.onChanged(({ permission, granted }) => {
      if (permission === "macro_interceptor") {
        if (granted) {
          registerMacroInterceptorIfPermitted();
        } else {
          macroInterceptorRegistered = false;
        }
      } else if (permission === "generation") {
        if (granted) {
          subscribeGenerationEventsIfPermitted();
        } else {
          unsubscribeGenerationEvents();
        }
      }
    }));
  }
  if (typeof spindle2.permissions?.onDenied === "function") {
    permanentUnsubs.push(spindle2.permissions.onDenied(({ permission, operation }) => {
      logWarn(`Permission "${permission}" denied for ${operation}`);
    }));
  }
  subscribeGenerationEventsIfPermitted();
  registerMacroInterceptorIfPermitted();
  return {
    hydrateChat,
    dispose() {
      unsubscribeGenerationEvents();
      for (const unsub of permanentUnsubs) {
        unsub();
      }
      permanentUnsubs.length = 0;
      activeBuffersByChat.clear();
      activeBuffersByGenId.clear();
      completedRefsByGenId.clear();
      hydrationInFlight.clear();
      chatMutationEpoch.clear();
      activeChatIdByUser.clear();
      lastKnownContentByChat.clear();
      messageStatesByChat.clear();
    }
  };
}

// src/backend.ts
if (typeof spindle !== "undefined") {
  createBackend(spindle);
}
export {
  BackendStore,
  createBackend,
  extractDurationMs,
  extractFinishReason,
  extractLorebookEntryNames,
  extractMacroNames,
  extractStopDetails,
  extractStopSequence
};
