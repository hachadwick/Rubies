import { findBookExact, isFullName } from '../bible/books';
import { chapterCount, verseCount } from '../bible/kjv';
import type { Ref } from '../bible/reference';

/** A Bible reference found in a book's text: where it is, and the passage it points to. */
export interface FoundRef {
  start: number;
  end: number;
  ref: Ref;
}

// "Luke 15:17", "1 Timothy 2:3-6", "Matt. 24:14", "Song of Solomon 2:4", "Luke 15" (a whole chapter).
const FULL =
  /(?<![\p{L}\d])((?:[1-3]|I{1,3})\s?)?([A-Z][a-z]+(?: of [A-Z][a-z]+)?)\.?\s(\d{1,3})(?::(\d{1,3})(?:\s?[-–—]\s?(\d{1,3})(?::(\d{1,3}))?)?)?(?![\d:])/gu;
// After a reference: "; 14:31" (another chapter of the same book) or ", 31" / ", 31-33" (more verses).
const MORE_CHAPTER = /^(\s?[;,]\s?)(\d{1,3}):(\d{1,3})(?:\s?[-–—]\s?(\d{1,3}))?(?![\d:])/;
const MORE_VERSE = /^(\s?,\s?)(\d{1,3})(?:\s?[-–—]\s?(\d{1,3}))?(?![\d:])/;
// "verse 20", "verses 18-19", "vv. 22-24": the chapter of the last reference.
const VERSES = /\b(?:verses?|vv?\.)\s(\d{1,3})(?:\s?[-–—]\s?(\d{1,3}))?(?![\d:])/gi;

/** Names that are also ordinary words or first names, so "Mark 2" alone isn't taken as a chapter. */
const NEEDS_VERSE = new Set(['mark', 'job', 'numbers', 'judges', 'ruth', 'james', 'john', 'acts', 'kings', 'lamentations']);

const exists = (r: Ref) => {
  const chapters = chapterCount(r.book);
  if (r.chapter < 1 || r.chapter > chapters) return false;
  if (r.verse === undefined) return true;
  const verses = verseCount(r.book, r.chapter);
  return r.verse >= 1 && r.verse <= verses && (r.endVerse === undefined || r.endChapter !== undefined || r.endVerse >= r.verse);
};

/**
 * Finds Bible references in a sentence. `context` is the last reference before it (in this sentence or an
 * earlier one), which "verse 20" refers back to; it's updated as references are found.
 */
export function findRefs(text: string, context: { last?: Ref } = {}): FoundRef[] {
  const found: FoundRef[] = [];
  const taken = (s: number, e: number) => found.some((f) => s < f.end && e > f.start);

  // Every match of both kinds, in reading order, so "verse 20" follows the reference just before it.
  const matches: { index: number; full?: RegExpExecArray; verses?: RegExpExecArray }[] = [];
  for (const m of text.matchAll(FULL)) matches.push({ index: m.index!, full: m as RegExpExecArray });
  for (const m of text.matchAll(VERSES)) matches.push({ index: m.index!, verses: m as RegExpExecArray });
  matches.sort((a, b) => a.index - b.index);

  for (const { index, full, verses } of matches) {
    if (full) {
      const [all, prefix = '', name, c, v, e1, e2] = full;
      const book = findBookExact(prefix + name);
      if (!book) continue;
      // A whole chapter ("Luke 15") only with the book's full name, and not for names that are everyday words.
      if (!v && (!isFullName(book, prefix + name) || NEEDS_VERSE.has(name.toLowerCase()))) continue;
      const ref: Ref = { book: book.id, chapter: Number(c) };
      if (v) {
        ref.verse = Number(v);
        if (e1 && e2) {
          ref.endChapter = Number(e1);
          ref.endVerse = Number(e2);
        } else if (e1) ref.endVerse = Number(e1);
      }
      if (!exists(ref) || taken(index, index + all.length)) continue;
      found.push({ start: index, end: index + all.length, ref });
      context.last = ref;

      // Follow-on references to the same book.
      let at = index + all.length;
      for (;;) {
        const rest = text.slice(at);
        const mc = MORE_CHAPTER.exec(rest);
        const mv = mc ? null : ref.verse !== undefined ? MORE_VERSE.exec(rest) : null;
        const m = mc ?? mv;
        if (!m) break;
        const last = context.last!;
        const next: Ref = mc
          ? { book: book.id, chapter: Number(mc[2]), verse: Number(mc[3]), endVerse: mc[4] ? Number(mc[4]) : undefined }
          : { book: book.id, chapter: last.endChapter ?? last.chapter, verse: Number(m[2]), endVerse: m[3] ? Number(m[3]) : undefined };
        if (!exists(next)) break;
        const start = at + m[1].length;
        found.push({ start, end: at + m[0].length, ref: next });
        context.last = next;
        at += m[0].length;
      }
    } else if (verses && context.last && !taken(index, index + verses[0].length)) {
      const last = context.last;
      const ref: Ref = {
        book: last.book,
        chapter: last.endChapter ?? last.chapter,
        verse: Number(verses[1]),
        endVerse: verses[2] ? Number(verses[2]) : undefined,
      };
      if (!exists(ref)) continue;
      found.push({ start: index, end: index + verses[0].length, ref });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The references in every sentence of a section, keyed "paragraph:sentence". "verse 20" can refer back to a
 * reference earlier in the same paragraph or the one before it.
 */
export function sectionRefs(paras: { s: string[]; h?: 1 }[]): Map<string, FoundRef[]> {
  const out = new Map<string, FoundRef[]>();
  const context: { last?: Ref } = {};
  let sinceLast = 0;
  paras.forEach((p, pi) => {
    if (p.h) {
      context.last = undefined;
      return;
    }
    // A reference from several paragraphs back is too far away for "verse 20" to mean it.
    if (++sinceLast > 2) context.last = undefined;
    p.s.forEach((s, si) => {
      const refs = findRefs(s, context);
      if (refs.length) {
        out.set(`${pi}:${si}`, refs);
        sinceLast = 0;
      }
    });
  });
  return out;
}
