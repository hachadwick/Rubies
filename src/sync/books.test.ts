import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type LibraryBook, type LibrarySection } from '../db';
import { applyBooks, fetchBooks, removeBookFiles, uploadNewBooks, type BookDrive } from './books';
import { GoogleError } from './google';
import { localChanges, mergeSyncData, emptySyncData } from './merge';

/** A pretend Google Drive folder. */
function fakeDrive() {
  const files = new Map<string, unknown>();
  let n = 0;
  const drive: BookDrive = {
    upload: async (_name, data) => {
      const id = `f${++n}`;
      files.set(id, JSON.parse(JSON.stringify(data)));
      return id;
    },
    download: async (id) => {
      if (!files.has(id)) throw new GoogleError('gone', 404);
      return files.get(id);
    },
    remove: async (id) => void files.delete(id),
  };
  return { drive, files };
}

const book = (id: string, updatedAt = 1, extra: Partial<LibraryBook> = {}): LibraryBook => ({
  id,
  title: `Book ${id}`,
  author: '',
  fileName: `${id}.pdf`,
  pageCount: 10,
  sections: [{ title: 'One', pg: '1' }, { title: 'Two', pg: '5' }],
  importedAt: 1,
  updatedAt,
  ...extra,
});
const sections = (bookId: string): LibrarySection[] => [
  { bookId, index: 0, title: 'One', paras: [{ s: ['First sentence.'], pg: '1' }] },
  { bookId, index: 1, title: 'Two', paras: [{ s: ['Second sentence.'], pg: '5' }] },
];

async function importLocally(id: string) {
  await db.libraryBooks.add(book(id));
  await db.librarySections.bulkAdd(sections(id));
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await new Promise((r) => setTimeout(r, 20)); // clearing records deletions; start without them
  await db.tombstones.clear();
});

describe('syncing Library books', () => {
  it('uploads a newly imported book once and remembers its file', async () => {
    const { drive, files } = fakeDrive();
    await importLocally('a');
    expect(await uploadNewBooks(drive)).toBe(1);
    const a = await db.libraryBooks.get('a');
    expect(a?.fileId).toBe('f1');
    expect(files.get('f1')).toMatchObject({ app: 'rubies-book', sections: [{ title: 'One' }, { title: 'Two' }] });
    expect(await uploadNewBooks(drive)).toBe(0); // not again
    // Uploading doesn't count as a deletion or edit.
    expect(await db.tombstones.count()).toBe(0);
    expect(a?.updatedAt).toBe(1);
  });

  it('brings a book from another device, text and all', async () => {
    const { drive } = fakeDrive();
    await importLocally('a');
    await uploadNewBooks(drive);
    const listed = (await db.libraryBooks.get('a'))!;
    // Now pretend to be a second device with an empty library.
    await Promise.all(db.tables.map((t) => t.clear()));
    await new Promise((r) => setTimeout(r, 20));
    await db.tombstones.clear();
    const local = emptySyncData();
    const merged = mergeSyncData(local, { ...emptySyncData(), libraryBooks: [listed] });
    const c = localChanges(local, merged);
    const got = await fetchBooks(drive, c.libraryBooks.put as LibraryBook[]);
    await applyBooks(got, c.libraryBooks.remove);
    expect((await db.libraryBooks.get('a'))?.title).toBe('Book a');
    expect((await db.librarySections.get(['a', 1]))?.paras[0].s).toEqual(['Second sentence.']);
  });

  it('takes a new title without downloading the text again', async () => {
    const { drive, files } = fakeDrive();
    await importLocally('a');
    await uploadNewBooks(drive);
    files.clear(); // a download would now fail
    const renamed = { ...(await db.libraryBooks.get('a'))!, title: 'Renamed', updatedAt: 5 };
    const got = await fetchBooks(drive, [renamed]);
    await applyBooks(got, []);
    expect((await db.libraryBooks.get('a'))?.title).toBe('Renamed');
  });

  it('skips a book whose file has gone from Drive', async () => {
    const { drive } = fakeDrive();
    const got = await fetchBooks(drive, [book('x', 1, { fileId: 'missing' })]);
    expect(got.books).toEqual([]);
  });

  it('removes a book deleted on another device, and its file', async () => {
    const { drive, files } = fakeDrive();
    await importLocally('a');
    await uploadNewBooks(drive);
    const listed = (await db.libraryBooks.get('a'))!;
    const local = { ...emptySyncData(), libraryBooks: [listed] };
    const remote = { ...emptySyncData(), libraryBooks: [listed], tombstones: [{ key: 'libraryBooks:a', table: 'libraryBooks' as const, id: 'a', deletedAt: 9 }] };
    const merged = mergeSyncData(local, remote);
    const c = localChanges(local, merged);
    await applyBooks(await fetchBooks(drive, c.libraryBooks.put as LibraryBook[]), c.libraryBooks.remove);
    expect(await db.libraryBooks.count()).toBe(0);
    expect(await db.librarySections.count()).toBe(0);
    await removeBookFiles(drive, remote.libraryBooks, merged.libraryBooks);
    expect(files.size).toBe(0);
  });

  it('records a deletion when a book is removed here', async () => {
    await importLocally('a');
    await db.libraryBooks.delete('a');
    await new Promise((r) => setTimeout(r, 20));
    expect((await db.tombstones.get('libraryBooks:a'))?.table).toBe('libraryBooks');
  });
});
