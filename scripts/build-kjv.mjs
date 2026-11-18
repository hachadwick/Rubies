// Converts a scrollmapper-format KJV.json into the compact public/kjv.json used by the app.
// Usage: node scripts/build-kjv.mjs path/to/KJV.json
// Output shape: { "books": [ [ ["verse 1 text", "verse 2 text", ...], ...chapters ], ...66 books ] }
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/build-kjv.mjs path/to/KJV.json');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(src, 'utf8'));
if (raw.books.length !== 66) throw new Error(`Expected 66 books, got ${raw.books.length}`);

let count = 0;
const books = raw.books.map((b) =>
  b.chapters.map((c, ci) => {
    if (c.chapter !== ci + 1) throw new Error(`${b.name}: chapter order`);
    return c.verses.map((v, vi) => {
      if (v.verse !== vi + 1) throw new Error(`${b.name} ${c.chapter}: verse order`);
      count++;
      return v.text.trim();
    });
  }),
);
writeFileSync(new URL('../public/kjv.json', import.meta.url), JSON.stringify({ books }));
console.log(`Wrote ${count} verses`);
