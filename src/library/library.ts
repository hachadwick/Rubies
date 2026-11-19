import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { db, newId, type LibraryBook, type LibrarySection } from '../db';
import { parseBook } from './parse';
import { readPdf } from './pdf';

/**
 * Imports a PDF into the Library: reads its text, works out its chapters, paragraphs and sentences, and saves
 * that as text (the PDF itself isn't kept). pdf.js is only downloaded the first time a book is imported.
 */
export async function importPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<LibraryBook> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const contents = await readPdf(pdfjs, new Uint8Array(await file.arrayBuffer()), onProgress, signal);
  const parsed = parseBook(contents.pages, { fileName: file.name, metaTitle: contents.metaTitle, outline: contents.outline });
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
  const now = Date.now();
  const book: LibraryBook = {
    id: newId(),
    title: parsed.title,
    author: contents.metaAuthor?.trim() ?? '',
    fileName: file.name,
    pageCount: contents.pages.length,
    sections: parsed.sections.map((s) => ({ title: s.title, pg: s.paras.find((p) => p.pg)?.pg ?? '' })),
    importedAt: now,
    updatedAt: now,
  };
  const sections: LibrarySection[] = parsed.sections.map((s, index) => ({ bookId: book.id, index, title: s.title, paras: s.paras }));
  await db.transaction('rw', db.libraryBooks, db.librarySections, async () => {
    await db.libraryBooks.add(book);
    await db.librarySections.bulkAdd(sections);
  });
  return book;
}

export async function deleteBook(id: string): Promise<void> {
  await db.transaction('rw', db.libraryBooks, db.librarySections, async () => {
    await db.librarySections.where('bookId').equals(id).delete();
    await db.libraryBooks.delete(id);
  });
}

/** Where a passage comes from: "Gerald Flurry, The Father’s Love, pp. 7–8". */
export function citation(book: Pick<LibraryBook, 'title' | 'author'>, pages: string[]): string {
  const pgs = [...new Set(pages.filter(Boolean))];
  const where = !pgs.length ? '' : pgs.length === 1 ? `, p. ${pgs[0]}` : `, pp. ${pgs[0]}–${pgs[pgs.length - 1]}`;
  return `${book.author.trim() ? `${book.author.trim()}, ` : ''}${book.title}${where}`;
}

/** Text for searching: lower case, straight apostrophes and quotes. */
export const normalize = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
