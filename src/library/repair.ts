/** What pdf.js gives for a letter it can't name: some display fonts (a cover's fancy capitals) don't say. */
export const UNREADABLE = '�';

/** A line of letters set apart from each other: five or more pieces of one or two letters each. */
const SPACED_OUT = /^(\p{L}{1,2}\s+){4,}\p{L}{1,2}$/u;

/**
 * Fills in letters the PDF couldn't name. A title set in a decorative font can come out with gaps, like
 * "THE ?EW TH?O?E OF ?AVI?"; the same words nearly always appear again in plain type (a half-title, a running
 * head, the contents), so the gaps are filled from there. Text with no match elsewhere is left as it is.
 */
export function repairUnreadable(bs: { lines: { text: string }[] }[]): void {
  const all = bs.flatMap((b) => b.lines);
  if (!all.some((l) => l.text.includes(UNREADABLE) || SPACED_OUT.test(l.text.trim()))) return;
  const readable = all
    .map((l) => l.text)
    .filter((t) => !t.includes(UNREADABLE) && !SPACED_OUT.test(t.trim()))
    .join(' ');

  // Letters spread out for show ("G E R A L D  F L U R R Y") become the same words as set normally elsewhere.
  for (const l of all) {
    const text = l.text.trim();
    if (!SPACED_OUT.test(text) || text.includes(UNREADABLE)) continue;
    const letters = [...text.replace(/\s+/g, '')];
    const m = readable.match(new RegExp(`(?<![\\p{L}\\p{N}])${letters.join('\\s?')}(?![\\p{L}\\p{N}])`, 'iu'));
    if (m && /\s/.test(m[0])) l.text = text === text.toUpperCase() ? m[0].toUpperCase() : m[0];
  }

  /** The readable words that fit a damaged phrase, without their spaces (the commonest, if more than one fits). */
  const find = (damaged: string): string | null => {
    const words = damaged.trim().split(/\s+/).filter(Boolean);
    if (!words.join('').replaceAll(UNREADABLE, '').length) return null;
    const pattern = words
      .map((w) =>
        w
          .split(UNREADABLE)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^\\s\\uFFFD]'),
      )
      .join('\\s+');
    const counts = new Map<string, number>();
    for (const m of readable.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu'))) {
      const found = m[0].replace(/\s+/g, '').toLowerCase();
      counts.set(found, (counts.get(found) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  /** Puts the found letters into the gaps, in the capitals or small letters of the text around them. */
  const fill = (lines: { text: string }[], found: string) => {
    const chars = [...found];
    let i = 0;
    for (const l of lines) {
      const letters = l.text.replace(/[^\p{L}]/gu, '');
      const upper = !!letters && letters === letters.toUpperCase();
      l.text = [...l.text]
        .map((ch) => {
          if (/\s/.test(ch)) return ch;
          const from = chars[i++] ?? ch;
          return ch === UNREADABLE ? (upper ? from.toUpperCase() : from) : ch;
        })
        .join('');
    }
  };

  for (const b of bs) {
    const damaged = b.lines.filter((l) => l.text.includes(UNREADABLE));
    if (!damaged.length) continue;
    // The whole heading at once is the surest match; failing that, a line at a time.
    const whole = find(b.lines.map((l) => l.text).join(' '));
    if (whole) fill(b.lines, whole);
    else
      for (const l of damaged) {
        const one = find(l.text);
        if (one) fill([l], one);
      }
  }
}
