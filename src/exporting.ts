import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';
import { hasSpeaker, kindLabel, type Note } from './db';
import { renderInkImages, type InkImage } from './ink';
import { copyText, escapeHtml, formatDate, noteTitle, quoteParts, safeFileName } from './util';

/** Present only in the desktop (Electron) app; see electron/preload.cjs. */
declare global {
  interface Window {
    rubiesDesktop?: {
      savePdf: (html: string, fileName: string) => Promise<'saved' | 'canceled'>;
      openEmail: (mailto: string) => Promise<void>;
    };
  }
}

const ACCENT = '8B1E3F';

/** "Sermon · Wednesday, November 18, 2026 · Darren Verbout · Cabot, Arkansas" */
export function noteMetaParts(n: Note): string[] {
  const who = hasSpeaker(n.kind) ? [n.speaker.trim(), n.church.trim()] : [];
  return [kindLabel(n.kind), formatDate(n.date, { dateStyle: 'full' }), ...who].filter(Boolean);
}

export function noteFileBase(n: Note): string {
  return safeFileName(`${noteTitle(n)}${n.date ? ` (${n.date})` : ''}`);
}

/** Plain-text version of a note, for sharing, email and the clipboard. */
export function noteToText(n: Note): string {
  const body = n.bodyText.replace(/\n{3,}/g, '\n\n').trim();
  const ink = n.ink.length ? '\n\n(This note also has handwritten notes, viewable in Rubies.)' : '';
  return `${noteTitle(n)}\n${noteMetaParts(n).join(' · ')}\n\n${body}${ink}`.trim();
}

/** Saves a file: download / save dialog on computers, share sheet on phones and tablets. */
export async function saveBlob(name: string, blob: Blob): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const touchDevice = matchMedia('(pointer: coarse)').matches;
  if (touchDevice && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

type RunFormat = { -readonly [K in 'bold' | 'italics' | 'strike' | 'highlight']?: IRunOptions[K] } & { underline?: boolean };

function inlineRuns(node: Node, fmt: RunFormat = {}): TextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return text ? [new TextRun({ text, ...fmt, underline: fmt.underline ? {} : undefined })] : [];
  }
  if (!(node instanceof HTMLElement)) return [];
  const next: RunFormat = { ...fmt };
  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      next.bold = true;
      break;
    case 'EM':
    case 'I':
      next.italics = true;
      break;
    case 'U':
      next.underline = true;
      break;
    case 'S':
    case 'DEL':
      next.strike = true;
      break;
    case 'MARK':
      next.highlight = 'yellow';
      break;
    case 'BR':
      return [new TextRun({ text: '', break: 1 })];
  }
  return [...node.childNodes].flatMap((c) => inlineRuns(c, next));
}

interface BlockCtx {
  quote: boolean;
  listInstance: { n: number };
}

const quoteStyle = (quote: boolean): Partial<IParagraphOptions> =>
  quote
    ? {
        indent: { left: 360 },
        spacing: { before: 60, after: 60 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
      }
    : {};

function blocks(node: Node, ctx: BlockCtx): Paragraph[] {
  if (!(node instanceof HTMLElement)) {
    const text = node.textContent?.trim();
    return text ? [new Paragraph({ children: [new TextRun(text)], ...quoteStyle(ctx.quote) })] : [];
  }
  switch (node.tagName) {
    case 'P':
      return [new Paragraph({ children: inlineRuns(node), spacing: { after: 120 }, ...quoteStyle(ctx.quote) })];
    case 'H1':
    case 'H2':
    case 'H3':
      return [
        new Paragraph({
          children: inlineRuns(node),
          heading: node.tagName === 'H1' ? HeadingLevel.HEADING_1 : node.tagName === 'H2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        }),
      ];
    case 'BLOCKQUOTE': {
      // “The quoted words” in quotation marks, then — Who said them, right-aligned underneath.
      const inQuote = { ...ctx, quote: true };
      const { lead, body, cite } = quoteParts(node);
      const mark = (text: string) => new TextRun({ text, bold: true, color: ACCENT });
      const paras = body.flatMap((c, i) => {
        if (!(c instanceof HTMLElement && c.tagName === 'P')) return blocks(c, inQuote);
        const runs = inlineRuns(c);
        return [
          new Paragraph({
            children: [...(i === 0 ? [mark('“')] : []), ...runs, ...(i === body.length - 1 ? [mark('”')] : [])],
            spacing: { after: 120 },
            ...quoteStyle(true),
          }),
        ];
      });
      const citePara = cite
        ? [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `— ${cite}`, bold: true, color: '666666', size: 20 })],
              ...quoteStyle(true),
            }),
          ]
        : [];
      return [...(lead ? blocks(lead, inQuote) : []), ...paras, ...citePara];
    }
    case 'UL':
    case 'OL':
      return listItems(node, ctx, 0);
    case 'HR':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 4 } } })];
    default:
      return [...node.childNodes].flatMap((c) => blocks(c, ctx));
  }
}

function listItems(list: HTMLElement, ctx: BlockCtx, level: number): Paragraph[] {
  const ordered = list.tagName === 'OL';
  const instance = ordered ? ++ctx.listInstance.n : 0;
  const out: Paragraph[] = [];
  for (const li of [...list.children]) {
    const nested: HTMLElement[] = [];
    const runs: TextRun[] = [];
    for (const child of [...li.childNodes]) {
      if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(child);
      else {
        if (runs.length && child instanceof HTMLElement && child.tagName === 'P') runs.push(new TextRun({ text: '', break: 1 }));
        runs.push(...inlineRuns(child));
      }
    }
    out.push(
      new Paragraph({
        children: runs,
        ...(ordered ? { numbering: { reference: 'numbered', level, instance } } : { bullet: { level } }),
        ...quoteStyle(ctx.quote),
      }),
    );
    for (const n of nested) out.push(...listItems(n, ctx, Math.min(level + 1, 2)));
  }
  return out;
}

function inkParagraphs(images: InkImage[]): Paragraph[] {
  if (!images.length) return [];
  const widthPx = 624; // 6.5" text column at 96 dpi
  return [
    new Paragraph({ text: 'Handwritten notes', heading: HeadingLevel.HEADING_2, pageBreakBefore: false }),
    ...images.map(
      (img) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: 'png',
              data: img.png,
              transformation: { width: widthPx, height: Math.round((widthPx * img.height) / img.width) },
            }),
          ],
        }),
    ),
  ];
}

export async function exportWord(n: Note): Promise<void> {
  const html = new DOMParser().parseFromString(`<div>${n.bodyHtml}</div>`, 'text/html').body.firstElementChild!;
  const ctx: BlockCtx = { quote: false, listInstance: { n: 0 } };
  const body = blocks(html, ctx);
  const ink = await renderInkImages(n.ink);

  const doc = new Document({
    creator: 'Rubies',
    title: noteTitle(n),
    description: noteMetaParts(n).join(' · '),
    styles: {
      default: { document: { run: { font: 'Calibri', size: 24 } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', run: { font: 'Georgia', size: 48, bold: true, color: '222222' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 120 } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
            { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
          ],
        },
      ],
    },
    sections: [
      {
        // US Letter, 1" margins
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: [
          new Paragraph({ text: noteTitle(n), heading: HeadingLevel.TITLE, spacing: { after: 80 } }),
          new Paragraph({
            children: [new TextRun({ text: noteMetaParts(n).join('  ·  '), color: '666666', size: 22 })],
            spacing: { after: 300 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDDD', space: 8 } },
          }),
          ...body,
          ...inkParagraphs(ink),
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  await saveBlob(`${noteFileBase(n)}.docx`, blob);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** A self-contained, print-ready HTML page for the note. */
export function noteToPrintHtml(n: Note, ink: InkImage[]): string {
  const inkHtml = ink.length
    ? `<h2>Handwritten notes</h2>${ink.map((i) => `<img class="ink" src="${i.dataUrl}" alt="Handwritten notes">`).join('')}`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(noteTitle(n))}</title>
<style>
  @page { size: letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1d1d1d; font: 12pt/1.55 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif; }
  h1 { margin: 0 0 4pt; font: 700 24pt/1.2 Georgia, 'Times New Roman', serif; }
  .meta { margin: 0 0 18pt; padding-bottom: 10pt; border-bottom: 1px solid #ddd; color: #666; font-size: 10.5pt; }
  h2 { margin: 16pt 0 6pt; color: #${ACCENT}; font-size: 15pt; break-after: avoid; }
  h3 { margin: 12pt 0 4pt; font-size: 13pt; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 22pt; }
  li p { margin: 0; }
  blockquote { margin: 6pt 0 10pt; padding: 6pt 12pt; border-left: 4px solid #${ACCENT}; background: #f6f3ef;
    font-family: Georgia, 'Times New Roman', serif; break-inside: avoid; }
  blockquote p { margin: 2pt 0; }
  blockquote strong { color: #${ACCENT}; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 0.85em; }
  blockquote > p:first-child:not(:has(> strong:only-child))::before,
  blockquote > p:first-child:has(> strong:only-child) + p::before { content: '\\201C'; color: #${ACCENT}; font-weight: 700; }
  blockquote > p:has(+ cite)::after, blockquote > p:last-child::after { content: '\\201D'; color: #${ACCENT}; font-weight: 700; }
  blockquote > cite { display: block; margin-top: 3pt; text-align: right; font: 600 10pt 'Segoe UI', system-ui, sans-serif; color: #666; }
  blockquote > cite::before { content: '\\2014\\00A0'; }
  blockquote > cite:empty { display: none; }
  blockquote > p:has(+ cite:empty)::after { content: '\\201D'; }
  mark { background: #fde68a; }
  img.ink { display: block; width: 100%; margin: 0 0 8pt; break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head>
<body>
  <h1>${escapeHtml(noteTitle(n))}</h1>
  <div class="meta">${noteMetaParts(n).map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>
  ${n.bodyHtml}
  ${inkHtml}
</body></html>`;
}

/**
 * Desktop app: writes a PDF file straight to disk (save dialog).
 * Browsers / iPad: opens the print dialog, where "Save as PDF" is available.
 */
export async function exportPdf(n: Note): Promise<'saved' | 'canceled' | 'printed'> {
  const html = noteToPrintHtml(n, await renderInkImages(n.ink));
  if (window.rubiesDesktop) return window.rubiesDesktop.savePdf(html, `${noteFileBase(n)}.pdf`);

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  await new Promise<void>((res) => {
    frame.onload = () => res();
    frame.srcdoc = html;
  });
  const win = frame.contentWindow!;
  await Promise.all([...win.document.images].map((img) => img.decode().catch(() => undefined)));
  win.focus();
  win.print();
  setTimeout(() => frame.remove(), 60_000);
  return 'printed';
}

// ---------------------------------------------------------------------------
// Share, email, copy
// ---------------------------------------------------------------------------

/** True where the system share sheet exists (iPad, iPhone, Android, Mac Safari, Windows Edge/Chrome). */
export const canShare = () => typeof navigator.share === 'function' && !window.rubiesDesktop;

export async function shareNote(n: Note): Promise<boolean> {
  try {
    await navigator.share({ title: noteTitle(n), text: noteToText(n) });
    return true;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return false;
    throw err;
  }
}

/** Opens a new email in the default mail app with the note as the message. */
export async function emailNote(n: Note): Promise<void> {
  let body = noteToText(n);
  // Mail apps reject very long mailto: links; long notes are trimmed with a pointer to the export options.
  if (body.length > 1800) body = `${body.slice(0, 1800)}…\n\n(Note shortened. Export it to Word or PDF to send the full note.)`;
  const url = `mailto:?subject=${encodeURIComponent(noteTitle(n))}&body=${encodeURIComponent(body)}`;
  if (window.rubiesDesktop) await window.rubiesDesktop.openEmail(url);
  else window.location.href = url;
}

export async function copyNote(n: Note): Promise<void> {
  await copyText(noteToText(n));
}
