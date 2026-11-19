import { db, FROM_SYNC, type LibraryBook, type LibraryBookFile, type LibrarySection } from '../db';
import { GoogleError } from './google';

/**
 * Syncing the Library. The list of books travels in the sync file like notes (see merge.ts); each book's text is
 * its own file in the same Drive folder, so the sync file stays small. A book's text never changes after it's
 * imported, so it's uploaded once (by the device that imported it) and downloaded once by each other device.
 */

/** The Drive calls used here (a fake one in tests). */
export interface BookDrive {
  upload(name: string, data: unknown): Promise<string>;
  download(id: string): Promise<unknown>;
  remove(id: string): Promise<void>;
}

/** Marks a transaction as sync's own, so deleting doesn't record a new deletion. */
function fromSync(tx: unknown) {
  (tx as Record<string, unknown>)[FROM_SYNC] = true;
}

/**
 * Uploads the text of books imported on this device that aren't in Drive yet, and notes where each went.
 * Returns how many were uploaded.
 */
export async function uploadNewBooks(drive: BookDrive): Promise<number> {
  const books = (await db.libraryBooks.toArray()).filter((b) => !b.fileId);
  for (const b of books) {
    const sections = await db.librarySections.where('bookId').equals(b.id).sortBy('index');
    const file: LibraryBookFile = { app: 'rubies-book', version: 1, book: b, sections };
    const fileId = await drive.upload(`rubies-book-${b.id}.json`, file);
    const still = await db.transaction('rw', db.libraryBooks, async (tx) => {
      fromSync(tx);
      return (await db.libraryBooks.update(b.id, { fileId })) > 0;
    });
    // Removed while it was uploading: take the file back out.
    if (!still) await drive.remove(fileId);
  }
  return books.length;
}

/**
 * Of the books sync wants on this device, the ones that can go in now: those already here (a new title or author),
 * and those whose text was downloaded. A book whose file has gone from Drive is left out.
 */
export async function fetchBooks(drive: BookDrive, wanted: LibraryBook[]): Promise<{ books: LibraryBook[]; sections: LibrarySection[] }> {
  const books: LibraryBook[] = [];
  const sections: LibrarySection[] = [];
  for (const b of wanted) {
    if (await db.librarySections.get([b.id, 0])) {
      books.push(b);
      continue;
    }
    if (!b.fileId) continue;
    let file: Partial<LibraryBookFile> | null;
    try {
      file = (await drive.download(b.fileId)) as Partial<LibraryBookFile> | null;
    } catch (e) {
      if (e instanceof GoogleError && e.status === 404) continue;
      throw e;
    }
    if (file?.app !== 'rubies-book' || !Array.isArray(file.sections) || !file.sections.length) continue;
    books.push(b);
    sections.push(...file.sections.map((s) => ({ ...s, bookId: b.id })));
  }
  return { books, sections };
}

/** Puts synced books on this device and removes ones deleted elsewhere (inside sync's own transaction). */
export async function applyBooks(put: { books: LibraryBook[]; sections: LibrarySection[] }, remove: string[]) {
  if (put.sections.length) await db.librarySections.bulkPut(put.sections);
  if (put.books.length) await db.libraryBooks.bulkPut(put.books);
  if (remove.length) {
    await db.librarySections.where('bookId').anyOf(remove).delete();
    await db.libraryBooks.bulkDelete(remove);
  }
}

/** Deletes the Drive files of books that are no longer in the library anywhere. */
export async function removeBookFiles(drive: BookDrive, before: LibraryBook[], after: LibraryBook[]) {
  const kept = new Set(after.map((b) => b.id));
  for (const b of before) if (!kept.has(b.id) && b.fileId) await drive.remove(b.fileId);
}
