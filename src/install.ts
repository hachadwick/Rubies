import { useSyncExternalStore } from 'react';

/**
 * Installing Rubies as an app. Chrome, Edge and Android offer an install prompt the page can trigger itself
 * (`beforeinstallprompt`); Safari and Firefox don't, so for those the install button shows step-by-step help for
 * the person's device and browser instead.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const HIDE_KEY = 'rubies.installButtonHidden';
const INSTALLED_KEY = 'rubies.installed';

let deferred: InstallPromptEvent | null = null;
let installed = false;
let hidden = false;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

const read = (k: string) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};
const write = (k: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(k, '1');
    else localStorage.removeItem(k);
  } catch {
    /* storage blocked: the choice just won't be remembered */
  }
};

/** Running as an installed app (home screen, dock, Start menu) rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

/** The Electron desktop app is already installed. */
const isDesktopApp = () => !!(window as { rubiesDesktop?: unknown }).rubiesDesktop || !location.protocol.startsWith('http');

/** Call once at start-up, before the browser fires its install event. */
export function startInstall() {
  installed = isStandalone() || isDesktopApp() || read(INSTALLED_KEY);
  hidden = read(HIDE_KEY);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the browser's own mini-bar away; the Install button offers it instead
    deferred = e as InstallPromptEvent;
    // The browser only offers this when the app isn't installed, so a stale "installed" flag can be cleared.
    if (!isStandalone()) {
      installed = false;
      write(INSTALLED_KEY, false);
    }
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    write(INSTALLED_KEY, true);
    notify();
  });
}

export interface InstallState {
  /** Already installed, or running inside the installed app. */
  installed: boolean;
  /** The browser can show its own install dialog (one tap). */
  canPrompt: boolean;
  /** The person chose to hide the header button. */
  hidden: boolean;
}

let snapshot: InstallState = { installed: false, canPrompt: false, hidden: false };
let snapshotVersion = -1;

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      if (snapshotVersion !== version) {
        snapshot = { installed, canPrompt: !!deferred, hidden };
        snapshotVersion = version;
      }
      return snapshot;
    },
  );
}

/** Shows the browser's install dialog. Resolves true if the person installed. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null; // a prompt event can only be used once
  notify();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}

export function setInstallButtonHidden(on: boolean) {
  hidden = on;
  write(HIDE_KEY, on);
  notify();
}

export type InstallPlatform =
  | 'ios-safari'
  | 'ios-other'
  | 'mac-safari'
  | 'android'
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'other';

/** Which set of install steps fits this device and browser. */
export function detectPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): InstallPlatform {
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\/|Chromium\//.test(ua)) return 'chrome';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return 'mac-safari';
  return 'other';
}

/** This site's address, for opening it in another browser. */
export const appUrl = () => location.origin + import.meta.env.BASE_URL;
