import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { findBook } from './books';
import { chapterCount, getPassage, searchBible, setBibleData } from './kjv';
import { extractRefs, formatRef, parseRef, parseRefs } from './reference';

beforeAll(() => {
  setBibleData(JSON.parse(readFileSync(new URL('../../public/kjv.json', import.meta.url), 'utf8')));
});

describe('findBook', () => {
  it.each([
    ['jn', 'John'],
    ['1 Cor', '1 Corinthians'],
    ['I Corinthians', '1 Corinthians'],
    ['First John', '1 John'],
    ['Ps', 'Psalms'],
    ['psalm', 'Psalms'],
    ['Song of Solomon', 'Song of Solomon'],
    ['Phili', 'Philippians'],
    ['Rev.', 'Revelation'],
  ])('%s → %s', (input, name) => expect(findBook(input)?.name).toBe(name));

  it('rejects ambiguous prefixes', () => expect(findBook('Ph')).toBeUndefined());
});

describe('parseRef', () => {
  it.each([
    ['John 3:16', 'John 3:16'],
    ['jn 3:16-18', 'John 3:16–18'],
    ['1cor13', '1 Corinthians 13'],
    ['Gen 1:1-2:3', 'Genesis 1:1–2:3'],
    ['Ps 23', 'Psalms 23'],
    ['Ps 120-122', 'Psalms 120–122'],
    ['romans', 'Romans 1'],
    ['II Tim 3.16', '2 Timothy 3:16'],
  ])('%s → %s', (input, out) => expect(formatRef(parseRef(input)!)).toBe(out));

  it('rejects non-references', () => {
    expect(parseRef('love one another')).toBeUndefined();
    expect(parseRef('')).toBeUndefined();
  });
});

describe('parseRefs', () => {
  it('handles lists with implied books', () => {
    expect(parseRefs('John 3:16, 18; 4:1; Rom 5:8').map((r) => formatRef(r))).toEqual([
      'John 3:16',
      'John 3:18',
      'John 4:1',
      'Romans 5:8',
    ]);
  });
});

describe('getPassage', () => {
  it('returns a single verse', () => {
    const [v] = getPassage(parseRef('John 3:16')!);
    expect(v.text).toMatch(/^For God so loved the world/);
  });
  it('spans chapters', () => {
    const vs = getPassage(parseRef('Gen 1:31-2:2')!);
    expect(vs.map((v) => `${v.chapter}:${v.verse}`)).toEqual(['1:31', '2:1', '2:2']);
  });
  it('clamps to existing verses', () => {
    expect(getPassage(parseRef('Ps 117:1-99')!)).toHaveLength(2);
    expect(getPassage(parseRef('John 99:1')!)).toHaveLength(0);
  });
  it('has the right shape', () => {
    expect(chapterCount(19)).toBe(150);
    expect(getPassage(parseRef('Ps 119')!)).toHaveLength(176);
  });
});

describe('searchBible', () => {
  it('matches whole words', () => {
    const r = searchBible('Jesus wept');
    expect(r.verses.map((v) => formatRef(v))).toContain('John 11:35');
  });
  it('matches phrases and prefixes', () => {
    expect(searchBible('"born again"').total).toBeGreaterThan(0);
    expect(searchBible('faith*').total).toBeGreaterThan(searchBible('faith').total);
  });
  it('filters by testament', () => {
    expect(searchBible('Jesus', 10, 'OT').total).toBe(0);
  });
});

describe('extractRefs', () => {
  it('finds references in prose', () => {
    const refs = extractRefs('Pastor read John 3:16 then 1 Cor. 13:4-7 and I John 1:9. Also Jude 1:3.');
    expect(refs.map((r) => formatRef(r))).toEqual(['John 3:16', '1 Corinthians 13:4–7', '1 John 1:9', 'Jude 1:3']);
  });
  it('ignores non-book words', () => {
    expect(extractRefs('Service at 10:30 and Meeting 7:00')).toEqual([]);
  });
});
