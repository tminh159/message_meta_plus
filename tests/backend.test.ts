import { describe, expect, test } from "bun:test";
import type {
  ChatGetMessageDTO,
  MacroInterceptorCtxDTO,
  MacroInterceptorHandler,
  SpindleAPI,
} from "lumiverse-spindle-types";
import { BackendStore, createBackend } from "../src/backend.js";
import {
  type BackendToFrontendMessage,
  type ChatMetaMap,
  DEFAULT_SETTINGS,
  makeMetaKey,
} from "../src/shared/types.js";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface MockSpindleOptions {
  permissions?: string[];
  activeChatId?: string | null;
  chats?: Record<string, Array<Partial<ChatGetMessageDTO> & { id: string }>>;
  initialStorage?: Record<string, unknown>;
  enableUserStorage?: boolean;
}

function createMockSpindle(opts: MockSpindleOptions = {}) {
  const granted = new Set<string>(
    opts.permissions ?? ["chats", "chat_mutation", "generation", "macro_interceptor"],
  );
  const storageMap = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.initialStorage ?? {})) {
    storageMap.set(k, JSON.stringify(v));
  }
  const userStorageMaps = new Map<string, Map<string, string>>();
  const getUserBucket = (userId?: string) => {
    const scope = userId && userId.length > 0 ? userId : "__default__";
    let bucket = userStorageMaps.get(scope);
    if (!bucket) {
      bucket = new Map<string, string>();
      userStorageMaps.set(scope, bucket);
    }
    return bucket;
  };

  const eventHandlers = new Map<string, Set<(payload: unknown, userId?: string) => void>>();
  let frontendMessageHandler: ((payload: unknown, userId: string) => void) | null = null;
  let permissionChangedHandler:
    | ((ev: { permission: string; granted: boolean; allGranted: string[] }) => void)
    | null = null;
  const macroInterceptors: Array<{ fn: MacroInterceptorHandler; priority: number }> = [];
  const sentToFrontend: Array<{ payload: BackendToFrontendMessage; userId?: string }> = [];
  const getMessagesCalls: string[] = [];

  const chats = new Map<string, Array<Partial<ChatGetMessageDTO> & { id: string }>>();
  for (const [chatId, msgs] of Object.entries(opts.chats ?? {})) {
    chats.set(chatId, msgs);
  }
  let activeChatId: string | null =
    opts.activeChatId === undefined ? "chat-1" : opts.activeChatId;

  const apiObj: Record<string, unknown> = {
    log: {
      info() {},
      warn() {},
      error() {},
    },
    permissions: {
      has(perm: string) {
        return granted.has(perm);
      },
      async getGranted() {
        return [...granted];
      },
      onChanged(cb: (ev: { permission: string; granted: boolean; allGranted: string[] }) => void) {
        permissionChangedHandler = cb;
        return () => {
          permissionChangedHandler = null;
        };
      },
      onDenied() {
        return () => {};
      },
    },
    storage: {
      async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> {
        const raw = storageMap.get(path);
        if (raw === undefined) return options?.fallback as T;
        return JSON.parse(raw) as T;
      },
      async setJson(path: string, value: unknown): Promise<void> {
        storageMap.set(path, JSON.stringify(value));
      },
      async exists(path: string): Promise<boolean> {
        return storageMap.has(path);
      },
      async read(path: string): Promise<string> {
        return storageMap.get(path) ?? "";
      },
      async write(path: string, data: string): Promise<void> {
        storageMap.set(path, data);
      },
    },
    chats: {
      async getActive() {
        return activeChatId ? { id: activeChatId } : null;
      },
    },
    chat: {
      async getMessages(chatId: string) {
        getMessagesCalls.push(chatId);
        return (chats.get(chatId) ?? []).map((m, idx) => ({
          id: m.id,
          chat_id: chatId,
          index_in_chat: m.index_in_chat ?? idx,
          is_user: m.is_user ?? false,
          name: m.name ?? (m.is_user ? "User" : "Assistant"),
          content: m.content ?? "",
          send_date: m.send_date ?? 1700000000,
          swipe_id: m.swipe_id ?? 0,
          swipes: m.swipes ?? [m.content ?? ""],
          extra: m.extra ?? {},
          role: m.role ?? (m.is_user ? "user" : "assistant"),
        }));
      },
    },
    on(event: string, handler: (payload: unknown, userId?: string) => void) {
      let set = eventHandlers.get(event);
      if (!set) {
        set = new Set();
        eventHandlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    },
    registerMacroInterceptor(fn: MacroInterceptorHandler, priority = 0) {
      macroInterceptors.push({ fn, priority });
    },
    onFrontendMessage(handler: (payload: unknown, userId: string) => void) {
      frontendMessageHandler = handler;
      return () => {
        frontendMessageHandler = null;
      };
    },
    sendToFrontend(payload: unknown, userId?: string) {
      sentToFrontend.push({
        payload: payload as BackendToFrontendMessage,
        userId,
      });
    },
  };

  if (opts.enableUserStorage) {
    apiObj.userStorage = {
      async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
        const raw = getUserBucket(options?.userId).get(path);
        if (raw === undefined) return options?.fallback as T;
        return JSON.parse(raw) as T;
      },
      async setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void> {
        getUserBucket(options?.userId).set(path, JSON.stringify(value));
      },
      async exists(path: string, userId?: string): Promise<boolean> {
        return getUserBucket(userId).has(path);
      },
      async read(path: string, userId?: string): Promise<string> {
        return getUserBucket(userId).get(path) ?? "";
      },
      async write(path: string, data: string, userId?: string): Promise<void> {
        getUserBucket(userId).set(path, data);
      },
    };
  }

  const api = apiObj as unknown as SpindleAPI;

  return {
    api,
    storageMap,
    userStorageMaps,
    sentToFrontend,
    getMessagesCalls,
    macroInterceptors,
    chats,
    setActiveChat(id: string | null) {
      activeChatId = id;
    },
    grantPermission(perm: string) {
      granted.add(perm);
      permissionChangedHandler?.({
        permission: perm,
        granted: true,
        allGranted: [...granted],
      });
    },
    revokePermission(perm: string) {
      granted.delete(perm);
      permissionChangedHandler?.({
        permission: perm,
        granted: false,
        allGranted: [...granted],
      });
    },
    emit(event: string, payload: unknown, userId = "u1") {
      for (const fn of eventHandlers.get(event) ?? []) {
        fn(payload, userId);
      }
    },
    sendFromFrontend(payload: unknown, userId = "u1") {
      frontendMessageHandler?.(payload, userId);
    },
    async runMacroInterceptor(ctx: MacroInterceptorCtxDTO) {
      const results: unknown[] = [];
      for (const entry of macroInterceptors) {
        results.push(await entry.fn(ctx));
      }
      return results;
    },
  };
}

describe("Backend controller and storage", () => {
  test("correlates GENERATION_STARTED + WORLD_INFO_ACTIVATED + macro interceptor + real snake_case GENERATION_ENDED (no swipeId/metrics) + GENERATION_METRICS_READY", async () => {
    const mock = createMockSpindle();
    const controller = createBackend(mock.api);

    expect(mock.macroInterceptors).toHaveLength(1);
    expect(mock.macroInterceptors[0]?.priority).toBe(100);

    mock.emit("GENERATION_STARTED", {
      generationId: "gen-1",
      chatId: "chat-1",
      targetMessageId: "msg-ai-1",
      targetSwipeId: 2,
    });

    mock.emit("WORLD_INFO_ACTIVATED", {
      chatId: "chat-1",
      entries: [
        { comment: "Arcane Citadel", keys: ["citadel"] },
        { name: "Moon Pact", keys: ["moon"] },
        { comment: "Arcane Citadel", keys: ["citadel"] },
      ],
    });

    // Preview/non-commit phase is ignored; both "prompt" and "other" phases are captured and return void
    const previewRes = await mock.runMacroInterceptor({
      phase: "preview",
      commit: false,
      template: "Hello {{user}} from {{char}}",
      env: { chat: { id: "chat-1" } },
    } as unknown as MacroInterceptorCtxDTO);
    expect(previewRes).toEqual([undefined]);

    const promptRes = await mock.runMacroInterceptor({
      phase: "prompt",
      commit: true,
      template: "Scene for {{char}} and {{user}} (escaped \\{{ignored}})",
      env: { chat: { id: "chat-1" } },
    } as unknown as MacroInterceptorCtxDTO);
    expect(promptRes).toEqual([undefined]);

    const otherRes = await mock.runMacroInterceptor({
      phase: "other",
      commit: true,
      template: "Author note at {{time}}",
      env: { chat: { id: "chat-1" } },
    } as unknown as MacroInterceptorCtxDTO);
    expect(otherRes).toEqual([undefined]);

    // Real Lumiverse GENERATION_ENDED uses snake_case finish_reason/stop_sequence/stop_details and omits swipeId & generationMetrics
    mock.emit("GENERATION_ENDED", {
      generationId: "gen-1",
      chatId: "chat-1",
      messageId: "msg-ai-1",
      content: "The silver spire glowed softly in moonlight.",
      finish_reason: "length",
      stop_sequence: "###",
      stop_details: { type: "max_tokens", explanation: "Output limit reached" },
    });

    await flush();

    let stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    const rec = stored[makeMetaKey("msg-ai-1", 2)];
    expect(rec).toBeDefined();
    expect(rec?.isUser).toBe(false);
    expect(rec?.finishReason).toBe("length");
    expect(rec?.stopSequence).toBe("###");
    expect(rec?.stopDetails).toBe("max_tokens: Output limit reached");
    expect(rec?.wordCount).toBe(7);
    expect(typeof rec?.durationMs).toBe("number");
    expect(rec?.lorebookTriggers).toEqual({
      count: 2,
      entries: ["Arcane Citadel", "Moon Pact"],
    });
    expect(rec?.macrosApplied).toEqual({
      count: 3,
      names: ["char", "user", "time"],
    });

    const pushed = mock.sentToFrontend.findLast((m) => m.payload.type === "chat-meta-update");
    expect(pushed?.payload).toMatchObject({
      type: "chat-meta-update",
      chatId: "chat-1",
      messageStates: {
        "msg-ai-1": { swipeId: 2, isUser: false },
      },
    });

    // Subsequent GENERATION_METRICS_READY delivers authoritative durationMs + swipeId
    mock.emit("GENERATION_METRICS_READY", {
      generationId: "gen-1",
      chatId: "chat-1",
      messageId: "msg-ai-1",
      swipeId: 2,
      generationMetrics: { durationMs: 14_250 },
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-ai-1:2"]?.durationMs).toBe(14_250);
    expect(stored["msg-ai-1:2"]?.lorebookTriggers?.count).toBe(2);

    controller.dispose();
  });

  test("pre-stream GENERATION_STOPPED and error GENERATION_ENDED without messageId never corrupt prior messages", async () => {
    const mock = createMockSpindle({
      chats: {
        "chat-1": [
          { id: "msg-u1", is_user: true, role: "user", content: "Hi", swipe_id: 0 },
          {
            id: "msg-prev",
            is_user: false,
            role: "assistant",
            content: "Existing complete reply",
            swipe_id: 0,
            extra: {
              generationOutcome: { finish_reason: "stop" },
              generationMetrics: { durationMs: 2_500 },
            },
          },
          {
            id: "msg-empty-target",
            is_user: false,
            role: "assistant",
            content: "   ",
            swipe_id: 0,
          },
          {
            id: "msg-partial",
            is_user: false,
            role: "assistant",
            content: "Partial stopped output",
            swipe_id: 1,
            swipes: ["First swipe", "Partial stopped output"],
          },
        ],
      },
    });
    const controller = createBackend(mock.api);
    await controller.hydrateChat("chat-1");

    // 1) Pre-stream abort with NO targetMessageId -> must NOT touch msg-prev or msg-partial
    mock.emit("GENERATION_STARTED", {
      generationId: "gen-prestream-stop",
      chatId: "chat-1",
    });
    mock.emit("WORLD_INFO_ACTIVATED", {
      chatId: "chat-1",
      entries: [{ comment: "ShouldNotAttach" }],
    });
    mock.emit("GENERATION_STOPPED", {
      generationId: "gen-prestream-stop",
      chatId: "chat-1",
    });
    await flush();

    let stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-prev:0"]?.finishReason).toBe("stop");
    expect(stored["msg-prev:0"]?.lorebookTriggers).toBeUndefined();

    // 2) Stopped with targetMessageId missing from getMessages or empty content -> must NOT write
    mock.emit("GENERATION_STARTED", {
      generationId: "gen-missing-target",
      chatId: "chat-1",
      targetMessageId: "msg-never-saved",
    });
    mock.emit("GENERATION_STOPPED", {
      generationId: "gen-missing-target",
      chatId: "chat-1",
    });
    mock.emit("GENERATION_STARTED", {
      generationId: "gen-empty-target",
      chatId: "chat-1",
      targetMessageId: "msg-empty-target",
    });
    mock.emit("GENERATION_STOPPED", {
      generationId: "gen-empty-target",
      chatId: "chat-1",
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-never-saved:0"]).toBeUndefined();
    expect(stored["msg-empty-target:0"]?.finishReason).toBeUndefined();

    // 3) Stopped with valid targetMessageId existing in getMessages with non-empty content -> writes "stopped"
    mock.emit("GENERATION_STARTED", {
      generationId: "gen-valid-stop",
      chatId: "chat-1",
      targetMessageId: "msg-partial",
      targetSwipeId: 1,
    });
    mock.emit("WORLD_INFO_ACTIVATED", {
      chatId: "chat-1",
      entries: [{ comment: "Guard Lore" }],
    });
    mock.emit("GENERATION_STOPPED", {
      generationId: "gen-valid-stop",
      chatId: "chat-1",
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-partial:1"]?.finishReason).toBe("stopped");
    expect(stored["msg-partial:1"]?.wordCount).toBe(3);
    expect(stored["msg-partial:1"]?.lorebookTriggers).toEqual({
      count: 1,
      entries: ["Guard Lore"],
    });

    // 4) GENERATION_ENDED with error/errorCode and NO explicit messageId drops buffer without corrupting targetMessageId
    mock.emit("GENERATION_STARTED", {
      generationId: "gen-err-1",
      chatId: "chat-1",
      targetMessageId: "msg-prev",
      targetSwipeId: 0,
    });
    mock.emit("GENERATION_ENDED", {
      generationId: "gen-err-1",
      chatId: "chat-1",
      error: "Provider 502",
      errorCode: "UPSTREAM_ERROR",
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-prev:0"]?.finishReason).toBe("stop");

    controller.dispose();
  });

  test("prevents false-positive Edited badge on unchanged metadata updates and active streaming edits", async () => {
    const mock = createMockSpindle();
    const controller = createBackend(mock.api);

    mock.emit("MESSAGE_SENT", {
      chatId: "chat-1",
      message: {
        id: "msg-u1",
        is_user: true,
        role: "user",
        content: "Hello world",
        swipe_id: 0,
      },
    });
    await flush();

    // Metadata-only MESSAGE_EDITED (same content, e.g. setMessageHidden) must NOT set edited=true
    mock.emit("MESSAGE_EDITED", {
      chatId: "chat-1",
      message: {
        id: "msg-u1",
        is_user: true,
        content: "Hello world",
        swipe_id: 0,
      },
    });
    await flush();

    let stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-u1:0"]?.edited).toBeUndefined();

    // Active generation MESSAGE_EDITED on targetMessageId must NOT set edited=true
    mock.emit("GENERATION_STARTED", {
      generationId: "gen-stream-1",
      chatId: "chat-1",
      targetMessageId: "msg-a1",
      targetSwipeId: 0,
    });
    mock.emit("MESSAGE_EDITED", {
      chatId: "chat-1",
      message: {
        id: "msg-a1",
        is_user: false,
        content: "Streaming partial",
        swipe_id: 0,
      },
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-a1:0"]?.edited).toBeUndefined();

    mock.emit("GENERATION_ENDED", {
      generationId: "gen-stream-1",
      chatId: "chat-1",
      messageId: "msg-a1",
      content: "One two three",
      finish_reason: "stop",
    });
    mock.emit("GENERATION_METRICS_READY", {
      generationId: "gen-stream-1",
      chatId: "chat-1",
      messageId: "msg-a1",
      swipeId: 0,
      generationMetrics: { durationMs: 2_000 },
    });
    await flush();

    // Actual user edit changing content -> sets edited=true and preserves durationMs/finishReason
    mock.emit("MESSAGE_EDITED", {
      chatId: "chat-1",
      message: {
        id: "msg-a1",
        is_user: false,
        content: "One two three four five",
        swipe_id: 0,
      },
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-a1:0"]?.edited).toBe(true);
    expect(typeof stored["msg-a1:0"]?.editedAt).toBe("number");
    expect(stored["msg-a1:0"]?.wordCount).toBe(5);
    expect(stored["msg-a1:0"]?.durationMs).toBe(2_000);
    expect(stored["msg-a1:0"]?.finishReason).toBe("stop");

    // Swipe deleted shifts higher swipe indices down
    stored["msg-a1:2"] = { isUser: false, wordCount: 99, finishReason: "length" };
    await mock.api.storage.setJson!("chats/chat-1.json", stored);

    controller.dispose();
    const controller2 = createBackend(mock.api);

    mock.emit("MESSAGE_SWIPED", {
      chatId: "chat-1",
      action: "deleted",
      swipeId: 1,
      message: {
        id: "msg-a1",
        is_user: false,
        swipe_id: 1,
        swipes: ["One two three four five", "Swiped text"],
        content: "Swiped text",
      },
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-a1:0"]?.edited).toBe(true);
    expect(stored["msg-a1:1"]?.finishReason).toBe("length");
    expect(stored["msg-a1:2"]).toBeUndefined();

    mock.emit("MESSAGE_DELETED", { chatId: "chat-1", messageId: "msg-a1" });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-a1:0"]).toBeUndefined();
    expect(stored["msg-a1:1"]).toBeUndefined();
    expect(stored["msg-u1:0"]).toBeDefined();

    controller2.dispose();
  });

  test("handles CHAT_CHANGED { chat: { id } }, impersonate isUser=true, runtime macro_interceptor revocation, and multi-user userStorage isolation", async () => {
    const mock = createMockSpindle({
      enableUserStorage: true,
      activeChatId: "chat-hydrate",
      chats: {
        "chat-hydrate": [
          {
            id: "m1",
            is_user: true,
            role: "user",
            content: "User prompt with four words",
            swipe_id: 0,
            swipes: ["User prompt with four words"],
          },
          {
            id: "m2",
            is_user: false,
            role: "assistant",
            content: "Swipe two content",
            swipe_id: 1,
            swipes: ["Swipe one", "Swipe two content here"],
            extra: {
              generationMetricsBySwipe: [{ durationMs: 1_500 }, { durationMs: 3_200 }],
              generationOutcomeBySwipe: [
                { finish_reason: "stop" },
                { finish_reason: "length", stop_sequence: "END" },
              ],
            },
          },
        ],
        "chat-nested": [
          { id: "m-nested", is_user: false, role: "assistant", content: "Nested chat change", swipe_id: 0 },
        ],
      },
    });

    const controller = createBackend(mock.api);

    // 1) Multi-user get-state + userStorage isolation + messageStates emission
    mock.sendFromFrontend({ type: "get-state" }, "user-a");
    await flush();

    const stateA = mock.sentToFrontend.find(
      (m) => m.userId === "user-a" && m.payload.type === "state-update",
    );
    expect(stateA).toBeDefined();
    if (stateA?.payload.type === "state-update") {
      expect(stateA.payload.activeChatId).toBe("chat-hydrate");
      expect(stateA.payload.settings).toEqual(DEFAULT_SETTINGS);
      expect(stateA.payload.messageStates).toEqual({
        m1: { swipeId: 0, isUser: true },
        m2: { swipeId: 1, isUser: false },
      });
      expect(stateA.payload.meta?.["m2:1"]?.finishReason).toBe("length");
      expect(stateA.payload.meta?.["m2:1"]?.stopSequence).toBe("END");
    }

    // user-a updates settings -> stored only in user-a's userStorage, NOT user-b's
    mock.sendFromFrontend(
      {
        type: "update-settings",
        settings: {
          ...DEFAULT_SETTINGS,
          fields: { ...DEFAULT_SETTINGS.fields, wordCount: "inline" },
          finishReasonAbnormalOnly: false,
        },
      },
      "user-a",
    );
    await flush();

    mock.sendFromFrontend({ type: "get-state" }, "user-b");
    await flush();
    const stateB = mock.sentToFrontend.findLast(
      (m) => m.userId === "user-b" && m.payload.type === "state-update",
    );
    expect(stateB?.payload.type === "state-update" && stateB.payload.settings.fields.wordCount).toBe(
      "hover",
    );
    expect(
      JSON.parse(mock.userStorageMaps.get("user-a")!.get("settings.json")!).fields.wordCount,
    ).toBe("inline");

    // 2) CHAT_CHANGED with nested { chat: { id } } hydrates & emits chat-meta-update
    mock.emit("CHAT_CHANGED", { chat: { id: "chat-nested" } }, "user-a");
    await flush();
    expect(mock.getMessagesCalls).toContain("chat-nested");
    const nestedPush = mock.sentToFrontend.findLast(
      (m) => m.userId === "user-a" && m.payload.type === "chat-meta-update",
    );
    expect(nestedPush?.payload).toMatchObject({
      type: "chat-meta-update",
      chatId: "chat-nested",
      messageStates: {
        "m-nested": { swipeId: 0, isUser: false },
      },
    });

    // 3) impersonate generation records isUser: true and runtime revokePermission("macro_interceptor") stops capture
    mock.emit(
      "GENERATION_STARTED",
      {
        generationId: "gen-imp",
        chatId: "chat-nested",
        targetMessageId: "msg-imp-1",
        targetSwipeId: 0,
      },
      "user-a",
    );
    mock.revokePermission("macro_interceptor");
    await mock.runMacroInterceptor({
      phase: "prompt",
      commit: true,
      template: "Should not record {{char}} after revocation",
      env: { chat: { id: "chat-nested" } },
    } as unknown as MacroInterceptorCtxDTO);

    mock.emit(
      "GENERATION_ENDED",
      {
        generationId: "gen-imp",
        chatId: "chat-nested",
        messageId: "msg-imp-1",
        generationType: "impersonate",
        content: "User persona speaks",
        finish_reason: "stop",
      },
      "user-a",
    );
    await flush();

    const chatNestedMeta = JSON.parse(
      mock.userStorageMaps.get("user-a")!.get("chats/chat-nested.json")!,
    ) as ChatMetaMap;
    expect(chatNestedMeta["msg-imp-1:0"]?.isUser).toBe(true);
    expect(chatNestedMeta["msg-imp-1:0"]?.macrosApplied).toBeUndefined();

    // Re-granting macro_interceptor restores capture
    mock.grantPermission("macro_interceptor");
    mock.emit(
      "GENERATION_STARTED",
      {
        generationId: "gen-regrant",
        chatId: "chat-nested",
        targetMessageId: "msg-ai-after",
        targetSwipeId: 0,
      },
      "user-a",
    );
    await mock.runMacroInterceptor({
      phase: "prompt",
      commit: true,
      template: "Captured {{user}} after re-grant",
      env: { chat: { id: "chat-nested" } },
    } as unknown as MacroInterceptorCtxDTO);
    mock.emit(
      "GENERATION_ENDED",
      {
        generationId: "gen-regrant",
        chatId: "chat-nested",
        messageId: "msg-ai-after",
        content: "AI reply",
        finish_reason: "stop",
      },
      "user-a",
    );
    await flush();

    const chatNestedMetaAfter = JSON.parse(
      mock.userStorageMaps.get("user-a")!.get("chats/chat-nested.json")!,
    ) as ChatMetaMap;
    expect(chatNestedMetaAfter["msg-ai-after:0"]?.macrosApplied).toEqual({
      count: 1,
      names: ["user"],
    });

    const store = new BackendStore(mock.api.storage, mock.api.userStorage);
    expect((await store.loadSettings("user-a")).fields.wordCount).toBe("inline");

    controller.dispose();
  });

  test("preserves GenerationBuffer past 10 minutes via 60m TTL and GENERATION_IN_PROGRESS activity updates", async () => {
    const mock = createMockSpindle();
    const controller = createBackend(mock.api);
    const origNow = Date.now;
    let fakeNow = 1_700_000_000_000;
    Date.now = () => fakeNow;

    try {
      mock.emit("GENERATION_STARTED", {
        generationId: "gen-long-1",
        chatId: "chat-1",
      });

      // +8m: lorebook activated
      fakeNow += 8 * 60_000;
      mock.emit("WORLD_INFO_ACTIVATED", {
        chatId: "chat-1",
        entries: [{ name: "Ancient Tome" }],
      });

      // +7m (15m total > old 10m TTL): GENERATION_IN_PROGRESS updates target & activity
      fakeNow += 7 * 60_000;
      mock.emit("GENERATION_IN_PROGRESS", {
        generationId: "gen-long-1",
        chatId: "chat-1",
        targetMessageId: "msg-long",
        targetSwipeId: 2,
      });

      // +7m (22m total): macro interceptor still sees buffer
      fakeNow += 7 * 60_000;
      await mock.runMacroInterceptor({
        phase: "prompt",
        commit: true,
        template: "Long prompt {{user}} and {{char}}",
        env: { chat: { id: "chat-1" } },
      } as unknown as MacroInterceptorCtxDTO);

      // +3m (25m total): GENERATION_ENDED omits swipeId & generationMetrics (Lumiverse host shape)
      fakeNow += 3 * 60_000;
      mock.emit("GENERATION_ENDED", {
        generationId: "gen-long-1",
        chatId: "chat-1",
        messageId: "msg-long",
        content: "A very thorough slow reply",
        finish_reason: "stop",
      });
      await flush();

      const stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
      expect(stored["msg-long:2"]).toEqual({
        isUser: false,
        durationMs: 25 * 60_000,
        finishReason: "stop",
        wordCount: 5,
        lorebookTriggers: { count: 1, entries: ["Ancient Tome"] },
        macrosApplied: { count: 2, names: ["user", "char"] },
      });

      // Authoritative GENERATION_METRICS_READY refines durationMs while keeping triggers/macros
      mock.emit("GENERATION_METRICS_READY", {
        generationId: "gen-long-1",
        chatId: "chat-1",
        messageId: "msg-long",
        swipeId: 2,
        generationMetrics: { durationMs: 1_501_234 },
      });
      await flush();

      const updated = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
      expect(updated["msg-long:2"]?.durationMs).toBe(1_501_234);
      expect(updated["msg-long:2"]?.lorebookTriggers).toEqual({
        count: 1,
        entries: ["Ancient Tome"],
      });
      expect(updated["msg-long:2"]?.macrosApplied).toEqual({
        count: 2,
        names: ["user", "char"],
      });

      const lastPush = mock.sentToFrontend
        .filter((e) => e.payload.type === "chat-meta-update" && e.payload.chatId === "chat-1")
        .at(-1)?.payload;
      if (lastPush?.type === "chat-meta-update") {
        expect(lastPush.messageStates?.["msg-long"]?.swipeId).toBe(2);
      }
    } finally {
      Date.now = origNow;
      controller.dispose();
    }
  });

  test("hydrateChat respects mutation epoch so concurrent CHAT_CHANGED cannot clobber live metadata or serve stale promises", async () => {
    const mock = createMockSpindle();
    let getCallCount = 0;
    let resolveFirstGet!: (rows: Array<Partial<ChatGetMessageDTO> & { id: string }>) => void;
    const firstGetPromise = new Promise<Array<Partial<ChatGetMessageDTO> & { id: string }>>(
      (resolve) => {
        resolveFirstGet = resolve;
      },
    );

    mock.api.chat.getMessages = async (chatId: string) => {
      getCallCount += 1;
      mock.getMessagesCalls.push(chatId);
      if (getCallCount === 1) {
        return firstGetPromise as Promise<ChatGetMessageDTO[]>;
      }
      return [
        {
          id: "msg-race",
          chat_id: chatId,
          index_in_chat: 0,
          is_user: false,
          name: "Assistant",
          content: "Final four word reply",
          send_date: 1700000000,
          swipe_id: 1,
          swipes: ["Initial swipe", "Final four word reply"],
          extra: {
            generationMetricsBySwipe: [null, { durationMs: 4200 }],
            generationOutcomeBySwipe: [null, { finishReason: "stop" }],
          },
          role: "assistant",
        },
      ];
    };

    const controller = createBackend(mock.api);

    mock.emit("GENERATION_STARTED", {
      generationId: "gen-race",
      chatId: "chat-1",
      targetMessageId: "msg-race",
      targetSwipeId: 1,
    });
    await mock.runMacroInterceptor({
      phase: "prompt",
      commit: true,
      template: "Prompt with {{char}}",
      env: { chat: { id: "chat-1" } },
    } as unknown as MacroInterceptorCtxDTO);

    // Mid-generation CHAT_CHANGED starts an in-flight hydrateChat against pre-metrics DB state
    mock.emit("CHAT_CHANGED", { chatId: "chat-1" });
    await flush();
    expect(getCallCount).toBe(1);

    // Generation finishes while first getMessages() is still suspended
    mock.emit("GENERATION_ENDED", {
      generationId: "gen-race",
      chatId: "chat-1",
      messageId: "msg-race",
      content: "Final four word reply",
      finish_reason: "stop",
    });
    await flush();

    mock.emit("GENERATION_METRICS_READY", {
      generationId: "gen-race",
      chatId: "chat-1",
      messageId: "msg-race",
      swipeId: 1,
      generationMetrics: { durationMs: 4200 },
    });
    await flush();

    // Frontend asks for get-chat-meta after GENERATION_METRICS_READY; must NOT coalesce onto stale flight #1
    const postMutationHydrate = mock.sendFromFrontend({
      type: "get-chat-meta",
      chatId: "chat-1",
    });

    // Resolve first stale getMessages snapshot (empty content, no generationMetrics)
    resolveFirstGet([
      {
        id: "msg-race",
        chat_id: "chat-1",
        index_in_chat: 0,
        is_user: false,
        name: "Assistant",
        content: "",
        send_date: 1700000000,
        swipe_id: 1,
        swipes: ["Initial swipe", ""],
        extra: {},
        role: "assistant",
      },
    ]);

    await postMutationHydrate;
    await flush();

    expect(getCallCount).toBeGreaterThanOrEqual(2);
    const stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-race:1"]?.durationMs).toBe(4200);
    expect(stored["msg-race:1"]?.wordCount).toBe(4);
    expect(stored["msg-race:1"]?.finishReason).toBe("stop");
    expect(stored["msg-race:1"]?.macrosApplied).toEqual({ count: 1, names: ["char"] });

    controller.dispose();
  });

  test("handles swipe GENERATION_ENDED without swipeId, fixes messageStates on GENERATION_METRICS_READY, and avoids false Edited badge on updateSwipe", async () => {
    const mock = createMockSpindle();
    const controller = createBackend(mock.api);

    // Host stages new swipe #2 via MESSAGE_SWIPED(action: "added") and starts generation without targetSwipeId
    mock.emit("GENERATION_STARTED", {
      generationId: "gen-swipe-2",
      chatId: "chat-1",
      targetMessageId: "msg-sw",
    });
    mock.emit("MESSAGE_SWIPED", {
      chatId: "chat-1",
      action: "added",
      swipeId: 2,
      message: {
        id: "msg-sw",
        is_user: false,
        swipe_id: 2,
        swipes: ["First swipe", "Second swipe", ""],
        content: "",
      },
    });
    await flush();

    // Host calls updateSwipe at end of generation -> MESSAGE_SWIPED(action: "updated")
    mock.emit("MESSAGE_SWIPED", {
      chatId: "chat-1",
      action: "updated",
      swipeId: 2,
      message: {
        id: "msg-sw",
        is_user: false,
        swipe_id: 2,
        swipes: ["First swipe", "Second swipe", "Third generated swipe"],
        content: "Third generated swipe",
      },
    });
    await flush();

    mock.emit("GENERATION_ENDED", {
      generationId: "gen-swipe-2",
      chatId: "chat-1",
      messageId: "msg-sw",
      content: "Third generated swipe",
      finish_reason: "stop",
    });
    await flush();

    let stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-sw:2"]?.edited).toBeUndefined();
    expect(stored["msg-sw:2"]?.finishReason).toBe("stop");
    expect(stored["msg-sw:2"]?.wordCount).toBe(3);

    // Separate scenario: buffer missing & GENERATION_ENDED fell back to swipe 0, then GENERATION_METRICS_READY delivers swipeId 3
    mock.emit("GENERATION_ENDED", {
      generationId: "gen-late-3",
      chatId: "chat-1",
      messageId: "msg-late",
      content: "Recovered late message",
      finish_reason: "stop",
    });
    await flush();

    mock.emit("GENERATION_METRICS_READY", {
      generationId: "gen-late-3",
      chatId: "chat-1",
      messageId: "msg-late",
      swipeId: 3,
      generationMetrics: { durationMs: 9100 },
    });
    await flush();

    stored = JSON.parse(mock.storageMap.get("chats/chat-1.json")!) as ChatMetaMap;
    expect(stored["msg-late:3"]?.durationMs).toBe(9100);
    const latestPush = mock.sentToFrontend
      .filter((e) => e.payload.type === "chat-meta-update" && e.payload.chatId === "chat-1")
      .at(-1)?.payload;
    if (latestPush?.type === "chat-meta-update") {
      expect(latestPush.messageStates?.["msg-late"]?.swipeId).toBe(3);
    }

    controller.dispose();
  });
});
