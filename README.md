# Rubies

Sermon note taking with the King James Bible, for iPad, Mac, Windows and Android.

Rubies is an installable, offline-first web app (PWA). One codebase runs in Safari, Chrome and Edge, and installs to the home screen or desktop like a native app. After the first visit it works with no internet connection: the full KJV text (31,102 verses) is cached on the device.

## Features

- **Side-by-side Bible and notes** on iPad landscape, laptops and desktops; Bible and Notes tabs on phones and iPad portrait.
- **Quick look-ups.** Type a reference into the Bible search box (`John 3:16`, `jn 3:16-18`, `1 Cor 13`, `Ps 23`, `Gen 1:1-2:3`) to jump straight there, or type words for a keyword search. A trailing `*` matches word forms (`forgiv*`), `"double quotes"` match a phrase, and results can be filtered to the Old or New Testament.
- **Tap verses** to highlight them in 5 colours, bookmark, copy, or **add them to the open note** as a formatted quotation.
- **Sermon notes** with title, type (sermon, sermonette, Bible study or personal study), date, speaker and location. Speaker and location auto-complete and carry over from your last note.
- **Rich text:** bold, italic, underline, highlight, headings, lists and quotes.
- **Verse ↔ note links.** Any reference written in a note (like "Rom 5:8") is detected automatically. Verses cited in your notes show a 📓 marker in the Bible, and tapping the verse lists the notes that cite it.
- **Handwriting** (Write mode) with Apple Pencil pressure, pen colours and sizes, highlighter, eraser, and undo/redo on lined paper. After a pen is detected, fingers scroll instead of drawing (palm rejection); the ✋ button toggles this.
- **Light and dark themes**, and adjustable Bible and note text sizes.
- **Export & share** (the share button in a note): save as a **Word document** or **PDF** (formatting, Scripture quotes and handwriting included), or send it with the system **Share** sheet (iPad, iPhone, Android, Mac), by **Email**, or **Copy** it as text. In the desktop app, PDFs are saved straight to a file; in a browser, PDF opens the print dialog, where you choose Save as PDF.
- **Sync with Google Drive.** Sign in with Google (Settings → Sync across devices) and notes, the prayer list, highlights and bookmarks stay the same on every device. They're kept in a hidden Rubies folder in the person's own Google Drive (the `drive.appdata` scope: Rubies can't see any other Drive files). Edits on two devices are merged note by note, newest wins, and deletions carry over.
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

PWAs must be served over **HTTPS** to install. Rubies is published on **GitHub Pages** at
**https://hachadwick.github.io/Rubies/**. People open that address, then:

- **iPad / iPhone:** Safari → Share → Add to Home Screen.
- **Android:** Chrome → menu → Install app.
- **Windows / Mac:** Chrome or Edge → the install icon in the address bar.

After that it works offline. Each person's notes stay on their own device; nothing is sent back to the site.

### Publishing

Publishing is automatic: every push to `main` runs `.github/workflows/pages.yml`, which runs the tests, builds the
site with `npm run build:web` and publishes it. Installed copies pick up the new version the next time they're
opened with internet. The Actions tab also has a **Run workflow** button to publish without a new push.

One-time setup: in the repository on GitHub, **Settings → Pages → Build and deployment → Source: GitHub Actions**.
GitHub Pages publishes from a private repository only on a paid plan (Pro or Team); on the free plan the repository
must be public. Either way, the published site itself is public.

To try the published build locally:

```sh
npm run build:web      # builds for /Rubies/ into dist-web/ (the desktop build in dist/ is separate)
npm run preview:web    # http://localhost:4173/Rubies/
```

The `/Rubies/` in those two scripts in `package.json` must match the repository name (GitHub Pages serves the site
at `/<repository>/`, and the letter case matters).

### Sync with Google Drive: one-time setup

Sync needs a Google OAuth client ID (free). Without one, Settings just says sync isn't set up.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (e.g. "Rubies").
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **Google Auth Platform → Branding** (the OAuth consent screen): app name Rubies, support email, and the home page
   `https://hachadwick.github.io/Rubies/`. **Audience**: External. **Data access**: add the scope
   `.../auth/drive.appdata` (plus `openid`, `email`, `profile`). While the app is in *Testing*, only the Google
   accounts listed as test users can sign in; choose **Publish app** to let anyone in. `drive.appdata` isn't a
   sensitive scope, so publishing doesn't need Google's security review.
4. **Clients → Create client → Web application**. Authorized JavaScript origins:
   `https://hachadwick.github.io`, `http://localhost:5173` and `http://localhost:4173` (no redirect URIs needed).
5. Copy the client ID (`….apps.googleusercontent.com`; it isn't a secret) and:
   - for the published site: repository **Settings → Secrets and variables → Actions → Variables → New variable**
     named `GOOGLE_CLIENT_ID`, then re-run the publish workflow;
   - for local development: a `.env.local` file containing `VITE_GOOGLE_CLIENT_ID=…`.

Sign-in uses Google's popup, so it works in browsers and installed web apps but not in the desktop (Electron) app,
which shows a note instead. Google's sign-in lasts about an hour; after that the cloud icon in the Notes header turns
yellow and one tap reconnects (changes made meanwhile are kept and sync then).

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
