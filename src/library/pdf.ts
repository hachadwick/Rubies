import type { OutlineEntry, RawPage } from './parse';

/** The parts of pdf.js used here (the module is loaded only when a book is imported; see load.ts). */
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export interface PdfContents {
  pages: RawPage[];
  metaTitle?: string;
  metaAuthor?: string;
  outline: OutlineEntry[];
  /** The first page as a small JPEG (a data: URL), for the Library shelf. Missing if it couldn't be drawn. */
  cover?: string;
}

/** The cover is drawn this wide: enough to stay sharp at shelf size on a high-density screen, and only a few KB. */
const COVER_WIDTH = 180;

/** Draws a page small and returns it as a JPEG data: URL (undefined if this browser can't, or the page is odd). */
async function drawCover(page: import('pdfjs-dist/legacy/build/pdf.mjs').PDFPageProxy): Promise<string | undefined> {
  try {
    const base = page.getViewport({ scale: 1 });
    if (!(base.width > 0 && base.height > 0)) return undefined;
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.min(Math.round(viewport.height), COVER_WIDTH * 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    // JPEG has no transparency: a page without its own background would come out black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const url = canvas.toDataURL('image/jpeg', 0.75);
    canvas.width = canvas.height = 0;
    return url.startsWith('data:image/jpeg') ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the text of every page of a PDF, with where each piece sits, plus its title, author and bookmarks.
 * `onPage` reports progress; `signal` stops it.
 */
export async function readPdf(
  pdfjs: PdfJs,
  data: Uint8Array,
  onPage?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<PdfContents> {
  const task = pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'PasswordException') throw new Error('This PDF is password protected. Remove the password and try again.');
    if (name === 'InvalidPDFException') throw new Error('This file isn’t a PDF, or it’s damaged.');
    throw e;
  }
  try {
    let labels: string[] | null = null;
    try {
      labels = await pdf.getPageLabels();
    } catch {
      /* none */
    }
    // Use the printed page numbers only where they make sense: plain numbers that go up through the book
    // (a cover labelled "173" or a front-matter label like "Sec0ii" gets none).
    const numeric = labels?.map((l) => (/^[0-9]+$/.test(l) ? Number(l) : null));
    const goodLabel = (i: number) => {
      const l = labels?.[i];
      if (!l) return labels ? '' : String(i + 1);
      if (/^[ivxlcdm]+$/i.test(l)) return l;
      const n = numeric![i];
      if (n === null) return '';
      return numeric!.slice(i + 1).some((m) => m !== null && m <= n) ? '' : l;
    };
    const pages: RawPage[] = [];
    let cover: string | undefined;
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
      const page = await pdf.getPage(i);
      const [x0, y0, x1, y1] = page.view;
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (!('str' in it)) continue;
        items.push({ str: it.str, x: it.transform[4] - x0, y: it.transform[5] - y0, w: it.width, h: it.height || Math.hypot(it.transform[2], it.transform[3]) });
      }
      pages.push({ items, width: x1 - x0, height: y1 - y0, label: goodLabel(i - 1) });
      if (i === 1) cover = await drawCover(page);
      page.cleanup();
      onPage?.(i, pdf.numPages);
    }

    let metaTitle: string | undefined;
    let metaAuthor: string | undefined;
    try {
      const { info } = (await pdf.getMetadata()) as { info: { Title?: string; Author?: string } };
      metaTitle = typeof info?.Title === 'string' ? info.Title : undefined;
      metaAuthor = typeof info?.Author === 'string' ? info.Author : undefined;
    } catch {
      /* none */
    }

    const outline: OutlineEntry[] = [];
    try {
      let top = (await pdf.getOutline()) ?? [];
      // A single bookmark holding all the others is the book's own name; use what's inside it.
      if (top.length === 1 && top[0].items?.length) top = top[0].items;
      for (const o of top) {
        let dest = o.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (!Array.isArray(dest) || dest[0] == null) continue;
        const ref = dest[0];
        const page = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
        outline.push({ title: o.title, page });
      }
    } catch {
      /* no usable bookmarks */
    }

    return { pages, metaTitle, metaAuthor, outline, cover };
  } finally {
    await task.destroy();
  }
}
