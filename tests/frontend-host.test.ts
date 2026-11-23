import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { ChatMessageDTO, SpindleFrontendContext } from "lumiverse-spindle-types";
import { setup, teardown } from "../src/frontend.js";
import { MMP_STYLES } from "../src/frontend/styles.js";
import {
  type BackendToFrontendMessage,
  type ChatMetaMap,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type FrontendToBackendMessage,
} from "../src/shared/types.js";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

const origWindow = globalThis.window;
const origDocument = globalThis.document;
const origNode = globalThis.Node;
const origElement = globalThis.Element;
const origHTMLElement = globalThis.HTMLElement;
const origMutationObserver = globalThis.MutationObserver;
const origAbortController = globalThis.AbortController;
const origAbortSignal = globalThis.AbortSignal;
const origGetComputedStyle = globalThis.getComputedStyle;
const origRAF = globalThis.requestAnimationFrame;
const origCAF = globalThis.cancelAnimationFrame;

let activeHost: MockFrontendHost | undefined;

afterEach(() => {
  activeHost?.destroy();
  activeHost = undefined;
  teardown();
  globalThis.window = origWindow;
  globalThis.document = origDocument;
  globalThis.Node = origNode;
  globalThis.Element = origElement;
  globalThis.HTMLElement = origHTMLElement;
  globalThis.MutationObserver = origMutationObserver;
  globalThis.AbortController = origAbortController;
  globalThis.AbortSignal = origAbortSignal;
  globalThis.getComputedStyle = origGetComputedStyle;
  globalThis.requestAnimationFrame = origRAF;
  globalThis.cancelAnimationFrame = origCAF;
});

interface MockHostOptions {
  chatId?: string | null;
  useLegacyOn?: boolean;
  coldStart?: boolean;
}

class MockFrontendHost {
  readonly dom: JSDOM;
  readonly doc: Document;
  readonly chatContainer: HTMLElement;
  readonly drawerRoot: HTMLElement;
  readonly sentToBackend: FrontendToBackendMessage[] = [];
  readonly styleNodes: HTMLStyleElement[] = [];
  readonly eventListeners = new Map<string, Set<(payload?: unknown) => void>>();
  readonly stateListeners = new Map<string, Set<(val: unknown) => void>>();
  backendListener: ((payload: unknown) => void) | null = null;
  activeChatId: string | null;
  messages: Array<Partial<ChatMessageDTO> & { id: string }> = [];
  injectCount = 0;
  uninjectCount = 0;
  cleanupCalls = 0;
  drawerDestroyCalls = 0;
  uuidCounter = 0;
  private injCounter = 0;
  private injectedEls = new Set<Element>();
  private cleanupFn?: () => void;

  constructor(options: MockHostOptions = {}) {
    this.activeChatId = options.chatId === undefined ? "chat-1" : options.chatId;
    this.dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
      url: "https://lumiverse.local/",
    });
    const win = this.dom.window as unknown as Window & typeof globalThis;
    this.doc = win.document;

    globalThis.window = win;
    globalThis.document = this.doc;
    globalThis.Node = win.Node;
    globalThis.Element = win.Element;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.MutationObserver = win.MutationObserver;
    globalThis.AbortController = win.AbortController;
    globalThis.AbortSignal = win.AbortSignal;
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

    // Ensure non-zero bounding boxes for viewport clamping tests
    Object.defineProperty(win, "innerWidth", { value: 1024, configurable: true });
    Object.defineProperty(win, "innerHeight", { value: 768, configurable: true });

    this.chatContainer = this.doc.createElement("div");
    this.chatContainer.className = "chatColumn";
    this.chatContainer.setAttribute("data-chat-scroll", "true");
    if (!options.coldStart) {
      const streamMarker = this.doc.createElement("div");
      streamMarker.setAttribute("data-spindle-mount", "chat_stream_before");
      this.chatContainer.appendChild(streamMarker);
    }
    this.drawerRoot = this.doc.createElement("div");
    this.doc.body.append(this.drawerRoot);
    if (!options.coldStart) {
      this.doc.body.append(this.chatContainer);
    }

    const self = this;

    const eventsApi = {
      on(eventName: string, handler: (payload?: unknown) => void) {
        let set = self.eventListeners.get(eventName);
        if (!set) {
          set = new Set();
          self.eventListeners.set(eventName, set);
        }
        set.add(handler);
        return () => {
          set?.delete(handler);
        };
      },
    };

    const ctxObj: Record<string, unknown> = {
      host: {
        capabilities: {
          "frontend-uuid-v1": 1,
        },
      },
      uuid: {
        v4: () => `uuid-v4-${++self.uuidCounter}`,
        v7: () => `uuid-v7-${++self.uuidCounter}`,
      },
      getActiveChat: () => ({ chatId: self.activeChatId, characterId: "char-1" }),
      sendToBackend: (msg: FrontendToBackendMessage) => {
        self.sentToBackend.push(msg);
      },
      onBackendMessage: (handler: (payload: unknown) => void) => {
        self.backendListener = handler;
        return () => {
          if (self.backendListener === handler) self.backendListener = null;
        };
      },
      state: {
        subscribe: (selector: string, cb: (val: unknown) => void) => {
          let set = self.stateListeners.get(selector);
          if (!set) {
            set = new Set();
            self.stateListeners.set(selector, set);
          }
          set.add(cb);
          return () => {
            set?.delete(cb);
          };
        },
      },
      messages: {
        getRecent: () => self.messages,
        getContent: (id: string) => self.messages.find((m) => m.id === id)?.content ?? null,
      },
      dom: {
        addStyle(css: string) {
          const style = self.doc.createElement("style");
          style.textContent = css;
          self.doc.head.appendChild(style);
          self.styleNodes.push(style);
          return () => {
            style.remove();
            const idx = self.styleNodes.indexOf(style);
            if (idx >= 0) self.styleNodes.splice(idx, 1);
          };
        },
        createElement(tag: string, attrs?: Record<string, string>) {
          const el = self.doc.createElement(tag);
          if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
              el.setAttribute(k, v);
            }
          }
          return el;
        },
        listMessageElements() {
          const out: Array<{ messageId: string; element: Element }> = [];
          const nodes = self.doc.querySelectorAll("[data-message-id]");
          for (const el of nodes) {
            const id = el.getAttribute("data-message-id");
            if (id) out.push({ messageId: id, element: el });
          }
          return out;
        },
        findMessageElement(messageId: string) {
          return self.doc.querySelector(`[data-message-id="${messageId}"]`);
        },
        inject(target: string | Element, html: string, position: InsertPosition = "beforeend") {
          const el = typeof target === "string" ? self.doc.querySelector(target)! : target;
          const wrapper = self.doc.createElement("div");
          wrapper.setAttribute("data-spindle-inj-id", `inj-${++self.injCounter}`);
          wrapper.setAttribute("data-spindle-injected", "true");
          wrapper.innerHTML = html;
          el.insertAdjacentElement(position, wrapper);
          self.injectedEls.add(wrapper);
          self.injectCount += 1;
          return wrapper;
        },
        uninject(el: Element) {
          if (self.injectedEls.delete(el)) {
            self.uninjectCount += 1;
          }
          el.remove();
        },
        cleanup() {
          self.cleanupCalls += 1;
          for (const el of self.injectedEls) {
            el.remove();
          }
          self.injectedEls.clear();
        },
      },
      ui: {
        registerDrawerTab() {
          return {
            root: self.drawerRoot,
            tabId: "message_meta_plus:tab:settings",
            setTitle() {},
            setShortName() {},
            setBadge() {},
            activate() {},
            onActivate() {
              return () => {};
            },
            destroy() {
              self.drawerDestroyCalls += 1;
              self.drawerRoot.replaceChildren();
            },
          };
        },
      },
    };

    if (options.useLegacyOn) {
      ctxObj.on = eventsApi.on;
    } else {
      ctxObj.events = eventsApi;
    }

    this.ctx = ctxObj as unknown as SpindleFrontendContext;
  }

  readonly ctx: SpindleFrontendContext;

  mount(): void {
    this.cleanupFn = setup(this.ctx);
  }

  /**
   * Mirrors real Lumiverse DOM: an outer virtualizer row carrying `data-message-id`
   * wrapping the inner BubbleMessage/MinimalMessage card which ALSO carries
   * `data-message-id`, `data-component`, and `data-part="user"|"character"`
   * (without fake `data-swipe-id` or `data-is-user` attributes).
   */
  mountMessageDom(opts: {
    id: string;
    layout: "bubble" | "minimal";
    isUser?: boolean;
    nativePillText?: string;
    rowReverse?: boolean;
  }): HTMLElement {
    const scopePrefix = opts.layout === "minimal" ? "message:" + opts.id + ":minimal:" : "message:" + opts.id + ":bubble:";
    const virtualRow = this.doc.createElement("div");
    virtualRow.className = "virtualRow";
    virtualRow.setAttribute("data-message-id", opts.id);

    if (opts.layout === "minimal") {
      const card = this.doc.createElement("div");
      card.className = "minimal-message";
      card.setAttribute("data-component", "MinimalMessage");
      card.setAttribute("data-part", opts.isUser ? "user" : "character");
      card.setAttribute("data-message-id", opts.id);

      const header = this.doc.createElement("div");
      header.className = "minimal-header";
      header.style.display = "flex";
      header.style.flexDirection = "row";

      const nativePill = this.doc.createElement("span");
      nativePill.className = "native-meta-pill";
      nativePill.textContent = opts.nativePillText ?? "gpt-4o · 120t";

      const headerMount = this.doc.createElement("span");
      headerMount.setAttribute("data-spindle-mount", "message_header");
      headerMount.setAttribute("data-spindle-scope", `${scopePrefix}header`);
      headerMount.style.display = "contents";
      header.append(nativePill, headerMount);

      const bodyBeforeMount = this.doc.createElement("div");
      bodyBeforeMount.setAttribute("data-spindle-mount", "message_body_before");
      bodyBeforeMount.setAttribute("data-spindle-scope", `${scopePrefix}body-before`);

      const body = this.doc.createElement("div");
      body.className = "minimal-body";
      body.textContent = "Message text";

      const footerMount = this.doc.createElement("div");
      footerMount.setAttribute("data-spindle-mount", "message_footer");
      footerMount.setAttribute("data-spindle-scope", `${scopePrefix}footer`);

      card.append(header, bodyBeforeMount, body, footerMount);
      virtualRow.appendChild(card);
      this.chatContainer.appendChild(virtualRow);
      return virtualRow;
    }

    const bubble = this.doc.createElement("div");
    bubble.className = opts.isUser ? "message-bubble user" : "message-bubble";
    bubble.setAttribute("data-component", "BubbleMessage");
    bubble.setAttribute("data-part", opts.isUser ? "user" : "character");
    bubble.setAttribute("data-message-id", opts.id);

    const header = this.doc.createElement("div");
    header.className = "bubble-header";
    header.style.display = "flex";
    header.style.flexDirection = opts.rowReverse ?? opts.isUser ? "row-reverse" : "row";

    const headerLeft = this.doc.createElement("div");
    headerLeft.className = "headerLeft";
    const nativePill = this.doc.createElement("span");
    nativePill.className = "native-meta-pill";
    nativePill.textContent = opts.nativePillText ?? "claude-3-7 · 240t";
    headerLeft.appendChild(nativePill);

    const headerMount = this.doc.createElement("span");
    headerMount.setAttribute("data-spindle-mount", "message_header");
    headerMount.setAttribute("data-spindle-scope", `${scopePrefix}header`);
    headerMount.style.display = "contents";

    header.append(headerLeft, headerMount);

    const bodyBeforeMount = this.doc.createElement("div");
    bodyBeforeMount.setAttribute("data-spindle-mount", "message_body_before");
    bodyBeforeMount.setAttribute("data-spindle-scope", `${scopePrefix}body-before`);

    const body = this.doc.createElement("div");
    body.className = "bubble-body";
    body.textContent = "Message text";

    const footerMount = this.doc.createElement("div");
    footerMount.setAttribute("data-spindle-mount", "message_footer");
    footerMount.setAttribute("data-spindle-scope", `${scopePrefix}footer`);

    bubble.append(header, bodyBeforeMount, body, footerMount);
    virtualRow.appendChild(bubble);
    this.chatContainer.appendChild(virtualRow);
    return virtualRow;
  }

  emitChatState(chatId: string | null): void {
    this.activeChatId = chatId;
    for (const cb of this.stateListeners.get("chat.active") ?? []) {
      cb({ chatId });
    }
  }

  pushFromBackend(msg: BackendToFrontendMessage): void {
    this.backendListener?.(msg);
  }

  emitEvent(eventName: string, payload?: unknown): void {
    for (const handler of this.eventListeners.get(eventName) ?? []) {
      handler(payload);
    }
  }

  listenerCount(eventName: string): number {
    return this.eventListeners.get(eventName)?.size ?? 0;
  }

  destroy(): void {
    this.cleanupFn?.();
    this.cleanupFn = undefined;
    this.dom.window.close();
  }
}

describe("Message Meta Plus Frontend Host Integration", () => {
  test("initial mount renders pills in both Bubble and Minimal mounts without touching native MetaPill", () => {
    const host = (activeHost = new MockFrontendHost());
    const bubbleEl = host.mountMessageDom({ id: "msg-bubble", layout: "bubble", isUser: false });
    const minimalEl = host.mountMessageDom({ id: "msg-minimal", layout: "minimal", isUser: false });
    const userEl = host.mountMessageDom({ id: "msg-user", layout: "bubble", isUser: true });

    host.mount();

    expect(host.sentToBackend.some((m) => m.type === "get-state")).toBe(true);
    expect(host.sentToBackend.some((m) => m.type === "get-chat-meta" && m.chatId === "chat-1")).toBe(
      true,
    );
    expect(host.styleNodes).toHaveLength(1);

    const meta: ChatMetaMap = {
      "msg-bubble:0": {
        isUser: false,
        durationMs: 14_000,
        finishReason: "length",
        wordCount: 85,
        lorebookTriggers: { count: 1, entries: ["Castle"] },
      },
      "msg-minimal:0": {
        isUser: false,
        durationMs: 3_000,
        finishReason: "stop",
        edited: true,
      },
      "msg-user:0": {
        isUser: true,
        wordCount: 5,
        edited: false,
      },
    };

    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta,
    });

    const bubblePill = bubbleEl.querySelector("[data-mmp-pill]");
    expect(bubblePill).not.toBeNull();
    expect(bubblePill?.textContent).toBe("00:00:14·length");
    expect(bubblePill?.classList.contains("mmp-pill--pos-next-to-pill")).toBe(true);
    expect(bubblePill?.classList.contains("mmp-pill--bubble")).toBe(true);
    expect(bubblePill?.classList.contains("mmp-pill--row-reverse")).toBe(false);
    expect(bubblePill?.parentElement?.classList.contains("mmp-inj-wrap--next-to-pill")).toBe(true);
    expect(bubblePill?.parentElement?.classList.contains("mmp-inj-wrap--bubble")).toBe(true);
    expect(bubbleEl.querySelector(".native-meta-pill")?.textContent).toBe("claude-3-7 · 240t");

    const minimalPill = minimalEl.querySelector("[data-mmp-pill]");
    expect(minimalPill).not.toBeNull();
    expect(minimalPill?.textContent).toBe("00:00:03·Edited");
    expect(minimalPill?.classList.contains("mmp-pill--pos-next-to-pill")).toBe(true);
    expect(minimalPill?.classList.contains("mmp-pill--minimal")).toBe(true);
    expect(minimalPill?.parentElement?.classList.contains("mmp-inj-wrap--minimal")).toBe(true);
    expect(minimalEl.querySelector(".native-meta-pill")?.textContent).toBe("gpt-4o · 120t");

    // User message has wordCount=hover, editedBadge=inline (false -> off), so only hover field active -> circle (!)
    // Also its Bubble header uses flex-direction: row-reverse -> row-reverse classes are applied
    const userPill = userEl.querySelector("[data-mmp-pill]");
    expect(userPill).not.toBeNull();
    expect(userPill?.classList.contains("mmp-pill--circle")).toBe(true);
    expect(userPill?.classList.contains("mmp-pill--row-reverse")).toBe(true);
    expect(userPill?.parentElement?.classList.contains("mmp-inj-wrap--row-reverse")).toBe(true);
    expect(userPill?.textContent).toBe("!");
  });

  test("handles late-arriving bubbles via MutationObserver and avoids duplicate pills on virtualization remount / re-render", async () => {
    const host = (activeHost = new MockFrontendHost({ useLegacyOn: true }));
    host.mount();

    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta: {
        "msg-late:0": {
          isUser: false,
          durationMs: 7_000,
          finishReason: "content_filter",
        },
      },
    });

    // Late-arriving bubble mounted after initial setup
    const lateBubble = host.mountMessageDom({ id: "msg-late", layout: "bubble", isUser: false });
    await flush();

    expect(lateBubble.querySelectorAll("[data-mmp-pill]")).toHaveLength(1);
    expect(lateBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:07·content_filter");
    const initialInjectCount = host.injectCount;

    // Re-render events with unchanged signature should NOT inject duplicate pills
    host.emitEvent("CHARACTER_MESSAGE_RENDERED", { messageId: "msg-late" });
    host.emitEvent("CHARACTER_MESSAGE_RENDERED", { messageId: "msg-late" });
    await flush();
    expect(lateBubble.querySelectorAll("[data-mmp-pill]")).toHaveLength(1);
    expect(host.injectCount).toBe(initialInjectCount);

    // Virtualization unmount & remount of the same messageId
    lateBubble.remove();
    await flush();
    const remountedBubble = host.mountMessageDom({ id: "msg-late", layout: "bubble", isUser: false });
    await flush();

    expect(remountedBubble.querySelectorAll("[data-mmp-pill]")).toHaveLength(1);
    expect(remountedBubble.querySelector("[data-mmp-pill]")?.textContent).toBe(
      "00:00:07·content_filter",
    );
  });

  test("updates pill when active swipe changes without DOM swipe attributes", () => {
    const host = (activeHost = new MockFrontendHost());
    const bubble = host.mountMessageDom({
      id: "msg-sw",
      layout: "bubble",
      isUser: false,
    });
    host.mount();

    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta: {
        "msg-sw:0": { isUser: false, durationMs: 4_000, finishReason: "stop" },
        "msg-sw:1": { isUser: false, durationMs: 12_000, finishReason: "length", edited: true },
      },
      messageStates: {
        "msg-sw": { swipeId: 0, isUser: false },
      },
    });

    expect(bubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:04");

    // Swipe change event updates cached swipe_id and re-renders pill
    host.emitEvent("MESSAGE_SWIPED", {
      chatId: "chat-1",
      message: { id: "msg-sw", swipe_id: 1, is_user: false },
    });

    const pills = bubble.querySelectorAll("[data-mmp-pill]");
    expect(pills).toHaveLength(1);
    expect(pills[0]?.textContent).toBe("00:00:12·length·Edited");
    expect(pills[0]?.getAttribute("data-mmp-swipe-id")).toBe("1");
  });

  test("renders (!) circle badge and opens/closes portal tooltip on hover, focus, and tap", () => {
    const host = (activeHost = new MockFrontendHost());
    const bubble = host.mountMessageDom({ id: "msg-circle", layout: "bubble", isUser: false });
    const emptyUser = host.mountMessageDom({ id: "msg-empty-user", layout: "bubble", isUser: true });
    host.mount();

    const hoverOnlySettings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      fields: {
        generationTime: "hover",
        finishReason: "hover",
        lorebookTriggers: "hover",
        macrosApplied: "hover",
        wordCount: "off",
        editedBadge: "hover",
      },
      finishReasonAbnormalOnly: true,
      position: "next-to-pill",
    };

    host.pushFromBackend({
      type: "state-update",
      settings: hoverOnlySettings,
      activeChatId: "chat-1",
      meta: {
        "msg-circle:0": {
          isUser: false,
          durationMs: 9_000,
          lorebookTriggers: { count: 2, entries: ["Silver Spire", "Old Pact"] },
          macrosApplied: { count: 1, names: ["char"] },
        },
        "msg-empty-user:0": {
          isUser: true,
          wordCount: 10,
          edited: false,
        },
      },
    });

    // Empty user message (wordCount=off, edited=false, AI fields ignored) must render NO pill / no empty !
    expect(emptyUser.querySelector("[data-mmp-pill]")).toBeNull();

    const pill = bubble.querySelector("[data-mmp-pill]") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.classList.contains("mmp-pill--circle")).toBe(true);
    expect(pill.textContent).toBe("!");

    const win = host.dom.window;
    // 1) Hover open + leave close
    pill.dispatchEvent(new win.MouseEvent("mouseenter", { bubbles: true }));
    let tooltip = host.doc.body.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tooltip).not.toBeNull();
    expect(pill.getAttribute("aria-expanded")).toBe("true");
    expect(tooltip?.textContent).toContain("00:00:09");
    expect(tooltip?.textContent).toContain("Silver Spire");
    expect(tooltip?.textContent).toContain("Old Pact");
    expect(tooltip?.textContent).toContain("char");

    pill.dispatchEvent(new win.MouseEvent("mouseleave", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(pill.getAttribute("aria-expanded")).toBe("false");

    // 2) Focus open + blur close
    pill.dispatchEvent(new win.FocusEvent("focus"));
    expect(host.doc.body.querySelector('[role="tooltip"]')).not.toBeNull();
    pill.dispatchEvent(new win.FocusEvent("blur"));
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();

    // 3) Tap/click pins tooltip; outside pointerdown closes; tap again toggles closed
    pill.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).not.toBeNull();
    // mouseleave while pinned does not close it
    pill.dispatchEvent(new win.MouseEvent("mouseleave", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).not.toBeNull();

    // Outside tap closes
    host.doc.body.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();

    // Tap open + Escape closes
    pill.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).not.toBeNull();
    host.doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  test("drawer settings controls toggle modes, show live preview, persist via sendToBackend, and update pills live", () => {
    const host = (activeHost = new MockFrontendHost());
    const bubble = host.mountMessageDom({ id: "msg-live", layout: "bubble", isUser: false });
    host.mount();

    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta: {
        "msg-live:0": {
          isUser: false,
          durationMs: 14_000,
          finishReason: "stop",
          wordCount: 55,
          lorebookTriggers: { count: 1, entries: ["Tome"] },
        },
      },
    });

    // Initially: generationTime=inline, finishReason=inline (abnormal only -> stop hidden), wordCount=hover
    expect(bubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:14");

    // Drawer live preview has both inline and circle (!) samples
    expect(host.drawerRoot.querySelector(".mmp-pill:not(.mmp-pill--circle)")).not.toBeNull();
    expect(host.drawerRoot.querySelector(".mmp-pill--circle")).not.toBeNull();

    // Toggle wordCount -> Inline
    const wordInlineBtn = host.drawerRoot.querySelector(
      'button[data-mmp-field="wordCount"][data-mmp-mode="inline"]',
    ) as HTMLButtonElement;
    wordInlineBtn.click();

    expect(bubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:14·55w");
    const updateMsg = host.sentToBackend.findLast((m) => m.type === "update-settings");
    expect(updateMsg).toMatchObject({
      type: "update-settings",
      settings: {
        fields: {
          wordCount: "inline",
        },
      },
    });

    // Uncheck "Finish Reason: Inline only when abnormal" -> normal "stop" now appears inline
    const abnormalCheckbox = host.drawerRoot.querySelector(
      'input[data-mmp-abnormal-toggle="1"]',
    ) as HTMLInputElement;
    abnormalCheckbox.checked = false;
    abnormalCheckbox.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));

    expect(bubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:14·stop·55w");

    // Switch all fields to Off -> pill is cleanly uninjected (hidden)
    for (const offBtn of host.drawerRoot.querySelectorAll('button[data-mmp-mode="off"]')) {
      (offBtn as HTMLButtonElement).click();
    }
    expect(bubble.querySelector("[data-mmp-pill]")).toBeNull();
  });

  test("switches cleanly across all 4 pill positions via compact select dropdown with zero duplicates", () => {
    const host = (activeHost = new MockFrontendHost());
    const bubble = host.mountMessageDom({ id: "msg-pos-b", layout: "bubble", isUser: false });
    const minimal = host.mountMessageDom({ id: "msg-pos-m", layout: "minimal", isUser: false });
    host.mount();

    // Streamlined borderless hairline drawer layout assertions (zero exposition clutter)
    expect(host.drawerRoot.querySelector(".mmp-section")).not.toBeNull();
    expect(host.drawerRoot.querySelector(".mmp-footnote")).toBeNull();
    expect(host.drawerRoot.querySelector(".mmp-field-hint")).toBeNull();
    expect(host.drawerRoot.querySelector(".mmp-drawer-subtitle")).toBeNull();
    expect(host.drawerRoot.querySelector(".mmp-card")).toBeNull();
    expect(host.drawerRoot.querySelector(".mmp-position-grid")).toBeNull();

    const posSelect = host.drawerRoot.querySelector(
      'select[data-mmp-position-select="1"]',
    ) as HTMLSelectElement | null;
    expect(posSelect).not.toBeNull();
    expect(Array.from(posSelect!.options).map((o) => o.value)).toEqual([
      "next-to-pill",
      "below-header",
      "footer",
      "header-corner",
    ]);

    host.pushFromBackend({
      type: "state-update",
      settings: { ...DEFAULT_SETTINGS, position: "footer" },
      activeChatId: "chat-1",
      meta: {
        "msg-pos-b:0": { isUser: false, durationMs: 6_000, finishReason: "length" },
        "msg-pos-m:0": { isUser: false, durationMs: 4_000 },
      },
    });
    expect(posSelect!.value).toBe("footer");

    const expectedMountByPos: Record<string, string> = {
      "next-to-pill": "message_header",
      "below-header": "message_body_before",
      footer: "message_footer",
      "header-corner": "message_header",
    };

    for (const pos of ["next-to-pill", "below-header", "footer", "header-corner"] as const) {
      posSelect!.value = pos;
      posSelect!.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));

      expect(posSelect!.value).toBe(pos);
      const lastUpdate = host.sentToBackend.findLast((m) => m.type === "update-settings");
      expect(lastUpdate).toMatchObject({
        type: "update-settings",
        settings: { position: pos },
      });

      const mountName = expectedMountByPos[pos];
      for (const card of [bubble, minimal]) {
        const pills = card.querySelectorAll("[data-mmp-pill]");
        expect(pills).toHaveLength(1);
        const pill = pills[0]!;
        expect(pill.getAttribute("data-mmp-pos")).toBe(pos);
        expect(pill.classList.contains(`mmp-pill--pos-${pos}`)).toBe(true);
        expect(pill.parentElement?.classList.contains(`mmp-inj-wrap--${pos}`)).toBe(true);

        const targetSlot = card.querySelector(`[data-spindle-mount="${mountName}"]`);
        expect(targetSlot?.contains(pill)).toBe(true);
        const allWrappers = card.querySelectorAll(".mmp-inj-wrap");
        expect(allWrappers).toHaveLength(1);
      }
    }

    // Footer layout-shift guard: AI footer aligns to lower bound of SwipeControls row; user footer stays in-flow
    const footerBubbleBlock = MMP_STYLES.match(
      /\.mmp-inj-wrap--footer\.mmp-inj-wrap--bubble\s*\{([^}]+)\}/,
    )?.[1];
    const footerMinimalBlock = MMP_STYLES.match(
      /\.mmp-inj-wrap--footer\.mmp-inj-wrap--minimal\s*\{([^}]+)\}/,
    )?.[1];
    const footerUserBubbleBlock = MMP_STYLES.match(
      /\.mmp-inj-wrap--footer\.mmp-inj-wrap--bubble\.mmp-inj-wrap--user\s*\{([^}]+)\}/,
    )?.[1];
    expect(footerBubbleBlock).toBeDefined();
    expect(footerMinimalBlock).toBeDefined();
    expect(footerUserBubbleBlock).toBeDefined();
    for (const block of [footerBubbleBlock!, footerMinimalBlock!]) {
      expect(block).toContain("position: absolute;");
      expect(block).toContain("align-items: flex-end;");
      expect(block).toContain("width: auto;");
      expect(block).toContain("padding: 0;");
      expect(block).toContain("margin: 0;");
      expect(block).not.toContain("width: 100%;");
      expect(block).not.toContain("min-height:");
    }
    expect(footerBubbleBlock).toContain("bottom: 18px;");
    expect(footerMinimalBlock).toContain("bottom: 12px;");
    expect(footerUserBubbleBlock).toContain("position: static;");
    expect(footerUserBubbleBlock).toContain("padding: 0 24px 14px;");
    expect(MMP_STYLES).not.toContain("padding: 2px 8px;");
    expect(MMP_STYLES).not.toContain("width: 18px;");

    // Verify user bubble in footer receives mmp-inj-wrap--user / mmp-pill--user classes
    const userFooter = host.mountMessageDom({ id: "msg-pos-u", layout: "bubble", isUser: true });
    host.pushFromBackend({
      type: "chat-meta-update",
      chatId: "chat-1",
      meta: { "msg-pos-u:0": { isUser: true, wordCount: 12 } },
      messageStates: { "msg-pos-u": { swipeId: 0, isUser: true } },
    });
    const prevWordBtn = host.drawerRoot.querySelector(
      'button[data-mmp-field="wordCount"][data-mmp-mode="inline"]',
    ) as HTMLButtonElement;
    prevWordBtn.click();
    posSelect!.value = "footer";
    posSelect!.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));
    const userFooterPill = userFooter.querySelector("[data-mmp-pill]");
    expect(userFooterPill?.classList.contains("mmp-pill--user")).toBe(true);
    expect(userFooterPill?.parentElement?.classList.contains("mmp-inj-wrap--user")).toBe(true);
  });

  test("tears down cleanly and re-setups without duplicate listeners or pills", () => {
    const host = (activeHost = new MockFrontendHost());
    const bubble = host.mountMessageDom({ id: "msg-td", layout: "bubble", isUser: false });

    const cleanup1 = setup(host.ctx);
    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta: { "msg-td:0": { isUser: false, durationMs: 2_000 } },
    });

    expect(bubble.querySelectorAll("[data-mmp-pill]")).toHaveLength(1);
    expect(host.listenerCount("CHARACTER_MESSAGE_RENDERED")).toBe(1);
    expect(host.styleNodes).toHaveLength(1);

    // Open tooltip before teardown to confirm tooltip is also removed on teardown
    const pill = bubble.querySelector("[data-mmp-pill]") as HTMLElement;
    pill.dispatchEvent(new host.dom.window.MouseEvent("click", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).not.toBeNull();

    cleanup1();

    expect(host.styleNodes).toHaveLength(0);
    expect(host.cleanupCalls).toBe(1);
    expect(host.drawerDestroyCalls).toBe(1);
    expect(host.listenerCount("CHARACTER_MESSAGE_RENDERED")).toBe(0);
    expect(bubble.querySelector("[data-mmp-pill]")).toBeNull();
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();

    // Re-setup after teardown
    host.sentToBackend.length = 0;
    const cleanup2 = setup(host.ctx);
    expect(host.listenerCount("CHARACTER_MESSAGE_RENDERED")).toBe(1);
    expect(host.styleNodes).toHaveLength(1);
    expect(host.sentToBackend.filter((m) => m.type === "get-state")).toHaveLength(1);

    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta: { "msg-td:0": { isUser: false, durationMs: 5_000 } },
    });

    expect(bubble.querySelectorAll("[data-mmp-pill]")).toHaveLength(1);
    expect(bubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:05");

    cleanup2();
  });

  test("supports duration format dropdown, field reordering buttons, and user message toggle live", () => {
    const host = (activeHost = new MockFrontendHost());
    const aiBubble = host.mountMessageDom({ id: "msg-ai-opts", layout: "bubble", isUser: false });
    const userBubble = host.mountMessageDom({ id: "msg-u-opts", layout: "bubble", isUser: true });
    host.mount();

    host.pushFromBackend({
      type: "state-update",
      settings: {
        ...DEFAULT_SETTINGS,
        fields: {
          ...DEFAULT_SETTINGS.fields,
          generationTime: "inline",
          wordCount: "inline",
        },
      },
      activeChatId: "chat-1",
      meta: {
        "msg-ai-opts:0": {
          isUser: false,
          durationMs: 74_000,
          wordCount: 42,
        },
        "msg-u-opts:0": {
          isUser: true,
          wordCount: 9,
        },
      },
    });

    expect(aiBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:01:14·42w");
    expect(userBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("9w");

    // 1) Duration Format dropdown nested inside generationTime row -> toggles 00:01:14 <-> 1m 14s live
    const genRow = host.drawerRoot.querySelector('[data-mmp-field-row="generationTime"]');
    expect(genRow).not.toBeNull();
    const formatSelect = genRow!.querySelector(
      'select[data-mmp-duration-format-select="1"]',
    ) as HTMLSelectElement | null;
    expect(formatSelect).not.toBeNull();
    expect(Array.from(formatSelect!.options).map((o) => [o.value, o.textContent])).toEqual([
      ["hms", "HH:MM:SS"],
      ["compact", "Compact"],
    ]);
    expect(formatSelect?.value).toBe("hms");
    formatSelect!.value = "compact";
    formatSelect!.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));
    expect(aiBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("1m 14s·42w");

    formatSelect!.value = "hms";
    formatSelect!.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));
    expect(aiBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:01:14·42w");
    formatSelect!.value = "compact";
    formatSelect!.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));
    expect(aiBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("1m 14s·42w");

    // 2) Field Ordering buttons -> move wordCount up to index 0 (before generationTime)
    const moveWordUp = host.drawerRoot.querySelector(
      'button[data-mmp-move-up="wordCount"]',
    ) as HTMLButtonElement;
    // wordCount starts at index 4; click up 4 times to reach index 0
    for (let i = 0; i < 4; i++) {
      moveWordUp.click();
    }
    expect(aiBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("42w·1m 14s");
    const rowOrder = Array.from(
      host.drawerRoot.querySelectorAll<HTMLElement>("[data-mmp-field-row]"),
    ).map((el) => el.dataset.mmpFieldRow);
    expect(rowOrder[0]).toBe("wordCount");
    expect((host.drawerRoot.querySelector('button[data-mmp-move-up="wordCount"]') as HTMLButtonElement).disabled).toBe(
      true,
    );

    // 3) Show on User Messages toggle -> false hides user pill immediately, true restores it
    const userToggle = host.drawerRoot.querySelector(
      'input[data-mmp-user-messages-toggle="1"]',
    ) as HTMLInputElement;
    expect(userToggle.checked).toBe(true);
    userToggle.checked = false;
    userToggle.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));
    expect(userBubble.querySelector("[data-mmp-pill]")).toBeNull();
    expect(aiBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("42w·1m 14s");

    userToggle.checked = true;
    userToggle.dispatchEvent(new host.dom.window.Event("change", { bubbles: true }));
    expect(userBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("9w");
  });

  test("corner help button opens portal tooltip with exposition details and closes on leave, Escape, and teardown", () => {
    const host = (activeHost = new MockFrontendHost());
    const cleanup = setup(host.ctx);

    const helpBtn = host.drawerRoot.querySelector(
      'button[data-mmp-help-btn="1"]',
    ) as HTMLButtonElement | null;
    expect(helpBtn).not.toBeNull();
    expect(helpBtn?.textContent).toBe("?");
    expect(helpBtn?.getAttribute("aria-expanded")).toBe("false");

    const win = host.dom.window;

    // 1) Hover open + leave close
    helpBtn!.dispatchEvent(new win.MouseEvent("mouseenter", { bubbles: true }));
    const tooltip = host.doc.body.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tooltip).not.toBeNull();
    expect(helpBtn?.getAttribute("aria-expanded")).toBe("true");
    expect(tooltip?.textContent).toContain("Pill rules");
    expect(tooltip?.textContent).toContain("0 triggers, 0 macros, or unedited behave as Off");
    expect(tooltip?.textContent).toContain("Finish Reason");
    expect(tooltip?.textContent).toContain("Lorebook & Macros");
    expect(tooltip?.textContent).toContain("Word Count & Edited");

    helpBtn!.dispatchEvent(new win.MouseEvent("mouseleave", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(helpBtn?.getAttribute("aria-expanded")).toBe("false");

    // 2) Click open + Escape close
    helpBtn!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).not.toBeNull();
    host.doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();

    // 3) Click open + teardown removes tooltip cleanly
    helpBtn!.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(host.doc.body.querySelector('[role="tooltip"]')).not.toBeNull();
    cleanup();
    expect(host.doc.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  test("resolves exact swipeId and isUser from backend messageStates even when ctx.messages.getRecent is empty", () => {
    const host = (activeHost = new MockFrontendHost());
    host.messages = []; // Simulate older message outside getRecent(200) window
    const oldAiRow = host.mountMessageDom({ id: "msg-old-ai", layout: "bubble", isUser: false });
    const oldUserRow = host.mountMessageDom({ id: "msg-old-user", layout: "bubble", isUser: true });
    host.mount();

    // Real Lumiverse 2-node DOM causes listMessageElements() to return 2 entries per message
    expect(host.ctx.dom.listMessageElements()).toHaveLength(4);

    host.pushFromBackend({
      type: "state-update",
      settings: {
        ...DEFAULT_SETTINGS,
        fields: { ...DEFAULT_SETTINGS.fields, wordCount: "inline" },
      },
      activeChatId: "chat-1",
      meta: {
        "msg-old-ai:0": { isUser: false, durationMs: 1_000, wordCount: 10 },
        "msg-old-ai:2": { isUser: false, durationMs: 9_000, finishReason: "length", wordCount: 88 },
        "msg-old-user:1": { isUser: true, wordCount: 7, edited: true },
      },
      messageStates: {
        "msg-old-ai": { swipeId: 2, isUser: false },
        "msg-old-user": { swipeId: 1, isUser: true },
      },
    });

    const aiPills = oldAiRow.querySelectorAll("[data-mmp-pill]");
    expect(aiPills).toHaveLength(1);
    expect(aiPills[0]?.textContent).toBe("00:00:09·length·88w");
    expect(aiPills[0]?.getAttribute("data-mmp-swipe-id")).toBe("2");

    const userPills = oldUserRow.querySelectorAll("[data-mmp-pill]");
    expect(userPills).toHaveLength(1);
    expect(userPills[0]?.textContent).toBe("7w·Edited");
    expect(userPills[0]?.getAttribute("data-mmp-swipe-id")).toBe("1");
  });

  test("handles CHAT_SWITCHED / chat.active subscription and cold-start MutationObserver re-binding", async () => {
    const host = (activeHost = new MockFrontendHost({ chatId: null, coldStart: true }));
    host.mount();

    expect(host.sentToBackend.filter((m) => m.type === "get-chat-meta")).toHaveLength(0);

    // Mount chat container + stream marker AFTER setup(ctx) (cold start)
    const streamMarker = host.doc.createElement("div");
    streamMarker.setAttribute("data-spindle-mount", "chat_stream_before");
    host.chatContainer.prepend(streamMarker);
    host.doc.body.appendChild(host.chatContainer);

    // Switch chat via ctx.state.subscribe("chat.active")
    host.emitChatState("chat-alpha");
    expect(host.sentToBackend.some((m) => m.type === "get-chat-meta" && m.chatId === "chat-alpha")).toBe(
      true,
    );

    const alphaBubble = host.mountMessageDom({ id: "msg-alpha", layout: "bubble", isUser: false });
    host.pushFromBackend({
      type: "chat-meta-update",
      chatId: "chat-alpha",
      meta: { "msg-alpha:0": { isUser: false, durationMs: 4_000 } },
      messageStates: { "msg-alpha": { swipeId: 0, isUser: false } },
    });
    await flush();

    expect(alphaBubble.querySelectorAll("[data-mmp-pill]")).toHaveLength(1);
    expect(alphaBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:04");

    // Switch to chat-beta -> old pills cleared & new chat-meta requested
    host.emitEvent("CHAT_SWITCHED", { chatId: "chat-beta" });
    expect(alphaBubble.querySelector("[data-mmp-pill]")).toBeNull();
    expect(host.sentToBackend.some((m) => m.type === "get-chat-meta" && m.chatId === "chat-beta")).toBe(
      true,
    );

    alphaBubble.remove();
    const betaBubble = host.mountMessageDom({ id: "msg-beta", layout: "bubble", isUser: false });
    host.pushFromBackend({
      type: "chat-meta-update",
      chatId: "chat-beta",
      meta: { "msg-beta:0": { isUser: false, durationMs: 11_000, finishReason: "max_tokens" } },
      messageStates: { "msg-beta": { swipeId: 0, isUser: false } },
    });
    await flush();

    expect(betaBubble.querySelectorAll("[data-mmp-pill]")).toHaveLength(1);
    expect(betaBubble.querySelector("[data-mmp-pill]")?.textContent).toBe("00:00:11·max_tokens");
  });

  test("clamps portal tooltip inside viewport accounting for --lumiverse-ui-scale", () => {
    const host = (activeHost = new MockFrontendHost());
    // Set CSS zoom scale = 1.25 on documentElement (1024 / 1.25 = 819.2 layout px wide, 768 / 1.25 = 614.4 high)
    host.doc.documentElement.style.setProperty("--lumiverse-ui-scale", "1.25");

    const bubble = host.mountMessageDom({ id: "msg-scale", layout: "bubble", isUser: false });
    host.mount();

    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta: { "msg-scale:0": { isUser: false, durationMs: 5_000, wordCount: 25 } },
      messageStates: { "msg-scale": { swipeId: 0, isUser: false } },
    });

    const pill = bubble.querySelector("[data-mmp-pill]") as HTMLElement;
    expect(pill).not.toBeNull();

    // Anchor near top-right corner in rendered pixels (left: 980, top: 10, bottom: 32)
    pill.getBoundingClientRect = () =>
      ({
        left: 980,
        top: 10,
        right: 1010,
        bottom: 32,
        width: 30,
        height: 22,
        x: 980,
        y: 10,
        toJSON() {},
      }) as DOMRect;

    // Mock tooltip element bounding rect via prototype for JSDOM
    const origGetRect = host.dom.window.HTMLElement.prototype.getBoundingClientRect;
    host.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute("role") === "tooltip") {
        // 250px rendered = 200px layout at 1.25 scale; 100px rendered = 80px layout
        return {
          left: 0,
          top: 0,
          right: 250,
          bottom: 100,
          width: 250,
          height: 100,
          x: 0,
          y: 0,
          toJSON() {},
        } as DOMRect;
      }
      return origGetRect.call(this);
    };

    try {
      pill.dispatchEvent(new host.dom.window.MouseEvent("mouseenter", { bubbles: true }));
      const tooltip = host.doc.body.querySelector('[role="tooltip"]') as HTMLElement;
      expect(tooltip).not.toBeNull();
      const leftPx = Number.parseInt(tooltip.style.left, 10);
      const topPx = Number.parseInt(tooltip.style.top, 10);

      // Layout viewport width = 1024 / 1.25 = 819.2; layout tip width = 200; margin = 8 -> clamped left = round(819.2 - 200 - 8) = 611
      expect(leftPx).toBe(611);
      // Layout anchor.top = 10 / 1.25 = 8 -> above fails (< 8), flips below anchor.bottom (32 / 1.25 = 25.6) + 6 = 32
      expect(topPx).toBe(32);
    } finally {
      host.dom.window.HTMLElement.prototype.getBoundingClientRect = origGetRect;
    }
  });

  test("GENERATION_ENDED, GENERATION_STOPPED, and GENERATION_METRICS_READY request get-chat-meta even when bubble is already mounted and use authoritative backend swipeId", async () => {
    const host = (activeHost = new MockFrontendHost());
    const bubble = host.mountMessageDom({ id: "msg-slow", layout: "bubble", isUser: false });
    host.messages = [
      { id: "msg-slow", is_user: false, swipe_id: 0, content: "" },
    ];
    host.mount();
    host.pushFromBackend({
      type: "state-update",
      settings: DEFAULT_SETTINGS,
      activeChatId: "chat-1",
      meta: {},
      messageStates: {},
    });

    // Clear initial mount requests
    host.sentToBackend.length = 0;

    // Bubble already exists in DOM; slow generation ends without swipeId
    host.emitEvent("GENERATION_ENDED", {
      chatId: "chat-1",
      messageId: "msg-slow",
      content: "Slow finished reply",
      finish_reason: "stop",
    });
    expect(
      host.sentToBackend.filter((m) => m.type === "get-chat-meta" && m.chatId === "chat-1"),
    ).toHaveLength(1);

    host.sentToBackend.length = 0;
    host.emitEvent("GENERATION_METRICS_READY", {
      chatId: "chat-1",
      messageId: "msg-slow",
      swipeId: 2,
      generationMetrics: { durationMs: 210_000 },
    });
    expect(
      host.sentToBackend.filter((m) => m.type === "get-chat-meta" && m.chatId === "chat-1"),
    ).toHaveLength(1);

    host.sentToBackend.length = 0;
    host.emitEvent("GENERATION_STOPPED", {
      chatId: "chat-1",
      messageId: "msg-slow",
    });
    expect(
      host.sentToBackend.filter((m) => m.type === "get-chat-meta" && m.chatId === "chat-1"),
    ).toHaveLength(1);

    // Backend responds with metadata stored at swipe 2 while cached DTO had swipe 0 from initial message list
    host.pushFromBackend({
      type: "chat-meta-update",
      chatId: "chat-1",
      meta: {
        "msg-slow:2": {
          isUser: false,
          durationMs: 210_000,
          finishReason: "stop",
          wordCount: 3,
        },
      },
      messageStates: {
        "msg-slow": { swipeId: 2, isUser: false },
      },
    });
    await flush();

    const pill = bubble.querySelector("[data-mmp-pill]");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe("00:03:30");
  });

  test("re-renders when data-part transitions from streaming to character via MutationObserver attribute watch", async () => {
    const host = (activeHost = new MockFrontendHost());
    const bubble = host.mountMessageDom({ id: "msg-stream", layout: "bubble", isUser: false });
    const innerCard = bubble.querySelector('[data-component="BubbleMessage"]')!;
    innerCard.setAttribute("data-part", "streaming");

    host.messages = [{ id: "msg-stream", is_user: false, swipe_id: 0, content: "" }];
    host.mount();
    host.pushFromBackend({
      type: "state-update",
      settings: {
        ...DEFAULT_SETTINGS,
        fields: {
          ...DEFAULT_SETTINGS.fields,
          generationTime: "hidden",
          finishReason: "hidden",
          wordCount: "inline",
        },
      },
      activeChatId: "chat-1",
      meta: {},
      messageStates: {},
    });
    await flush();

    // Before streaming finishes, empty content shows 0w
    expect(bubble.querySelector("[data-mmp-pill]")?.textContent).toBe("0w");

    // Streaming completes: store has final content and card transitions data-part="streaming" -> "character"
    host.messages = [
      { id: "msg-stream", is_user: false, swipe_id: 0, content: "One two three four" },
    ];
    innerCard.setAttribute("data-part", "character");
    await flush();

    const pill = bubble.querySelector("[data-mmp-pill]");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe("4w");
  });

  test("resyncs on CONNECTED reconnect, window focus, and chat.messageCount changes and cleans up on teardown", () => {
    const host = (activeHost = new MockFrontendHost());
    host.mount();
    host.sentToBackend.length = 0;

    // Authenticated WS reconnect pushes state & chat meta sync
    host.emitEvent("CONNECTED", { role: "owner" });
    expect(host.sentToBackend.some((m) => m.type === "get-state")).toBe(true);
    expect(host.sentToBackend.some((m) => m.type === "get-chat-meta" && m.chatId === "chat-1")).toBe(
      true,
    );

    // Window focus resyncs active chat
    host.sentToBackend.length = 0;
    host.dom.window.dispatchEvent(new host.dom.window.Event("focus"));
    expect(host.sentToBackend.some((m) => m.type === "get-chat-meta" && m.chatId === "chat-1")).toBe(
      true,
    );

    // chat.messageCount baseline does not duplicate sync, subsequent increment triggers sync
    host.sentToBackend.length = 0;
    for (const cb of host.stateListeners.get("chat.messageCount") ?? []) {
      cb(5);
    }
    expect(host.sentToBackend.some((m) => m.type === "get-chat-meta")).toBe(false);

    for (const cb of host.stateListeners.get("chat.messageCount") ?? []) {
      cb(6);
    }
    expect(host.sentToBackend.some((m) => m.type === "get-chat-meta" && m.chatId === "chat-1")).toBe(
      true,
    );

    // Teardown detaches focus/state/CONNECTED listeners
    host.destroy();
    host.sentToBackend.length = 0;
    host.dom.window.dispatchEvent(new host.dom.window.Event("focus"));
    expect(host.sentToBackend).toHaveLength(0);
  });
});
