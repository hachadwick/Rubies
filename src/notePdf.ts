import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { Note } from './db';
import type { InkImage } from './ink';
import { noteTitle, quoteParts } from './util';

/**
 * Writes a note as a PDF file, in the app itself (the single-note "PDF" export uses the print dialog or the
 * desktop app's printer instead, which can't make several files at once). Used for the zip of every note.
 *
 * It lays the note out much as the printed one looks: title, a line of details, then headings, paragraphs, lists
 * and quotes with their bold, italic, underline, strike-through and highlighting, and any handwriting as pictures.
 * The built-in PDF fonts only have Western letters, so anything else in a note is written as "?".
 */

const PAGE = { width: 612, height: 792, margin: 54 }; // US Letter, 0.75" margins
const ACCENT = rgb(0x8b / 255, 0x1e / 255, 0x3f / 255);
const INK = rgb(0.11, 0.11, 0.11);
const GREY = rgb(0.4, 0.4, 0.4);
const QUOTE_BG = rgb(0.965, 0.953, 0.937);
const MARK = rgb(0.992, 0.902, 0.541);

type Family = 'sans' | 'serif';
interface Fmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  mark?: boolean;
  color?: ReturnType<typeof rgb>;
}
interface Run extends Fmt {
  text: string;
}
interface Piece extends Fmt {
  text: string;
  width: number;
  font: PDFFont;
  space: boolean;
}
interface ParaStyle {
  size: number;
  family?: Family;
  /** Extra space from the left margin, and how much narrower on the right. */
  indent?: number;
  /** Text drawn to the left of the first line (a bullet or number), inside the indent. */
  marker?: string;
  align?: 'left' | 'right';
  after?: number;
  before?: number;
  /** Inside a quote: tinted background with a ruby bar down the side. */
  quote?: boolean;
  lineHeight?: number;
}

class Writer {
  private page!: PDFPage;
  private y = 0;
  private readonly allowed = new Map<PDFFont, Set<number>>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Record<Family, Record<'r' | 'b' | 'i' | 'bi', PDFFont>>,
  ) {
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  private font(family: Family, f: Fmt): PDFFont {
    return this.fonts[family][f.bold && f.italic ? 'bi' : f.bold ? 'b' : f.italic ? 'i' : 'r'];
  }

  /** Only the letters the font has: anything else would stop the whole file being written. */
  private clean(text: string, font: PDFFont): string {
    let set = this.allowed.get(font);
    if (!set) this.allowed.set(font, (set = new Set(font.getCharacterSet())));
    let out = '';
    for (const ch of text.replace(/[  -  ]/g, ' ').replace(/[​-‍﻿]/g, '')) {
      out += set.has(ch.codePointAt(0)!) ? ch : '?';
    }
    return out;
  }

  /** Makes sure there is room for this much; starts a new page if not. */
  private need(height: number) {
    if (this.y - height < PAGE.margin) this.newPage();
  }

  gap(points: number) {
    this.y -= points;
  }

  rule(color = rgb(0.85, 0.85, 0.85)) {
    this.need(8);
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.width - PAGE.margin, y: this.y }, thickness: 0.75, color });
    this.y -= 8;
  }

  /** A paragraph of runs, wrapped to the page and carried onto new pages as needed. */
  para(runs: Run[], style: ParaStyle) {
    const family = style.family ?? 'sans';
    const size = style.size;
    const lineHeight = style.lineHeight ?? size * 1.5;
    const quotePad = style.quote ? 12 : 0;
    const left = PAGE.margin + (style.indent ?? 0) + quotePad;
    const width = PAGE.width - PAGE.margin - quotePad - left;

    // Words and the spaces between them, each measured in its own font; '\n' is a line break.
    const lines: Piece[][] = [[]];
    let lineWidth = 0;
    const push = (p: Piece) => {
      const line = lines[lines.length - 1];
      if (p.space) {
        // No space at the start of a line.
        if (line.length) {
          line.push(p);
          lineWidth += p.width;
        }
        return;
      }
      if (line.length && lineWidth + p.width > width) {
        while (line.length && line[line.length - 1].space) line.pop();
        lines.push([]);
        lineWidth = 0;
      }
      lines[lines.length - 1].push(p);
      lineWidth += p.width;
    };
    for (const run of runs) {
      const font = this.font(family, run);
      for (const part of run.text.split(/(\n|[ \t]+)/)) {
        if (!part) continue;
        if (part === '\n') {
          lines.push([]);
          lineWidth = 0;
          continue;
        }
        const space = /^[ \t]+$/.test(part);
        let text = space ? ' ' : this.clean(part, font);
        // A "word" wider than the line (a long link) is cut to fit.
        while (!space && font.widthOfTextAtSize(text, size) > width && text.length > 1) {
          let n = text.length - 1;
          while (n > 1 && font.widthOfTextAtSize(text.slice(0, n), size) > width - lineWidth) n--;
          if (lineWidth && font.widthOfTextAtSize(text.slice(0, n), size) > width - lineWidth) {
            lines.push([]);
            lineWidth = 0;
            continue;
          }
          const head = text.slice(0, n);
          push({ ...run, text: head, width: font.widthOfTextAtSize(head, size), font, space: false });
          lines.push([]);
          lineWidth = 0;
          text = text.slice(n);
        }
        push({ ...run, text, width: font.widthOfTextAtSize(text, size), font, space });
      }
    }
    if (!lines.some((l) => l.some((p) => !p.space))) return;

    this.y -= style.before ?? 0;
    lines.forEach((line, i) => {
      this.need(lineHeight);
      const top = this.y;
      this.y -= lineHeight;
      const base = this.y + (lineHeight - size) / 2 + size * 0.22;
      if (style.quote) {
        const x = PAGE.margin + (style.indent ?? 0);
        // Slightly overlapping the line before, so the tint has no hairline gaps.
        this.page.drawRectangle({ x, y: this.y, width: PAGE.width - PAGE.margin - x, height: top - this.y + 0.5, color: QUOTE_BG });
        this.page.drawRectangle({ x, y: this.y, width: 3, height: top - this.y + 0.5, color: ACCENT });
      }
      if (i === 0 && style.marker) {
        const f = this.font(family, {});
        const marker = this.clean(style.marker, f);
        this.page.drawText(marker, { x: left - 6 - f.widthOfTextAtSize(marker, size), y: base, size, font: f, color: INK });
      }
      while (line.length && line[line.length - 1].space) line.pop();
      const used = line.reduce((w, p) => w + p.width, 0);
      let x = style.align === 'right' ? left + width - used : left;
      for (const p of line) {
        if (p.mark) this.page.drawRectangle({ x, y: base - size * 0.22, width: p.width, height: size * 1.15, color: MARK });
        if (!p.space) this.page.drawText(p.text, { x, y: base, size, font: p.font, color: p.color ?? INK });
        const stroke = { thickness: Math.max(0.5, size / 16), color: p.color ?? INK };
        if (p.underline) this.page.drawLine({ start: { x, y: base - size * 0.12 }, end: { x: x + p.width, y: base - size * 0.12 }, ...stroke });
        if (p.strike) this.page.drawLine({ start: { x, y: base + size * 0.28 }, end: { x: x + p.width, y: base + size * 0.28 }, ...stroke });
        x += p.width;
      }
    });
    this.y -= style.after ?? 0;
  }

  /** A picture across the page (handwriting), on a new page if it doesn't fit on this one. */
  image(img: PDFImage, pixelWidth: number, pixelHeight: number) {
    const maxWidth = PAGE.width - PAGE.margin * 2;
    const maxHeight = PAGE.height - PAGE.margin * 2;
    const scale = Math.min(maxWidth / pixelWidth, maxHeight / pixelHeight);
    const w = pixelWidth * scale;
    const h = pixelHeight * scale;
    this.need(h);
    this.page.drawImage(img, { x: PAGE.margin + (maxWidth - w) / 2, y: this.y - h, width: w, height: h });
    this.y -= h + 8;
  }
}

/** The text of an element as runs, with its bold, italic and the rest. */
function runsOf(node: Node, fmt: Fmt = {}): Run[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ');
    return text ? [{ ...fmt, text }] : [];
  }
  if (!(node instanceof HTMLElement)) return [];
  const next = { ...fmt };
  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      next.bold = true;
      break;
    case 'EM':
    case 'I':
      next.italic = true;
      break;
    case 'U':
      next.underline = true;
      break;
    case 'S':
    case 'DEL':
      next.strike = true;
      break;
    case 'MARK':
      next.mark = true;
      break;
    case 'BR':
      return [{ ...fmt, text: '\n' }];
  }
  return [...node.childNodes].flatMap((c) => runsOf(c, next));
}

const BODY = 11.5;

function block(w: Writer, node: Node, ctx: { quote: boolean; indent: number }) {
  if (!(node instanceof HTMLElement)) {
    const text = node.textContent?.trim();
    if (text) w.para([{ text }], { size: BODY, after: 7, quote: ctx.quote, indent: ctx.indent, family: ctx.quote ? 'serif' : 'sans' });
    return;
  }
  const family: Family = ctx.quote ? 'serif' : 'sans';
  switch (node.tagName) {
    case 'P':
      w.para(runsOf(node), { size: BODY, after: ctx.quote ? 0 : 7, quote: ctx.quote, indent: ctx.indent, family });
      return;
    case 'H1':
      w.para(runsOf(node, { bold: true }), { size: 18, before: 10, after: 4, indent: ctx.indent, quote: ctx.quote });
      return;
    case 'H2':
      w.para(runsOf(node, { bold: true, color: ACCENT }), { size: 15, before: 10, after: 4, indent: ctx.indent, quote: ctx.quote });
      return;
    case 'H3':
      w.para(runsOf(node, { bold: true }), { size: 13, before: 8, after: 3, indent: ctx.indent, quote: ctx.quote });
      return;
    case 'BLOCKQUOTE': {
      // “The quoted words” in quotation marks, then — who said them, on the right underneath.
      const { lead, body, cite } = quoteParts(node);
      const inQuote = { quote: true, indent: ctx.indent };
      const mark = (text: string): Run => ({ text, bold: true, color: ACCENT });
      w.gap(4);
      if (lead) w.para(runsOf(lead, { bold: true, color: ACCENT }), { size: 10, quote: true, indent: ctx.indent });
      body.forEach((c, i) => {
        if (!(c instanceof HTMLElement && c.tagName === 'P')) return block(w, c, inQuote);
        w.para([...(i === 0 ? [mark('“')] : []), ...runsOf(c), ...(i === body.length - 1 ? [mark('”')] : [])], {
          size: BODY,
          quote: true,
          indent: ctx.indent,
          family: 'serif',
        });
      });
      if (cite) w.para([{ text: `— ${cite}`, bold: true, color: GREY }], { size: 10, quote: true, indent: ctx.indent, align: 'right' });
      w.gap(10);
      return;
    }
    case 'UL':
    case 'OL':
      list(w, node, ctx, 0);
      w.gap(ctx.quote ? 0 : 5);
      return;
    case 'HR':
      w.gap(4);
      w.rule();
      return;
    default:
      for (const c of [...node.childNodes]) block(w, c, ctx);
  }
}

function list(w: Writer, el: HTMLElement, ctx: { quote: boolean; indent: number }, level: number) {
  const ordered = el.tagName === 'OL';
  let n = Number(el.getAttribute('start')) || 1;
  for (const li of [...el.children]) {
    const nested: HTMLElement[] = [];
    const runs: Run[] = [];
    for (const child of [...li.childNodes]) {
      if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(child);
      else {
        // A second paragraph in the same item starts on a new line.
        if (runs.length && child instanceof HTMLElement && child.tagName === 'P') runs.push({ text: '\n' });
        runs.push(...runsOf(child));
      }
    }
    w.para(runs, {
      size: BODY,
      indent: ctx.indent + 22 * (level + 1),
      marker: ordered ? `${n++}.` : level ? '–' : '•',
      quote: ctx.quote,
      family: ctx.quote ? 'serif' : 'sans',
      after: 1,
    });
    for (const sub of nested) list(w, sub, ctx, Math.min(level + 1, 3));
  }
}

/** The note as the bytes of a PDF file. `meta` is the line under the title; `ink` is its handwriting. */
export async function noteToPdf(n: Note, meta: string[], ink: InkImage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(noteTitle(n));
  doc.setSubject(meta.join(' · '));
  doc.setCreator('Rubies');
  const [sr, sb, si, sbi, tr, tb, ti, tbi] = await Promise.all(
    [
      StandardFonts.Helvetica,
      StandardFonts.HelveticaBold,
      StandardFonts.HelveticaOblique,
      StandardFonts.HelveticaBoldOblique,
      StandardFonts.TimesRoman,
      StandardFonts.TimesRomanBold,
      StandardFonts.TimesRomanItalic,
      StandardFonts.TimesRomanBoldItalic,
    ].map((f) => doc.embedFont(f)),
  );
  const w = new Writer(doc, { sans: { r: sr, b: sb, i: si, bi: sbi }, serif: { r: tr, b: tb, i: ti, bi: tbi } });

  w.para([{ text: noteTitle(n), bold: true }], { size: 22, family: 'serif', lineHeight: 27, after: 2 });
  w.para([{ text: meta.join('  ·  '), color: GREY }], { size: 10, after: 6 });
  w.rule();
  w.gap(6);

  const html = new DOMParser().parseFromString(`<div>${n.bodyHtml}</div>`, 'text/html').body.firstElementChild!;
  block(w, html, { quote: false, indent: 0 });

  if (ink.length) {
    w.para([{ text: 'Handwritten notes', bold: true, color: ACCENT }], { size: 15, before: 10, after: 6 });
    for (const img of ink) w.image(await doc.embedPng(img.png), img.width, img.height);
  }
  return doc.save();
}
