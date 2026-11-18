// Electron entry point: runs Rubies as a desktop app (Windows / macOS) in its own window.
// The built web app in dist/ is served from a private app:// scheme so fetch(), IndexedDB
// and absolute asset paths behave exactly as they do on the web.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://rubies';
// Set RUBIES_DEV_URL=http://localhost:5173 to load the Vite dev server instead of dist/.
const DEV_URL = process.env.RUBIES_DEV_URL;

// For testing: RUBIES_PROFILE=<folder> runs with a separate, throwaway data folder so real notes are never touched.
if (process.env.RUBIES_PROFILE) app.setPath('userData', process.env.RUBIES_PROFILE);
// For testing: RUBIES_EXPORT_DIR=<folder> saves exports there without showing Save dialogs.
const EXPORT_DIR = process.env.RUBIES_EXPORT_DIR;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 520,
    title: 'Rubies',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#fbfaf8',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.once('ready-to-show', () => win.show());

  // Links to websites open in the user's normal browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on('context-menu', (_e, params) => showContextMenu(win, params));

  // Exports (e.g. Word files) ask where to save, starting in Documents.
  win.webContents.session.on('will-download', (_e, item) => {
    if (EXPORT_DIR) return item.setSavePath(path.join(EXPORT_DIR, item.getFilename()));
    item.setSaveDialogOptions({
      title: 'Save',
      defaultPath: path.join(app.getPath('documents'), item.getFilename()),
    });
  });

  win.loadURL(DEV_URL || `${ORIGIN}/index.html`);
}

/**
 * Right-click menu. Electron's spell checker underlines misspelled words but shows no menu by
 * itself, so this adds spelling suggestions, "Add to dictionary" and the usual edit commands.
 */
function showContextMenu(win, params) {
  const { editFlags, isEditable, misspelledWord, dictionarySuggestions, selectionText } = params;
  const items = [];

  if (isEditable && misspelledWord) {
    if (dictionarySuggestions.length) {
      for (const word of dictionarySuggestions.slice(0, 6)) {
        items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
      }
    } else {
      items.push({ label: 'No spelling suggestions', enabled: false });
    }
    items.push(
      { type: 'separator' },
      {
        label: 'Add to dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(misspelledWord),
      },
      { type: 'separator' },
    );
  }

  if (isEditable) {
    items.push(
      { role: 'undo', enabled: editFlags.canUndo },
      { role: 'redo', enabled: editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy },
      { role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    );
  } else if (selectionText.trim()) {
    items.push({ role: 'copy' });
  }

  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

const fromAppWindow = (event) => win && event.sender === win.webContents;

// Save a note as PDF: render the export page in a hidden window, then print it to a file.
ipcMain.handle('rubies:save-pdf', async (event, { html, fileName }) => {
  if (!fromAppWindow(event) || typeof html !== 'string') throw new Error('Not allowed');
  const safeName = String(fileName || 'Note.pdf').replace(/[\\/:*?"<>|]+/g, '-');
  const { canceled, filePath } = EXPORT_DIR
    ? { canceled: false, filePath: path.join(EXPORT_DIR, safeName) }
    : await dialog.showSaveDialog(win, {
    title: 'Save as PDF',
    defaultPath: path.join(app.getPath('documents'), safeName),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return 'canceled';

  const tmp = path.join(app.getPath('temp'), `rubies-print-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const printer = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
  });
  try {
    await printer.loadFile(tmp);
    const pdf = await printer.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(filePath, pdf);
  } finally {
    printer.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
  if (!EXPORT_DIR) shell.openPath(filePath);
  return 'saved';
});

ipcMain.handle('rubies:open-email', async (event, url) => {
  if (!fromAppWindow(event) || typeof url !== 'string' || !url.startsWith('mailto:')) throw new Error('Not allowed');
  await shell.openExternal(url);
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });

  // Keep standard Edit shortcuts (copy/paste/undo) and zoom working with the menu bar hidden.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
