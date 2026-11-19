/**
 * Turns the positioned text of a PDF's pages into a readable book: paragraphs of sentences, grouped into
 * sections (chapters). This is plain logic with no PDF library in it, so it can be tested; see pdf.ts for
 * the part that reads the file.
 *
 * Books laid out for print carry things that aren't part of the text — running heads, page numbers, drop caps,
 * words hyphenated across lines — and none of them say where a paragraph or chapter starts. This works those
 * out from the layout:
 * - Body text is the most common font size. Lines in the top and bottom margins that are smaller than that,
 *   only a number, or repeated on several pages are running heads and page numbers, and are dropped.
 * - A big single letter (a drop cap) is put back at the start of its word.
 * - A new paragraph starts at an indented line, after a wider gap than usual, or after a heading.
 * - Lines in larger type are headings. Very large ones start a chapter, unless the PDF has its own table of
 *   contents (bookmarks), which is used instead. A book with neither is split every ten pages.
 */

export interface RawItem {
  str: string;
  /** Left edge and baseline, in PDF units from the bottom left of the page. */
  x: number;
  y: number;
  w: number;
  /** Font height. */
  h: number;
}

export interface RawPage {
  items: RawItem[];
  width: number;
  height: number;
  /** The page number printed on the page, where the PDF says (else its position in the file; '' if unknown). */
  label: string;
}

/** A paragraph: its sentences, and the page it starts on. Headings are a single "sentence". */
export interface Para {
  s: string[];
  pg: string;
  h?: 1;
}

export interface ParsedSection {
  title: string;
  paras: Para[];
}

export interface ParsedBook {
  title: string;
  sections: ParsedSection[];
}

export interface OutlineEntry {
  title: string;
  /** Index of the page it points to (0-based). */
  page: number;
}

interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  h: number;
  page: number;
  /** Part of a paragraph that opens with a drop cap (indented around it, so not a new paragraph). */
  besideDrop?: boolean;
  /** The first line beside a drop cap: the paragraph starts here. */
  dropStart?: boolean;
}

const LABEL_LINE =
  /^(introduction|preface|foreword|prologue|epilogue|postscript|afterword|conclusion|appendix(\s+\w+)?|contents|acknowledgments?|dedication|(chapter|part|book|lesson|section|study)\s+[\w.]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|[0-9]+|[ivxlc]+)\.?$/i;

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'of', 'in', 'on', 'at', 'to', 'by', 'as', 'from', 'with', 'into', 'unto']);

/** "A FATHER’S HEARTACHE" → "A Father’s Heartache". Leaves text that isn't all capitals alone. */
export function titleCase(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return s;
  let first = true;
  return s.toLowerCase().replace(/[a-z][a-z’'.]*/g, (w) => {
    const keep = !first && SMALL_WORDS.has(w);
    first = false;
    return keep ? w : w[0].toUpperCase() + w.slice(1);
  }).replace(/(^|[.!?:—–]\s*|[‘“"(]\s*)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** The most common font height in the body text, weighted by how much text is set in it. */
function bodyHeight(pages: RawPage[]): number {
  const counts = new Map<number, number>();
  for (const p of pages)
    for (const it of p.items) {
      const n = it.str.trim().length;
      if (!n || it.h <= 0) continue;
      const k = Math.round(it.h * 2) / 2;
      counts.set(k, (counts.get(k) ?? 0) + n);
    }
  let best = 10;
  let most = 0;
  for (const [h, n] of counts) if (n > most) [best, most] = [h, n];
  return best;
}

const mode = (xs: number[]) => {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(Math.round(x), (counts.get(Math.round(x)) ?? 0) + 1);
  let best = xs[0] ?? 0;
  let most = 0;
  for (const [x, n] of counts) if (n > most || (n === most && x < best)) [best, most] = [x, n];
  return best;
};

/** Groups a page's text pieces into lines, top to bottom, and puts drop caps back. */
function pageLines(page: RawPage, pageIndex: number, body: number): Line[] {
  const seen = new Set<string>();
  const items: RawItem[] = [];
  const drops: RawItem[] = [];
  for (const it of page.items) {
    if (!it.str) continue;
    const key = `${it.str}|${Math.round(it.x)}|${Math.round(it.y)}`;
    if (seen.has(key)) continue; // some PDFs draw the same text twice
    seen.add(key);
    // L E T T E R - S P A C E D words
    const str = /^(\S )+\S$/.test(it.str) ? it.str.replace(/ /g, '') : it.str;
    const item = { ...it, str };
    if (/^[\p{L}]{1,2}$/u.test(str.trim()) && it.h >= body * 2.5) drops.push(item);
    else items.push(item);
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: RawItem[][] = [];
  for (const it of items) {
    const tol = Math.max(2, Math.min(it.h || body, body) * 0.45);
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= tol);
    if (row) row.push(it);
    else rows.push([it]);
  }

  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    let h = 0;
    for (const it of row) {
      if (it.str.trim()) h = Math.max(h, it.h);
      if (text && !/\s$/.test(text) && !/^\s/.test(it.str) && it.x - end > Math.max(it.h, body) * 0.15) text += ' ';
      text += it.str;
      end = Math.max(end, it.x + it.w);
    }
    text = text.replace(/­/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const first = row.find((it) => it.str.trim()) ?? row[0];
    lines.push({ text, x: first.x, y: row[0].y, right: end, h: h || body, page: pageIndex });
  }
  lines.sort((a, b) => b.y - a.y || a.x - b.x);

  for (const d of drops) {
    const beside = lines.filter((l) => l.x > d.x && l.y >= d.y - body * 0.5 && l.y <= d.y + d.h);
    if (!beside.length) {
      lines.push({ text: d.str.trim(), x: d.x, y: d.y, right: d.x + d.w, h: body, page: pageIndex, dropStart: true });
      continue;
    }
    beside[0].text = d.str.trim() + beside[0].text;
    beside[0].dropStart = true;
    for (const l of beside) l.besideDrop = true;
  }
  lines.sort((a, b) => b.y - a.y || a.x - b.x);
  return lines;
}

/**
 * Drops running heads and page numbers from the top and bottom margins: lines there that are only a number,
 * appear on several pages, or are in small type set apart from the text.
 */
function stripMargins(pages: Line[][], raw: RawPage[], body: number): Line[][] {
  const inBand = (l: Line) => {
    const H = raw[l.page].height;
    return l.y > H * 0.88 || l.y < H * 0.12;
  };
  const keyOf = (l: Line) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#]/g, '');
  const counts = new Map<string, number>();
  for (const lines of pages) for (const k of new Set(lines.filter(inBand).map(keyOf))) counts.set(k, (counts.get(k) ?? 0) + 1);
  return pages.map((lines) =>
    lines.filter((l, i) => {
      if (!inBand(l)) return true;
      if (/^[\divxlc\s.|·•–—-]*$/i.test(l.text) || (counts.get(keyOf(l)) ?? 0) >= 3) return false;
      const gaps = [lines[i - 1], lines[i + 1]].filter((o): o is Line => !!o && o.y !== l.y).map((o) => Math.abs(o.y - l.y));
      return !(l.h < body * 0.9 && Math.min(Infinity, ...gaps) > body * 1.8);
    }),
  );
}

/** Joins the lines of a paragraph, undoing hyphenation at line ends. */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!out) {
      out = line;
      continue;
    }
    const m = /([\p{L}]+)-$/u.exec(out);
    if (m && /^\p{Ll}/u.test(line) && !/^(self|well|non|ex|all|half|cross|so|co|anti|pre|post|re|God|Spirit)$/i.test(m[1])) {
      out = out.slice(0, -1) + line;
    } else if (/[\p{L}]-$/u.test(out) || /[—–]$/.test(out) || /^[—–]/.test(line)) {
      out += line;
    } else {
      out += ' ' + line;
    }
  }
  return out;
}

const ABBREV =
  /(?:^|[\s(“"‘])(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Rev|Prof|Gen|Col|Lt|Capt|Sgt|Mt|vs|etc|cf|ch|chap|vol|no|nos|p|pp|v|vv|ed|eds|trans|approx|ca|e\.g|i\.e|[A-Z])\.$/;

let segmenter: Intl.Segmenter | null | undefined;

/** Splits a paragraph into sentences. */
export function splitSentences(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
  const raw = segmenter
    ? [...segmenter.segment(text)].map((s) => s.segment)
    : (text.match(/[^.!?]+(?:[.!?]+[”’"')\]]*\s*|$)/g) ?? [text]);
  const out: string[] = [];
  for (const piece of raw) {
    const s = piece.trim();
    if (!s) continue;
    const prev = out[out.length - 1];
    // Re-join a split after an abbreviation ("Mr. Armstrong", "Herbert W. Armstrong"), or before
    // something that can't start a sentence (a lowercase word, a closing bracket, a verse reference).
    const joins =
      ABBREV.test(prev ?? '') ||
      /^[\p{Ll})\]”’,;:]/u.test(s) ||
      /^\d+[:)]/.test(s) ||
      /^\([^)]{1,40}\)[.!?]?[”’"]?$/.test(s) || // a reference after a quotation: “…” (Luke 15:18).
      s.length < 3;
    if (prev && joins) out[out.length - 1] = `${prev} ${s}`;
    else out.push(s);
  }
  return out;
}

interface Block {
  lines: Line[];
  heading: boolean;
  /** Set on headings big enough to start a chapter. */
  chapter: boolean;
}

/** Works out where paragraphs and headings start. */
function blocks(pages: Line[][], body: number): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  let prev: Line | null = null;
  const tol = body * 0.4;
  for (const lines of pages) {
    // The left margin: the usual start of lines near the leftmost one (a hanging “ can sit a little further left).
    const xs = lines.filter((l) => l.h < body * 1.3 && !l.besideDrop).map((l) => l.x);
    const left = Math.min(...xs);
    const margin = mode(xs.filter((x) => x <= left + body * 0.6));
    for (const l of lines) {
      const heading = l.h >= body * 1.3;
      const samePage = prev && prev.page === l.page;
      const gap = samePage ? prev!.y - l.y : 0;
      let start: boolean;
      if (heading) {
        start = !cur || !cur.heading || !samePage || gap > Math.max(l.h, prev!.h) * 2.5;
      } else if (!cur || cur.heading || l.dropStart) {
        start = true;
      } else if (samePage && gap > body * 2) {
        start = true;
      } else if (l.besideDrop) {
        start = false;
      } else {
        // Indented, when the line before wasn't (so a whole indented block quote stays together).
        const indented = l.x > margin + tol;
        const prevIndented = samePage ? prev!.x > margin + tol && !prev!.besideDrop : false;
        start = indented && !prevIndented;
      }
      if (start) {
        cur = { lines: [l], heading, chapter: heading && l.h >= body * 1.8 };
        out.push(cur);
      } else {
        cur!.lines.push(l);
        if (heading && l.h >= body * 1.8) cur!.chapter = true;
      }
      prev = l;
    }
  }
  return out;
}

/**
 * A heading's parts: any label line ("CHAPTER 1"), then the main words, then a smaller subtitle.
 * "CHAPTER 1 / YOUR SPECTACULAR / COVENANT" → ["Chapter 1", "Your Spectacular Covenant"].
 */
function headingParts(b: Block): string[] {
  const labels: string[] = [];
  const rest: Line[] = [];
  for (const l of b.lines) {
    if (!rest.length && LABEL_LINE.test(l.text.trim())) labels.push(l.text.trim());
    else rest.push(l);
  }
  const big = Math.max(0, ...rest.map((l) => l.h));
  const main = joinLines(rest.filter((l) => l.h >= big * 0.4).map((l) => l.text));
  const sub = joinLines(rest.filter((l) => l.h < big * 0.4).map((l) => l.text));
  return [labels.join(' '), main, sub].filter(Boolean).map(titleCase);
}

/** A chapter's name from its heading: "Chapter 1 — Your Spectacular Baptismal Covenant". */
function headingTitle(b: Block): string {
  const parts = headingParts(b);
  const title = parts.slice(0, parts.length > 1 && LABEL_LINE.test(parts[0]) ? 2 : 1).join(' — ');
  return title.length > 90 ? `${title.slice(0, 88).trimEnd()}…` : title;
}

function toPara(b: Block, labels: string[]): Para {
  const pg = labels[b.lines[0].page];
  if (b.heading) return { s: headingParts(b), pg, h: 1 };
  return { s: splitSentences(joinLines(b.lines.map((l) => l.text))), pg };
}

export function cleanFileName(name: string): string {
  return (
    name
      .replace(/\.pdf$/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/[_]+/g, ' ')
      .trim() || 'Untitled book'
  );
}

export function parseBook(raw: RawPage[], opts: { fileName: string; metaTitle?: string; outline?: OutlineEntry[] }): ParsedBook {
  const body = bodyHeight(raw);
  const pages = stripMargins(
    raw.map((p, i) => pageLines(p, i, body)),
    raw,
    body,
  );
  const labels = raw.map((p) => p.label);
  const bs = blocks(pages, body).filter((b) => b.lines.some((l) => l.text.trim()));
  if (!bs.some((b) => !b.heading)) throw new Error('No text found in this PDF. It may be scanned pages (pictures of text), which can’t be imported.');

  const sections: ParsedSection[] = [];
  const outline = (opts.outline ?? []).filter((o) => o.title.trim() && o.page >= 0).sort((a, b) => a.page - b.page);

  if (outline.length >= 2) {
    // The PDF's own table of contents.
    let oi = -1;
    for (const b of bs) {
      const page = b.lines[0].page;
      while (oi + 1 < outline.length && outline[oi + 1].page <= page) {
        oi++;
        sections.push({ title: outline[oi].title.trim(), paras: [] });
      }
      if (!sections.length) sections.push({ title: 'Opening pages', paras: [] });
      sections[sections.length - 1].paras.push(toPara(b, labels));
    }
  } else if (bs.filter((b) => b.chapter).length >= 2) {
    // Big headings start chapters (a heading on a page with nothing else yet joins the one before it,
    // so a title page stays in one piece).
    for (const b of bs) {
      const last = sections[sections.length - 1];
      if (b.chapter && (!last || last.paras.some((p) => !p.h))) sections.push({ title: headingTitle(b), paras: [] });
      else if (!last) sections.push({ title: 'Opening pages', paras: [] });
      sections[sections.length - 1].paras.push(toPara(b, labels));
    }
  } else {
    // Ten pages at a time.
    const per = 10;
    for (const b of bs) {
      const chunk = Math.floor(b.lines[0].page / per);
      let last = sections[sections.length - 1] as (ParsedSection & { chunk?: number }) | undefined;
      if (!last || last.chunk !== chunk) {
        const from = chunk * per;
        const to = Math.min(raw.length, from + per) - 1;
        last = { title: `Pages ${labels[from] || from + 1}–${labels[to] || to + 1}`, paras: [], chunk };
        sections.push(last);
      }
      last.paras.push(toPara(b, labels));
    }
    for (const s of sections) delete (s as { chunk?: number }).chunk;
  }

  const meta = opts.metaTitle?.trim();
  const usableMeta = meta && !/\.(docx?|indd|pdf|qxd|pages)$|^(untitled|microsoft word)/i.test(meta) ? meta : '';
  // A big heading on the first page that isn't a chapter label is the title page.
  const firstHeading = bs[0]?.heading && bs[0].lines[0].page === 0 ? headingParts(bs[0])[0] : '';
  const title = usableMeta || (firstHeading && !LABEL_LINE.test(firstHeading) ? firstHeading : '') || cleanFileName(opts.fileName);

  return { title, sections: sections.filter((s) => s.paras.length) };
}

/** Every sentence's text, for search. */
export function sectionText(paras: Para[]): string {
  return paras.map((p) => p.s.join(' ')).join('\n');
}
