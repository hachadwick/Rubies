import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * App updates on the web. When a new version is published, the service worker downloads it in the background and
 * waits; the notes header then shows an update button, and tapping it switches to the new version and reloads.
 * Open apps check for a new version every hour and whenever they come back to the foreground.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;

let available = false;
let apply: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

export function startUpdates() {
  // Offline caching is only needed on the web; the desktop app (app:// scheme) ships its files locally.
  if (!location.protocol.startsWith('http')) return;
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      available = true;
      listeners.forEach((l) => l());
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine && !reg.installing) reg.update().catch(() => {});
      };
      window.setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => available,
  );
}

/** Switches to the downloaded version and reloads. Notes are saved as they're typed, so nothing is lost. */
export async function applyUpdate() {
  if (apply) await apply(true);
  // In case the new service worker doesn't take over (or there isn't one), a plain reload still gets fresh files.
  window.setTimeout(() => location.reload(), 3000);
}
