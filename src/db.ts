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

export type NoteKind = 'sermon' | 'sermonette' | 'bible-study';

export const NOTE_KINDS: { value: NoteKind; label: string }[] = [
  { value: 'sermon', label: 'Sermon' },
  { value: 'sermonette', label: 'Sermonette' },
  { value: 'bible-study', label: 'Bible Study' },
];

export const kindLabel = (k: NoteKind | undefined) => NOTE_KINDS.find((x) => x.value === k)?.label ?? 'Sermon';

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

export const db = new Dexie('rubies') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  highlights: EntityTable<Highlight, 'key'>;
  bookmarks: EntityTable<Bookmark, 'key'>;
};

db.version(1).stores({
  notes: 'id, date, updatedAt, *verseKeys',
  highlights: 'key',
  bookmarks: 'key, createdAt',
});

export function newNote(): Note {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
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
}

export async function exportBackup(): Promise<Backup> {
  const [notes, highlights, bookmarks] = await Promise.all([
    db.notes.toArray(),
    db.highlights.toArray(),
    db.bookmarks.toArray(),
  ]);
  return { app: 'rubies', version: 1, exportedAt: new Date().toISOString(), notes, highlights, bookmarks };
}

/** Merges a backup into this device. Newer copies of the same note win. */
export async function importBackup(backup: Backup): Promise<{ notes: number; highlights: number; bookmarks: number }> {
  if (backup?.app !== 'rubies' || !Array.isArray(backup.notes)) throw new Error('This is not a Rubies backup file.');
  let notes = 0;
  await db.transaction('rw', db.notes, db.highlights, db.bookmarks, async () => {
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
  return { notes, highlights: backup.highlights?.length ?? 0, bookmarks: backup.bookmarks?.length ?? 0 };
}
