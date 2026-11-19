import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The whole sync run with Library books, against a pretend Google Drive: one device imports a book, a second
 * (empty) device receives it, and removing it there removes it from Drive too.
 */

const files = new Map<string, { name: string; data: unknown }>();
let n = 0;

vi.mock('./google', async (orig) => {
  const real = await orig<typeof import('./google')>();
  const put = (id: string | null, name: string, data: unknown) => {
    const key = id ?? `f${++n}`;
    files.set(key, { name, data: JSON.parse(JSON.stringify(data)) });
    return key;
  };
  return {
    ...real,
    syncSupported: () => true,
    findSyncFile: async () => [...files].find(([, f]) => f.name === 'rubies-sync.json')?.[0] ?? null,
    downloadSyncFile: async (_t: string, id: string) => {
      if (!files.has(id)) throw new real.GoogleError('gone', 404);
      return files.get(id)!.data;
    },
    uploadSyncFile: async (_t: string, id: string | null, data: unknown) => put(id, 'rubies-sync.json', data),
    uploadFile: async (_t: string, id: string | null, name: string, data: unknown) => put(id, name, data),
    deleteFile: async (_t: string, id: string) => void files.delete(id),
  };
});

let sync: typeof import('./sync');
let dbm: typeof import('../db');

beforeAll(async () => {
  const store = new Map<string, string>([
    ['rubies.sync', JSON.stringify({ account: { email: 'test@example.com', name: 'Test' } })],
    ['rubies.syncToken', JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 3600_000 })],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  sync = await import('./sync');
  dbm = await import('../db');
});

const syncFile = () => [...files.values()].find((f) => f.name === 'rubies-sync.json')!.data as { libraryBooks: { id: string }[]; tombstones: { key: string }[] };
const bookFiles = () => [...files.values()].filter((f) => f.name.startsWith('rubies-book-'));

describe('syncing the Library', () => {
  it('moves a book from one device to another, then removes it everywhere', async () => {
    const { db } = dbm;
    // Device 1 imports a book.
    await db.libraryBooks.add({ id: 'b1', title: 'The Book', author: '', fileName: 'b.pdf', pageCount: 3, sections: [{ title: 'One', pg: '1' }], importedAt: 1, updatedAt: 1 });
    await db.librarySections.add({ bookId: 'b1', index: 0, title: 'One', paras: [{ s: ['Hello there.'], pg: '1' }] });
    await sync.syncNow();
    expect(syncFile().libraryBooks.map((b) => b.id)).toEqual(['b1']);
    expect(bookFiles()).toHaveLength(1);

    // Device 2 starts empty and receives it. (Clearing records deletions, which a new device wouldn't have.)
    await Promise.all(db.tables.map((t) => t.clear()));
    await new Promise((r) => setTimeout(r, 20));
    await db.tombstones.clear();
    await sync.syncNow();
    expect((await db.libraryBooks.get('b1'))?.title).toBe('The Book');
    expect((await db.librarySections.get(['b1', 0]))?.paras[0].s).toEqual(['Hello there.']);
    expect(bookFiles()).toHaveLength(1); // not uploaded a second time

    // Removing it there takes it out of the list and deletes its text from Drive.
    await db.transaction('rw', db.libraryBooks, db.librarySections, async () => {
      await db.librarySections.where('bookId').equals('b1').delete();
      await db.libraryBooks.delete('b1');
    });
    await new Promise((r) => setTimeout(r, 20)); // the deletion record is written after the delete
    await sync.syncNow();
    expect(syncFile().libraryBooks).toEqual([]);
    expect(syncFile().tombstones.map((t) => t.key)).toContain('libraryBooks:b1');
    expect(bookFiles()).toHaveLength(0);
  });
});
