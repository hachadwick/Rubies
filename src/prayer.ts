import { db, newId, type Prayer } from './db';

/** Today as yyyy-mm-dd in local time. */
export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** A local date some days from today, as yyyy-mm-dd. */
export function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Quick follow-up choices offered when adding or changing a request. */
export const FOLLOW_UPS: { label: string; days: number }[] = [
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

/** Still open, with a follow-up date of today or earlier. */
export const isDue = (p: Prayer, today = todayIso()) => !p.answeredAt && !!p.followUpOn && p.followUpOn <= today;

export async function addPrayer(fields: { text: string; followUpOn?: string; noteId?: string; noteTitle?: string }): Promise<Prayer> {
  const now = Date.now();
  const prayer: Prayer = {
    id: newId(),
    text: fields.text.trim(),
    createdAt: now,
    followUpOn: fields.followUpOn || undefined,
    noteId: fields.noteId,
    noteTitle: fields.noteTitle,
    updatedAt: now,
  };
  await db.prayers.add(prayer);
  return prayer;
}

export const updatePrayer = (id: string, patch: Partial<Prayer>) => db.prayers.update(id, { ...patch, updatedAt: Date.now() });

/**
 * Follow-up reminders: requests whose follow-up date has come, not reminded yet today. Marks them reminded,
 * so each one is shown once a day until it's answered or its follow-up is moved.
 */
export async function takeDueReminders(): Promise<Prayer[]> {
  const today = todayIso();
  const due = (await db.prayers.where('followUpOn').belowOrEqual(today).toArray()).filter(
    (p) => !p.answeredAt && p.remindedOn !== today,
  );
  await Promise.all(due.map((p) => db.prayers.update(p.id, { remindedOn: today })));
  return due;
}

/** "in 5 days", "tomorrow", "today", "3 days ago". */
export function relativeDay(iso: string, today = todayIso()): string {
  const days = Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
