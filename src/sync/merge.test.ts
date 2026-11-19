import { describe, expect, it } from 'vitest';
import type { Note, Tombstone } from '../db';
import { emptySyncData, localChanges, mergeSyncData, sameData, type SyncData } from './merge';

const note = (id: string, updatedAt: number, title = id): Note => ({
  id,
  title,
  date: '2026-11-18',
  speaker: '',
  church: '',
  passage: '',
  bodyHtml: '',
  bodyText: '',
  ink: [],
  verseKeys: [],
  createdAt: 1,
  updatedAt,
});
const tomb = (table: Tombstone['table'], id: string, deletedAt: number): Tombstone => ({ key: `${table}:${id}`, table, id, deletedAt });
const data = (p: Partial<SyncData>): SyncData => ({ ...emptySyncData(), ...p });

describe('mergeSyncData', () => {
  it('combines notes from both sides', () => {
    const m = mergeSyncData(data({ notes: [note('a', 1)] }), data({ notes: [note('b', 1)] }));
    expect(m.notes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the most recently changed copy', () => {
    const m = mergeSyncData(data({ notes: [note('a', 5, 'mine')] }), data({ notes: [note('a', 9, 'theirs')] }));
    expect(m.notes).toHaveLength(1);
    expect(m.notes[0].title).toBe('theirs');
    const m2 = mergeSyncData(data({ notes: [note('a', 9, 'mine')] }), data({ notes: [note('a', 5, 'theirs')] }));
    expect(m2.notes[0].title).toBe('mine');
  });

  it('removes something deleted on another device', () => {
    const m = mergeSyncData(data({ notes: [note('a', 5)] }), data({ tombstones: [tomb('notes', 'a', 10)] }));
    expect(m.notes).toHaveLength(0);
    expect(m.tombstones).toHaveLength(1);
  });

  it('keeps something edited after it was deleted elsewhere', () => {
    const m = mergeSyncData(data({ notes: [note('a', 20)] }), data({ tombstones: [tomb('notes', 'a', 10)] }));
    expect(m.notes).toHaveLength(1);
  });

  it('does not bring back something deleted here', () => {
    const m = mergeSyncData(data({ tombstones: [tomb('highlights', '1:1:1', 10)] }), data({
      highlights: [{ key: '1:1:1', color: 'yellow', createdAt: 5 }],
    }));
    expect(m.highlights).toHaveLength(0);
  });

  it('handles an empty or older cloud file', () => {
    const m = mergeSyncData(data({ notes: [note('a', 1)] }), { notes: [] } as unknown as SyncData);
    expect(m.notes).toHaveLength(1);
  });
});

describe('localChanges and sameData', () => {
  it('lists what to add, update and remove on this device', () => {
    const local = data({ notes: [note('a', 1), note('b', 1), note('c', 1)] });
    const merged = data({ notes: [note('a', 1), note('b', 2), note('d', 1)], tombstones: [tomb('notes', 'c', 3)] });
    const c = localChanges(local, merged);
    expect(c.notes.put.map((n) => (n as Note).id).sort()).toEqual(['b', 'd']);
    expect(c.notes.remove).toEqual(['c']);
    expect(c.tombstones).toHaveLength(1);
  });

  it('spots when nothing needs uploading', () => {
    const a = data({ notes: [note('a', 1)], tombstones: [tomb('notes', 'x', 2)] });
    expect(sameData(a, data({ notes: [note('a', 1)], tombstones: [tomb('notes', 'x', 2)] }))).toBe(true);
    expect(sameData(a, data({ notes: [note('a', 2)], tombstones: [tomb('notes', 'x', 2)] }))).toBe(false);
    expect(sameData(a, data({ notes: [note('a', 1)] }))).toBe(false);
  });
});
