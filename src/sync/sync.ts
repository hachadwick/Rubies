import Dexie from 'dexie';
import { useSyncExternalStore } from 'react';
import { db, FROM_SYNC, SYNCED_TABLES, type Backup } from '../db';
import {
  downloadSyncFile,
  findSyncFile,
  getProfile,
  GoogleError,
  requestToken,
  revokeToken,
  syncSupported,
  uploadSyncFile,
  type Profile,
  type Token,
} from './google';
import { emptySyncData, localChanges, mergeSyncData, sameData, type SyncData } from './merge';

/**
 * Keeps this device's notes, prayer list, highlights and bookmarks in step with a file in the person's Google Drive.
 *
 * Each sync downloads the file, merges it with what's on this device (see merge.ts), applies the result here and
 * uploads it if anything changed. It runs when the app opens, a few seconds after each change, when the app comes
 * back to the foreground, when the internet comes back, and every few minutes while open.
 *
 * Google's sign-in lasts about an hour. After that, syncing pauses (nothing is lost; changes wait on the device)
 * until the person taps Reconnect, because Google's window can only be opened from a tap.
 */

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'paused' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  account?: Profile;
  lastSyncedAt?: number;
  error?: string;
  /** Paused because Google Drive access wasn't granted; reconnecting must show Google's consent screen again. */
  needsDriveAccess?: boolean;
}

const ACCOUNT_KEY = 'rubies.sync';
const TOKEN_KEY = 'rubies.syncToken';

interface Stored {
  account?: Profile;
  lastSyncedAt?: number;
  fileId?: string | null;
}

function readJson<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    if (v === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

let stored: Stored = readJson<Stored>(ACCOUNT_KEY) ?? {};
let token: Token | undefined = readJson<Token>(TOKEN_KEY);

const tokenValid = () => !!token && token.expiresAt - Date.now() > 60_000;

let state: SyncState = {
  status: !syncSupported() || !stored.account ? 'off' : tokenValid() ? 'idle' : 'paused',
  account: stored.account,
  lastSyncedAt: stored.lastSyncedAt,
};

const listeners = new Set<() => void>();
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function save(patch: Partial<Stored>) {
  stored = { ...stored, ...patch };
  writeJson(ACCOUNT_KEY, stored);
}
function setToken(t: Token | undefined) {
  token = t;
  writeJson(TOKEN_KEY, t);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// --- Syncing ----------------------------------------------------------------------------------------------------

async function readLocal(): Promise<SyncData> {
  const [notes, highlights, bookmarks, prayers, tombstones] = await Promise.all([
    db.notes.toArray(),
    db.highlights.toArray(),
    db.bookmarks.toArray(),
    db.prayers.toArray(),
    db.tombstones.toArray(),
  ]);
  return { notes, highlights, bookmarks, prayers, tombstones };
}

function parseRemote(raw: unknown): SyncData {
  const b = raw as Partial<Backup> | null;
  if (b?.app !== 'rubies' || !Array.isArray(b.notes)) return emptySyncData();
  return {
    notes: b.notes,
    highlights: b.highlights ?? [],
    bookmarks: b.bookmarks ?? [],
    prayers: b.prayers ?? [],
    tombstones: b.tombstones ?? [],
  };
}

/** Our own writes also fire Dexie's change event; changes landing just after a sync are ours, not the person's. */
let ignoreChangesUntil = 0;

async function applyLocal(local: SyncData, merged: SyncData) {
  const c = localChanges(local, merged);
  const any = SYNCED_TABLES.some((t) => c[t].put.length || c[t].remove.length) || c.tombstones.length;
  if (!any) return;
  await db.transaction('rw', [db.notes, db.highlights, db.bookmarks, db.prayers, db.tombstones], async (tx) => {
    (tx as unknown as Record<string, unknown>)[FROM_SYNC] = true;
    for (const t of SYNCED_TABLES) {
      const table = db.table(t);
      if (c[t].put.length) await table.bulkPut(c[t].put);
      if (c[t].remove.length) await table.bulkDelete(c[t].remove);
    }
    if (c.tombstones.length) await db.tombstones.bulkPut(c.tombstones);
  });
  ignoreChangesUntil = Date.now() + 1500;
}

async function runSync(): Promise<void> {
  if (!syncSupported() || !stored.account) return;
  if (!tokenValid()) return set({ status: 'paused', error: undefined });
  if (!navigator.onLine) return set({ status: 'offline', error: undefined });
  set({ status: 'syncing', error: undefined });
  const t = token!.accessToken;
  try {
    let fileId = stored.fileId ?? (await findSyncFile(t));
    let remoteRaw: unknown = null;
    if (fileId) {
      try {
        remoteRaw = await downloadSyncFile(t, fileId);
      } catch (e) {
        if (!(e instanceof GoogleError && e.status === 404)) throw e;
        fileId = await findSyncFile(t); // the saved id is stale
        remoteRaw = fileId ? await downloadSyncFile(t, fileId) : null;
      }
    }
    const remote = parseRemote(remoteRaw);
    const local = await readLocal();
    const merged = mergeSyncData(local, remote);
    await applyLocal(local, merged);
    if (!fileId || !sameData(merged, remote)) {
      const file: Backup = { app: 'rubies', version: 1, exportedAt: new Date().toISOString(), ...merged };
      fileId = await uploadSyncFile(t, fileId, file);
    }
    const now = Date.now();
    save({ fileId, lastSyncedAt: now });
    set({ status: 'idle', lastSyncedAt: now });
  } catch (e) {
    if (e instanceof GoogleError && e.missingScope) {
      setToken(undefined);
      return set({ status: 'paused', error: undefined, needsDriveAccess: true });
    }
    if (e instanceof GoogleError && e.status === 401) {
      setToken(undefined);
      return set({ status: 'paused', error: undefined });
    }
    if (e instanceof GoogleError && e.status === 0) return set({ status: 'offline', error: undefined });
    set({ status: 'error', error: (e as Error).message });
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Syncs now (or right after the sync that's already running). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runSync();
    } while (again && state.status === 'idle');
  })().finally(() => {
    running = null;
  });
  return running;
}

// --- Signing in and out -----------------------------------------------------------------------------------------

/** Signs in with Google (from a tap) and syncs straight away. */
export async function signIn(): Promise<void> {
  set({ error: undefined });
  try {
    // `consent` so Google shows the Drive checkbox again if it was left unticked last time.
    const t = await requestToken({ prompt: 'select_account consent' });
    const account = await getProfile(t.accessToken);
    if (stored.account && stored.account.email !== account.email) save({ fileId: undefined, lastSyncedAt: undefined });
    setToken(t);
    save({ account });
    set({ account, status: 'idle', lastSyncedAt: stored.lastSyncedAt, needsDriveAccess: false });
    await syncNow();
  } catch (e) {
    set({ error: (e as Error).message });
    throw e;
  }
}

/** After the hour-long sign-in runs out: get a fresh one (from a tap), usually without any questions. */
export async function reconnect(): Promise<void> {
  set({ error: undefined });
  try {
    const t = await requestToken({ prompt: state.needsDriveAccess ? 'consent' : '', loginHint: stored.account?.email });
    setToken(t);
    set({ status: 'idle', needsDriveAccess: false });
    await syncNow();
  } catch (e) {
    const missing = e instanceof GoogleError && e.missingScope;
    set({ status: 'paused', error: missing ? undefined : (e as Error).message, needsDriveAccess: missing || state.needsDriveAccess });
    throw e;
  }
}

/** Stops syncing on this device. The notes stay here, and the copy in Google Drive stays there. */
export async function signOut(): Promise<void> {
  const t = token?.accessToken;
  setToken(undefined);
  stored = {};
  writeJson(ACCOUNT_KEY, undefined);
  set({ status: 'off', account: undefined, lastSyncedAt: undefined, error: undefined });
  if (t) await revokeToken(t);
}

// --- When to sync -----------------------------------------------------------------------------------------------

let started = false;
let changeTimer: number | undefined;

/** Starts automatic syncing. Called once when the app opens. */
export function startSync() {
  if (started || !syncSupported()) return;
  started = true;

  Dexie.on('storagemutated', () => {
    if (state.status === 'off' || Date.now() < ignoreChangesUntil) return;
    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => syncNow(), 4000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (state.lastSyncedAt ?? 0) > 30_000) syncNow();
    // Leaving the app: send pending changes now rather than waiting.
    if (document.visibilityState === 'hidden' && changeTimer) {
      window.clearTimeout(changeTimer);
      changeTimer = undefined;
      syncNow();
    }
  });
  window.addEventListener('online', () => syncNow());
  window.setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 5 * 60 * 1000);

  syncNow();
}
