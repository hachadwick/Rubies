# Rubies

Sermon note taking with the King James Bible, for iPad, Mac, Windows and Android.

Rubies is an installable, offline-first web app (PWA). One codebase runs in Safari, Chrome and Edge, and installs to the home screen or desktop like a native app. After the first visit it works with no internet connection: the full KJV text (31,102 verses) is cached on the device.

## Features

- **Side-by-side Bible and notes** on iPad landscape, laptops and desktops; Bible and Notes tabs on phones and iPad portrait.
- **Quick look-ups.** Type a reference into the Bible search box (`John 3:16`, `jn 3:16-18`, `1 Cor 13`, `Ps 23`, `Gen 1:1-2:3`) to jump straight there, or type words for a keyword search. A trailing `*` matches word forms (`forgiv*`), `"double quotes"` match a phrase, and results can be filtered to the Old or New Testament.
- **Tap verses** to highlight them in 5 colours, bookmark, copy, or **add them to the open note** as a formatted quotation.
- **Sermon notes** with title, type (sermon, sermonette or Bible study), date, speaker and location. Speaker and location auto-complete and carry over from your last note.
- **Rich text:** bold, italic, underline, highlight, headings, lists and quotes. The **Insert verse** button looks up and inserts any passage.
- **Verse ↔ note links.** Any reference written in a note (like "Rom 5:8") is detected automatically. Verses cited in your notes show a 📓 marker in the Bible, and tapping the verse lists the notes that cite it.
- **Handwriting** (Write mode) with Apple Pencil pressure, pen colours and sizes, highlighter, eraser, and undo/redo on lined paper. After a pen is detected, fingers scroll instead of drawing (palm rejection); the ✋ button toggles this.
- **Light and dark themes**, and adjustable Bible and note text sizes.
- **Export & share** (the share button in a note): save as a **Word document** or **PDF** (formatting, Scripture quotes and handwriting included), or send it with the system **Share** sheet (iPad, iPhone, Android, Mac), by **Email**, or **Copy** it as text. In the desktop app, PDFs are saved straight to a file; in a browser, PDF opens the print dialog, where you choose Save as PDF.
- **Backup and restore.** Notes are stored privately on each device (IndexedDB). Settings → Export backup saves a `.json` file, and importing it on another device merges the notes in.

## Development

Requires Node.js 20+.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # reference parser + search tests against the real KJV text
npm run build      # production build in dist/ (includes the service worker)
npm run preview    # serve the production build at http://localhost:4173
```

The UI is built with [Mantine](https://mantine.dev) components (theme in `src/theme.ts`, ruby accent colour), with Inter for the interface and Literata for Scripture. Both fonts are bundled so they work offline.

### Project layout

| Path | What |
| --- | --- |
| `public/kjv.json` | Compact KJV text: `books[book][chapter][verse]` |
| `scripts/build-kjv.mjs` | Regenerates `public/kjv.json` from a scrollmapper-format `KJV.json` |
| `src/bible/` | Book names/abbreviations, reference parsing, passage lookup, keyword search |
| `src/db.ts` | Dexie (IndexedDB) schema for notes, highlights and bookmarks; backup import/export |
| `src/components/BiblePane.tsx` | Reader, look-up/search, verse actions, bookmarks and highlights |
| `src/components/NoteEditor.tsx` | Note metadata, TipTap rich-text editor, verse insertion |
| `src/components/InkPad.tsx` | Pencil/stylus handwriting canvas (perfect-freehand) |

## Getting it onto devices

PWAs must be served over **HTTPS** to install. Deploy `dist/` to any static host (Netlify, Cloudflare Pages, Vercel, or GitHub Pages), then:

- **iPad / iPhone:** open the site in Safari → Share → Add to Home Screen.
- **Android:** open the site in Chrome → menu → Install app.
- **Windows / Mac:** open the site in Chrome or Edge → the install icon in the address bar.

### Desktop app (Windows / Mac)

Rubies also runs as a stand-alone desktop program built with Electron. No browser is needed.

```sh
npm run desktop        # build and open Rubies in its own window
npm run desktop:win    # build the Windows installer: release/Rubies Setup <version>.exe
npm run desktop:mac    # build the macOS .dmg (must be run on a Mac)
```

The installer adds Start menu and desktop shortcuts. The desktop app keeps its own notes, separate from any browser copy, so use Settings → Export / Import backup to move notes between them. The installer isn't code-signed yet, so Windows SmartScreen will show a "Windows protected your PC" warning the first time; choose **More info → Run anyway**.

### App stores (later)

The same web code can be wrapped for the stores without rewriting: **Capacitor** for an iPad/iPhone App Store build and a Google Play build. The iOS build needs a Mac with Xcode.

## Scripture text

King James Version (1769 Oxford edition). It is public domain in the United States; in the UK the KJV is under Crown patent. The text comes from [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).
