import Dexie, { type EntityTable } from 'dexie';

export interface InkPoint {
  x: number;
  y: number;
  /** Pen pressure 0–1 (0.5 for mouse/finger). */
  p: number;
}

export interface InkStroke {
  points: InkPoint[];
  color: string;
  size: number;
  /** Highlighter strokes are drawn wide and translucent. */
  highlighter?: boolean;
}

export type NoteKind = 'sermon' | 'sermonette' | 'bible-study' | 'personal-study';

export const NOTE_KINDS: { value: NoteKind; label: string }[] = [
  { value: 'sermon', label: 'Sermon' },
  { value: 'sermonette', label: 'Sermonette' },
  { value: 'bible-study', label: 'Bible Study' },
  { value: 'personal-study', label: 'Personal Study' },
];

export const kindLabel = (k: NoteKind | undefined) => NOTE_KINDS.find((x) => x.value === k)?.label ?? 'Sermon';

/** Whether this type of note has a speaker and location. Personal study is on your own, so it has neither. */
export const hasSpeaker = (k: NoteKind | undefined) => k !== 'personal-study';

export interface Note {
  id: string;
  /** What kind of message this is. Notes saved before this field existed have none; treat as 'sermon'. */
  kind?: NoteKind;
  title: string;
  /** ISO date (yyyy-mm-dd) of the sermon. */
  date: string;
  speaker: string;
  /** Shown as "Location" in the app (where the message was given). */
  church: string;
  /** Main passage as typed, e.g. "Romans 8:28-39". */
  passage: string;
  /** Rich text body as HTML (TipTap). */
  bodyHtml: string;
  /** Plain text of the body, used for search and export. */
  bodyText: string;
  /** Handwritten ink, in a fixed 1000-unit-wide coordinate space. */
  ink: InkStroke[];
  /** Every verse key ("book:chapter:verse") this note cites; indexed for "notes citing this verse". */
  verseKeys: string[];
  createdAt: number;
  updatedAt: number;
  /** When the person last marked the note reviewed (ms). Never reviewed: counts from createdAt (see review.ts). */
  lastReviewedAt?: number;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

export interface Highlight {
  key: string;
  color: HighlightColor;
  createdAt: number;
}

export interface Bookmark {
  key: string;
  label: string;
  createdAt: number;
}

/** Someone or something to pray for, often jotted down during a message. */
export interface Prayer {
  id: string;
  /** Who or what to pray for, as typed. */
  text: string;
  /** When it was added to the list (ms). */
  createdAt: number;
  /** ISO date (yyyy-mm-dd) to follow up, if one was set. */
  followUpOn?: string;
  /** The note it was added from, if any. */
  noteId?: string;
  /** Title of that note at the time, so the list can say where it came from even if the note is deleted. */
  noteTitle?: string;
  /** When it was marked answered (ms). */
  answeredAt?: number;
  /** Last day (yyyy-mm-dd) a follow-up reminder was shown, so each is shown once a day. */
  remindedOn?: string;
  updatedAt: number;
}

/**
 * A book imported into the Library from a PDF. Its text is stored as sections (chapters) in `librarySections`,
 * each loaded on its own like a chapter of the Bible.
 *
 * With sync on, the list of books goes in the sync file like notes do, and each book's text is its own file in
 * the same Google Drive folder (`fileId`), uploaded once and downloaded once by each device. Books aren't part of
 * exported backups.
 */
export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  fileName: string;
  pageCount: number;
  /** Each section's title and the page it starts on. */
  sections: { title: string; pg: string }[];
  importedAt: number;
  updatedAt: number;
  /** The Google Drive file holding the book's text, once it has been uploaded for syncing. */
  fileId?: string;
}

/** The file in Google Drive holding one book's text. */
export interface LibraryBookFile {
  app: 'rubies-book';
  version: 1;
  book: LibraryBook;
  sections: LibrarySection[];
}

export interface LibrarySection {
  bookId: string;
  index: number;
  title: string;
  /** Paragraphs of sentences; `pg` is the printed page each starts on ('' if unknown), `h` marks headings. */
  paras: { s: string[]; pg: string; h?: 1 }[];
}

/** The tables that are backed up and synced. */
export const SYNCED_TABLES = ['notes', 'highlights', 'bookmarks', 'prayers', 'libraryBooks'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * A record of something deleted on this device, so that syncing removes it everywhere instead of bringing it back
 * from another device's copy. `key` is "table:id".
 */
export interface Tombstone {
  key: string;
  table: SyncedTable;
  id: string;
  deletedAt: number;
}

export const db = new Dexie('rubies') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  highlights: EntityTable<Highlight, 'key'>;
  bookmarks: EntityTable<Bookmark, 'key'>;
  prayers: EntityTable<Prayer, 'id'>;
  tombstones: EntityTable<Tombstone, 'key'>;
  libraryBooks: EntityTable<LibraryBook, 'id'>;
  librarySections: Dexie.Table<LibrarySection, [string, number]>;
};

db.version(1).stores({
  notes: 'id, date, updatedAt, *verseKeys',
  highlights: 'key',
  bookmarks: 'key, createdAt',
});
db.version(2).stores({
  prayers: 'id, createdAt, followUpOn',
});
db.version(3).stores({
  tombstones: 'key',
});
db.version(4).stores({
  libraryBooks: 'id, importedAt',
  librarySections: '[bookId+index], bookId',
});

/** Set on a transaction that's applying deletions from the cloud, which already carry their own tombstones. */
export const FROM_SYNC = '__rubiesFromSync';

// Every delete from a synced table leaves a tombstone (written once the delete has gone through).
for (const table of SYNCED_TABLES) {
  db.table(table).hook('deleting', function (primKey, _obj, trans) {
    for (let t: { parent?: unknown } | undefined = trans; t; t = t.parent as typeof t) {
      if ((t as Record<string, unknown>)[FROM_SYNC]) return;
    }
    trans.on('complete', () => {
      const id = String(primKey);
      db.tombstones.put({ key: `${table}:${id}`, table, id, deletedAt: Date.now() }).catch(() => {});
    });
  });
}

/**
 * A new random id. crypto.randomUUID() only exists on HTTPS and localhost, so when Rubies is opened over a
 * plain http:// address on the local network, a v4 UUID is made from crypto.getRandomValues (available everywhere).
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function newNote(): Note {
  const now = Date.now();
  return {
    id: newId(),
    kind: 'sermon',
    title: '',
    date: new Date(now - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
    speaker: '',
    church: '',
    passage: '',
    bodyHtml: '',
    bodyText: '',
    ink: [],
    verseKeys: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Asks the browser not to evict our data under storage pressure (important on iPad Safari). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export interface Backup {
  app: 'rubies';
  version: 1;
  exportedAt: string;
  notes: Note[];
  highlights: Highlight[];
  bookmarks: Bookmark[];
  /** Added later; older backups have none. */
  prayers?: Prayer[];
  /** Deletions, in the cloud sync file (not in exported backups). */
  tombstones?: Tombstone[];
  /** The Library's books (without their text), in the cloud sync file (not in exported backups). */
  libraryBooks?: LibraryBook[];
}

export async function exportBackup(): Promise<Backup> {
  const [notes, highlights, bookmarks, prayers] = await Promise.all([
    db.notes.toArray(),
    db.highlights.toArray(),
    db.bookmarks.toArray(),
    db.prayers.toArray(),
  ]);
  return { app: 'rubies', version: 1, exportedAt: new Date().toISOString(), notes, highlights, bookmarks, prayers };
}

/** Merges a backup into this device. Newer copies of the same note win. */
export async function importBackup(backup: Backup): Promise<{ notes: number; highlights: number; bookmarks: number; prayers: number }> {
  if (backup?.app !== 'rubies' || !Array.isArray(backup.notes)) throw new Error('This is not a Rubies backup file.');
  let notes = 0;
  let prayers = 0;
  await db.transaction('rw', [db.notes, db.highlights, db.bookmarks, db.prayers], async () => {
    for (const p of backup.prayers ?? []) {
      const existing = await db.prayers.get(p.id);
      if (!existing || existing.updatedAt < p.updatedAt) {
        await db.prayers.put(p);
        prayers++;
      }
    }
    for (const n of backup.notes) {
      const existing = await db.notes.get(n.id);
      if (!existing || existing.updatedAt < n.updatedAt) {
        await db.notes.put({ ...newNote(), ...n });
        notes++;
      }
    }
    await db.highlights.bulkPut(backup.highlights ?? []);
    await db.bookmarks.bulkPut(backup.bookmarks ?? []);
  });
  // Importing something on purpose brings it back even if it was deleted here before.
  await db.tombstones.bulkDelete([
    ...backup.notes.map((n) => `notes:${n.id}`),
    ...(backup.prayers ?? []).map((p) => `prayers:${p.id}`),
    ...(backup.highlights ?? []).map((h) => `highlights:${h.key}`),
    ...(backup.bookmarks ?? []).map((b) => `bookmarks:${b.key}`),
  ]);
  return { notes, highlights: backup.highlights?.length ?? 0, bookmarks: backup.bookmarks?.length ?? 0, prayers };
}
