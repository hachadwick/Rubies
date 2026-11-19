import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  ColorSwatch,
  Group,
  Kbd,
  Menu,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  NotebookPen,
  NotebookText,
  Search,
  Trash2,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { bookById } from '../bible/books';
import { chapterCount, getChapter, getPassage, searchBible, type SearchResult } from '../bible/kjv';
import { formatRef, parseKey, parseRefs, type Ref, verseKey } from '../bible/reference';
import { db, type HighlightColor, type Note } from '../db';
import { copyText, noteTitle } from '../util';
import { BookPicker } from './BookPicker';

export interface BibleLocation {
  book: number;
  chapter: number;
  /** Verses to scroll to and flash. */
  focus?: [number, number];
  /** Changes on every navigation so repeated jumps to the same place still scroll. */
  nonce?: number;
}

interface Props {
  loc: BibleLocation;
  onNavigate: (loc: BibleLocation) => void;
  /** Present when a note is open; inserts the passage into it. */
  onInsert?: (refs: Ref[]) => void;
  onOpenNote: (id: string) => void;
  toast: (msg: string) => void;
}

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange'];

/** Groups selected verse numbers into contiguous references: [1,2,3,5] → 1–3, 5. */
function toRefs(book: number, chapter: number, verses: number[]): Ref[] {
  const sorted = [...verses].sort((a, b) => a - b);
  const refs: Ref[] = [];
  for (const v of sorted) {
    const last = refs[refs.length - 1];
    if (last && (last.endVerse ?? last.verse!) + 1 === v) last.endVerse = v;
    else refs.push({ book, chapter, verse: v });
  }
  return refs;
}

export function refsLabel(refs: Ref[]): string {
  if (!refs.length) return '';
  const [first, ...rest] = refs;
  return [formatRef(first), ...rest.map((r) => (r.endVerse ? `${r.verse}–${r.endVerse}` : `${r.verse}`))].join(', ');
}

export function passageText(refs: Ref[]): string {
  return refs
    .map((r) => {
      const vs = getPassage(r);
      const body = vs.map((v) => (vs.length > 1 ? `${v.verse} ${v.text}` : v.text)).join(' ');
      return `${formatRef(r)} (KJV)\n${body}`;
    })
    .join('\n\n');
}

type Panel = { kind: 'search'; query: string; testament?: 'OT' | 'NT'; result: SearchResult } | { kind: 'saved' } | null;

export function BiblePane({ loc, onNavigate, onInsert, onOpenNote, toast }: Props) {
  const { book, chapter } = loc;
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [flash, setFlash] = useState<[number, number] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const verses = useMemo(() => getChapter(book, chapter), [book, chapter]);
  const prefix = `${book}:${chapter}:`;

  const highlights = useLiveQuery(
    async () => new Map((await db.highlights.where('key').startsWith(prefix).toArray()).map((h) => [h.key, h.color])),
    [prefix],
  );
  const bookmarks = useLiveQuery(
    async () => new Set((await db.bookmarks.where('key').startsWith(prefix).primaryKeys()) as string[]),
    [prefix],
  );
  const citing = useLiveQuery(async () => {
    const notes = await db.notes
      .where('verseKeys')
      .anyOf(verses.map((v) => v.key))
      .distinct()
      .toArray();
    const map = new Map<string, Note[]>();
    for (const n of notes)
      for (const k of n.verseKeys) if (k.startsWith(prefix)) map.set(k, [...(map.get(k) ?? []), n]);
    return map;
  }, [prefix]);

  // Reset selection and jump to the focused verse on navigation.
  useEffect(() => {
    setSelected([]);
    const el = scroller.current;
    if (!el) return;
    if (loc.focus) {
      setFlash(loc.focus);
      requestAnimationFrame(() =>
        el.querySelector(`[data-verse="${loc.focus![0]}"]`)?.scrollIntoView({ block: 'center' }),
      );
      const t = setTimeout(() => setFlash(null), 2200);
      return () => clearTimeout(t);
    }
    el.scrollTop = 0;
  }, [book, chapter, loc.focus, loc.nonce]);

  const go = (b: number, c: number, focus?: [number, number]) => {
    setPanel(null);
    onNavigate({ book: b, chapter: c, focus, nonce: Date.now() });
  };

  const step = (dir: 1 | -1) => {
    let b = book;
    let c = chapter + dir;
    if (c < 1) {
      if (b === 1) return;
      b -= 1;
      c = chapterCount(b);
    } else if (c > chapterCount(b)) {
      if (b === 66) return;
      b += 1;
      c = 1;
    }
    go(b, c);
  };

  const parsed = query.trim() ? parseRefs(query) : [];

  const submitLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (parsed.length && getPassage(parsed[0]).length) {
      const r = parsed[0];
      go(r.book, r.chapter, r.verse ? [r.verse, r.endChapter && r.endChapter !== r.chapter ? 999 : (r.endVerse ?? r.verse)] : undefined);
      setQuery('');
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    setPanel({ kind: 'search', query: q, result: searchBible(q) });
  };

  const refs = toRefs(book, chapter, selected);
  const selKeys = selected.map((v) => verseKey(book, chapter, v));
  const allBookmarked = selKeys.length > 0 && selKeys.every((k) => bookmarks?.has(k));
  const citingNotes = [...new Map(selKeys.flatMap((k) => citing?.get(k) ?? []).map((n) => [n.id, n])).values()];

  const setHighlight = async (color: HighlightColor | null) => {
    if (color) await db.highlights.bulkPut(selKeys.map((key) => ({ key, color, createdAt: Date.now() })));
    else await db.highlights.bulkDelete(selKeys);
    setSelected([]);
  };

  const toggleBookmark = async () => {
    if (allBookmarked) {
      await db.bookmarks.bulkDelete(selKeys);
      toast('Bookmark removed');
    } else {
      // One bookmark per passage, stored on its first verse.
      await db.bookmarks.bulkPut(
        refs.map((r) => ({ key: verseKey(r.book, r.chapter, r.verse!), label: formatRef(r), createdAt: Date.now() })),
      );
      toast(`Bookmarked ${refsLabel(refs)}`);
    }
    setSelected([]);
  };

  const copy = async () => {
    try {
      await copyText(passageText(refs));
      toast(`Copied ${refsLabel(refs)}`);
    } catch {
      toast('Copy failed');
    }
    setSelected([]);
  };

  const inFlash = (v: number) => flash && v >= flash[0] && v <= flash[1];
  const atStart = book === 1 && chapter === 1;
  const atEnd = book === 66 && chapter === 22;

  return (
    <section className="pane bible-pane" aria-label="Bible">
      <header className="pane-head">
        <Button
          variant="subtle"
          color="gray"
          size="md"
          px="xs"
          rightSection={<ChevronDown size={18} />}
          onClick={() => setPicking(true)}
          className="ref-btn"
        >
          {bookById(book).name} {chapter}
        </Button>
        <div className="spacer" />
        <ActionIcon onClick={() => step(-1)} aria-label="Previous chapter" disabled={atStart}>
          <ChevronLeft />
        </ActionIcon>
        <ActionIcon onClick={() => step(1)} aria-label="Next chapter" disabled={atEnd}>
          <ChevronRight />
        </ActionIcon>
        <Tooltip label="Bookmarks & highlights">
          <ActionIcon
            variant={panel?.kind === 'saved' ? 'light' : 'subtle'}
            color={panel?.kind === 'saved' ? undefined : 'gray'}
            onClick={() => setPanel(panel?.kind === 'saved' ? null : { kind: 'saved' })}
            aria-label="Bookmarks and highlights"
          >
            <Bookmark />
          </ActionIcon>
        </Tooltip>
      </header>

      <form onSubmit={submitLookup} role="search" className="lookup">
        <TextInput
          type="search"
          size="md"
          radius="xl"
          variant="filled"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Go to John 3:16 or search words…"
          aria-label="Look up a verse or search the Bible"
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="go"
          leftSection={<Search size={18} />}
          rightSectionWidth="auto"
          rightSection={
            query.trim() ? (
              <Group gap={6} pr="sm" wrap="nowrap" style={{ pointerEvents: 'none' }}>
                <Badge variant="light" radius="sm" tt="none" size="lg" fw={500}>
                  {parsed.length ? `Go to ${refsLabel(parsed)}` : 'Search'}
                </Badge>
                <Kbd visibleFrom="sm">↵</Kbd>
              </Group>
            ) : null
          }
        />
      </form>

      {panel?.kind === 'search' && (
        <SearchPanel
          panel={panel}
          onFilter={(testament) => setPanel({ ...panel, testament, result: searchBible(panel.query, 200, testament) })}
          onClose={() => setPanel(null)}
          onGo={(b, c, v) => go(b, c, [v, v])}
          onInsert={onInsert}
        />
      )}
      {panel?.kind === 'saved' && <SavedPanel onGo={(b, c, v) => go(b, c, [v, v])} onClose={() => setPanel(null)} />}

      <div className="verses" ref={scroller} hidden={!!panel}>
        <h2 className="chapter-title">
          {bookById(book).name} <span>{chapter}</span>
        </h2>
        {verses.map((v) => {
          const hl = highlights?.get(v.key);
          const notes = citing?.get(v.key);
          return (
            <p
              key={v.verse}
              data-verse={v.verse}
              className={['verse', hl && `hl-${hl}`, selected.includes(v.verse) && 'selected', inFlash(v.verse) && 'flash']
                .filter(Boolean)
                .join(' ')}
              onClick={() =>
                setSelected((s) => (s.includes(v.verse) ? s.filter((x) => x !== v.verse) : [...s, v.verse]))
              }
            >
              <sup className="vnum">{v.verse}</sup>
              {v.text}
              {bookmarks?.has(v.key) && <Bookmark className="vmark" size={14} aria-label="Bookmarked" />}
              {notes && <NotebookText className="vmark" size={14} aria-label={`Cited in ${notes.length} note(s)`} />}
            </p>
          );
        })}
        <Group justify="space-between" my="xl">
          <Button variant="default" leftSection={<ChevronLeft size={18} />} onClick={() => step(-1)} disabled={atStart}>
            Previous
          </Button>
          <Button variant="default" rightSection={<ChevronRight size={18} />} onClick={() => step(1)} disabled={atEnd}>
            Next
          </Button>
        </Group>
      </div>

      {selected.length > 0 && !panel && (
        <Paper className="action-bar" shadow="xl" withBorder p="sm" role="toolbar" aria-label="Verse actions">
          <Group justify="space-between" wrap="nowrap" mb={8}>
            <Text fw={700} size="lg" truncate>
              {refsLabel(refs)}
            </Text>
            <CloseButton size="lg" onClick={() => setSelected([])} aria-label="Clear selection" />
          </Group>
          <Group gap={6} justify="space-between">
            <Group gap={8}>
              {HIGHLIGHT_COLORS.map((c) => (
                <ColorSwatch
                  key={c}
                  component="button"
                  color={`var(--hl-${c}-solid)`}
                  size={30}
                  onClick={() => setHighlight(c)}
                  aria-label={`Highlight ${c}`}
                  style={{ cursor: 'pointer' }}
                />
              ))}
              <Tooltip label="Remove highlight">
                <ActionIcon size={30} radius="xl" variant="default" onClick={() => setHighlight(null)} aria-label="Remove highlight">
                  <Eraser size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group gap={4}>
              <ActionIcon onClick={toggleBookmark} aria-label={allBookmarked ? 'Remove bookmark' : 'Bookmark'}>
                {allBookmarked ? <BookmarkCheck /> : <Bookmark />}
              </ActionIcon>
              <ActionIcon onClick={copy} aria-label="Copy">
                <Copy />
              </ActionIcon>
              {citingNotes.length > 0 && (
                <Menu position="top-end" shadow="md" width={260}>
                  <Menu.Target>
                    <Button variant="light" size="compact-md" leftSection={<NotebookText size={16} />}>
                      {citingNotes.length}
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>Cited in your notes</Menu.Label>
                    {citingNotes.map((n) => (
                      <Menu.Item key={n.id} onClick={() => onOpenNote(n.id)}>
                        {noteTitle(n)}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
              {onInsert && (
                <Button
                  leftSection={<NotebookPen size={18} />}
                  onClick={() => {
                    onInsert(refs);
                    setSelected([]);
                  }}
                >
                  Add to note
                </Button>
              )}
            </Group>
          </Group>
        </Paper>
      )}

      <BookPicker opened={picking} current={book} onClose={() => setPicking(false)} onPick={(b, c) => (setPicking(false), go(b, c))} />
    </section>
  );
}

function highlightMatches(text: string, query: string) {
  const terms = [
    ...[...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()),
    ...query
      .replace(/"[^"]*"/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/\*$/, '')),
  ].filter(Boolean);
  if (!terms.length) return text;
  const re = new RegExp(
    `(\\b(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})\\w*)`,
    'gi',
  );
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

function PanelHead({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Group className="panel-head" justify="space-between" wrap="nowrap">
      {children}
      <CloseButton size="lg" onClick={onClose} aria-label="Close" />
    </Group>
  );
}

function ResultRow({
  label,
  onClick,
  children,
  action,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li>
      <UnstyledButton className="result" onClick={onClick}>
        <Text component="span" size="xs" fw={700} c="var(--mantine-primary-color-filled)" tt="uppercase" className="result-ref">
          {label}
        </Text>
        <span className="result-text">{children}</span>
      </UnstyledButton>
      {action}
    </li>
  );
}

function SearchPanel({
  panel,
  onFilter,
  onClose,
  onGo,
  onInsert,
}: {
  panel: Extract<Panel, { kind: 'search' }>;
  onFilter: (t?: 'OT' | 'NT') => void;
  onClose: () => void;
  onGo: (book: number, chapter: number, verse: number) => void;
  onInsert?: (refs: Ref[]) => void;
}) {
  const { result, query, testament } = panel;
  return (
    <div className="panel">
      <PanelHead onClose={onClose}>
        <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" truncate>
            <b>{result.total.toLocaleString()}</b> {result.total === 1 ? 'verse' : 'verses'}{' '}
            <Text span c="dimmed" inherit>
              for “{query}”
            </Text>
          </Text>
          <SegmentedControl
            size="xs"
            value={testament ?? 'all'}
            onChange={(v) => onFilter(v === 'all' ? undefined : (v as 'OT' | 'NT'))}
            data={[
              { value: 'all', label: 'All' },
              { value: 'OT', label: 'Old Testament' },
              { value: 'NT', label: 'New Testament' },
            ]}
          />
        </Stack>
      </PanelHead>
      {result.total === 0 && (
        <Text c="dimmed" ta="center" p="xl">
          No verses found. Try fewer words, or end a word with * to match more forms (e.g. <em>forgiv*</em>).
        </Text>
      )}
      <ol className="results">
        {result.verses.map((v) => (
          <ResultRow
            key={v.key}
            label={formatRef(v, true)}
            onClick={() => onGo(v.book, v.chapter, v.verse)}
            action={
              onInsert && (
                <Tooltip label="Add to note">
                  <ActionIcon onClick={() => onInsert([v])} aria-label={`Add ${formatRef(v)} to note`}>
                    <NotebookPen size={18} />
                  </ActionIcon>
                </Tooltip>
              )
            }
          >
            {highlightMatches(v.text, query)}
          </ResultRow>
        ))}
      </ol>
      {result.total > result.verses.length && (
        <Text c="dimmed" ta="center" size="sm" p="md">
          Showing the first {result.verses.length}. Add words to narrow the search.
        </Text>
      )}
    </div>
  );
}

function SavedPanel({ onGo, onClose }: { onGo: (b: number, c: number, v: number) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'bookmarks' | 'highlights'>('bookmarks');
  const bookmarks = useLiveQuery(() => db.bookmarks.orderBy('createdAt').reverse().toArray(), []);
  const highlights = useLiveQuery(() => db.highlights.toArray(), []);

  const sortedHighlights = useMemo(
    () =>
      (highlights ?? [])
        .map((h) => ({ ...h, ...parseKey(h.key) }))
        .sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse),
    [highlights],
  );

  const snippet = (b: number, c: number, v: number) => getPassage({ book: b, chapter: c, verse: v })[0]?.text ?? '';

  return (
    <div className="panel">
      <PanelHead onClose={onClose}>
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          data={[
            { value: 'bookmarks', label: 'Bookmarks' },
            { value: 'highlights', label: 'Highlights' },
          ]}
        />
      </PanelHead>
      {tab === 'bookmarks' ? (
        bookmarks?.length === 0 ? (
          <Text c="dimmed" ta="center" p="xl">
            No bookmarks yet. Tap a verse, then the bookmark button.
          </Text>
        ) : (
          <ol className="results">
            {bookmarks?.map((bm) => {
              const k = parseKey(bm.key);
              return (
                <ResultRow
                  key={bm.key}
                  label={bm.label}
                  onClick={() => onGo(k.book, k.chapter, k.verse)}
                  action={
                    <ActionIcon color="red" onClick={() => db.bookmarks.delete(bm.key)} aria-label={`Delete bookmark ${bm.label}`}>
                      <Trash2 size={18} />
                    </ActionIcon>
                  }
                >
                  {snippet(k.book, k.chapter, k.verse)}
                </ResultRow>
              );
            })}
          </ol>
        )
      ) : sortedHighlights.length === 0 ? (
        <Text c="dimmed" ta="center" p="xl">
          No highlights yet. Tap a verse, then pick a colour.
        </Text>
      ) : (
        <ol className="results">
          {sortedHighlights.map((h) => (
            <ResultRow
              key={h.key}
              label={formatRef({ book: h.book, chapter: h.chapter, verse: h.verse }, true)}
              onClick={() => onGo(h.book, h.chapter, h.verse)}
            >
              <span className={`hl-${h.color}`}>{snippet(h.book, h.chapter, h.verse)}</span>
            </ResultRow>
          ))}
        </ol>
      )}
    </div>
  );
}
