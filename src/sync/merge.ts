import type { Bookmark, Highlight, Note, Prayer, SyncedTable, Tombstone } from '../db';

/** Everything that syncs: the four tables plus the deletions. */
export interface SyncData {
  notes: Note[];
  highlights: Highlight[];
  bookmarks: Bookmark[];
  prayers: Prayer[];
  tombstones: Tombstone[];
}

type Rec = Note | Highlight | Bookmark | Prayer;

/** Each record's id, and the time that decides which copy is newer. */
const KEYS: Record<SyncedTable, { id: (r: Rec) => string; version: (r: Rec) => number }> = {
  notes: { id: (r) => (r as Note).id, version: (r) => (r as Note).updatedAt ?? 0 },
  prayers: { id: (r) => (r as Prayer).id, version: (r) => (r as Prayer).updatedAt ?? 0 },
  // Highlights and bookmarks are replaced, not edited, so when they were made is their version.
  highlights: { id: (r) => (r as Highlight).key, version: (r) => (r as Highlight).createdAt ?? 0 },
  bookmarks: { id: (r) => (r as Bookmark).key, version: (r) => (r as Bookmark).createdAt ?? 0 },
};

const TABLES = Object.keys(KEYS) as SyncedTable[];

/**
 * Combines this device's data with the copy in the cloud.
 * - The same note (or prayer, highlight, bookmark) on both: the most recently changed copy wins.
 * - Deleted on one device: it stays deleted, unless it was changed somewhere after it was deleted.
 */
export function mergeSyncData(local: SyncData, remote: SyncData): SyncData {
  const tombs = new Map<string, Tombstone>();
  for (const t of [...(local.tombstones ?? []), ...(remote.tombstones ?? [])]) {
    const had = tombs.get(t.key);
    if (!had || had.deletedAt < t.deletedAt) tombs.set(t.key, t);
  }

  const out = { tombstones: [...tombs.values()] } as SyncData;
  for (const table of TABLES) {
    const { id, version } = KEYS[table];
    const byId = new Map<string, Rec>();
    for (const r of [...((local[table] ?? []) as Rec[]), ...((remote[table] ?? []) as Rec[])]) {
      const had = byId.get(id(r));
      if (!had || version(had) < version(r)) byId.set(id(r), r);
    }
    (out as unknown as Record<SyncedTable, Rec[]>)[table] = [...byId.values()].filter((r) => {
      const t = tombs.get(`${table}:${id(r)}`);
      return !t || t.deletedAt < version(r);
    });
  }
  return out;
}

/** What has to change on this device to match the merged data. */
export function localChanges(local: SyncData, merged: SyncData) {
  const changes = {} as Record<SyncedTable, { put: Rec[]; remove: string[] }>;
  for (const table of TABLES) {
    const { id, version } = KEYS[table];
    const mine = new Map((local[table] as Rec[]).map((r) => [id(r), r]));
    const theirs = new Map((merged[table] as Rec[]).map((r) => [id(r), r]));
    changes[table] = {
      put: [...theirs.values()].filter((r) => {
        const m = mine.get(id(r));
        return !m || version(m) !== version(r);
      }),
      remove: [...mine.keys()].filter((k) => !theirs.has(k)),
    };
  }
  const knownTombs = new Map(local.tombstones.map((t) => [t.key, t.deletedAt]));
  const tombstones = merged.tombstones.filter((t) => knownTombs.get(t.key) !== t.deletedAt);
  return { ...changes, tombstones };
}

/** True when two copies hold the same records at the same versions (so nothing needs uploading). */
export function sameData(a: SyncData, b: SyncData): boolean {
  for (const table of TABLES) {
    const { id, version } = KEYS[table];
    const as = a[table] as Rec[];
    const bs = (b[table] ?? []) as Rec[];
    if (as.length !== bs.length) return false;
    const bv = new Map(bs.map((r) => [id(r), version(r)]));
    if (as.some((r) => bv.get(id(r)) !== version(r))) return false;
  }
  const bt = new Map((b.tombstones ?? []).map((t) => [t.key, t.deletedAt]));
  return a.tombstones.length === bt.size && a.tombstones.every((t) => bt.get(t.key) === t.deletedAt);
}

export const emptySyncData = (): SyncData => ({ notes: [], highlights: [], bookmarks: [], prayers: [], tombstones: [] });
