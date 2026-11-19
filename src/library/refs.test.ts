import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { setBibleData } from '../bible/kjv';
import { formatRef } from '../bible/reference';
import { findRefs, sectionRefs } from './refs';

beforeAll(() => {
  setBibleData(JSON.parse(readFileSync(new URL('../../public/kjv.json', import.meta.url), 'utf8')));
});

/** Each reference as [the text it covers, where it points]. */
const show = (text: string, ctx = {}) => findRefs(text, ctx).map((f) => [text.slice(f.start, f.end), formatRef(f.ref)]);

describe('findRefs', () => {
  it('finds references in running text', () => {
    expect(show('It was in these conditions that “he came to himself” (Luke 15:17).')).toEqual([['Luke 15:17', 'Luke 15:17']]);
    expect(show('the knowledge of His truth (1 Timothy 2:3-6). It was')).toEqual([['1 Timothy 2:3-6', '1 Timothy 2:3–6']]);
    expect(show('preach the gospel (Matt. 24:14)')).toEqual([['Matt. 24:14', 'Matthew 24:14']]);
  });

  it('follows on to more chapters and verses of the same book', () => {
    expect(show('the love His Son shows (John 8:29; 14:31).')).toEqual([
      ['John 8:29', 'John 8:29'],
      ['14:31', 'John 14:31'],
    ]);
    expect(show('see Romans 8:28, 31-39')).toEqual([
      ['Romans 8:28', 'Romans 8:28'],
      ['31-39', 'Romans 8:31–39'],
    ]);
  });

  it('takes "verse 20" from the reference before it', () => {
    const ctx = {};
    show('“he came to himself” (Luke 15:17).', ctx);
    expect(show('lost son “a great way off” (verse 20). And (verses 22-24).', ctx)).toEqual([
      ['verse 20', 'Luke 15:20'],
      ['verses 22-24', 'Luke 15:22–24'],
    ]);
    expect(show('verse 3 of what?')).toEqual([]); // nothing to refer back to
  });

  it('takes a whole chapter only with the full book name', () => {
    expect(show('the prodigal son, recorded in Luke 15, is moving.')).toEqual([['Luke 15', 'Luke 15']]);
    expect(show('Read Mark 2 and Job 3 and Ex 4.')).toEqual([]);
  });

  it('ignores things that only look like references', () => {
    expect(show('In 1975 he founded it. Chapter 7 begins. At 5:30 we met. Over 400 stations.')).toEqual([]);
    expect(show('Revelation 23:1 and John 3:99')).toEqual([]); // no such chapter or verse
  });
});

describe('sectionRefs', () => {
  it('carries the last reference to the next paragraph, but not past a heading', () => {
    const refs = sectionRefs([
      { s: ['He said (Luke 15:18).'] },
      { s: ['And then (verse 20).'] },
      { s: ['Next part'], h: 1 },
      { s: ['Again (verse 21).'] },
    ]);
    expect([...refs.keys()]).toEqual(['0:0', '1:0']);
    expect(formatRef(refs.get('1:0')![0].ref)).toBe('Luke 15:20');
  });
});
