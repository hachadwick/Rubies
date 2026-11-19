import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Reading aloud, with the device's own speech voices (the Web Speech API: Windows, macOS, iPad, Android and
 * Chrome each have their own set, so the list differs by device; nothing is sent over the internet unless the
 * person picks one of the browser's online voices).
 *
 * A passage is read one piece at a time (a verse, or a sentence of a book), so the pane can show which piece is
 * being read, and Pause can pick up where it left off. (Pause is done by stopping and starting that piece again,
 * because the speech engines' own pause doesn't work reliably everywhere, notably on Android.)
 */

export interface Piece {
  /** What the pane uses to mark the piece being read, e.g. the verse number. */
  id: string;
  text: string;
}

export interface ReadingState {
  status: 'idle' | 'playing' | 'paused';
  /** The piece being read (or where it was paused). */
  current?: string;
  /** Which pane is reading. */
  owner?: string;
}

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// --- Voices ------------------------------------------------------------------------------------------------------

export type VoiceGender = 'female' | 'male' | 'other';

// Speech engines don't say whether a voice is male or female, so it's worked out from the usual voice names
// (Windows, Edge's online voices, Apple, Google, Android and Amazon).
const FEMALE =
  /\b(female|woman|zira|hazel|susan|linda|heather|catherine|samantha|victoria|karen|moira|tessa|fiona|veena|allison|ava|serena|kate|joanna|salli|kimberly|ivy|emma|amy|aria|jenny|michelle|sonia|libby|natasha|clara|emily|nicky|kathy|vicki|agnes|shelley|sandy|flo|grandma|ana|ashley|cora|elizabeth|jane|nancy|sara|ellie|hollie|maisie|olivia|abbi|bella|isla|kendra|joanne|zoe|siri female|tara|neerja|leah|luna|molly|nova|ruth)\b/i;
const MALE =
  /\b(male|man|david|mark|george|james|richard|sean|daniel|alex|fred|tom|oliver|arthur|rishi|aaron|gordon|lee|guy|davis|tony|ryan|christopher|eric|roger|steffan|andrew|brian|thomas|ralph|albert|bruce|junior|rocko|grandpa|reed|eddy|brandon|jacob|jason|liam|william|ethan|alfie|elliot|noah|thomas|prabhat|connor|mitchell|wayne|kevin|matthew|justin|joey|russell|siri male)\b/i;

export function voiceGender(v: Pick<SpeechSynthesisVoice, 'name'>): VoiceGender {
  // Check "female" first: it contains "male". Chrome's "Google US English" is a woman's voice.
  if (FEMALE.test(v.name) || /^Google US English$/i.test(v.name)) return 'female';
  if (MALE.test(v.name)) return 'male';
  return 'other';
}

/** A voice's name without the engine's wording: "Microsoft Zira - English (United States)" → "Zira". */
export function voiceLabel(v: Pick<SpeechSynthesisVoice, 'name' | 'lang'>): string {
  const name = v.name
    .replace(/^(Microsoft|Google|Apple)\s+/i, '')
    .replace(/\s+Online\s+\(Natural\)/i, ' (natural)')
    .replace(/\s+-\s+English.*$/i, '')
    .replace(/\s*\((Enhanced|Premium)\)/i, ' (enhanced)')
    .trim();
  const region = /^en-(\w+)/i.exec(v.lang)?.[1]?.toUpperCase();
  return region && !/\b(US|UK|GB|AU|IN|IE|ZA|CA|NZ)\b/.test(name) ? `${name} · ${region}` : name;
}

/** English voices on this device, female first, then male, then the rest. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (speechSupported() ? speechSynthesis.getVoices() : []));
  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => setVoices(speechSynthesis.getVoices());
    update();
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  const order: Record<VoiceGender, number> = { female: 0, male: 1, other: 2 };
  return voices
    .filter((v) => /^en\b/i.test(v.lang))
    .sort((a, b) => order[voiceGender(a)] - order[voiceGender(b)] || voiceLabel(a).localeCompare(voiceLabel(b)));
}

// --- Settings (per device) ---------------------------------------------------------------------------------------

const VOICE_KEY = 'rubies.voice';
const RATE_KEY = 'rubies.voiceRate';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

let voiceURI = read(VOICE_KEY) ?? '';
let rate = Number(read(RATE_KEY)) || 1;

export const RATES = [0.75, 1, 1.25, 1.5];

// --- Reading -----------------------------------------------------------------------------------------------------

let state: ReadingState = { status: 'idle' };
const listeners = new Set<() => void>();
function set(next: ReadingState) {
  state = next;
  listeners.forEach((l) => l());
}

export function useReading(): ReadingState & { voiceURI: string; rate: number } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  return { ...s, voiceURI, rate };
}

let pieces: Piece[] = [];
let index = 0;
let onFinished: (() => void) | undefined;
/** Changes whenever reading is stopped or restarted, so a stopped utterance's events are ignored. */
let run = 0;

/** Says Bible references the way they're read aloud: "John 3:16-18" → "John 3, verses 16 to 18". */
export function speakable(text: string): string {
  return text
    .replace(/(\d+):(\d+)\s?[-–—]\s?(\d+):(\d+)/g, '$1, verse $2, to chapter $3, verse $4')
    .replace(/(\d+):(\d+)\s?[-–—]\s?(\d+)/g, '$1, verses $2 to $3')
    .replace(/(\d+):(\d+)/g, '$1, verse $2')
    .replace(/\bvv?\.\s/g, 'verses ')
    .replace(/[“”]/g, '"');
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const all = speechSynthesis.getVoices();
  return all.find((v) => v.voiceURI === voiceURI) ?? all.find((v) => v.default && /^en\b/i.test(v.lang)) ?? all.find((v) => /^en\b/i.test(v.lang));
}

function speakFrom(i: number) {
  const mine = ++run;
  speechSynthesis.cancel();
  index = i;
  const piece = pieces[i];
  if (!piece) {
    const done = onFinished;
    set({ status: 'idle' });
    done?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(speakable(piece.text));
  const voice = pickVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  }
  u.rate = rate;
  u.onend = () => {
    if (mine === run) speakFrom(i + 1);
  };
  u.onerror = (e) => {
    // "interrupted"/"canceled" come from our own stop or restart.
    if (mine !== run || e.error === 'interrupted' || e.error === 'canceled') return;
    speakFrom(i + 1);
  };
  set({ status: 'playing', current: piece.id, owner: state.owner });
  speechSynthesis.speak(u);
}

/**
 * Reads `list` aloud from piece `from`. `owner` names the pane reading (so a pane only shows its own reading);
 * `finished` runs after the last piece (e.g. to go on to the next chapter).
 */
export function startReading(owner: string, list: Piece[], from = 0, finished?: () => void) {
  if (!speechSupported() || !list.length) return;
  pieces = list;
  onFinished = finished;
  state = { ...state, owner };
  speakFrom(Math.max(0, Math.min(from, list.length - 1)));
}

export function pauseReading() {
  if (state.status !== 'playing') return;
  run++;
  speechSynthesis.cancel();
  set({ ...state, status: 'paused' });
}

export function resumeReading() {
  if (state.status === 'paused') speakFrom(index);
}

/** Skips to the next (1) or previous (-1) piece. */
export function skip(dir: 1 | -1) {
  if (state.status === 'idle') return;
  const to = Math.max(0, Math.min(pieces.length - 1, index + dir));
  if (state.status === 'paused') {
    index = to;
    set({ ...state, current: pieces[to]?.id });
  } else speakFrom(to);
}

export function stopReading(owner?: string) {
  if (owner && state.owner !== owner) return;
  run++;
  onFinished = undefined;
  if (speechSupported()) speechSynthesis.cancel();
  set({ status: 'idle' });
}

export function setVoice(uri: string) {
  voiceURI = uri;
  write(VOICE_KEY, uri);
  if (state.status === 'playing') speakFrom(index);
  else listeners.forEach((l) => l());
}

export function setRate(r: number) {
  rate = r;
  write(RATE_KEY, String(r));
  if (state.status === 'playing') speakFrom(index);
  else listeners.forEach((l) => l());
}

/** Says a short sample in a voice, so the person can hear it before choosing. */
export function previewVoice(v: SpeechSynthesisVoice) {
  if (state.status === 'playing') pauseReading();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('In the beginning was the Word, and the Word was with God.');
  u.voice = v;
  u.lang = v.lang;
  u.rate = rate;
  speechSynthesis.speak(u);
}
