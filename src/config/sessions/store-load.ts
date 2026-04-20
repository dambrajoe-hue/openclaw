import fs from "node:fs";
import fsp from "node:fs/promises";
import { normalizeSessionDeliveryFields } from "../../utils/delivery-context.shared.js";
import { getFileStatSnapshot } from "../cache-utils.js";
import {
  isSessionStoreCacheEnabled,
  readSessionStoreCache,
  setSerializedSessionStore,
  writeSessionStoreCache,
} from "./store-cache.js";
import { applySessionStoreMigrations } from "./store-migrations.js";
import { normalizeSessionRuntimeModelFields, type SessionEntry } from "./types.js";

export type LoadSessionStoreOptions = {
  skipCache?: boolean;
};

type SessionStoreReadSnapshot = {
  store: Record<string, SessionEntry>;
  fileStat?: ReturnType<typeof getFileStatSnapshot>;
  serializedFromDisk?: string;
};

function isSessionStoreRecord(value: unknown): value is Record<string, SessionEntry> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSessionEntryDelivery(entry: SessionEntry): SessionEntry {
  const normalized = normalizeSessionDeliveryFields({
    channel: entry.channel,
    lastChannel: entry.lastChannel,
    lastTo: entry.lastTo,
    lastAccountId: entry.lastAccountId,
    lastThreadId: entry.lastThreadId ?? entry.deliveryContext?.threadId ?? entry.origin?.threadId,
    deliveryContext: entry.deliveryContext,
  });
  const nextDelivery = normalized.deliveryContext;
  const sameDelivery =
    (entry.deliveryContext?.channel ?? undefined) === nextDelivery?.channel &&
    (entry.deliveryContext?.to ?? undefined) === nextDelivery?.to &&
    (entry.deliveryContext?.accountId ?? undefined) === nextDelivery?.accountId &&
    (entry.deliveryContext?.threadId ?? undefined) === nextDelivery?.threadId;
  const sameLast =
    entry.lastChannel === normalized.lastChannel &&
    entry.lastTo === normalized.lastTo &&
    entry.lastAccountId === normalized.lastAccountId &&
    entry.lastThreadId === normalized.lastThreadId;
  if (sameDelivery && sameLast) {
    return entry;
  }
  return {
    ...entry,
    deliveryContext: nextDelivery,
    lastChannel: normalized.lastChannel,
    lastTo: normalized.lastTo,
    lastAccountId: normalized.lastAccountId,
    lastThreadId: normalized.lastThreadId,
  };
}

export function normalizeSessionStore(store: Record<string, SessionEntry>): void {
  for (const [key, entry] of Object.entries(store)) {
    if (!entry) {
      continue;
    }
    const normalized = normalizeSessionEntryDelivery(normalizeSessionRuntimeModelFields(entry));
    if (normalized !== entry) {
      store[key] = normalized;
    }
  }
}

function finalizeLoadedSessionStore(params: {
  storePath: string;
  snapshot: SessionStoreReadSnapshot;
  opts: LoadSessionStoreOptions;
}): Record<string, SessionEntry> {
  if (params.snapshot.serializedFromDisk !== undefined) {
    setSerializedSessionStore(params.storePath, params.snapshot.serializedFromDisk);
  } else {
    setSerializedSessionStore(params.storePath, undefined);
  }

  applySessionStoreMigrations(params.snapshot.store);
  normalizeSessionStore(params.snapshot.store);

  if (!params.opts.skipCache && isSessionStoreCacheEnabled()) {
    writeSessionStoreCache({
      storePath: params.storePath,
      store: params.snapshot.store,
      mtimeMs: params.snapshot.fileStat?.mtimeMs,
      sizeBytes: params.snapshot.fileStat?.sizeBytes,
      serialized: params.snapshot.serializedFromDisk,
    });
  }

  return structuredClone(params.snapshot.store);
}

function loadSessionStoreFromDisk(storePath: string): SessionStoreReadSnapshot {
  // Retry a few times on Windows because readers can briefly observe empty or
  // transiently invalid content while another process is swapping the file.
  const snapshot: SessionStoreReadSnapshot = {
    store: {},
    fileStat: getFileStatSnapshot(storePath),
  };
  const maxReadAttempts = resolveSessionStoreMaxReadAttempts();
  const retryBuf = maxReadAttempts > 1 ? new Int32Array(new SharedArrayBuffer(4)) : undefined;
  for (let attempt = 0; attempt < maxReadAttempts; attempt += 1) {
    try {
      const raw = fs.readFileSync(storePath, "utf-8");
      if (raw.length === 0 && attempt < maxReadAttempts - 1) {
        Atomics.wait(retryBuf!, 0, 0, 50);
        continue;
      }
      const parsed = JSON.parse(raw);
      if (isSessionStoreRecord(parsed)) {
        snapshot.store = parsed;
        snapshot.serializedFromDisk = raw;
      }
      snapshot.fileStat = getFileStatSnapshot(storePath) ?? snapshot.fileStat;
      break;
    } catch {
      if (attempt < maxReadAttempts - 1) {
        Atomics.wait(retryBuf!, 0, 0, 50);
        continue;
      }
    }
  }
  return snapshot;
}

function resolveSessionStoreMaxReadAttempts(): number {
  return process.platform === "win32" ? 3 : 1;
}

async function waitForSessionStoreReadRetry(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSessionStoreFromDiskAsync(storePath: string): Promise<SessionStoreReadSnapshot> {
  const snapshot: SessionStoreReadSnapshot = {
    store: {},
    fileStat: getFileStatSnapshot(storePath),
  };
  const maxReadAttempts = resolveSessionStoreMaxReadAttempts();
  for (let attempt = 0; attempt < maxReadAttempts; attempt += 1) {
    try {
      const raw = await fsp.readFile(storePath, "utf-8");
      if (raw.length === 0 && attempt < maxReadAttempts - 1) {
        await waitForSessionStoreReadRetry(50);
        continue;
      }
      const parsed = JSON.parse(raw);
      if (isSessionStoreRecord(parsed)) {
        snapshot.store = parsed;
        snapshot.serializedFromDisk = raw;
      }
      snapshot.fileStat = getFileStatSnapshot(storePath) ?? snapshot.fileStat;
      break;
    } catch {
      if (attempt < maxReadAttempts - 1) {
        await waitForSessionStoreReadRetry(50);
        continue;
      }
    }
  }
  return snapshot;
}

export function loadSessionStore(
  storePath: string,
  opts: LoadSessionStoreOptions = {},
): Record<string, SessionEntry> {
  if (!opts.skipCache && isSessionStoreCacheEnabled()) {
    const currentFileStat = getFileStatSnapshot(storePath);
    const cached = readSessionStoreCache({
      storePath,
      mtimeMs: currentFileStat?.mtimeMs,
      sizeBytes: currentFileStat?.sizeBytes,
    });
    if (cached) {
      return cached;
    }
  }

  return finalizeLoadedSessionStore({
    storePath,
    snapshot: loadSessionStoreFromDisk(storePath),
    opts,
  });
}

export async function loadSessionStoreAsync(
  storePath: string,
  opts: LoadSessionStoreOptions = {},
): Promise<Record<string, SessionEntry>> {
  if (!opts.skipCache && isSessionStoreCacheEnabled()) {
    const currentFileStat = getFileStatSnapshot(storePath);
    const cached = readSessionStoreCache({
      storePath,
      mtimeMs: currentFileStat?.mtimeMs,
      sizeBytes: currentFileStat?.sizeBytes,
    });
    if (cached) {
      return cached;
    }
  }

  return finalizeLoadedSessionStore({
    storePath,
    snapshot: await loadSessionStoreFromDiskAsync(storePath),
    opts,
  });
}
