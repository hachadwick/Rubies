import { bookById } from './books';
import { type Ref, verseKey } from './reference';

/** books[bookIndex][chapterIndex][verseIndex] = verse text */
let books: string[][][] | null = null;
let loading: Promise<void> | null = null;

export function loadBible(): Promise<void> {
  if (books) return Promise.resolve();
  loading ??= fetch(`${import.meta.env.BASE_URL}kjv.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load the Bible text (${r.status})`);
      return r.json();
    })
    .then((json: { books: string[][][] }) => {
      books = json.books;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** For tests and non-browser use. */
export function setBibleData(json: { books: string[][][] }) {
  books = json.books;
}

function data(): string[][][] {
  if (!books) throw new Error('Bible not loaded');
  return books;
}

export interface Verse {
  book: number;
  chapter: number;
  verse: number;
  text: string;
  key: string;
}

export const chapterCount = (book: number) => data()[book - 1]?.length ?? 0;
export const verseCount = (book: number, chapter: number) => data()[book - 1]?.[chapter - 1]?.length ?? 0;

export function getChapter(book: number, chapter: number): Verse[] {
  return (data()[book - 1]?.[chapter - 1] ?? []).map((text, i) => ({
    book,
    chapter,
    verse: i + 1,
    text,
    key: verseKey(book, chapter, i + 1),
  }));
}

/** Returns the verses a reference covers, clamped to what exists. Empty if the reference is invalid. */
export function getPassage(ref: Ref): Verse[] {
  const endChapter = Math.min(ref.endChapter ?? ref.chapter, chapterCount(ref.book));
  if (ref.chapter < 1 || ref.chapter > endChapter) return [];
  const out: Verse[] = [];
  for (let c = ref.chapter; c <= endChapter; c++) {
    let verses = getChapter(ref.book, c);
    if (ref.verse !== undefined) {
      const from = c === ref.chapter ? ref.verse : 1;
      const to = c === endChapter ? (ref.endVerse ?? (c === ref.chapter ? ref.verse : verses.length)) : verses.length;
      verses = verses.filter((v) => v.verse >= from && v.verse <= to);
    }
    out.push(...verses);
  }
  return out;
}

export function refKeys(ref: Ref): string[] {
  return getPassage(ref).map((v) => v.key);
}

export interface SearchResult {
  total: number;
  verses: Verse[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Keyword search. Every word must appear (case-insensitive, whole words; a trailing * matches a prefix,
 * e.g. "faith*" finds faithful). Text in "double quotes" is matched as a phrase.
 */
export function searchBible(query: string, limit = 200, testament?: 'OT' | 'NT'): SearchResult {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  const words = query.replace(/"[^"]*"/g, ' ').split(/\s+/).filter((w) => w && w !== '*');
  const tests = [
    ...phrases.map((p) => new RegExp(`\\b${escapeRe(p).replace(/\s+/g, '\\s+')}\\b`, 'i')),
    ...words.map((w) =>
      w.endsWith('*') ? new RegExp(`\\b${escapeRe(w.slice(0, -1))}`, 'i') : new RegExp(`\\b${escapeRe(w)}\\b`, 'i'),
    ),
  ];
  if (!tests.length) return { total: 0, verses: [] };
  const out: Verse[] = [];
  let total = 0;
  data().forEach((chapters, bi) => {
    if (testament && bookById(bi + 1).testament !== testament) return;
    chapters.forEach((verses, ci) =>
      verses.forEach((text, vi) => {
        if (tests.every((t) => t.test(text))) {
          total++;
          if (out.length < limit)
            out.push({ book: bi + 1, chapter: ci + 1, verse: vi + 1, text, key: verseKey(bi + 1, ci + 1, vi + 1) });
        }
      }),
    );
  });
  return { total, verses: out };
}
