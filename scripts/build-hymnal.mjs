// Builds the Hymnal that ships with the app from the full PDF of The Bible Hymnal:
//   public/hymnal.pdf      only the pages of music (the cover, foreword and indexes are trimmed off)
//   src/hymnal/songs.json  each song's page, title, scripture and composer, and whether it runs onto a second page
// Page numbers are the printed ones (the number in the corner of each page), not the PDF's.
// Usage: node scripts/build-hymnal.mjs "path/to/The Bible Hymnal.pdf"
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/build-hymnal.mjs "path/to/The Bible Hymnal.pdf"');
  process.exit(1);
}
const bytes = readFileSync(src);

// Read the top of every page: the printed number sits in a top corner, the title and credits under it.
const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
const music = []; // { pdfIndex, n, title, credits }
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const [, y0, , y1] = page.view;
  const height = y1 - y0;
  const top = (await page.getTextContent()).items
    .filter((it) => 'str' in it && it.str.trim())
    .map((it) => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5] - y0, h: Math.round(it.height) }))
    .filter((t) => t.y > height - 100)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  page.cleanup();
  // A page of music has its number alone in the top corner in the large type, and staves full of music glyphs.
  const corner = top.find((t) => t.h === 18 && /^\d+$/.test(t.s) && t.y > height - 45);
  const ops = (await (await pdf.getPage(i)).getOperatorList()).fnArray.length;
  if (!corner || ops < 1500) continue;
  const title = [...new Set(top.filter((t) => t.h === 18 && t !== corner && /[A-Za-z]/.test(t.s)).map((t) => t.s))].join(' ');
  const credits = [...new Set(top.filter((t) => t.h === 10 && /[A-Za-z]/.test(t.s)).map((t) => t.s))];
  music.push({ pdfIndex: i - 1, n: Number(corner.s), title, credits });
}
music.forEach((m, i) => {
  if (m.n !== i + 1) throw new Error(`Expected printed page ${i + 1}, found ${m.n} (PDF page ${m.pdfIndex + 1})`);
});

// "THE LORD’S MY SHEPHERD" -> "The Lord’s My Shepherd"
const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'with']);
const titleCase = (s) =>
  s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^([^a-z]*)([a-z])/, (_, p, c) => p + c.toUpperCase())))
    .join(' ')
    .replace(/\bMt\./, 'Mt.');
const isScripture = (s) => /^(Words from )?(Psalm|Exodus|Joel|Zechariah|Matthew|Mark|John|[12] Samuel|[12] Corinthians) \d/.test(s);

// A page with no title carries on the song from the page before.
const songs = [];
for (const m of music) {
  if (!m.title) {
    const prev = songs[songs.length - 1];
    if (!prev || prev.pages !== 1 || prev.page !== m.n - 1) throw new Error(`Page ${m.n} has no title and doesn't follow a one-page song`);
    prev.pages = 2;
    continue;
  }
  const ref = m.credits.filter(isScripture).join(', ');
  const by = m.credits.filter((c) => !isScripture(c) && !/^Descant/.test(c)).join(', ');
  songs.push({ page: m.n, pages: 1, title: titleCase(m.title), ref, by });
}

const full = await PDFDocument.load(bytes);
const out = await PDFDocument.create();
for (const p of await out.copyPages(full, music.map((m) => m.pdfIndex))) out.addPage(p);
out.setTitle('The Bible Hymnal');
const trimmed = await out.save();
writeFileSync(new URL('../public/hymnal.pdf', import.meta.url), trimmed);
writeFileSync(new URL('../src/hymnal/songs.json', import.meta.url), JSON.stringify(songs, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${music.length} pages of music, ${songs.length} songs (${songs.filter((s) => s.pages === 2).length} on two pages); hymnal.pdf is ${(trimmed.length / 1048576).toFixed(1)} MB`);
