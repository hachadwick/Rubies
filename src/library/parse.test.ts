import { describe, expect, it } from 'vitest';
import { citation } from './library';
import { repairUnreadable } from './repair';
import { joinLines, parseBook, splitSentences, titleCase, type RawItem, type RawPage } from './parse';

/** A page of body text at 10.5pt, one line every 15 units from the top, with a running head and page number. */
function page(label: string, lines: (string | { text: string; x?: number; h?: number; gap?: number })[], head = 'THE BOOK'): RawPage {
  const items: RawItem[] = [
    { str: head, x: 69, y: 613, w: 60, h: 7 },
    { str: label, x: 69, y: 39, w: 8, h: 7 },
  ];
  let y = 574;
  for (const l of lines) {
    const o = typeof l === 'string' ? { text: l } : l;
    y -= o.gap ?? 0;
    items.push({ str: o.text, x: o.x ?? 69, y, w: o.text.length * 5, h: o.h ?? 10.5 });
    y -= 15;
  }
  return { items, width: 432, height: 648, label };
}

describe('splitSentences', () => {
  it('splits sentences but not after titles or initials', () => {
    expect(splitSentences('When Herbert W. Armstrong led the Church, it grew. Mr. Armstrong was faithful! Was he?')).toEqual([
      'When Herbert W. Armstrong led the Church, it grew.',
      'Mr. Armstrong was faithful!',
      'Was he?',
    ]);
  });
  it('keeps a closing quote and reference with its sentence', () => {
    expect(splitSentences('He said, “I will arise.” (Luke 15:18). Then he went.')).toEqual([
      'He said, “I will arise.” (Luke 15:18).',
      'Then he went.',
    ]);
  });
});

describe('joinLines', () => {
  it('undoes hyphenation at line ends but keeps real hyphens and dashes', () => {
    expect(joinLines(['a great deal of trib-', 'ulation and self-', 'destructive living—', 'truly'])).toBe(
      'a great deal of tribulation and self-destructive living—truly',
    );
  });
});

describe('titleCase', () => {
  it('title-cases all-capital headings only', () => {
    expect(titleCase('A FATHER’S HEARTACHE, A FATHER’S JOY')).toBe('A Father’s Heartache, a Father’s Joy');
    expect(titleCase('Where Is God?')).toBe('Where Is God?');
  });
});

describe('parseBook', () => {
  const body = (n: number) => [
    { text: `Paragraph one of part ${n} starts here and`, x: 81 },
    'carries on to a second line. It ends here.',
    { text: `Paragraph two of part ${n} is indented.`, x: 81 },
  ];
  const pages: RawPage[] = [
    page('1', [{ text: 'CHAPTER 1', h: 21 }, { text: 'THE BEGINNING', h: 32 }, ...body(1)]),
    page('2', ['continues from the page before.', ...body(2)]),
    page('3', [{ text: 'CHAPTER 2', h: 21 }, { text: 'THE END', h: 32 }, ...body(3)]),
  ];

  it('finds chapters from big headings, and paragraphs from indents', () => {
    const book = parseBook(pages, { fileName: 'My Book (CODE_01).pdf' });
    expect(book.title).toBe('My Book');
    expect(book.sections.map((s) => s.title)).toEqual(['Chapter 1 — The Beginning', 'Chapter 2 — The End']);
    const [heading, p1, p2, p3] = book.sections[0].paras;
    expect(heading).toEqual({ s: ['Chapter 1', 'The Beginning'], pg: '1', h: 1 });
    expect(p1.s).toEqual(['Paragraph one of part 1 starts here and carries on to a second line.', 'It ends here.']);
    // A paragraph running onto the next page (whose first line isn't indented) stays one paragraph.
    expect(p2.s).toEqual(['Paragraph two of part 1 is indented. continues from the page before.']);
    expect(p3.pg).toBe('2');
  });

  it('drops running heads and page numbers', () => {
    const all = parseBook(pages, { fileName: 'x.pdf' }).sections.flatMap((s) => s.paras.flatMap((p) => p.s));
    expect(all.join(' ')).not.toContain('THE BOOK');
    expect(all.filter((s) => /^\d+$/.test(s))).toEqual([]);
  });

  it('uses the PDF’s bookmarks when it has them', () => {
    const book = parseBook(pages, {
      fileName: 'x.pdf',
      outline: [
        { title: 'Start', page: 0 },
        { title: 'Later', page: 1 },
      ],
    });
    expect(book.sections.map((s) => [s.title, s.paras[0].pg])).toEqual([
      ['Start', '1'],
      ['Later', '2'],
    ]);
  });

  it('puts a drop cap back on its word', () => {
    // The big J sits beside the first two lines, which are indented around it.
    const p = page('1', [
      { text: 'CHAPTER 1', h: 21 },
      { text: 'TITLE', h: 32 },
      { text: 'esus wept, and the people', x: 83, gap: 20 },
      { text: 'saw how He loved him.', x: 83 },
      'Then they went home together.',
    ]);
    p.items.push({ str: 'J', x: 67, y: 574 - 30 - 20 - 15, w: 13, h: 44 });
    const p2 = page('2', [{ text: 'CHAPTER 2', h: 21 }, { text: 'NEXT', h: 32 }, 'More body text to read here, and more again.']);
    const book = parseBook([p, p2], { fileName: 'x.pdf' });
    expect(book.sections[0].paras[1].s).toEqual(['Jesus wept, and the people saw how He loved him.', 'Then they went home together.']);
  });

  it('explains a PDF with no text', () => {
    expect(() => parseBook([{ items: [], width: 400, height: 600, label: '1' }], { fileName: 'scan.pdf' })).toThrow(/scanned/);
  });
});

describe('repairUnreadable', () => {
  const block = (...lines: string[]) => ({ lines: lines.map((text) => ({ text })) });
  it('fills letters a cover font could not name from the same words in plain type', () => {
    const cover = block('THE �EW', 'TH�O�E', 'OF �AVI�');
    repairUnreadable([cover, block('The New Throne of David'), block('Those who had to work fasted instead.')]);
    expect(cover.lines.map((l) => l.text)).toEqual(['THE NEW', 'THRONE', 'OF DAVID']);
  });
  it('leaves text alone when nothing else in the book matches', () => {
    const cover = block('�UBIES');
    repairUnreadable([cover, block('A book about something else entirely.')]);
    expect(cover.lines[0].text).toBe('�UBIES');
  });
});

describe('repairUnreadable: spaced-out letters', () => {
  it('closes up letters spread out for show when the words appear normally elsewhere', () => {
    const cover = { lines: [{ text: 'G E R A L D F L U R R Y' }] };
    repairUnreadable([cover, { lines: [{ text: 'Gerald Flurry' }] }]);
    expect(cover.lines[0].text).toBe('GERALD FLURRY');
  });
  it('leaves ordinary short words alone', () => {
    const line = { lines: [{ text: 'It is as we go to do it' }] };
    repairUnreadable([line, { lines: [{ text: 'Something else.' }] }]);
    expect(line.lines[0].text).toBe('It is as we go to do it');
  });
});

describe('citation', () => {
  it('names the author, book and pages', () => {
    expect(citation({ title: 'The Book', author: 'A. Writer' }, ['7', '7', '8'])).toBe('A. Writer, The Book, pp. 7–8');
    expect(citation({ title: 'The Book', author: '' }, ['12'])).toBe('The Book, p. 12');
    expect(citation({ title: 'The Book', author: '' }, [''])).toBe('The Book');
  });
  it('names the chapter, except a title page', () => {
    expect(citation({ title: 'The Book', author: '' }, ['7'], 'Chapter 1 — The Start')).toBe('The Book, Chapter 1: The Start, p. 7');
    expect(citation({ title: 'The Book', author: '' }, ['7'], 'Introduction')).toBe('The Book, Introduction, p. 7');
    expect(citation({ title: 'The Book', author: '' }, [''], 'The Book')).toBe('The Book');
  });
});
