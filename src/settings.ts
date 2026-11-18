import { useCallback, useEffect, useState } from 'react';

/** Per-device reading preferences. Light/dark theme is handled by Mantine's colour-scheme manager. */
export interface Settings {
  /** Bible text size in px. */
  bibleFontSize: number;
  /** Note body text size in px. */
  noteFontSize: number;
}

const DEFAULTS: Settings = { bibleFontSize: 19, noteFontSize: 17 };
const KEY = 'rubies.settings';

function read(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode: settings just won't persist */
    }
    const root = document.documentElement;
    root.style.setProperty('--bible-size', `${settings.bibleFontSize}px`);
    root.style.setProperty('--note-size', `${settings.noteFontSize}px`);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  return [settings, update] as const;
}
