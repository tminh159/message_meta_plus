import type { ChatMessageDTO, SpindleFrontendContext } from "lumiverse-spindle-types";
import {
  BackendToFrontendMessage,
  ChatMetaMap,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  makeMetaKey,
  MessageMetaRecord,
  MessageStateSummary,
  PillPosition,
  sanitizeSettings,
} from "./shared/types.js";
import { isAbnormalFinishReason, PillView, resolvePillView } from "./shared/format.js";
import { MMP_STYLES } from "./frontend/styles.js";
import { createPortalTooltipController } from "./frontend/tooltip.js";
import { createSettingsDrawer } from "./frontend/settings-drawer.js";

interface CachedMessageInfo {
  swipeId?: number;
  isUser?: boolean;
  content?: string;
}

interface InjectedPillEntry {
  wrapper: Element;
  mountEl: Element;
  signature: string;
  abortController: AbortController;
}

type MessageVariant = "bubble" | "minimal";

interface PillLayoutMeta {
  position: PillPosition;
  variant: MessageVariant;
  rowReverse: boolean;
  isUser: boolean;
}

const MESSAGE_HEADER_SELECTOR = '[data-spindle-mount="message_header"]';
const MESSAGE_BODY_BEFORE_SELECTOR = '[data-spindle-mount="message_body_before"]';
const MESSAGE_FOOTER_SELECTOR = '[data-spindle-mount="message_footer"]';
const ANY_MESSAGE_MOUNT_SELECTOR = `${MESSAGE_HEADER_SELECTOR}, ${MESSAGE_BODY_BEFORE_SELECTOR}, ${MESSAGE_FOOTER_SELECTOR}`;
const CHAT_CONTAINER_SELECTOR = '[data-chat-scroll="true"]';
const STREAMING_TEXT_TAGS = new Set([
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
  "H6",
]);

const REFRESH_EVENTS = [
  "MESSAGE_SENT",
  "MESSAGE_EDITED",
  "MESSAGE_SWIPED",
  "SWIPE_EDITED",
  "CHAT_SWITCHED",
  "CHAT_CHANGED",
  "MESSAGE_DELETED",
  "GENERATION_ENDED",
  "GENERATION_STOPPED",
  "GENERATION_METRICS_READY",
  "CHARACTER_MESSAGE_RENDERED",
  "USER_MESSAGE_RENDERED",
] as const;

let activeTeardown: (() => void) | null = null;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getMountSelectorForPosition(position: PillPosition): string {
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

function detectMessageVariant(mountEl: Element, bubbleEl: Element): MessageVariant {
  const scope = mountEl.getAttribute("data-spindle-scope") ?? "";
  if (scope.includes(":minimal:")) return "minimal";
  if (scope.includes(":bubble:")) return "bubble";
  if (bubbleEl.querySelector('[data-spindle-scope*=":minimal:"]')) return "minimal";
  return "bubble";
}

function detectHeaderRowReverse(
  mountEl: Element,
  bubbleEl: Element,
  variant: MessageVariant,
  isUser: boolean,
): boolean {
  const headerSlot = bubbleEl.querySelector(MESSAGE_HEADER_SELECTOR) ?? mountEl;
  const headerEl = headerSlot.parentElement;
  if (headerEl && typeof getComputedStyle === "function") {
    try {
      const flexDirection = getComputedStyle(headerEl).flexDirection;
      if (flexDirection === "row-reverse") return true;
      if (flexDirection === "row") return false;
    } catch {
      // Ignore in minimal DOM environments
    }
  }
  if (variant !== "bubble") return false;
  const cls = typeof bubbleEl.className === "string" ? bubbleEl.className : "";
  if (cls.includes("userLeft") || bubbleEl.getAttribute("data-user-align") === "left") {
    return false;
  }
  return isUser && (cls.includes("user") || bubbleEl.getAttribute("data-is-user") === "true");
}

function computePillSignature(
  view: PillView,
  messageId: string,
  swipeId: number,
  layout: PillLayoutMeta,
): string {
  return JSON.stringify({
    messageId,
    swipeId,
    position: layout.position,
    variant: layout.variant,
    rowReverse: layout.rowReverse,
    isUser: layout.isUser,
    mode: view.mode,
    inlineSegments: view.inlineSegments,
    tooltipRows: view.tooltipRows,
  });
}

function buildPillHtml(
  view: PillView,
  messageId: string,
  swipeId: number,
  layout: PillLayoutMeta,
): string {
  const safeId = escapeHtml(messageId);
  const safeSwipe = String(swipeId);
  const layoutClasses = [
    `mmp-pill--pos-${layout.position}`,
    `mmp-pill--${layout.variant}`,
    ...(layout.isUser ? ["mmp-pill--user"] : []),
    ...(layout.rowReverse ? ["mmp-pill--row-reverse"] : []),
  ].join(" ");
  const dataAttrs = `data-mmp-pill="1" data-mmp-msg-id="${safeId}" data-mmp-swipe-id="${safeSwipe}" data-mmp-pos="${layout.position}" data-mmp-variant="${layout.variant}"`;

  if (view.mode === "circle") {
    return `<button type="button" class="mmp-pill mmp-pill--circle ${layoutClasses}" ${dataAttrs} aria-expanded="false" aria-label="Message metadata (hover or tap for details)"><span class="mmp-pill-bang">!</span></button>`;
  }

  const parts = view.inlineSegments
    .map((seg, idx) => {
      const dot = idx > 0 ? `<span class="mmp-dot" aria-hidden="true">·</span>` : "";
      const isAbnormal = seg.key === "finishReason" && isAbnormalFinishReason(seg.text);
      const segClass = isAbnormal ? "mmp-segment mmp-segment--abnormal" : "mmp-segment";
      return `${dot}<span class="${segClass}">${escapeHtml(seg.text)}</span>`;
    })
    .join("");

  return `<button type="button" class="mmp-pill ${layoutClasses}" ${dataAttrs} aria-expanded="false" aria-label="Message metadata details">${parts}</button>`;
}

function applyWrapperClasses(wrapper: Element, layout: PillLayoutMeta): void {
  if (!wrapper.classList) return;
  wrapper.classList.add(
    "mmp-inj-wrap",
    `mmp-inj-wrap--${layout.position}`,
    `mmp-inj-wrap--${layout.variant}`,
  );
  if (layout.isUser) {
    wrapper.classList.add("mmp-inj-wrap--user");
  }
  if (layout.rowReverse) {
    wrapper.classList.add("mmp-inj-wrap--row-reverse");
  }
}

function findMountElement(bubbleEl: Element, selector: string): Element | null {
  if (bubbleEl.matches(selector)) {
    return bubbleEl;
  }
  return bubbleEl.querySelector(selector);
}

function resolveInnerCardElement(element: Element): Element {
  if (element.hasAttribute("data-part") || element.hasAttribute("data-component")) {
    return element;
  }
  const inner = element.querySelector?.("[data-message-id][data-part], [data-message-id][data-component]");
  return inner ?? element;
}

function selectPreferredBubbleElements(
  mounted: ReadonlyArray<{ messageId: string; element: Element }>,
  mountSelector: string,
): Map<string, Element> {
  const byId = new Map<string, Element>();
  for (const { messageId, element } of mounted) {
    const existing = byId.get(messageId);
    if (!existing) {
      byId.set(messageId, element);
      continue;
    }
    const existingIsInner =
      existing.hasAttribute("data-part") || existing.hasAttribute("data-component");
    const candidateIsInner =
      element.hasAttribute("data-part") || element.hasAttribute("data-component");
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

function findChatObserveRoot(): Element | null {
  if (typeof document === "undefined") return null;
  const streamBeforeParent =
    document.querySelector('[data-spindle-mount="chat_stream_before"]')?.parentElement ?? null;
  if (streamBeforeParent) return streamBeforeParent;
  const chatScroll = document.querySelector(CHAT_CONTAINER_SELECTOR);
  if (chatScroll) return chatScroll;
  return null;
}

function nodeContainsMessageMount(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  if (
    el.classList.contains("mmp-inj-wrap") ||
    el.hasAttribute("data-mmp-pill") ||
    el.classList.contains("mmp-tooltip")
  ) {
    return false;
  }
  if (el.matches(ANY_MESSAGE_MOUNT_SELECTOR) || el.hasAttribute("data-message-id")) {
    return true;
  }
  // Fast-skip inline/markdown streaming nodes inside an already-mounted message bubble
  if (
    STREAMING_TEXT_TAGS.has(el.tagName) &&
    !el.hasAttribute("data-spindle-mount") &&
    el.closest?.("[data-message-id]")
  ) {
    return false;
  }
  return Boolean(el.querySelector(ANY_MESSAGE_MOUNT_SELECTOR) || el.querySelector("[data-message-id]"));
}

export function setup(ctx: SpindleFrontendContext): () => void {
  if (activeTeardown) {
    try {
      activeTeardown();
    } catch {
      // Ignore cleanup errors from a prior load
    }
    activeTeardown = null;
  }

  let destroyed = false;
  let settings: ExtensionSettings = sanitizeSettings(DEFAULT_SETTINGS);
  let activeChatId: string | null = ctx.getActiveChat?.().chatId ?? null;
  const metaByChatId = new Map<string, ChatMetaMap>();
  const messageStatesByChatId = new Map<string, Record<string, MessageStateSummary>>();
  const messageInfoCache = new Map<string, CachedMessageInfo>();
  const injectedByMessageId = new Map<string, InjectedPillEntry>();

  const removeStyle = ctx.dom.addStyle(MMP_STYLES);
  const tooltip = createPortalTooltipController(ctx);
  const drawer = createSettingsDrawer(ctx, settings, tooltip, (next) => {
    settings = next;
    renderAllMountedMessages();
  });

  const getCurrentMetaMap = (): ChatMetaMap => {
    if (!activeChatId) return {};
    return metaByChatId.get(activeChatId) ?? {};
  };

  const getCurrentMessageStates = (): Record<string, MessageStateSummary> => {
    if (!activeChatId) return {};
    return messageStatesByChatId.get(activeChatId) ?? {};
  };

  const cacheMessageDto = (msg: Partial<ChatMessageDTO> & { id?: string }): void => {
    if (!msg || typeof msg.id !== "string" || !msg.id) return;
    const prev = messageInfoCache.get(msg.id);
    const swipeId =
      typeof msg.swipe_id === "number" && Number.isFinite(msg.swipe_id) && msg.swipe_id >= 0
        ? Math.floor(msg.swipe_id)
        : prev?.swipeId;
    const isUser = typeof msg.is_user === "boolean" ? msg.is_user : prev?.isUser;
    const content = typeof msg.content === "string" ? msg.content : prev?.content;
    messageInfoCache.set(msg.id, { swipeId, isUser, content });
  };

  const syncRecentMessagesIntoCache = (): void => {
    try {
      const recent = (ctx.messages as { getRecent?: (limit: number) => ChatMessageDTO[] })?.getRecent?.(200);
      if (Array.isArray(recent)) {
        for (const msg of recent) cacheMessageDto(msg);
      }
    } catch {
      // Ignore if unavailable or permission-gated
    }
  };

  const hydrateMessageCacheFromHost = async (chatId: string | null): Promise<void> => {
    if (destroyed) return;
    syncRecentMessagesIntoCache();

    if (!chatId) return;
    try {
      const getMessages = (
        ctx.chats as {
          getMessages?: (
            id: string,
            opts?: { limit?: number; tail?: boolean },
          ) => Promise<{ data?: ChatMessageDTO[] }>;
        }
      )?.getMessages;
      if (typeof getMessages === "function") {
        const page = await getMessages(chatId, { limit: 200, tail: true });
        if (destroyed) return;
        if (Array.isArray(page?.data)) {
          for (const msg of page.data) cacheMessageDto(msg);
          renderAllMountedMessages();
        }
      }
    } catch {
      // Optional enrichment only; backend meta records and messageStates still drive rendering
    }
  };

  const resolveMessageInputs = (
    messageId: string,
    bubbleEl: Element,
    metaMap: ChatMetaMap,
    messageStates: Record<string, MessageStateSummary>,
  ): { swipeId: number; record: MessageMetaRecord | undefined; isUser: boolean; content?: string } => {
    const cached = messageInfoCache.get(messageId);
    const backendState = messageStates[messageId];

    const domSwipeRaw = bubbleEl.getAttribute("data-swipe-id");
    const domSwipe =
      domSwipeRaw !== null && Number.isFinite(Number(domSwipeRaw)) && Number(domSwipeRaw) >= 0
        ? Math.floor(Number(domSwipeRaw))
        : undefined;

    let swipeId = cached?.swipeId ?? backendState?.swipeId ?? domSwipe ?? 0;
    let record = metaMap[makeMetaKey(messageId, swipeId)];

    // If chosen swipeId has no record yet (e.g. cached DTO pre-dates swipe/metrics),
    // prefer the backend state or DOM swipe slot when it holds a record.
    if (!record && backendState !== undefined) {
      const backendRecord = metaMap[makeMetaKey(messageId, backendState.swipeId)];
      if (backendRecord) {
        swipeId = backendState.swipeId;
        record = backendRecord;
      }
    }
    if (!record && domSwipe !== undefined) {
      const domRecord = metaMap[makeMetaKey(messageId, domSwipe)];
      if (domRecord) {
        swipeId = domSwipe;
        record = domRecord;
      }
    }

    // If swipeId wasn't explicitly known and default :0 has no record, check for a matching key
    if (!record && cached?.swipeId === undefined && backendState === undefined && domSwipe === undefined) {
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

    const domDataPart =
      bubbleEl.getAttribute("data-part") ??
      bubbleEl.querySelector?.("[data-part]")?.getAttribute("data-part") ??
      null;
    const domIsUserFromPart =
      domDataPart === "user"
        ? true
        : domDataPart === "character" || domDataPart === "streaming"
          ? false
          : undefined;
    const domIsUserAttr = bubbleEl.getAttribute("data-is-user");
    const domIsUser =
      domIsUserFromPart ?? (domIsUserAttr !== null ? domIsUserAttr === "true" : undefined);

    const isUser =
      cached?.isUser ??
      backendState?.isUser ??
      record?.isUser ??
      domIsUser ??
      false;

    let content = cached?.content;
    if (content === undefined) {
      try {
        const getContent = (ctx.messages as { getContent?: (id: string) => string | null })?.getContent;
        const hostContent = typeof getContent === "function" ? getContent(messageId) : null;
        if (typeof hostContent === "string") content = hostContent;
      } catch {
        // Ignore
      }
    }

    return { swipeId, record, isUser, content };
  };

  const cleanupEntry = (entry: InjectedPillEntry): void => {
    entry.abortController.abort();
    try {
      ctx.dom.uninject(entry.wrapper);
    } catch {
      entry.wrapper.remove();
    }
  };

  const removeOrphanPillsInMount = (mountEl: Element, keepWrapper?: Element): void => {
    const existingPills = mountEl.querySelectorAll("[data-mmp-pill]");
    for (const pill of existingPills) {
      const wrapper = pill.parentElement;
      if (wrapper && wrapper === keepWrapper) continue;
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

  const renderMessageBubble = (messageId: string, rawBubbleEl: Element): void => {
    if (destroyed) return;
    const bubbleEl = resolveInnerCardElement(rawBubbleEl);
    const mountSelector = getMountSelectorForPosition(settings.position);
    const mountEl = findMountElement(bubbleEl, mountSelector);
    if (!mountEl) return;

    const metaMap = getCurrentMetaMap();
    const messageStates = getCurrentMessageStates();
    const { swipeId, record, isUser, content } = resolveMessageInputs(
      messageId,
      bubbleEl,
      metaMap,
      messageStates,
    );
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
    const layout: PillLayoutMeta = {
      position: settings.position,
      variant,
      rowReverse,
      isUser,
    };

    const signature = computePillSignature(view, messageId, swipeId, layout);
    if (
      existing &&
      existing.wrapper.isConnected &&
      mountEl.contains(existing.wrapper) &&
      existing.signature === signature
    ) {
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

    const abortController = new AbortController();
    const pillEl = wrapper.querySelector("[data-mmp-pill]") as HTMLElement | null;
    if (pillEl) {
      tooltip.attach(pillEl, view.tooltipRows, abortController.signal);
    }

    injectedByMessageId.set(messageId, {
      wrapper,
      mountEl,
      signature,
      abortController,
    });
  };

  function renderAllMountedMessages(): void {
    if (destroyed) return;
    syncRecentMessagesIntoCache();
    const mountSelector = getMountSelectorForPosition(settings.position);
    const preferredById = selectPreferredBubbleElements(
      ctx.dom.listMessageElements(),
      mountSelector,
    );
    for (const [messageId, element] of preferredById) {
      renderMessageBubble(messageId, element);
    }
  }

  let scheduledScanRaf: number | null = null;
  let scheduledScanTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleScan = (): void => {
    if (destroyed) return;
    if (typeof requestAnimationFrame === "function") {
      if (scheduledScanRaf !== null) return;
      scheduledScanRaf = requestAnimationFrame(() => {
        scheduledScanRaf = null;
        renderAllMountedMessages();
      });
    } else {
      if (scheduledScanTimer !== null) return;
      scheduledScanTimer = setTimeout(() => {
        scheduledScanTimer = null;
        renderAllMountedMessages();
      }, 0);
    }
  };

  let observer: MutationObserver | null = null;
  let currentObserveRoot: Element | null = null;

  const ensureObserverBound = (): void => {
    if (destroyed || typeof MutationObserver === "undefined" || typeof document === "undefined") {
      return;
    }
    const targetRoot = findChatObserveRoot() ?? document.body;
    if (!targetRoot) return;
    if (observer && currentObserveRoot === targetRoot) return;

    if (observer) {
      try {
        observer.disconnect();
      } catch {
        // Ignore
      }
    } else {
      observer = new MutationObserver((mutations) => {
        if (destroyed) return;
        let shouldScan = false;
        for (const mutation of mutations) {
          if (mutation.type === "attributes") {
            const target = mutation.target as Element | null;
            if (
              target &&
              target.nodeType === 1 &&
              (target.hasAttribute("data-message-id") || target.closest?.("[data-message-id]"))
            ) {
              shouldScan = true;
              break;
            }
            continue;
          }
          for (const added of mutation.addedNodes) {
            if (nodeContainsMessageMount(added)) {
              shouldScan = true;
              break;
            }
          }
          if (shouldScan) break;
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
    observer.observe(targetRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-part", "data-message-id"],
    });
  };

  const handleEventPayload = (eventName: string, payload: unknown): void => {
    if (destroyed) return;
    const data = isRecord(payload) ? payload : {};

    if (eventName === "CHAT_SWITCHED") {
      const nextChatId =
        typeof data.chatId === "string"
          ? data.chatId
          : ctx.getActiveChat?.().chatId ?? null;
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
          void hydrateMessageCacheFromHost(activeChatId);
        }
      }
      ensureObserverBound();
      scheduleScan();
      return;
    }

    if (eventName === "CHAT_CHANGED") {
      const chatObj = isRecord(data.chat) ? data.chat : null;
      const nextChatId =
        typeof chatObj?.id === "string"
          ? chatObj.id
          : typeof data.chatId === "string"
            ? data.chatId
            : ctx.getActiveChat?.().chatId ?? activeChatId;
      if (nextChatId && nextChatId !== activeChatId) {
        activeChatId = nextChatId;
        tooltip.hide();
        messageInfoCache.clear();
        ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
        void hydrateMessageCacheFromHost(activeChatId);
      }
      ensureObserverBound();
      scheduleScan();
      return;
    }

    if (eventName === "MESSAGE_DELETED") {
      const deletedId =
        typeof data.messageId === "string"
          ? data.messageId
          : isRecord(data.message) && typeof data.message.id === "string"
            ? data.message.id
            : null;
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

    const isGenerationTerminalEvent =
      eventName === "GENERATION_ENDED" ||
      eventName === "GENERATION_STOPPED" ||
      eventName === "GENERATION_METRICS_READY";

    if (isGenerationTerminalEvent) {
      syncRecentMessagesIntoCache();
    }

    if (isRecord(data.message)) {
      cacheMessageDto(data.message as Partial<ChatMessageDTO> & { id?: string });
    } else if (typeof data.messageId === "string") {
      cacheMessageDto({
        id: data.messageId,
        swipe_id: typeof data.swipeId === "number" ? data.swipeId : undefined,
        is_user: typeof data.isUser === "boolean" ? data.isUser : undefined,
        content: typeof data.content === "string" ? data.content : undefined,
      });
    }

    const targetMessageId =
      isRecord(data.message) && typeof data.message.id === "string"
        ? data.message.id
        : typeof data.messageId === "string"
          ? data.messageId
          : null;

    if (isGenerationTerminalEvent) {
      const reqChatId =
        typeof data.chatId === "string" && data.chatId.length > 0
          ? data.chatId
          : activeChatId;
      if (reqChatId) {
        ctx.sendToBackend({ type: "get-chat-meta", chatId: reqChatId });
        if (targetMessageId && messageInfoCache.get(targetMessageId)?.content === undefined) {
          void hydrateMessageCacheFromHost(reqChatId);
        }
      }
    }

    if (targetMessageId) {
      const bubbleEl = ctx.dom.findMessageElement(targetMessageId);
      if (bubbleEl) {
        renderMessageBubble(targetMessageId, bubbleEl);
        if (!isGenerationTerminalEvent) {
          return;
        }
      }
    }

    scheduleScan();
  };

  // Subscribe to backend messages
  const unsubBackend = ctx.onBackendMessage((rawPayload: unknown) => {
    if (destroyed || !isRecord(rawPayload)) return;
    const msg = rawPayload as unknown as BackendToFrontendMessage;

    if (msg.type === "state-update") {
      settings = sanitizeSettings(msg.settings);
      drawer.setSettings(settings);
      const nextChatId = msg.activeChatId ?? ctx.getActiveChat?.().chatId ?? activeChatId;
      activeChatId = nextChatId;
      if (activeChatId && isRecord(msg.meta)) {
        metaByChatId.set(activeChatId, msg.meta as ChatMetaMap);
      }
      if (activeChatId && isRecord(msg.messageStates)) {
        messageStatesByChatId.set(
          activeChatId,
          msg.messageStates as Record<string, MessageStateSummary>,
        );
      }
      ensureObserverBound();
      renderAllMountedMessages();
      return;
    }

    if (msg.type === "chat-meta-update" && typeof msg.chatId === "string") {
      if (isRecord(msg.meta)) {
        metaByChatId.set(msg.chatId, msg.meta as ChatMetaMap);
      }
      if (isRecord(msg.messageStates)) {
        messageStatesByChatId.set(
          msg.chatId,
          msg.messageStates as Record<string, MessageStateSummary>,
        );
      }
      if (!activeChatId) {
        activeChatId = ctx.getActiveChat?.().chatId ?? msg.chatId;
      }
      if (msg.chatId === activeChatId) {
        renderAllMountedMessages();
      }
    }
  });

  // Subscribe to host events (support both standard ctx.events.on and optional ctx.on)
  const unsubscribers: Array<() => void> = [unsubBackend];
  const subscribeEvent = (eventName: string, handler: (payload: unknown) => void): (() => void) | null => {
    if (ctx.events && typeof ctx.events.on === "function") {
      return ctx.events.on(eventName, handler);
    }
    const legacyOn = (ctx as unknown as { on?: (ev: string, cb: (p: unknown) => void) => () => void }).on;
    if (typeof legacyOn === "function") {
      return legacyOn(eventName, handler);
    }
    return null;
  };

  for (const eventName of REFRESH_EVENTS) {
    const unsub = subscribeEvent(eventName, (payload) => handleEventPayload(eventName, payload));
    if (unsub) unsubscribers.push(unsub);
  }

  let lastObservedMessageCount: number | null = null;

  const syncActiveChatOnResume = (): void => {
    if (destroyed) return;
    const currentChatId = ctx.getActiveChat?.().chatId ?? activeChatId;
    if (currentChatId && currentChatId !== activeChatId) {
      lastObservedMessageCount = null;
      handleEventPayload("CHAT_SWITCHED", { chatId: currentChatId });
      return;
    }
    if (!activeChatId) return;
    ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
    void hydrateMessageCacheFromHost(activeChatId);
    ensureObserverBound();
    scheduleScan();
  };

  const unsubConnected = subscribeEvent("CONNECTED", (payload) => {
    if (destroyed) return;
    const data = isRecord(payload) ? payload : null;
    if (data && "role" in data && !data.role) return;
    ctx.sendToBackend({ type: "get-state" });
    syncActiveChatOnResume();
  });
  if (unsubConnected) unsubscribers.push(unsubConnected);

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        syncActiveChatOnResume();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    unsubscribers.push(() => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const onWindowFocus = (): void => {
      syncActiveChatOnResume();
    };
    window.addEventListener("focus", onWindowFocus);
    unsubscribers.push(() => {
      window.removeEventListener("focus", onWindowFocus);
    });
  }

  // Subscribe to active chat & message count selectors if host provides ctx.state
  try {
    if (ctx.state && typeof ctx.state.subscribe === "function") {
      const unsubChatState = ctx.state.subscribe<{ chatId?: string | null }>("chat.active", (val) => {
        const nextId = val?.chatId ?? null;
        if (nextId !== activeChatId) {
          lastObservedMessageCount = null;
          handleEventPayload("CHAT_SWITCHED", { chatId: nextId });
        }
      });
      unsubscribers.push(unsubChatState);

      const unsubCountState = ctx.state.subscribe<{ count?: number } | number>(
        "chat.messageCount",
        (val) => {
          const count =
            typeof val === "number"
              ? val
              : isRecord(val) && typeof val.count === "number"
                ? val.count
                : null;
          if (count === null) return;
          const prev = lastObservedMessageCount;
          lastObservedMessageCount = count;
          if (prev !== null && count !== prev && activeChatId) {
            ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
            void hydrateMessageCacheFromHost(activeChatId);
            scheduleScan();
          }
        },
      );
      unsubscribers.push(unsubCountState);
    }
  } catch {
    // Optional host selector
  }

  // Observe late-arriving message elements (re-binds to chat scroll container once mounted)
  ensureObserverBound();

  // Initial sync
  ctx.sendToBackend({ type: "get-state" });
  if (activeChatId) {
    ctx.sendToBackend({ type: "get-chat-meta", chatId: activeChatId });
    void hydrateMessageCacheFromHost(activeChatId);
  }
  renderAllMountedMessages();

  const cleanup = (): void => {
    if (destroyed) return;
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
      } catch {
        // Ignore
      }
      observer = null;
    }
    currentObserveRoot = null;

    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore
      }
    }
    unsubscribers.length = 0;

    for (const entry of injectedByMessageId.values()) {
      cleanupEntry(entry);
    }
    injectedByMessageId.clear();

    try {
      tooltip.destroy();
    } catch {
      // Ignore
    }

    try {
      drawer.destroy();
    } catch {
      // Ignore
    }

    try {
      ctx.dom.cleanup();
    } catch {
      // Ignore
    }

    try {
      removeStyle();
    } catch {
      // Ignore
    }

    if (activeTeardown === cleanup) {
      activeTeardown = null;
    }
  };

  activeTeardown = cleanup;
  return cleanup;
}

export function teardown(): void {
  if (activeTeardown) {
    activeTeardown();
    activeTeardown = null;
  }
}
