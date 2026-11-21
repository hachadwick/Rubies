import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import songList from './songs.json';

/**
 * The Hymnal: The Bible Hymnal, built into the app like the Bible (see scripts/build-hymnal.mjs). Its pages of
 * music are in public/hymnal.pdf with everything else trimmed off, so page N of that file is the page printed
 * "N" in the book. Page numbers everywhere here are those printed ones.
 */
export interface Song {
  /** The printed page it starts on, which is also its number in the book. */
  page: number;
  /** 1, or 2 when it carries on over the page. */
  pages: number;
  title: string;
  /** The scripture it's from ("Psalm 23"), if any. */
  ref: string;
  /** Who wrote the words and music. */
  by: string;
}

export const SONGS = songList as Song[];
export const LAST_PAGE = SONGS[SONGS.length - 1].page + SONGS[SONGS.length - 1].pages - 1;
/** Every page is the same size, in PDF points. */
export const PAGE_RATIO = 522 / 684;

const byPage = new Map<number, Song>();
for (const s of SONGS) for (let i = 0; i < s.pages; i++) byPage.set(s.page + i, s);

/** The song printed on a page (the second page of a two-page song belongs to that song). */
export function songAt(page: number): Song {
  return byPage.get(Math.min(Math.max(Math.round(page) || 1, 1), LAST_PAGE))!;
}

/** The pages a song is printed on: [16, 17]. */
export const songPages = (s: Song): number[] => Array.from({ length: s.pages }, (_, i) => s.page + i);

/** The song after (1) or before (-1) this one, or undefined at either end of the book. */
export function neighbour(s: Song, dir: 1 | -1): Song | undefined {
  return SONGS[SONGS.indexOf(s) + dir];
}

const fold = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ');

/** Songs whose title, scripture, writer or page number match every word typed. */
export function searchSongs(query: string): Song[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return SONGS;
  return SONGS.filter((s) => {
    const hay = fold(`${s.page} ${s.title} ${s.ref} ${s.by}`);
    return terms.every((t) => hay.includes(t));
  });
}

let doc: Promise<PDFDocumentProxy> | null = null;

/** Opens the hymnal (once). pdf.js is the same reader used for importing books, loaded only when it's needed. */
export function loadHymnal(): Promise<PDFDocumentProxy> {
  doc ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    // The whole file in one go: it's already on the device (precached), and it's read back to front many times.
    return pdfjs.getDocument({ url: `${import.meta.env.BASE_URL}hymnal.pdf`, disableRange: true, disableStream: true, disableAutoFetch: true }).promise;
  })().catch((e) => {
    doc = null;
    throw e;
  });
  return doc;
}

/** The widest a page is ever drawn, in real pixels: sharp on a big screen without using endless memory. */
const MAX_PIXELS_WIDE = 2600;

/**
 * Draws a page into a canvas, `cssWidth` CSS pixels wide, as sharp as the screen. The canvas keeps showing what it
 * had until the new drawing is ready. Returns a function that stops a drawing that's no longer wanted.
 */
export function drawPage(page: number, canvas: HTMLCanvasElement, cssWidth: number, onDone?: (error?: Error) => void): () => void {
  let cancelled = false;
  let task: RenderTask | null = null;
  (async () => {
    const pdf = await loadHymnal();
    if (cancelled) return;
    const p = await pdf.getPage(page);
    if (cancelled) return;
    const base = p.getViewport({ scale: 1 });
    const pixels = Math.min(Math.round(cssWidth * Math.min(window.devicePixelRatio || 1, 3)), MAX_PIXELS_WIDE);
    const viewport = p.getViewport({ scale: pixels / base.width });
    const buffer = document.createElement('canvas');
    buffer.width = Math.round(viewport.width);
    buffer.height = Math.round(viewport.height);
    const ctx = buffer.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, buffer.width, buffer.height);
    task = p.render({ canvas: buffer, canvasContext: ctx, viewport });
    await task.promise;
    if (cancelled) return;
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    canvas.getContext('2d')!.drawImage(buffer, 0, 0);
    buffer.width = buffer.height = 0;
    onDone?.();
  })().catch((e: Error) => {
    if (!cancelled && e?.name !== 'RenderingCancelledException') onDone?.(e);
  });
  return () => {
    cancelled = true;
    task?.cancel();
  };
}
