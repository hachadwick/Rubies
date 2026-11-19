import type { Note } from './db';

/**
 * Reviewing notes: each note has a "last reviewed" date (set with Mark as reviewed; until then, the day it was
 * written). Once that's older than the chosen interval, the note is stale and Rubies suggests looking at it again.
 */
export const REVIEW_CHOICES: { value: string; label: string }[] = [
  { value: '30', label: 'Every month' },
  { value: '90', label: 'Every 3 months' },
  { value: '180', label: 'Every 6 months' },
  { value: '365', label: 'Every year' },
  { value: '0', label: "Don't remind me" },
];

const DAY = 86400000;

/** When the note was last reviewed, or written if it never has been. */
export const reviewedAt = (n: Pick<Note, 'lastReviewedAt' | 'createdAt'>) => n.lastReviewedAt ?? n.createdAt;

const hasContent = (n: Note) => !!(n.title.trim() || n.passage.trim() || n.bodyText.trim() || n.ink.length);

/** Due for review: not reviewed within the interval (never, when the interval is 0). Empty notes don't count. */
export const isStale = (n: Note, everyDays: number, now = Date.now()) =>
  everyDays > 0 && hasContent(n) && now - reviewedAt(n) >= everyDays * DAY;

/** "today", "yesterday", "3 weeks ago", "4 months ago", "2 years ago". */
export function timeAgo(ms: number, now = Date.now()): string {
  const days = Math.floor((now - ms) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (days < 14) return rtf.format(-days, 'day');
  if (days < 60) return rtf.format(-Math.floor(days / 7), 'week');
  if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
  return rtf.format(-Math.floor(days / 365), 'year');
}

/** "3 months", for "You haven't reviewed these in over 3 months". */
export const intervalLabel = (everyDays: number) =>
  everyDays >= 365 ? 'a year' : everyDays >= 30 ? `${Math.round(everyDays / 30)} month${everyDays >= 60 ? 's' : ''}` : `${everyDays} days`;
