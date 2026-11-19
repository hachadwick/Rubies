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

export const db = new Dexie('rubies') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  highlights: EntityTable<Highlight, 'key'>;
  bookmarks: EntityTable<Bookmark, 'key'>;
  prayers: EntityTable<Prayer, 'id'>;
};

db.version(1).stores({
  notes: 'id, date, updatedAt, *verseKeys',
  highlights: 'key',
  bookmarks: 'key, createdAt',
});
db.version(2).stores({
  prayers: 'id, createdAt, followUpOn',
});

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
  return { notes, highlights: backup.highlights?.length ?? 0, bookmarks: backup.bookmarks?.length ?? 0, prayers };
}
