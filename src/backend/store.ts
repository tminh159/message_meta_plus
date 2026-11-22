import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  ChatMetaMap,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  MessageMetaRecord,
  sanitizeSettings,
} from "../shared/types.js";

const SETTINGS_FILE = "settings.json";
const CHATS_DIR = "chats";
const DEFAULT_USER_SCOPE = "__default__";

function sanitizeChatStorageKey(chatId: string): string {
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${CHATS_DIR}/${safe || "unknown"}.json`;
}

export function resolveUserScopeKey(userId?: string): string {
  return typeof userId === "string" && userId.length > 0
    ? userId
    : DEFAULT_USER_SCOPE;
}

function cloneRecord(record: MessageMetaRecord): MessageMetaRecord {
  return {
    ...record,
    ...(record.lorebookTriggers
      ? {
          lorebookTriggers: {
            count: record.lorebookTriggers.count,
            entries: [...record.lorebookTriggers.entries],
          },
        }
      : {}),
    ...(record.macrosApplied
      ? {
          macrosApplied: {
            count: record.macrosApplied.count,
            names: [...record.macrosApplied.names],
          },
        }
      : {}),
  };
}

export function cloneChatMeta(meta: ChatMetaMap): ChatMetaMap {
  const copy: ChatMetaMap = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value && typeof value === "object") {
      copy[key] = cloneRecord(value);
    }
  }
  return copy;
}

/**
 * Serialized persistence wrapper over `spindle.userStorage` (when available and
 * `userId` is present) with fallback to `spindle.storage`, plus per-user
 * in-memory caching so concurrent writes never race.
 */
export class BackendStore {
  private settingsCache = new Map<string, ExtensionSettings>();
  private chatMetaCache = new Map<string, ChatMetaMap>();
  private writeChains = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: SpindleAPI["storage"],
    private readonly userStorage?: SpindleAPI["userStorage"],
  ) {}

  private shouldUseUserStorage(userId?: string): boolean {
    return (
      typeof userId === "string" &&
      userId.length > 0 &&
      this.userStorage !== undefined &&
      this.userStorage !== null
    );
  }

  private chatCacheKey(chatId: string, userId?: string): string {
    const scope = this.shouldUseUserStorage(userId)
      ? resolveUserScopeKey(userId)
      : "__shared__";
    return `${scope}:${chatId}`;
  }

  private enqueueWrite(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.writeChains.get(key) ?? Promise.resolve();
    const next = prev.then(task, task).finally(() => {
      if (this.writeChains.get(key) === next) {
        this.writeChains.delete(key);
      }
    });
    this.writeChains.set(key, next);
    return next;
  }

  private async readJson<T>(
    path: string,
    fallback: T,
    userId?: string,
  ): Promise<T> {
    const useUser = this.shouldUseUserStorage(userId);
    const backend = useUser ? this.userStorage! : this.storage;
    try {
      if (typeof backend.getJson === "function") {
        const result = useUser
          ? await (backend as NonNullable<SpindleAPI["userStorage"]>).getJson<T>(
              path,
              { fallback, userId },
            )
          : await (backend as SpindleAPI["storage"]).getJson<T>(path, {
              fallback,
            });
        return result ?? fallback;
      }
      if (typeof backend.exists === "function") {
        const present = useUser
          ? await (backend as NonNullable<SpindleAPI["userStorage"]>).exists(
              path,
              userId,
            )
          : await (backend as SpindleAPI["storage"]).exists(path);
        if (!present) return fallback;
      }
      if (typeof backend.read === "function") {
        const raw = useUser
          ? await (backend as NonNullable<SpindleAPI["userStorage"]>).read(
              path,
              userId,
            )
          : await (backend as SpindleAPI["storage"]).read(path);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
      }
    } catch {
      return fallback;
    }
    return fallback;
  }

  private async writeJson(
    path: string,
    value: unknown,
    userId?: string,
  ): Promise<void> {
    const useUser = this.shouldUseUserStorage(userId);
    const backend = useUser ? this.userStorage! : this.storage;
    if (typeof backend.setJson === "function") {
      if (useUser) {
        await (backend as NonNullable<SpindleAPI["userStorage"]>).setJson(
          path,
          value,
          { userId },
        );
      } else {
        await (backend as SpindleAPI["storage"]).setJson(path, value);
      }
      return;
    }
    if (typeof backend.write === "function") {
      const serialized = JSON.stringify(value);
      if (useUser) {
        await (backend as NonNullable<SpindleAPI["userStorage"]>).write(
          path,
          serialized,
          userId,
        );
      } else {
        await (backend as SpindleAPI["storage"]).write(path, serialized);
      }
    }
  }

  async loadSettings(userId?: string): Promise<ExtensionSettings> {
    const scopeKey = resolveUserScopeKey(userId);
    const cached = this.settingsCache.get(scopeKey);
    if (cached) {
      return sanitizeSettings(cached);
    }
    const raw = await this.readJson<unknown>(
      SETTINGS_FILE,
      DEFAULT_SETTINGS,
      userId,
    );
    const sanitized = sanitizeSettings(raw);
    if (!this.settingsCache.has(scopeKey)) {
      this.settingsCache.set(scopeKey, sanitized);
    }
    return sanitizeSettings(this.settingsCache.get(scopeKey) ?? sanitized);
  }

  async saveSettings(
    input: unknown,
    userId?: string,
  ): Promise<ExtensionSettings> {
    const scopeKey = resolveUserScopeKey(userId);
    const sanitized = sanitizeSettings(input);
    this.settingsCache.set(scopeKey, sanitized);
    const chainKey = `${this.shouldUseUserStorage(userId) ? scopeKey : "__shared__"}:${SETTINGS_FILE}`;
    await this.enqueueWrite(chainKey, () =>
      this.writeJson(SETTINGS_FILE, sanitized, userId),
    );
    return sanitizeSettings(sanitized);
  }

  async loadChatMeta(chatId: string, userId?: string): Promise<ChatMetaMap> {
    const cacheKey = this.chatCacheKey(chatId, userId);
    const cached = this.chatMetaCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const path = sanitizeChatStorageKey(chatId);
    const raw = await this.readJson<unknown>(path, {}, userId);
    const map: ChatMetaMap =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? cloneChatMeta(raw as ChatMetaMap)
        : {};
    // Re-check cache in case concurrent writes populated it during the async read.
    const existing = this.chatMetaCache.get(cacheKey);
    if (existing) {
      return existing;
    }
    this.chatMetaCache.set(cacheKey, map);
    return map;
  }

  getCachedChatMeta(chatId: string, userId?: string): ChatMetaMap | undefined {
    return this.chatMetaCache.get(this.chatCacheKey(chatId, userId));
  }

  async saveChatMeta(
    chatId: string,
    meta: ChatMetaMap,
    userId?: string,
  ): Promise<void> {
    const cacheKey = this.chatCacheKey(chatId, userId);
    this.chatMetaCache.set(cacheKey, meta);
    const path = sanitizeChatStorageKey(chatId);
    const snapshot = cloneChatMeta(meta);
    await this.enqueueWrite(cacheKey, () =>
      this.writeJson(path, snapshot, userId),
    );
  }
}
