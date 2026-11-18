import { kindLabel, type Note } from './db';

/** Saves a file. Uses the share sheet on iPad/Android when available, else a normal download. */
export async function saveFile(name: string, content: string, type: string): Promise<void> {
  const file = new File([content], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const touchDevice = matchMedia('(pointer: coarse)').matches;
  if (touchDevice && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, opts);
}

export function noteTitle(n: Pick<Note, 'title' | 'passage' | 'date'>): string {
  return n.title.trim() || n.passage.trim() || `Sermon notes — ${formatDate(n.date)}`;
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'note';
}

/** Converts the TipTap HTML body to Markdown (headings, lists, quotes, bold/italic). */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? '';
    if (!(n instanceof HTMLElement)) return '';
    const inner = [...n.childNodes].map(inline).join('');
    switch (n.tagName) {
      case 'STRONG':
      case 'B':
        return inner.trim() ? `**${inner}**` : inner;
      case 'EM':
      case 'I':
        return inner.trim() ? `*${inner}*` : inner;
      case 'MARK':
        return inner.trim() ? `==${inner}==` : inner;
      case 'BR':
        return '  \n';
      default:
        return inner;
    }
  };
  const block = (n: Node, prefix = ''): string[] => {
    if (!(n instanceof HTMLElement)) return n.textContent?.trim() ? [prefix + n.textContent] : [];
    switch (n.tagName) {
      case 'H1':
      case 'H2':
      case 'H3':
        return [`${'#'.repeat(Number(n.tagName[1]) + 1)} ${inline(n)}`, ''];
      case 'P':
        return [prefix + inline(n), ...(prefix ? [] : [''])];
      case 'BLOCKQUOTE':
        return [...[...n.childNodes].flatMap((c) => block(c, '> ')), ''];
      case 'UL':
      case 'OL':
        return [
          ...[...n.children].map((li, i) => `${prefix}${n.tagName === 'OL' ? `${i + 1}.` : '-'} ${inline(li).trim()}`),
          '',
        ];
      case 'HR':
        return ['---', ''];
      default:
        return [...n.childNodes].flatMap((c) => block(c, prefix));
    }
  };
  return block(doc.body.firstChild!).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function noteToMarkdown(n: Note): string {
  const meta = [
    `**Type:** ${kindLabel(n.kind)}`,
    n.date &&`**Date:** ${formatDate(n.date, { dateStyle: 'full' })}`,
    n.speaker && `**Speaker:** ${n.speaker}`,
    n.church && `**Church:** ${n.church}`,
    n.passage && `**Passage:** ${n.passage}`,
  ].filter(Boolean);
  const ink = n.ink.length ? '\n\n_(This note also has handwritten notes, viewable in Rubies.)_' : '';
  return `# ${noteTitle(n)}\n\n${meta.join('  \n')}\n\n${htmlToMarkdown(n.bodyHtml)}${ink}\n`;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
