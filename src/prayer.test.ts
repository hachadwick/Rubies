import { describe, expect, it } from 'vitest';
import type { Prayer } from './db';
import { inDays, isDue, relativeDay, todayIso } from './prayer';

const prayer = (p: Partial<Prayer>): Prayer => ({ id: 'x', text: 'Mum', createdAt: 0, updatedAt: 0, ...p });

describe('prayer follow-ups', () => {
  it('counts days from today', () => {
    expect(inDays(0)).toBe(todayIso());
    expect(relativeDay(inDays(0))).toBe('today');
    expect(relativeDay(inDays(1))).toBe('tomorrow');
    expect(relativeDay(inDays(-1))).toBe('yesterday');
    expect(relativeDay(inDays(7))).toBe('in 7 days');
    expect(relativeDay(inDays(-3))).toBe('3 days ago');
  });

  it('is due on or after the follow-up date, until answered', () => {
    expect(isDue(prayer({ followUpOn: inDays(0) }))).toBe(true);
    expect(isDue(prayer({ followUpOn: inDays(-2) }))).toBe(true);
    expect(isDue(prayer({ followUpOn: inDays(1) }))).toBe(false);
    expect(isDue(prayer({}))).toBe(false);
    expect(isDue(prayer({ followUpOn: inDays(-2), answeredAt: 1 }))).toBe(false);
  });
});
