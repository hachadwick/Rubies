import { describe, expect, it } from 'vitest';
import { newNote, type Note } from './db';
import { isStale, reviewedAt, timeAgo } from './review';

const DAY = 86400000;
const now = Date.UTC(2026, 10, 18, 12);
const note = (p: Partial<Note>): Note => ({ ...newNote(), title: 'Grace', createdAt: now, ...p });

describe('reviewing notes', () => {
  it('counts from when it was written until it is reviewed', () => {
    expect(reviewedAt(note({ createdAt: now - 5 * DAY }))).toBe(now - 5 * DAY);
    expect(reviewedAt(note({ createdAt: now - 5 * DAY, lastReviewedAt: now - DAY }))).toBe(now - DAY);
  });

  it('is stale once the interval has passed since the last review', () => {
    expect(isStale(note({ createdAt: now - 100 * DAY }), 90, now)).toBe(true);
    expect(isStale(note({ createdAt: now - 80 * DAY }), 90, now)).toBe(false);
    expect(isStale(note({ createdAt: now - 400 * DAY, lastReviewedAt: now - 10 * DAY }), 90, now)).toBe(false);
  });

  it('never nags when reminders are off, or about empty notes', () => {
    expect(isStale(note({ createdAt: now - 400 * DAY }), 0, now)).toBe(false);
    expect(isStale(note({ title: '', createdAt: now - 400 * DAY }), 90, now)).toBe(false);
  });

  it('says how long ago in plain words', () => {
    expect(timeAgo(now, now)).toBe('today');
    expect(timeAgo(now - DAY, now)).toBe('yesterday');
    expect(timeAgo(now - 100 * DAY, now)).toMatch(/3 months ago/);
  });
});
