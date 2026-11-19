/**
 * Google sign-in and the sync file in Google Drive.
 *
 * Rubies uses the Google Identity Services token flow (no server needed) with the `drive.appdata` scope: the file
 * lives in a hidden app folder in the person's own Drive. Rubies can't see any of their other Drive files, and the
 * file doesn't show up in their Drive's file list.
 */

/** The OAuth client ID from Google Cloud Console (set at build time; see README → Sync with Google Drive). */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

const SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid email profile';
const FILE_NAME = 'rubies-sync.json';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Sign-in only works from a web address Google knows about, so not in the desktop app (app://). */
export const syncSupported = () => !!GOOGLE_CLIENT_ID && location.protocol.startsWith('http');

// --- Minimal types for the Google Identity Services script -----------------------------------------------------

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

let gisLoading: Promise<GoogleOAuth2> | null = null;

/** Loads Google's sign-in script the first time it's needed. */
function loadGis(): Promise<GoogleOAuth2> {
  gisLoading ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google.accounts.oauth2);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error('Google sign-in did not load.')));
    s.onerror = () => reject(new Error('Could not reach Google. Check the internet connection.'));
    document.head.append(s);
  }).catch((e) => {
    gisLoading = null;
    throw e;
  });
  return gisLoading;
}

/** Start loading the script early so the sign-in popup can open straight from a tap (Safari blocks late popups). */
export const preloadGoogle = () => {
  if (syncSupported()) loadGis().catch(() => {});
};

export interface Token {
  accessToken: string;
  expiresAt: number;
}

/**
 * Asks Google for an access token. Must be called from a tap or click, because it may open Google's popup.
 * `prompt: ''` skips the account chooser and consent screen when the person already agreed before.
 */
export async function requestToken(opts: { prompt?: '' | 'consent' | 'select_account'; loginHint?: string } = {}): Promise<Token> {
  const oauth2 = await loadGis();
  return new Promise<Token>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Google sign-in failed.'));
        resolve({ accessToken: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
      },
      error_callback: (e) =>
        reject(new Error(e.type === 'popup_closed' ? 'Sign-in was closed before it finished.' : e.type === 'popup_failed_to_open' ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.' : e.message || 'Google sign-in failed.')),
    });
    client.requestAccessToken({ prompt: opts.prompt ?? '', login_hint: opts.loginHint });
  });
}

export async function revokeToken(token: string) {
  try {
    const oauth2 = await loadGis();
    await new Promise<void>((done) => oauth2.revoke(token, done));
  } catch {
    /* signing out locally is what matters */
  }
}

/** A Google request that failed; `status` 401 means the sign-in has expired. */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    throw new GoogleError('Could not reach Google Drive. Check the internet connection.', 0);
  }
  if (!res.ok) {
    let msg = `Google Drive error ${res.status}`;
    try {
      msg = (await res.json())?.error?.message || msg;
    } catch {
      /* keep the status */
    }
    throw new GoogleError(msg, res.status);
  }
  return res;
}

export interface Profile {
  email: string;
  name: string;
  picture?: string;
}

export async function getProfile(token: string): Promise<Profile> {
  const p = await (await call(token, 'https://www.googleapis.com/oauth2/v3/userinfo')).json();
  return { email: p.email ?? '', name: p.name || p.email || 'Google account', picture: p.picture };
}

/** The sync file's id, or null when this account hasn't synced yet. */
export async function findSyncFile(token: string): Promise<string | null> {
  const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const r = await (await call(token, `${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`)).json();
  return r.files?.[0]?.id ?? null;
}

export async function downloadSyncFile(token: string, id: string): Promise<unknown> {
  return (await call(token, `${DRIVE}/files/${id}?alt=media`)).json();
}

/** Saves the sync file (creating it the first time) and returns its id. */
export async function uploadSyncFile(token: string, id: string | null, data: unknown): Promise<string> {
  const body = JSON.stringify(data);
  if (id) {
    await call(token, `${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return id;
  }
  const boundary = `rubies${Math.random().toString(36).slice(2)}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return (await r.json()).id;
}
