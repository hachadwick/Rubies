import { bookById, findBook } from './books';

/** A passage reference. `verse` undefined = whole chapter(s). */
export interface Ref {
  book: number;
  chapter: number;
  verse?: number;
  endChapter?: number;
  endVerse?: number;
}

/** Stable key for a single verse, used for highlights, bookmarks and note citations. */
export const verseKey = (book: number, chapter: number, verse: number) => `${book}:${chapter}:${verse}`;

export function parseKey(key: string): { book: number; chapter: number; verse: number } {
  const [book, chapter, verse] = key.split(':').map(Number);
  return { book, chapter, verse };
}

const REF_RE =
  /^\s*((?:[1-3]|i{1,3})\s*)?([a-z][a-z .]*?)\.?\s*(?:(\d+)(?:\s*[:.]\s*(\d+))?(?:\s*[-–—]\s*(\d+)(?:\s*[:.]\s*(\d+))?)?)?\s*$/i;

/**
 * Parses a user-typed reference such as "John 3:16", "jn 3:16-18", "1 Cor 13", "Ps 23:1-6",
 * "Gen 1:1-2:3" or just "Romans". Returns undefined if it isn't a reference.
 */
export function parseRef(input: string): Ref | undefined {
  const m = REF_RE.exec(input);
  if (!m) return undefined;
  const [, prefix = '', name, c, v, e1, e2] = m;
  const book = findBook(prefix + name);
  if (!book) return undefined;
  const ref: Ref = { book: book.id, chapter: c ? Number(c) : 1 };
  if (v) {
    ref.verse = Number(v);
    if (e1 && e2) {
      ref.endChapter = Number(e1);
      ref.endVerse = Number(e2);
    } else if (e1) {
      ref.endVerse = Number(e1);
    }
  } else if (e1 && !e2) {
    // "Ps 120-122" is a chapter range
    ref.endChapter = Number(e1);
  }
  return ref;
}

/**
 * Splits "John 3:16; Rom 5:8" into several references. Later parts may omit the book:
 * "John 3:16, 18" adds verse 18 of the same chapter, "John 3:16; 4:1" moves to chapter 4.
 * Returns [] if any part fails to parse.
 */
export function parseRefs(input: string): Ref[] {
  const out: Ref[] = [];
  for (const part of input.split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    let ref = /^\d+\s*([:.\-–—]|$)/.test(trimmed) && out.length ? undefined : parseRef(trimmed);
    const prev = out[out.length - 1];
    if (!ref && prev) {
      const bare = /^(\d+)(?:\s*[:.]\s*(\d+))?(?:\s*[-–—]\s*(\d+))?$/.exec(trimmed);
      if (bare) {
        const [, a, b, e] = bare;
        const end = e ? Number(e) : undefined;
        if (b) ref = { book: prev.book, chapter: Number(a), verse: Number(b), endVerse: end };
        else if (prev.verse !== undefined)
          ref = { book: prev.book, chapter: prev.endChapter ?? prev.chapter, verse: Number(a), endVerse: end };
        else ref = { book: prev.book, chapter: Number(a), endChapter: end };
      }
    }
    if (!ref) return [];
    out.push(ref);
  }
  return out;
}

export function formatRef(ref: Ref, short = false): string {
  const b = bookById(ref.book);
  let s = `${short ? b.short : b.name} ${ref.chapter}`;
  if (ref.verse !== undefined) {
    s += `:${ref.verse}`;
    if (ref.endChapter !== undefined && ref.endChapter !== ref.chapter) s += `–${ref.endChapter}:${ref.endVerse}`;
    else if (ref.endVerse !== undefined && ref.endVerse !== ref.verse) s += `–${ref.endVerse}`;
  } else if (ref.endChapter !== undefined && ref.endChapter !== ref.chapter) {
    s += `–${ref.endChapter}`;
  }
  return s;
}

const TEXT_REF_RE =
  /(?<![A-Za-z])((?:[1-3]|I{1,3})\s?)?([A-Z][a-z]+(?: of [A-Z][a-z]+)?)\.?\s(\d{1,3}):(\d{1,3})(?:\s?[-–—]\s?(\d{1,3})(?::(\d{1,3}))?)?/g;

/** Finds every "Book chapter:verse" reference written in free text (e.g. sermon notes). */
export function extractRefs(text: string): Ref[] {
  const out: Ref[] = [];
  for (const m of text.matchAll(TEXT_REF_RE)) {
    const [, prefix = '', name, c, v, e1, e2] = m;
    const book = findBook(prefix + name) ?? (prefix ? findBook(name) : undefined);
    if (!book) continue;
    const ref: Ref = { book: book.id, chapter: Number(c), verse: Number(v) };
    if (e1 && e2) {
      ref.endChapter = Number(e1);
      ref.endVerse = Number(e2);
    } else if (e1) ref.endVerse = Number(e1);
    out.push(ref);
  }
  return out;
}
