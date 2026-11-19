import { hasSpeaker, kindLabel, type Note } from './db';

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

/**
 * Copies text. navigator.clipboard only exists on HTTPS and localhost; over a plain http:// network address,
 * falls back to the older select-and-copy, which browsers still allow from a click.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Copy is not available here');
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, opts);
}

export function noteTitle(n: Pick<Note, 'title' | 'passage' | 'date'> & { kind?: Note['kind'] }): string {
  return n.title.trim() || n.passage.trim() || `${kindLabel(n.kind)} notes — ${formatDate(n.date)}`;
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'note';
}

/**
 * A quote's parts, for the exports: the quoted blocks (to go inside quotation marks), who said it (the <cite>
 * line, '' when empty), and, in quotes saved before the name line existed, a first line that is only a bold Bible
 * reference (kept outside the marks).
 */
export function quoteParts(quote: HTMLElement): { lead?: HTMLElement; body: ChildNode[]; cite: string } {
  const kids = [...quote.childNodes].filter((n) => n instanceof HTMLElement || n.textContent?.trim());
  const citeEl = kids.find((n): n is HTMLElement => n instanceof HTMLElement && n.tagName === 'CITE');
  let body = kids.filter((n) => n !== citeEl);
  const first = body[0];
  const lead =
    first instanceof HTMLElement &&
    first.tagName === 'P' &&
    first.children.length === 1 &&
    first.firstElementChild!.tagName === 'STRONG' &&
    first.textContent!.trim() === first.firstElementChild!.textContent!.trim() &&
    body.length > 1
      ? first
      : undefined;
  if (lead) body = body.slice(1);
  return { lead, body, cite: citeEl?.textContent?.trim() ?? '' };
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
      case 'BLOCKQUOTE': {
        // “The quoted words” — Who said them
        const { lead, body, cite } = quoteParts(n);
        const lines = body.flatMap((c) => block(c, '> ')).filter((l) => l !== '');
        if (lines.length) {
          lines[0] = `> “${lines[0].replace(/^> /, '')}`;
          lines[lines.length - 1] += '”';
        }
        return [...(lead ? block(lead, '> ') : []), ...lines, ...(cite ? ['>', `> — ${cite}`] : []), ''];
      }
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
    n.date && `**Date:** ${formatDate(n.date, { dateStyle: 'full' })}`,
    hasSpeaker(n.kind) && n.speaker && `**Speaker:** ${n.speaker}`,
    hasSpeaker(n.kind) && n.church && `**Location:** ${n.church}`,
    n.passage && `**Passage:** ${n.passage}`,
  ].filter(Boolean);
  const ink = n.ink.length ? '\n\n_(This note also has handwritten notes, viewable in Rubies.)_' : '';
  return `# ${noteTitle(n)}\n\n${meta.join('  \n')}\n\n${htmlToMarkdown(n.bodyHtml)}${ink}\n`;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
