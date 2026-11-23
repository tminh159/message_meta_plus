import type {
  ActivatedWorldInfoEntryDTO,
  ChatGetMessageDTO,
  ChatMessageDTO,
  GenerationEndedPayloadDTO,
  GenerationStartedPayloadDTO,
  GenerationStoppedPayloadDTO,
  MacroInterceptorCtxDTO,
  MessageSwipedPayloadDTO,
  SpindleAPI,
  SwipeEditedPayloadDTO,
} from "lumiverse-spindle-types";
import { countWords } from "../shared/format.js";
import {
  BackendToFrontendMessage,
  ChatMetaMap,
  ExtensionSettings,
  FrontendToBackendMessage,
  MessageMetaRecord,
  MessageStateSummary,
  makeMetaKey,
} from "../shared/types.js";
import {
  extractDurationMs,
  extractFinishReason,
  extractLorebookEntryNames,
  extractMacroNames,
  extractStopDetails,
  extractStopSequence,
} from "./extractors.js";
import {
  BackendStore,
  cloneChatMeta,
  resolveUserScopeKey,
} from "./store.js";

interface GenerationBuffer {
  generationId?: string;
  chatId: string;
  startedAt: number;
  lastActivityAt: number;
  targetMessageId?: string;
  targetSwipeId?: number;
  streamedMessageIds: Set<string>;
  lorebookEntries: string[];
  macroNames: Set<string>;
}

interface CompletedGenerationRef {
  chatId: string;
  messageId: string;
  swipeId: number;
  startedAt: number;
  completedAt: number;
}

const MAX_COMPLETED_REFS = 500;
const STALE_BUFFER_TTL_MS = 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMetaKey(key: string): { messageId: string; swipeId: number } | null {
  const sepIdx = key.lastIndexOf(":");
  if (sepIdx <= 0) return null;
  const messageId = key.slice(0, sepIdx);
  const swipeId = Number(key.slice(sepIdx + 1));
  if (!Number.isInteger(swipeId) || swipeId < 0) return null;
  return { messageId, swipeId };
}

function parseSwipeIndexFromKey(key: string, messageId: string): number | null {
  const prefix = `${messageId}:`;
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  const parsed = Number(suffix);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getSwipeValue<T>(
  bySwipe: unknown,
  fallbackSingle: unknown,
  swipeIndex: number,
  activeSwipeId: number,
): T | undefined {
  if (Array.isArray(bySwipe) && swipeIndex >= 0 && swipeIndex < bySwipe.length) {
    const val = bySwipe[swipeIndex];
    if (val !== null && val !== undefined) return val as T;
  }
  if (swipeIndex === activeSwipeId && fallbackSingle !== null && fallbackSingle !== undefined) {
    return fallbackSingle as T;
  }
  return undefined;
}

function cloneMessageStates(
  states: Record<string, MessageStateSummary> | undefined,
): Record<string, MessageStateSummary> | undefined {
  if (!states) return undefined;
  const copy: Record<string, MessageStateSummary> = {};
  for (const [id, summary] of Object.entries(states)) {
    copy[id] = { swipeId: summary.swipeId, isUser: summary.isUser };
  }
  return copy;
}

export interface BackendController {
  hydrateChat(chatId: string, userId?: string): Promise<ChatMetaMap>;
  dispose(): void;
}

export function createBackend(spindle: SpindleAPI): BackendController {
  const store = new BackendStore(spindle.storage, spindle.userStorage);
  const activeBuffersByChat = new Map<string, GenerationBuffer>();
  const activeBuffersByGenId = new Map<string, GenerationBuffer>();
  const completedRefsByGenId = new Map<string, CompletedGenerationRef>();
  const hydrationInFlight = new Map<
    string,
    { epoch: number; promise: Promise<ChatMetaMap> }
  >();
  const chatMutationEpoch = new Map<string, number>();
  const activeChatIdByUser = new Map<string, string | null>();
  const lastKnownContentByChat = new Map<string, Map<string, string>>();
  const messageStatesByChat = new Map<string, Record<string, MessageStateSummary>>();

  let macroInterceptorRegistered = false;
  let generationUnsubs: Array<() => void> = [];
  const permanentUnsubs: Array<() => void> = [];

  function hasPermission(permission: string): boolean {
    if (typeof spindle.permissions?.has === "function") {
      return spindle.permissions.has(permission);
    }
    return true;
  }

  function logWarn(msg: string): void {
    if (typeof spindle.log?.warn === "function") {
      spindle.log.warn(`[MessageMetaPlus] ${msg}`);
    }
  }

  function chatScopeKey(chatId: string, userId?: string): string {
    const useUser =
      typeof userId === "string" &&
      userId.length > 0 &&
      spindle.userStorage !== undefined &&
      spindle.userStorage !== null;
    return `${useUser ? resolveUserScopeKey(userId) : "__shared__"}:${chatId}`;
  }

  function getLastKnownContentMap(chatId: string, userId?: string): Map<string, string> {
    const scope = chatScopeKey(chatId, userId);
    let map = lastKnownContentByChat.get(scope);
    if (!map) {
      map = new Map<string, string>();
      lastKnownContentByChat.set(scope, map);
    }
    return map;
  }

  function getLastKnownContent(
    chatId: string,
    key: string,
    userId?: string,
  ): string | undefined {
    return lastKnownContentByChat.get(chatScopeKey(chatId, userId))?.get(key);
  }

  function setLastKnownContent(
    chatId: string,
    key: string,
    content: string,
    userId?: string,
  ): void {
    getLastKnownContentMap(chatId, userId).set(key, content);
  }

  function getMessageStatesMap(
    chatId: string,
    userId?: string,
  ): Record<string, MessageStateSummary> {
    const scope = chatScopeKey(chatId, userId);
    let states = messageStatesByChat.get(scope);
    if (!states) {
      states = {};
      messageStatesByChat.set(scope, states);
    }
    return states;
  }

  function setMessageState(
    chatId: string,
    messageId: string,
    summary: MessageStateSummary,
    userId?: string,
  ): void {
    getMessageStatesMap(chatId, userId)[messageId] = {
      swipeId: summary.swipeId,
      isUser: summary.isUser,
    };
  }

  function deleteMessageState(
    chatId: string,
    messageId: string,
    userId?: string,
  ): void {
    const states = messageStatesByChat.get(chatScopeKey(chatId, userId));
    if (states) {
      delete states[messageId];
    }
  }

  function getChatMutationEpoch(chatId: string, userId?: string): number {
    return chatMutationEpoch.get(chatScopeKey(chatId, userId)) ?? 0;
  }

  function bumpChatMutationEpoch(chatId: string, userId?: string): number {
    const scope = chatScopeKey(chatId, userId);
    const next = (chatMutationEpoch.get(scope) ?? 0) + 1;
    chatMutationEpoch.set(scope, next);
    return next;
  }

  function sendToFrontend(msg: BackendToFrontendMessage, userId?: string): void {
    spindle.sendToFrontend(msg, userId);
  }

  function pushChatMeta(chatId: string, meta: ChatMetaMap, userId?: string): void {
    const messageStates = cloneMessageStates(
      messageStatesByChat.get(chatScopeKey(chatId, userId)),
    );
    sendToFrontend(
      {
        type: "chat-meta-update",
        chatId,
        meta: cloneChatMeta(meta),
        ...(messageStates ? { messageStates } : {}),
      },
      userId,
    );
  }

  function pushState(
    settings: ExtensionSettings,
    chatId: string | null,
    meta?: ChatMetaMap,
    userId?: string,
  ): void {
    const messageStates = chatId
      ? cloneMessageStates(messageStatesByChat.get(chatScopeKey(chatId, userId)))
      : undefined;
    sendToFrontend(
      {
        type: "state-update",
        settings,
        activeChatId: chatId,
        ...(meta ? { meta: cloneChatMeta(meta) } : {}),
        ...(messageStates ? { messageStates } : {}),
      },
      userId,
    );
  }

  function pruneStaleBuffers(now: number = Date.now()): void {
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

  function getOrCreateBuffer(chatId: string, generationId?: string): GenerationBuffer {
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
    const created: GenerationBuffer = {
      generationId,
      chatId,
      startedAt: now,
      lastActivityAt: now,
      streamedMessageIds: new Set<string>(),
      lorebookEntries: [],
      macroNames: new Set<string>(),
    };
    activeBuffersByChat.set(chatId, created);
    if (generationId) {
      activeBuffersByGenId.set(generationId, created);
    }
    return created;
  }

  function clearBuffer(buffer: GenerationBuffer | undefined): void {
    if (!buffer) return;
    if (activeBuffersByChat.get(buffer.chatId) === buffer) {
      activeBuffersByChat.delete(buffer.chatId);
    }
    if (buffer.generationId && activeBuffersByGenId.get(buffer.generationId) === buffer) {
      activeBuffersByGenId.delete(buffer.generationId);
    }
  }

  function recordCompletedRef(
    generationId: string,
    ref: CompletedGenerationRef,
  ): void {
    if (completedRefsByGenId.size >= MAX_COMPLETED_REFS) {
      const oldest = completedRefsByGenId.keys().next().value;
      if (oldest !== undefined) {
        completedRefsByGenId.delete(oldest);
      }
    }
    completedRefsByGenId.set(generationId, ref);
  }

  function isRecentlyCompletedTarget(
    chatId: string,
    messageId: string,
    swipeId: number,
    windowMs: number = 30_000,
  ): boolean {
    const cutoff = Date.now() - windowMs;
    for (const ref of completedRefsByGenId.values()) {
      if (
        ref.chatId === chatId &&
        ref.messageId === messageId &&
        ref.swipeId === swipeId &&
        ref.completedAt >= cutoff
      ) {
        return true;
      }
    }
    return false;
  }

  function mergeExtraIntoRecord(
    existing: MessageMetaRecord | undefined,
    params: {
      isUser: boolean;
      content?: string;
      metrics?: unknown;
      outcome?: unknown;
    },
  ): MessageMetaRecord {
    const next: MessageMetaRecord = existing ? { ...existing } : {};
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
      const stopDetails = extractStopDetails(
        outcome.stopDetails ?? outcome.stop_details,
      );
      if (stopDetails && !next.stopDetails) {
        next.stopDetails = stopDetails;
      }
    }

    return next;
  }

  async function hydrateChat(chatId: string, userId?: string): Promise<ChatMetaMap> {
    const flightKey = chatScopeKey(chatId, userId);
    const startEpoch = getChatMutationEpoch(chatId, userId);
    const existingFlight = hydrationInFlight.get(flightKey);
    if (existingFlight) {
      if (existingFlight.epoch >= startEpoch) {
        return existingFlight.promise;
      }
      await existingFlight.promise.catch(() => undefined);
      return hydrateChat(chatId, userId);
    }

    const runEpoch = getChatMutationEpoch(chatId, userId);
    const job = (async () => {
      const initialMeta = await store.loadChatMeta(chatId, userId);
      if (!hasPermission("chat_mutation") || typeof spindle.chat?.getMessages !== "function") {
        return initialMeta;
      }

      let meta = initialMeta;
      try {
        const messages = await spindle.chat.getMessages(chatId);
        if (!Array.isArray(messages)) {
          return meta;
        }

        const mutatedDuringFetch = getChatMutationEpoch(chatId, userId) !== runEpoch;
        meta = await store.loadChatMeta(chatId, userId);

        const activeBuf = activeBuffersByChat.get(chatId);
        const activeProtectedIds = new Set<string>();
        if (activeBuf?.targetMessageId) {
          activeProtectedIds.add(activeBuf.targetMessageId);
        }
        if (activeBuf) {
          for (const id of activeBuf.streamedMessageIds) {
            activeProtectedIds.add(id);
          }
        }
        const recentlyCompletedIds = new Set<string>();
        const recentCutoff = Date.now() - 60_000;
        for (const ref of completedRefsByGenId.values()) {
          if (ref.chatId === chatId && ref.completedAt >= recentCutoff) {
            recentlyCompletedIds.add(ref.messageId);
          }
        }

        const liveSwipeCounts = new Map<string, number>();
        const existingStates = messageStatesByChat.get(flightKey);
        const nextStates: Record<string, MessageStateSummary> = {};
        const contentMap = getLastKnownContentMap(chatId, userId);

        for (const rawMsg of messages) {
          if (!rawMsg || typeof rawMsg.id !== "string") continue;
          const msg = rawMsg as ChatGetMessageDTO & Partial<ChatMessageDTO>;
          const isUser =
            typeof msg.is_user === "boolean"
              ? msg.is_user
              : msg.role === "user";
          const activeSwipeId =
            typeof msg.swipe_id === "number" && Number.isInteger(msg.swipe_id) && msg.swipe_id >= 0
              ? msg.swipe_id
              : 0;
          const extra = asRecord(msg.extra);
          const swipes = Array.isArray(msg.swipes) ? msg.swipes : [];

          liveSwipeCounts.set(msg.id, swipes.length > 0 ? swipes.length : activeSwipeId + 1);
          const prevLiveState = mutatedDuringFetch ? existingStates?.[msg.id] : undefined;
          nextStates[msg.id] =
            prevLiveState && meta[makeMetaKey(msg.id, prevLiveState.swipeId)]
              ? { swipeId: prevLiveState.swipeId, isUser: prevLiveState.isUser }
              : { swipeId: activeSwipeId, isUser };

          if (swipes.length > 0) {
            for (let idx = 0; idx < swipes.length; idx++) {
              const swipeText = swipes[idx];
              const content =
                typeof swipeText === "string"
                  ? swipeText
                  : idx === activeSwipeId && typeof msg.content === "string"
                    ? msg.content
                    : undefined;
              const key = makeMetaKey(msg.id, idx);
              const existingRecord = meta[key];
              const preserveLiveWords =
                mutatedDuringFetch &&
                existingRecord?.wordCount !== undefined &&
                existingRecord.wordCount > 0 &&
                (!content || content.trim().length === 0);
              if (typeof content === "string" && !preserveLiveWords) {
                contentMap.set(key, content);
              }
              const metrics = getSwipeValue(
                extra?.generationMetricsBySwipe,
                extra?.generationMetrics,
                idx,
                activeSwipeId,
              );
              const outcome = getSwipeValue(
                extra?.generationOutcomeBySwipe,
                extra?.generationOutcome,
                idx,
                activeSwipeId,
              );
              meta[key] = mergeExtraIntoRecord(existingRecord, {
                isUser,
                content: preserveLiveWords ? undefined : content,
                metrics,
                outcome,
              });
            }
          } else {
            const key = makeMetaKey(msg.id, activeSwipeId);
            const rawContent = typeof msg.content === "string" ? msg.content : undefined;
            const existingRecord = meta[key];
            const preserveLiveWords =
              mutatedDuringFetch &&
              existingRecord?.wordCount !== undefined &&
              existingRecord.wordCount > 0 &&
              (!rawContent || rawContent.trim().length === 0);
            if (typeof rawContent === "string" && !preserveLiveWords) {
              contentMap.set(key, rawContent);
            }
            meta[key] = mergeExtraIntoRecord(existingRecord, {
              isUser,
              content: preserveLiveWords ? undefined : rawContent,
              metrics: extra?.generationMetrics,
              outcome: extra?.generationOutcome,
            });
          }
        }

        // Prune records belonging to deleted messages or out-of-range swipes,
        // while preserving targets created during an active generation or concurrent mutation.
        for (const key of Object.keys(meta)) {
          const parsed = parseMetaKey(key);
          if (!parsed) continue;
          if (activeProtectedIds.has(parsed.messageId)) continue;
          const swipeBound = liveSwipeCounts.get(parsed.messageId);
          if (
            swipeBound !== undefined
              ? parsed.swipeId >= swipeBound
              : !mutatedDuringFetch && !recentlyCompletedIds.has(parsed.messageId)
          ) {
            delete meta[key];
            contentMap.delete(key);
          }
        }
        for (const key of contentMap.keys()) {
          const parsed = parseMetaKey(key);
          if (!parsed) continue;
          if (activeProtectedIds.has(parsed.messageId)) continue;
          const swipeBound = liveSwipeCounts.get(parsed.messageId);
          if (
            swipeBound !== undefined
              ? parsed.swipeId >= swipeBound
              : !mutatedDuringFetch && !recentlyCompletedIds.has(parsed.messageId)
          ) {
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

  async function verifyStoppedTargetMessage(
    chatId: string,
    targetMessageId: string,
    payload: Record<string, unknown>,
    buffer: GenerationBuffer,
  ): Promise<{ messageId: string; swipeId: number; content: string } | null> {
    if (!hasPermission("chat_mutation") || typeof spindle.chat?.getMessages !== "function") {
      return null;
    }

    try {
      const messages = await spindle.chat.getMessages(chatId);
      if (!Array.isArray(messages)) return null;
      const target = messages.find((m) => m && m.id === targetMessageId) as
        | (ChatGetMessageDTO & Partial<ChatMessageDTO>)
        | undefined;
      if (!target || typeof target.id !== "string") return null;

      const activeSwipeId =
        typeof target.swipe_id === "number" && Number.isInteger(target.swipe_id) && target.swipe_id >= 0
          ? target.swipe_id
          : 0;
      const candidateSwipe =
        typeof payload.swipeId === "number"
          ? payload.swipeId
          : typeof payload.targetSwipeId === "number"
            ? payload.targetSwipeId
            : buffer.targetSwipeId ?? activeSwipeId;
      const safeSwipeId =
        typeof candidateSwipe === "number" && Number.isInteger(candidateSwipe) && candidateSwipe >= 0
          ? candidateSwipe
          : activeSwipeId;

      const swipeText =
        Array.isArray(target.swipes) && typeof target.swipes[safeSwipeId] === "string"
          ? target.swipes[safeSwipeId]
          : undefined;
      const resolvedContent =
        typeof payload.content === "string" && payload.content.trim().length > 0
          ? payload.content
          : typeof swipeText === "string" && swipeText.trim().length > 0
            ? swipeText
            : typeof target.content === "string" && target.content.trim().length > 0
              ? target.content
              : "";

      if (resolvedContent.trim().length === 0) {
        return null;
      }

      return {
        messageId: target.id,
        swipeId: safeSwipeId,
        content: resolvedContent,
      };
    } catch {
      return null;
    }
  }

  async function finalizeGeneration(
    kind: "ended" | "stopped",
    rawPayload: unknown,
    userId?: string,
  ): Promise<void> {
    const payload = asRecord(rawPayload);
    if (!payload) return;
    const chatId = typeof payload.chatId === "string" ? payload.chatId : undefined;
    if (!chatId) return;

    const generationId =
      typeof payload.generationId === "string" ? payload.generationId : undefined;

    const buffer =
      (generationId ? activeBuffersByGenId.get(generationId) : undefined) ??
      activeBuffersByChat.get(chatId);

    clearBuffer(buffer);

    const explicitMessageId =
      typeof payload.messageId === "string" && payload.messageId.length > 0
        ? payload.messageId
        : undefined;

    const hasError =
      (typeof payload.error === "string" && payload.error.trim().length > 0) ||
      payload.errorCode !== undefined ||
      (typeof payload.errorMessage === "string" && payload.errorMessage.trim().length > 0);

    // Pre-stream error without a saved message: drop buffer cleanly so we never
    // overwrite an existing message's finishReason with "error".
    if (kind === "ended" && hasError && !explicitMessageId) {
      return;
    }

    let messageId = explicitMessageId;
    const knownStateForExplicit = messageId
      ? getMessageStatesMap(chatId, userId)[messageId]
      : undefined;
    let swipeId =
      typeof payload.swipeId === "number"
        ? payload.swipeId
        : typeof payload.targetSwipeId === "number"
          ? payload.targetSwipeId
          : buffer?.targetSwipeId ?? knownStateForExplicit?.swipeId ?? 0;
    let content =
      typeof payload.content === "string" ? payload.content : undefined;

    if (kind === "ended" && !messageId) {
      messageId = buffer?.targetMessageId;
      if (
        messageId &&
        typeof payload.swipeId !== "number" &&
        typeof payload.targetSwipeId !== "number" &&
        buffer?.targetSwipeId === undefined
      ) {
        const tracked = getMessageStatesMap(chatId, userId)[messageId];
        if (tracked) {
          swipeId = tracked.swipeId;
        }
      }
    } else if (kind === "stopped" && !messageId) {
      if (!buffer?.targetMessageId) {
        return;
      }
      const verified = await verifyStoppedTargetMessage(
        chatId,
        buffer.targetMessageId,
        payload,
        buffer,
      );
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

    const safeSwipeId =
      typeof swipeId === "number" && Number.isInteger(swipeId) && swipeId >= 0
        ? swipeId
        : 0;
    const key = makeMetaKey(messageId, safeSwipeId);
    bumpChatMutationEpoch(chatId, userId);
    const meta = await store.loadChatMeta(chatId, userId);
    const existing = meta[key];

    const startedAt = buffer?.startedAt;
    const metricsDuration = extractDurationMs(payload.generationMetrics);
    const wallDuration =
      startedAt !== undefined ? Math.max(0, Math.round(Date.now() - startedAt)) : undefined;
    const durationMs = metricsDuration ?? wallDuration ?? existing?.durationMs;

    const finishReason =
      kind === "stopped"
        ? extractFinishReason(payload) ?? "stopped"
        : extractFinishReason(payload) ?? existing?.finishReason;

    const stopSequence = extractStopSequence(payload) ?? existing?.stopSequence;
    const stopDetails =
      extractStopDetails(payload.stopDetails ?? payload.stop_details) ??
      existing?.stopDetails;

    const hasBuffer = buffer !== undefined;
    const lorebookEntries = buffer?.lorebookEntries ?? [];
    const macroNames = buffer ? Array.from(buffer.macroNames) : [];
    const isImpersonate = payload.generationType === "impersonate";
    const isUser = isImpersonate ? true : (existing?.isUser ?? false);

    const record: MessageMetaRecord = {
      ...(existing ?? {}),
      isUser,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(finishReason ? { finishReason } : {}),
      ...(stopSequence ? { stopSequence } : {}),
      ...(stopDetails ? { stopDetails } : {}),
      ...(typeof content === "string" ? { wordCount: countWords(content) } : {}),
      ...(lorebookEntries.length > 0
        ? {
            lorebookTriggers: {
              count: lorebookEntries.length,
              entries: [...lorebookEntries],
            },
          }
        : {}),
      ...(macroNames.length > 0
        ? {
            macrosApplied: {
              count: macroNames.length,
              names: macroNames,
            },
          }
        : {}),
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
        completedAt: now,
      });
    }

    await store.saveChatMeta(chatId, meta, userId);
    pushChatMeta(chatId, meta, userId);

    if (!hasBuffer || typeof content !== "string" || !finishReason) {
      void hydrateChat(chatId, userId).then((hydrated) => {
        pushChatMeta(chatId, hydrated, userId);
      });
    }
  }

  async function handleMetricsReady(rawPayload: unknown, userId?: string): Promise<void> {
    const payload = asRecord(rawPayload);
    if (!payload) return;

    const generationId =
      typeof payload.generationId === "string" ? payload.generationId : undefined;
    const completedRef = generationId ? completedRefsByGenId.get(generationId) : undefined;

    const chatId =
      typeof payload.chatId === "string" ? payload.chatId : completedRef?.chatId;
    const messageId =
      typeof payload.messageId === "string"
        ? payload.messageId
        : completedRef?.messageId;

    if (!chatId || !messageId) return;

    const swipeId =
      typeof payload.swipeId === "number" && Number.isInteger(payload.swipeId) && payload.swipeId >= 0
        ? payload.swipeId
        : completedRef?.swipeId ?? 0;

    const durationMs = extractDurationMs(payload.generationMetrics);
    if (durationMs === undefined) return;

    bumpChatMutationEpoch(chatId, userId);
    const meta = await store.loadChatMeta(chatId, userId);
    const key = makeMetaKey(messageId, swipeId);
    let existing = meta[key];

    // If GENERATION_ENDED previously wrote buffered metadata to another swipe slot
    // (e.g. fallback 0 before swipeId was known), carry over triggers/macros.
    if (!existing && completedRef && completedRef.swipeId !== swipeId) {
      const prevKey = makeMetaKey(completedRef.messageId, completedRef.swipeId);
      const prev = meta[prevKey];
      if (prev) {
        existing = { ...prev };
      }
    }

    const isUser = existing?.isUser ?? false;
    meta[key] = {
      ...(existing ?? {}),
      isUser,
      durationMs,
    };

    if (completedRef && completedRef.swipeId !== swipeId) {
      completedRef.swipeId = swipeId;
    }

    setMessageState(chatId, messageId, { swipeId, isUser }, userId);

    await store.saveChatMeta(chatId, meta, userId);
    pushChatMeta(chatId, meta, userId);

    if (!existing || existing.wordCount === undefined || !existing.finishReason) {
      void hydrateChat(chatId, userId).then((hydrated) => {
        pushChatMeta(chatId, hydrated, userId);
      });
    }
  }

  function registerMacroInterceptorIfPermitted(): void {
    if (macroInterceptorRegistered) return;
    if (!hasPermission("macro_interceptor")) return;
    if (typeof spindle.registerMacroInterceptor !== "function") return;

    spindle.registerMacroInterceptor(async (ctx: MacroInterceptorCtxDTO) => {
      if (!hasPermission("macro_interceptor")) return;
      if (
        !ctx ||
        (ctx.phase !== "prompt" && ctx.phase !== "other") ||
        ctx.commit === false
      ) {
        return;
      }

      const chatId =
        typeof ctx.env?.chat?.id === "string" && ctx.env.chat.id.length > 0
          ? ctx.env.chat.id
          : undefined;
      if (!chatId) return;

      pruneStaleBuffers();
      const buffer = activeBuffersByChat.get(chatId);
      if (!buffer) return;
      buffer.lastActivityAt = Date.now();

      const names = extractMacroNames(ctx.template);
      if (names.length === 0) return;

      for (const name of names) {
        buffer.macroNames.add(name);
      }
      // Strictly non-mutating pass-through: never return a string or rich result.
    }, 100);

    macroInterceptorRegistered = true;
  }

  function unsubscribeGenerationEvents(): void {
    for (const unsub of generationUnsubs) {
      unsub();
    }
    generationUnsubs = [];
  }

  function subscribeGenerationEventsIfPermitted(): void {
    if (generationUnsubs.length > 0) return;
    if (!hasPermission("generation")) return;

    generationUnsubs.push(
      spindle.on("GENERATION_STARTED", (payload: GenerationStartedPayloadDTO) => {
        if (!payload?.chatId) return;
        const now = Date.now();
        pruneStaleBuffers(now);
        const raw = payload as GenerationStartedPayloadDTO & {
          targetSwipeId?: number;
        };
        const fresh: GenerationBuffer = {
          generationId: payload.generationId,
          chatId: payload.chatId,
          startedAt: now,
          lastActivityAt: now,
          targetMessageId:
            typeof payload.targetMessageId === "string"
              ? payload.targetMessageId
              : undefined,
          targetSwipeId:
            typeof raw.targetSwipeId === "number" && raw.targetSwipeId >= 0
              ? Math.floor(raw.targetSwipeId)
              : undefined,
          streamedMessageIds: new Set<string>(),
          lorebookEntries: [],
          macroNames: new Set<string>(),
        };
        const previous = activeBuffersByChat.get(payload.chatId);
        if (previous?.generationId) {
          activeBuffersByGenId.delete(previous.generationId);
        }
        activeBuffersByChat.set(payload.chatId, fresh);
        if (payload.generationId) {
          activeBuffersByGenId.set(payload.generationId, fresh);
        }
      }),
    );

    generationUnsubs.push(
      spindle.on("GENERATION_IN_PROGRESS", (rawPayload: unknown) => {
        const payload = asRecord(rawPayload);
        const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
        if (!chatId) return;
        const generationId =
          typeof payload?.generationId === "string" ? payload.generationId : undefined;
        const buffer = getOrCreateBuffer(chatId, generationId);
        buffer.lastActivityAt = Date.now();
        const targetMsgId =
          typeof payload?.targetMessageId === "string" && payload.targetMessageId.length > 0
            ? payload.targetMessageId
            : typeof payload?.messageId === "string" && payload.messageId.length > 0
              ? payload.messageId
              : undefined;
        if (targetMsgId && !buffer.targetMessageId) {
          buffer.targetMessageId = targetMsgId;
        }
        const rawSwipeId =
          typeof payload?.targetSwipeId === "number"
            ? payload.targetSwipeId
            : typeof payload?.swipeId === "number"
              ? payload.swipeId
              : undefined;
        if (
          typeof rawSwipeId === "number" &&
          Number.isInteger(rawSwipeId) &&
          rawSwipeId >= 0 &&
          buffer.targetSwipeId === undefined
        ) {
          buffer.targetSwipeId = rawSwipeId;
        }
      }),
    );

    generationUnsubs.push(
      spindle.on(
        "GENERATION_ENDED",
        (payload: GenerationEndedPayloadDTO, userId?: string) => {
          void finalizeGeneration("ended", payload, userId);
        },
      ),
    );

    generationUnsubs.push(
      spindle.on(
        "GENERATION_STOPPED",
        (payload: GenerationStoppedPayloadDTO, userId?: string) => {
          void finalizeGeneration("stopped", payload, userId);
        },
      ),
    );
  }

  // Subscribe to WORLD_INFO_ACTIVATED & GENERATION_METRICS_READY (non-gated events).
  permanentUnsubs.push(
    spindle.on("WORLD_INFO_ACTIVATED", (rawPayload: unknown) => {
      const payload = asRecord(rawPayload);
      if (!payload) return;
      const entries = extractLorebookEntryNames(
        payload.entries as ActivatedWorldInfoEntryDTO[] | undefined,
      );
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
    }),
  );

  permanentUnsubs.push(
    spindle.on("GENERATION_METRICS_READY", (rawPayload: unknown, userId?: string) => {
      void handleMetricsReady(rawPayload, userId);
    }),
  );

  // Chat & message lifecycle events.
  permanentUnsubs.push(
    spindle.on("CHAT_SWITCHED", (rawPayload: unknown, userId?: string) => {
      const payload = asRecord(rawPayload);
      const nextChatId =
        typeof payload?.chatId === "string" && payload.chatId.length > 0
          ? payload.chatId
          : null;
      activeChatIdByUser.set(resolveUserScopeKey(userId), nextChatId);

      if (nextChatId) {
        void hydrateChat(nextChatId, userId).then((meta) => {
          pushChatMeta(nextChatId, meta, userId);
        });
      } else {
        void store.loadSettings(userId).then((settings) => {
          pushState(settings, null, undefined, userId);
        });
      }
    }),
  );

  permanentUnsubs.push(
    spindle.on("CHAT_CHANGED", (rawPayload: unknown, userId?: string) => {
      const payload = asRecord(rawPayload);
      const nestedChat = asRecord(payload?.chat);
      const chatId =
        typeof payload?.chatId === "string" && payload.chatId.length > 0
          ? payload.chatId
          : typeof nestedChat?.id === "string" && nestedChat.id.length > 0
            ? nestedChat.id
            : undefined;
      if (!chatId) return;
      void hydrateChat(chatId, userId).then((meta) => {
        pushChatMeta(chatId, meta, userId);
      });
    }),
  );

  permanentUnsubs.push(
    spindle.on("MESSAGE_SENT", (rawPayload: unknown, userId?: string) => {
      const payload = asRecord(rawPayload);
      const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
      const message = asRecord(payload?.message) as Partial<ChatMessageDTO> | null;
      if (!chatId || !message || typeof message.id !== "string") return;

      const swipeId =
        typeof message.swipe_id === "number" && message.swipe_id >= 0
          ? Math.floor(message.swipe_id)
          : 0;
      const isUser =
        typeof message.is_user === "boolean"
          ? message.is_user
          : (message as { role?: string }).role === "user";

      if (!isUser) {
        const activeBuf = activeBuffersByChat.get(chatId);
        if (activeBuf) {
          activeBuf.lastActivityAt = Date.now();
          activeBuf.streamedMessageIds.add(message.id);
        }
      }

      void (async () => {
        bumpChatMutationEpoch(chatId, userId);
        const meta = await store.loadChatMeta(chatId, userId);
        const key = makeMetaKey(message.id!, swipeId);
        if (typeof message.content === "string") {
          setLastKnownContent(chatId, key, message.content, userId);
        }
        setMessageState(chatId, message.id!, { swipeId, isUser }, userId);
        meta[key] = {
          ...(meta[key] ?? {}),
          isUser,
          ...(typeof message.content === "string"
            ? { wordCount: countWords(message.content) }
            : {}),
        };
        await store.saveChatMeta(chatId, meta, userId);
        pushChatMeta(chatId, meta, userId);
      })();
    }),
  );

  permanentUnsubs.push(
    spindle.on("MESSAGE_EDITED", (rawPayload: unknown, userId?: string) => {
      const payload = asRecord(rawPayload);
      const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
      const message = asRecord(payload?.message) as Partial<ChatMessageDTO> | null;
      if (!chatId || !message || typeof message.id !== "string") return;

      const swipeId =
        typeof message.swipe_id === "number" && message.swipe_id >= 0
          ? Math.floor(message.swipe_id)
          : 0;
      const isUser =
        typeof message.is_user === "boolean"
          ? message.is_user
          : (message as { role?: string }).role === "user";

      const activeBuf = activeBuffersByChat.get(chatId);
      const isGeneratingTarget =
        activeBuf !== undefined &&
        (activeBuf.targetMessageId === message.id ||
          activeBuf.streamedMessageIds.has(message.id));
      if (isGeneratingTarget && activeBuf) {
        activeBuf.lastActivityAt = Date.now();
      }

      void (async () => {
        bumpChatMutationEpoch(chatId, userId);
        const meta = await store.loadChatMeta(chatId, userId);
        const key = makeMetaKey(message.id!, swipeId);
        const existing = meta[key];
        const prevContent = getLastKnownContent(chatId, key, userId);
        const hasContent = typeof message.content === "string";
        const contentUnchanged =
          !hasContent ||
          (prevContent !== undefined && message.content === prevContent);
        const markEdited = !isGeneratingTarget && !contentUnchanged;
        const resolvedIsUser = existing?.isUser ?? isUser;

        if (hasContent) {
          setLastKnownContent(chatId, key, message.content!, userId);
        }
        setMessageState(
          chatId,
          message.id!,
          { swipeId, isUser: resolvedIsUser },
          userId,
        );

        meta[key] = {
          ...(existing ?? {}),
          isUser: resolvedIsUser,
          ...(markEdited ? { edited: true, editedAt: Date.now() } : {}),
          ...(hasContent ? { wordCount: countWords(message.content!) } : {}),
        };
        await store.saveChatMeta(chatId, meta, userId);
        pushChatMeta(chatId, meta, userId);
      })();
    }),
  );

  permanentUnsubs.push(
    spindle.on("MESSAGE_DELETED", (rawPayload: unknown, userId?: string) => {
      const payload = asRecord(rawPayload);
      const chatId = typeof payload?.chatId === "string" ? payload.chatId : undefined;
      const messageId =
        typeof payload?.messageId === "string" ? payload.messageId : undefined;
      if (!chatId || !messageId) return;

      void (async () => {
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
    }),
  );

  permanentUnsubs.push(
    spindle.on(
      "MESSAGE_SWIPED",
      (payload: MessageSwipedPayloadDTO, userId?: string) => {
        if (!payload?.chatId || !payload.message?.id) return;
        const { chatId, message, action, swipeId } = payload;

        const isUser =
          typeof message.is_user === "boolean"
            ? message.is_user
            : (message as { role?: string }).role === "user";
        const activeSwipeId =
          typeof message.swipe_id === "number" && message.swipe_id >= 0
            ? Math.floor(message.swipe_id)
            : 0;
        const targetSwipe =
          action === "updated" && Number.isInteger(swipeId) && swipeId >= 0
            ? swipeId
            : activeSwipeId;

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
        const isGeneratingTarget =
          activeBuf !== undefined &&
          (activeBuf.targetMessageId === message.id ||
            activeBuf.streamedMessageIds.has(message.id) ||
            (!isUser &&
              typeof activeBuf.targetSwipeId === "number" &&
              activeBuf.targetSwipeId === targetSwipe));

        void (async () => {
          bumpChatMutationEpoch(chatId, userId);
          const meta = await store.loadChatMeta(chatId, userId);
          const contentMap = getLastKnownContentMap(chatId, userId);
          const extra = asRecord(message.extra);

          if (action === "deleted" && Number.isInteger(swipeId) && swipeId >= 0) {
            const shiftedEntries: Array<[number, MessageMetaRecord]> = [];
            for (const key of Object.keys(meta)) {
              const idx = parseSwipeIndexFromKey(key, message.id);
              if (idx === null) continue;
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

            const shiftedContents: Array<[number, string]> = [];
            for (const [key, val] of contentMap.entries()) {
              const idx = parseSwipeIndexFromKey(key, message.id);
              if (idx === null) continue;
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

          const swipeContent =
            Array.isArray(message.swipes) &&
            typeof message.swipes[targetSwipe] === "string"
              ? message.swipes[targetSwipe]
              : targetSwipe === message.swipe_id &&
                  typeof message.content === "string"
                ? message.content
                : undefined;

          const key = makeMetaKey(message.id, targetSwipe);
          const prevContent = contentMap.get(key);
          if (typeof swipeContent === "string") {
            contentMap.set(key, swipeContent);
          }

          const metrics = getSwipeValue(
            extra?.generationMetricsBySwipe,
            extra?.generationMetrics,
            targetSwipe,
            activeSwipeId,
          );
          const outcome = getSwipeValue(
            extra?.generationOutcomeBySwipe,
            extra?.generationOutcome,
            targetSwipe,
            activeSwipeId,
          );

          meta[key] = mergeExtraIntoRecord(meta[key], {
            isUser,
            content: swipeContent,
            metrics,
            outcome,
          });

          const wasStagedBlank = !isUser && prevContent === "";
          const recentlyGenerated = isRecentlyCompletedTarget(
            chatId,
            message.id,
            targetSwipe,
          );
          if (
            action === "updated" &&
            !isGeneratingTarget &&
            !wasStagedBlank &&
            !recentlyGenerated &&
            typeof swipeContent === "string" &&
            (prevContent === undefined ? isUser : swipeContent !== prevContent)
          ) {
            meta[key].edited = true;
            meta[key].editedAt = Date.now();
          }

          setMessageState(
            chatId,
            message.id,
            { swipeId: activeSwipeId, isUser },
            userId,
          );

          await store.saveChatMeta(chatId, meta, userId);
          pushChatMeta(chatId, meta, userId);
        })();
      },
    ),
  );

  permanentUnsubs.push(
    spindle.on(
      "SWIPE_EDITED",
      (payload: SwipeEditedPayloadDTO, userId?: string) => {
        if (!payload?.chatId || !payload.message?.id) return;
        const { chatId, message } = payload;

        void (async () => {
          bumpChatMutationEpoch(chatId, userId);
          const meta = await store.loadChatMeta(chatId, userId);
          const contentMap = getLastKnownContentMap(chatId, userId);
          const isUser =
            typeof message.is_user === "boolean"
              ? message.is_user
              : (message as { role?: string }).role === "user";
          const extra = asRecord(message.extra);
          const swipes = Array.isArray(message.swipes) ? message.swipes : [];
          const activeSwipeId =
            typeof message.swipe_id === "number" && message.swipe_id >= 0
              ? Math.floor(message.swipe_id)
              : 0;

          if (swipes.length > 0) {
            for (const key of Object.keys(meta)) {
              const idx = parseSwipeIndexFromKey(key, message.id);
              if (idx !== null && idx >= swipes.length) {
                delete meta[key];
                contentMap.delete(key);
              }
            }
            for (let idx = 0; idx < swipes.length; idx++) {
              const swipeContent =
                typeof swipes[idx] === "string"
                  ? swipes[idx]
                  : idx === activeSwipeId && typeof message.content === "string"
                    ? message.content
                    : undefined;
              const key = makeMetaKey(message.id, idx);
              if (typeof swipeContent === "string") {
                contentMap.set(key, swipeContent);
              }
              const metrics = getSwipeValue(
                extra?.generationMetricsBySwipe,
                extra?.generationMetrics,
                idx,
                activeSwipeId,
              );
              const outcome = getSwipeValue(
                extra?.generationOutcomeBySwipe,
                extra?.generationOutcome,
                idx,
                activeSwipeId,
              );
              meta[key] = mergeExtraIntoRecord(meta[key], {
                isUser,
                content: swipeContent,
                metrics,
                outcome,
              });
            }
          } else {
            const key = makeMetaKey(message.id, activeSwipeId);
            if (typeof message.content === "string") {
              contentMap.set(key, message.content);
            }
            meta[key] = mergeExtraIntoRecord(meta[key], {
              isUser,
              content:
                typeof message.content === "string" ? message.content : undefined,
              metrics: extra?.generationMetrics,
              outcome: extra?.generationOutcome,
            });
          }

          setMessageState(
            chatId,
            message.id,
            { swipeId: activeSwipeId, isUser },
            userId,
          );

          await store.saveChatMeta(chatId, meta, userId);
          pushChatMeta(chatId, meta, userId);
        })();
      },
    ),
  );

  // Frontend <-> Backend IPC.
  permanentUnsubs.push(
    spindle.onFrontendMessage((raw: unknown, userId: string) => {
      const msg = asRecord(raw) as Partial<FrontendToBackendMessage> | null;
      if (!msg || typeof msg.type !== "string") return;

      void (async () => {
        const userScope = resolveUserScopeKey(userId);
        switch (msg.type) {
          case "get-state": {
            const settings = await store.loadSettings(userId);
            let currentActiveChatId = activeChatIdByUser.get(userScope) ?? null;
            if (hasPermission("chats") && typeof spindle.chats?.getActive === "function") {
              try {
                const active = await spindle.chats.getActive(userId);
                currentActiveChatId = active?.id ?? null;
                activeChatIdByUser.set(userScope, currentActiveChatId);
              } catch {
                // Keep tracked activeChatId on transient/permission error.
              }
            }
            const meta = currentActiveChatId
              ? await hydrateChat(currentActiveChatId, userId)
              : undefined;
            pushState(settings, currentActiveChatId, meta, userId);
            break;
          }

          case "update-settings": {
            const settings = await store.saveSettings(
              (msg as { settings?: unknown }).settings,
              userId,
            );
            const currentActiveChatId = activeChatIdByUser.get(userScope) ?? null;
            const meta = currentActiveChatId
              ? store.getCachedChatMeta(currentActiveChatId, userId)
              : undefined;
            pushState(settings, currentActiveChatId, meta, userId);
            break;
          }

          case "get-chat-meta":
          case "hydrate-chat": {
            const chatId = (msg as { chatId?: unknown }).chatId;
            if (typeof chatId !== "string" || chatId.length === 0) return;
            const meta = await hydrateChat(chatId, userId);
            pushChatMeta(chatId, meta, userId);
            break;
          }
        }
      })();
    }),
  );

  // React to runtime permission grants / revocations.
  if (typeof spindle.permissions?.onChanged === "function") {
    permanentUnsubs.push(
      spindle.permissions.onChanged(({ permission, granted }) => {
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
      }),
    );
  }

  if (typeof spindle.permissions?.onDenied === "function") {
    permanentUnsubs.push(
      spindle.permissions.onDenied(({ permission, operation }) => {
        logWarn(`Permission "${permission}" denied for ${operation}`);
      }),
    );
  }

  // Initial registrations for granted permissions.
  subscribeGenerationEventsIfPermitted();
  registerMacroInterceptorIfPermitted();

  return {
    hydrateChat,
    dispose(): void {
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
    },
  };
}
