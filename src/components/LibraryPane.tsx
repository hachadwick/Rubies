import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CloseButton,
  ColorSwatch,
  Group,
  Kbd,
  Menu,
  Modal,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bookmark,
  BookmarkCheck,
  BookCopy,
  BookText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Eraser,
  FileUp,
  Library,
  NotebookPen,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Ref } from '../bible/reference';
import { db, parseSentenceKey, sentenceKey, type HighlightColor, type LibraryBook } from '../db';
import type { Insertion } from '../insertion';
import { citation, deleteBook, importPdf, normalize } from '../library/library';
import { sectionRefs, type FoundRef } from '../library/refs';
import { HIGHLIGHT_COLORS } from './BiblePane';
import { ListenButton, PlayerBar, useFollowReading, useStopOnUnmount } from './ReadAloud';
import { startReading, stopReading, useReading } from '../speech';
import { syncSupported } from '../sync/google';
import { useSyncState } from '../sync/sync';
import { copyText } from '../util';
import { ConfirmDialog } from './ConfirmDialog';

const LOC_KEY = 'rubies.library';

interface Place {
  bookId: string;
  section: number;
  /** Paragraph and sentence to scroll to and flash. */
  focus?: [number, number];
  /** Put the focused sentence at the top of the pane (a bookmark or highlight) rather than in the middle. */
  top?: boolean;
  nonce?: number;
}

function readPlace(): Place | null {
  try {
    const p = JSON.parse(localStorage.getItem(LOC_KEY) ?? '');
    if (typeof p?.bookId === 'string' && p.section >= 0) return { bookId: p.bookId, section: p.section };
  } catch {
    /* none yet */
  }
  return null;
}

interface Props {
  /** The Bible / Library switch, shown at the top of the pane. */
  tabs: ReactNode;
  /** Present when a note is open; adds the quote to it. */
  onInsert?: (what: Insertion) => void;
  /** Opens the Bible at a passage mentioned in the book. */
  onOpenRef: (ref: Ref) => void;
  toast: (msg: string) => void;
}

/** Where the reader was when they followed a reference to the Bible, so coming back returns there. */
let returnTo: Place | null = null;

export function LibraryPane({ tabs, onInsert, onOpenRef, toast }: Props) {
  const [place, setPlace] = useState<Place | null>(() => {
    const p = readPlace();
    const back = returnTo;
    returnTo = null;
    return back && p && back.bookId === p.bookId && back.section === p.section ? back : p;
  });

  useEffect(() => {
    try {
      if (place) localStorage.setItem(LOC_KEY, JSON.stringify({ bookId: place.bookId, section: place.section }));
      else localStorage.removeItem(LOC_KEY);
    } catch {
      /* ignore */
    }
  }, [place?.bookId, place?.section]); // eslint-disable-line react-hooks/exhaustive-deps

  const book = useLiveQuery(() => (place ? db.libraryBooks.get(place.bookId) : undefined), [place?.bookId]);
  // A book that was deleted (or never finished importing) goes back to the shelf.
  useEffect(() => {
    if (place && book === undefined) {
      db.libraryBooks.get(place.bookId).then((b) => !b && setPlace(null));
    }
  }, [place, book]);

  return (
    <section className="pane bible-pane library-pane" aria-label="Library">
      {tabs}
      {place && book ? (
        <Reader
          book={book}
          place={place}
          onPlace={setPlace}
          onClose={() => setPlace(null)}
          onInsert={onInsert}
          onOpenRef={(ref, at) => {
            returnTo = { bookId: book.id, section: place.section, focus: at, nonce: Date.now() };
            onOpenRef(ref);
          }}
          toast={toast}
        />
      ) : (
        <Shelf onOpen={(bookId) => setPlace({ bookId, section: 0 })} toast={toast} />
      )}
    </section>
  );
}

/* ---------------- The shelf: imported books, and importing new ones ---------------- */

function Shelf({ onOpen, toast }: { onOpen: (bookId: string) => void; toast: (msg: string) => void }) {
  const books = useLiveQuery(() => db.libraryBooks.orderBy('importedAt').reverse().toArray(), []);
  const syncing = useSyncState().status !== 'off';
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ name: string; done: number; total: number; abort: AbortController } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LibraryBook | null>(null);
  const [deleting, setDeleting] = useState<LibraryBook | null>(null);

  const start = async (file: File) => {
    setError(null);
    const abort = new AbortController();
    setImporting({ name: file.name, done: 0, total: 0, abort });
    try {
      const book = await importPdf(file, (done, total) => setImporting((s) => s && { ...s, done, total }), abort.signal);
      toast(`Imported ${book.title}`);
      onOpen(book.id);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'This PDF could not be imported.');
    } finally {
      setImporting(null);
    }
  };

  const importButton = (
    <Button leftSection={<FileUp size={18} />} onClick={() => input.current?.click()} disabled={!!importing}>
      Import PDF
    </Button>
  );

  return (
    <>
      <header className="pane-head">
        <Text fw={700} fz={20} px="xs">
          Library
        </Text>
        <div className="spacer" />
        {importButton}
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          aria-label="Choose a PDF to import"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) start(file);
          }}
        />
      </header>

      <div className="list-scroll library-shelf">
        {importing && (
          <Paper withBorder radius="lg" p="md" mt="md">
            <Group justify="space-between" wrap="nowrap" mb="xs">
              <Text size="sm" fw={600} truncate>
                Importing {importing.name}
              </Text>
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => importing.abort.abort()}>
                Cancel
              </Button>
            </Group>
            <Progress value={importing.total ? (importing.done / importing.total) * 100 : 3} animated />
            <Text size="xs" c="dimmed" mt={6}>
              {importing.total ? `Reading page ${importing.done} of ${importing.total}…` : 'Opening the PDF…'}
            </Text>
          </Paper>
        )}
        {error && (
          <Alert color="red" radius="lg" mt="md" title="Couldn’t import that PDF" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {books?.length === 0 && !importing && (
          <Stack align="center" ta="center" gap="sm" py={48} px="md">
            <ThemeIcon size={64} radius="xl" variant="light">
              <Library size={30} />
            </ThemeIcon>
            <Text fw={700} fz="lg">
              Your library is empty
            </Text>
            <Text c="dimmed" size="sm" maw={340}>
              Import a book as a PDF to read and study it here. Its text is brought in like the Bible’s, so you can
              tap any sentence and add it to your notes.
            </Text>
            {importButton}
          </Stack>
        )}

        <Stack gap="sm" mt="md">
          {books?.map((b) => (
            <Group key={b.id} className="note-card book-card" wrap="nowrap" gap="sm">
              <UnstyledButton className="book-open" onClick={() => onOpen(b.id)}>
                <ThemeIcon size={44} radius="md" variant="light">
                  <BookText size={22} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text fw={700} lineClamp={2}>
                    {b.title}
                  </Text>
                  <Text size="sm" c="dimmed" truncate>
                    {[b.author, `${b.sections.length} ${b.sections.length === 1 ? 'section' : 'sections'}`, `${b.pageCount} pages`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </div>
              </UnstyledButton>
              <Menu position="bottom-end" shadow="md">
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label={`More for ${b.title}`}>
                    <EllipsisVertical size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<Pencil size={16} />} onClick={() => setEditing(b)}>
                    Edit title and author
                  </Menu.Item>
                  <Menu.Item color="red" leftSection={<Trash2 size={16} />} onClick={() => setDeleting(b)}>
                    Remove from library
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          ))}
        </Stack>

        {!!books?.length && (
          <Text size="xs" c="dimmed" ta="center" mt="lg">
            {syncing
              ? 'Books sync to your other devices through Google Drive. They aren’t included in exported backups.'
              : syncSupported()
                ? 'Books are kept on this device. Turn on sync in Settings to have them on your other devices too.'
                : 'Books are kept on this device. They aren’t included in exported backups.'}
          </Text>
        )}
      </div>

      <EditBook book={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteBook(deleting.id);
          toast(`Removed ${deleting.title}`);
        }}
        title="Remove this book?"
        confirmLabel="Remove"
      >
        “{deleting?.title}” will be removed from your library{syncing ? ' on all your devices' : ''}. Quotes you’ve
        already added to notes stay. You can import the PDF again later.
      </ConfirmDialog>
    </>
  );
}

function EditBook({ book, onClose }: { book: LibraryBook | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author);
    }
  }, [book]);
  return (
    <Modal opened={!!book} onClose={onClose} title="Book details" radius="lg">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!book) return;
          await db.libraryBooks.update(book.id, { title: title.trim() || book.title, author: author.trim(), updatedAt: Date.now() });
          onClose();
        }}
      >
        <Stack>
          <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} data-autofocus />
          <TextInput
            label="Author"
            description="Shown with quotes you add to notes."
            value={author}
            onChange={(e) => setAuthor(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/* ---------------- Reading a book ---------------- */

interface Hit {
  section: number;
  para: number;
  sentence: number;
  text: string;
}

function Reader({
  book,
  place,
  onPlace,
  onClose,
  onInsert,
  onOpenRef,
  toast,
}: {
  book: LibraryBook;
  place: Place;
  onPlace: (p: Place) => void;
  onClose: () => void;
  onInsert?: (what: Insertion) => void;
  /** Opens the Bible at a reference found in sentence `at` ([paragraph, sentence]). */
  onOpenRef: (ref: Ref, at: [number, number]) => void;
  toast: (msg: string) => void;
}) {
  const index = Math.min(place.section, Math.max(0, book.sections.length - 1));
  const section = useLiveQuery(() => db.librarySections.get([book.id, index]), [book.id, index]);
  const [selected, setSelected] = useState<string[]>([]);
  const [flash, setFlash] = useState<[number, number] | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ query: string; hits: Hit[]; total: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // Highlights and bookmarks in this section, keyed by the full sentence key.
  const prefix = `${book.id}:${index}:`;
  const highlights = useLiveQuery(
    async () => new Map((await db.libraryHighlights.where('key').startsWith(prefix).toArray()).map((h) => [h.key, h.color])),
    [prefix],
  );
  const bookmarks = useLiveQuery(
    // Whole rows, not just primaryKeys(): see the same query in BiblePane.
    async () => new Set((await db.libraryBookmarks.where('key').startsWith(prefix).toArray()).map((b) => b.key)),
    [prefix],
  );
  // Bible references in the text, to show as links.
  const refs = useMemo(() => (section ? sectionRefs(section.paras) : new Map<string, FoundRef[]>()), [section]);

  // Reading aloud: the section's name (unless it opens with its own heading), then every sentence. At the end,
  // carry on to the next section.
  const reading = useReading();
  const keepReading = useRef(false);
  const listen = (from?: string) => {
    if (!section) return;
    const pieces = [
      ...(section.paras[0]?.h ? [] : [{ id: 'title', text: `${book.sections[index]?.title ?? ''}.` }]),
      ...section.paras.flatMap((p, pi) => p.s.map((text, si) => ({ id: `${pi}:${si}`, text: p.h ? `${text}.` : text }))),
    ];
    startReading('library', pieces, from ? Math.max(0, pieces.findIndex((x) => x.id === from)) : 0, () => {
      if (index >= book.sections.length - 1) return;
      keepReading.current = true;
      go(index + 1);
    });
  };
  useEffect(() => {
    if (!section || section.index !== index) return;
    // Going somewhere else by hand stops the reading; reaching the end of a section carries on.
    if (!keepReading.current) return stopReading('library');
    keepReading.current = false;
    listen();
  }, [section?.index, book.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useStopOnUnmount('library');
  useFollowReading('library', (id) => scroller.current?.querySelector(id === 'title' ? '.chapter-title' : `[data-s="${id}"]`));
  const readingKey = reading.owner === 'library' && reading.status !== 'idle' ? reading.current : undefined;

  // On moving to another section or a search result: clear the selection, scroll, and flash the sentence.
  useEffect(() => {
    setSelected([]);
    const el = scroller.current;
    if (!el || !section) return;
    if (place.focus) {
      setFlash(place.focus);
      requestAnimationFrame(() =>
        el.querySelector(`[data-s="${place.focus![0]}:${place.focus![1]}"]`)?.scrollIntoView({ block: place.top ? 'start' : 'center' }),
      );
      const t = setTimeout(() => setFlash(null), 2200);
      return () => clearTimeout(t);
    }
    el.scrollTop = 0;
  }, [book.id, index, place.focus, place.nonce, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number, focus?: [number, number], top?: boolean) => {
    setSearch(null);
    setSaved(false);
    onPlace({ bookId: book.id, section: i, focus, top, nonce: Date.now() });
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const words = normalize(q).split(/\s+/).filter(Boolean);
    const sections = await db.librarySections.where('bookId').equals(book.id).sortBy('index');
    const hits: Hit[] = [];
    let total = 0;
    for (const s of sections)
      s.paras.forEach((p, pi) =>
        p.s.forEach((text, si) => {
          const t = normalize(text);
          if (!words.every((w) => t.includes(w))) return;
          total++;
          if (hits.length < 200) hits.push({ section: s.index, para: pi, sentence: si, text });
        }),
      );
    setSaved(false);
    setSearch({ query: q, hits, total });
  };

  // The selection in reading order, grouped into paragraphs (a gap within a paragraph shows as "…").
  const picked = useMemo(() => {
    if (!section) return { paragraphs: [] as string[], pages: [] as string[] };
    const keys = new Set(selected);
    const paragraphs: string[] = [];
    const pages: string[] = [];
    section.paras.forEach((p, pi) => {
      const parts: string[] = [];
      let last = -2;
      p.s.forEach((s, si) => {
        if (!keys.has(`${pi}:${si}`)) return;
        if (parts.length && si !== last + 1) parts.push('…');
        parts.push(s);
        last = si;
      });
      if (parts.length) {
        paragraphs.push(parts.join(' '));
        pages.push(p.pg);
      }
    });
    return { paragraphs, pages };
  }, [section, selected]);

  const cite = citation(book, picked.pages, book.sections[index]?.title);
  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const copy = async () => {
    try {
      await copyText(`${picked.paragraphs.map((p, i) => (i === 0 ? `“${p}` : p)).join('\n\n')}”\n— ${cite}`);
      toast('Copied');
    } catch {
      toast('Copy failed');
    }
    setSelected([]);
  };

  // The selection as full sentence keys, in reading order.
  const selKeys = selected
    .map((k) => k.split(':').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([p, s]) => sentenceKey(book.id, index, p, s));
  const marked = selKeys.filter((k) => bookmarks?.has(k));

  const setHighlight = async (color: HighlightColor | null) => {
    if (color) await db.libraryHighlights.bulkPut(selKeys.map((key) => ({ key, color, createdAt: Date.now() })));
    else await db.libraryHighlights.bulkDelete(selKeys);
    setSelected([]);
  };

  const toggleBookmark = async () => {
    if (marked.length) {
      await db.libraryBookmarks.bulkDelete(marked);
      toast('Bookmark removed');
    } else {
      // One bookmark for the passage, on its first sentence.
      await db.libraryBookmarks.put({ key: selKeys[0], label: cite, createdAt: Date.now() });
      toast(`Bookmarked ${cite}`);
    }
    setSelected([]);
  };

  const atStart = index === 0;
  const atEnd = index >= book.sections.length - 1;
  const inFlash = (pi: number, si: number) => flash && flash[0] === pi && flash[1] === si;

  /** A sentence's text with its Bible references as links. */
  const sentenceText = (text: string, pi: number, si: number): ReactNode => {
    const found = refs.get(`${pi}:${si}`);
    if (!found) return text;
    const out: ReactNode[] = [];
    let at = 0;
    for (const f of found) {
      out.push(text.slice(at, f.start));
      out.push(
        <a
          key={f.start}
          href="#"
          className="bible-ref"
          title="Open in the Bible"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenRef(f.ref, [pi, si]);
          }}
        >
          {text.slice(f.start, f.end)}
        </a>,
      );
      at = f.end;
    }
    out.push(text.slice(at));
    return out;
  };

  return (
    <>
      <header className="pane-head">
        <Tooltip label="All books">
          <ActionIcon onClick={onClose} aria-label="Back to the library">
            <BookCopy />
          </ActionIcon>
        </Tooltip>
        <UnstyledButton className="lib-title" onClick={() => setPicking(true)} aria-label="Choose a section">
          <span className="lib-title-text">
            <Text component="span" size="xs" c="dimmed" fw={600} truncate display="block">
              {book.title}
            </Text>
            <Text component="span" fw={700} fz={17} truncate display="block">
              {book.sections[index]?.title}
            </Text>
          </span>
          <ChevronDown size={18} className="lib-title-chevron" />
        </UnstyledButton>
        <ActionIcon onClick={() => go(index - 1)} aria-label="Previous section" disabled={atStart}>
          <ChevronLeft />
        </ActionIcon>
        <ActionIcon onClick={() => go(index + 1)} aria-label="Next section" disabled={atEnd}>
          <ChevronRight />
        </ActionIcon>
        {/* From the first selected sentence, if any. */}
        <ListenButton
          owner="library"
          onStart={() =>
            listen(
              selected
                .map((k) => k.split(':').map(Number))
                .sort((a, b) => a[0] - b[0] || a[1] - b[1])
                .map((k) => k.join(':'))[0],
            )
          }
        />
        <Tooltip label="Bookmarks & highlights">
          <ActionIcon
            variant={saved ? 'light' : 'subtle'}
            color={saved ? undefined : 'gray'}
            onClick={() => {
              setSearch(null);
              setSaved(!saved);
            }}
            aria-label="Bookmarks and highlights in this book"
          >
            <Bookmark />
          </ActionIcon>
        </Tooltip>
      </header>

      <form onSubmit={runSearch} role="search" className="lookup lookup-row">
        <TextInput
          style={{ flex: 1, minWidth: 0 }}
          type="search"
          size="md"
          radius="xl"
          variant="filled"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search this book…"
          aria-label="Search this book"
          enterKeyHint="search"
          leftSection={<Search size={18} />}
          rightSectionWidth="auto"
          rightSection={
            query.trim() ? (
              <Group gap={6} pr="sm" wrap="nowrap" style={{ pointerEvents: 'none' }}>
                <Badge variant="light" radius="sm" tt="none" size="lg" fw={500}>
                  Search
                </Badge>
                <Kbd visibleFrom="sm">↵</Kbd>
              </Group>
            ) : null
          }
        />
        <Group gap={6} wrap="nowrap">
          <Button
            variant="default"
            radius="xl"
            size="md"
            px="sm"
            leftSection={<ChevronLeft size={18} />}
            onClick={() => go(index - 1)}
            disabled={atStart}
            aria-label="Previous section"
          >
            <span className="lookup-nav-label">Previous</span>
          </Button>
          <Button
            variant="default"
            radius="xl"
            size="md"
            px="sm"
            rightSection={<ChevronRight size={18} />}
            onClick={() => go(index + 1)}
            disabled={atEnd}
            aria-label="Next section"
          >
            <span className="lookup-nav-label">Next</span>
          </Button>
        </Group>
      </form>

      {search && (
        <div className="panel">
          <Group className="panel-head" justify="space-between" wrap="nowrap">
            <Text size="sm" truncate>
              <b>{search.total.toLocaleString()}</b> {search.total === 1 ? 'sentence' : 'sentences'}{' '}
              <Text span c="dimmed" inherit>
                for “{search.query}”
              </Text>
            </Text>
            <CloseButton size="lg" onClick={() => setSearch(null)} aria-label="Close search" />
          </Group>
          {search.total === 0 && (
            <Text c="dimmed" ta="center" p="xl">
              Nothing found. Try fewer words.
            </Text>
          )}
          <ol className="results">
            {search.hits.map((h) => (
              <li key={`${h.section}:${h.para}:${h.sentence}`}>
                <UnstyledButton className="result" onClick={() => go(h.section, [h.para, h.sentence])}>
                  <Text component="span" size="xs" fw={700} c="var(--accent)" tt="uppercase" className="result-ref">
                    {book.sections[h.section]?.title}
                  </Text>
                  <span className="result-text">{markWords(h.text, search.query)}</span>
                </UnstyledButton>
              </li>
            ))}
          </ol>
          {search.total > search.hits.length && (
            <Text c="dimmed" ta="center" size="sm" p="md">
              Showing the first {search.hits.length}. Add words to narrow the search.
            </Text>
          )}
        </div>
      )}

      {saved && <SavedPanel book={book} onGo={(s, p, i) => go(s, [p, i], true)} onClose={() => setSaved(false)} />}

      <div className="verses book-text" ref={scroller} hidden={!!search || saved}>
        {/* A section that opens with its own heading (most chapters) shows that instead of its name. */}
        {section && !section.paras[0]?.h && <h2 className="chapter-title">{book.sections[index]?.title}</h2>}
        {section?.paras.map((p, pi) => {
          const newPage = p.pg && p.pg !== section.paras[pi - 1]?.pg;
          return (
            <p key={pi} className={p.h ? 'book-para book-heading' : 'book-para'}>
              {newPage && (
                <span className="pg-mark" aria-label={`Page ${p.pg}`}>
                  p. {p.pg}
                </span>
              )}
              {p.s.map((s, si) => {
                const key = `${pi}:${si}`;
                const full = sentenceKey(book.id, index, pi, si);
                const hl = highlights?.get(full);
                return (
                  <Fragment key={si}>
                    <span
                      data-s={key}
                      className={[
                        'sent',
                        p.h && si === 0 && p.s.length > 1 && 'sent-label',
                        hl && `hl-${hl}`,
                        selected.includes(key) && 'selected',
                        inFlash(pi, si) && 'flash',
                        readingKey === key && 'reading',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => toggle(key)}
                    >
                      {sentenceText(s, pi, si)}
                      {bookmarks?.has(full) && <Bookmark className="vmark vmark-bookmark" size={20} fill="currentColor" aria-label="Bookmarked" />}
                    </span>{' '}
                  </Fragment>
                );
              })}
            </p>
          );
        })}
      </div>

      {selected.length > 0 && !search && !saved && (
        <Paper className="action-bar" shadow="xl" withBorder p="sm" role="toolbar" aria-label="Sentence actions">
          <Group justify="space-between" wrap="nowrap" mb={8}>
            <div style={{ minWidth: 0 }}>
              <Text fw={700} size="lg" truncate>
                {cite}
              </Text>
              <Text size="xs" c="dimmed">
                {selected.length} {selected.length === 1 ? 'sentence' : 'sentences'}
              </Text>
            </div>
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
              <ActionIcon onClick={toggleBookmark} aria-label={marked.length ? 'Remove bookmark' : 'Bookmark'}>
                {marked.length ? <BookmarkCheck /> : <Bookmark />}
              </ActionIcon>
              <ActionIcon onClick={copy} aria-label="Copy">
                <Copy />
              </ActionIcon>
              {onInsert && (
                <Button
                  leftSection={<NotebookPen size={18} />}
                  onClick={() => {
                    onInsert({ kind: 'quote', paragraphs: picked.paragraphs, cite });
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

      {!search && !saved && <PlayerBar owner="library" title={book.sections[index]?.title ?? book.title} />}

      <Modal opened={picking} onClose={() => setPicking(false)} title={book.title} radius="lg" size="md">
        <Stack gap={2}>
          {book.sections.map((s, i) => (
            <UnstyledButton
              key={i}
              className="section-row"
              data-active={i === index || undefined}
              onClick={() => {
                setPicking(false);
                go(i);
              }}
            >
              <Text span fw={i === index ? 700 : 500} style={{ flex: 1 }}>
                {s.title}
              </Text>
              {s.pg && (
                <Text span size="sm" c="dimmed">
                  {s.pg}
                </Text>
              )}
            </UnstyledButton>
          ))}
        </Stack>
      </Modal>
    </>
  );
}

/** This book's bookmarks and highlights, like the Bible's. */
function SavedPanel({ book, onGo, onClose }: { book: LibraryBook; onGo: (section: number, para: number, sentence: number) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'bookmarks' | 'highlights'>('bookmarks');
  const prefix = `${book.id}:`;
  const data = useLiveQuery(async () => {
    const [bookmarks, highlights, sections] = await Promise.all([
      db.libraryBookmarks.where('key').startsWith(prefix).toArray(),
      db.libraryHighlights.where('key').startsWith(prefix).toArray(),
      db.librarySections.where('bookId').equals(book.id).toArray(),
    ]);
    const text = (key: string) => {
      const k = parseSentenceKey(key);
      return sections.find((s) => s.index === k.section)?.paras[k.para]?.s[k.sentence] ?? '';
    };
    const order = (a: string, b: string) => {
      const x = parseSentenceKey(a);
      const y = parseSentenceKey(b);
      return x.section - y.section || x.para - y.para || x.sentence - y.sentence;
    };
    return {
      bookmarks: bookmarks.sort((a, b) => b.createdAt - a.createdAt).map((b) => ({ ...b, text: text(b.key) })),
      highlights: highlights.sort((a, b) => order(a.key, b.key)).map((h) => ({ ...h, text: text(h.key) })),
    };
  }, [book.id]);

  const where = (key: string) => {
    const k = parseSentenceKey(key);
    return book.sections[k.section]?.title ?? '';
  };
  const open = (key: string) => {
    const k = parseSentenceKey(key);
    onGo(k.section, k.para, k.sentence);
  };

  return (
    <div className="panel">
      <Group className="panel-head" justify="space-between" wrap="nowrap">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          data={[
            { value: 'bookmarks', label: 'Bookmarks' },
            { value: 'highlights', label: 'Highlights' },
          ]}
        />
        <CloseButton size="lg" onClick={onClose} aria-label="Close" />
      </Group>
      {tab === 'bookmarks' ? (
        data?.bookmarks.length === 0 ? (
          <Text c="dimmed" ta="center" p="xl">
            No bookmarks in this book yet. Tap a sentence, then the bookmark button.
          </Text>
        ) : (
          <ol className="results">
            {data?.bookmarks.map((bm) => (
              <li key={bm.key}>
                <UnstyledButton className="result" onClick={() => open(bm.key)}>
                  <Text component="span" size="xs" fw={700} c="var(--accent)" tt="uppercase" className="result-ref">
                    {where(bm.key)}
                  </Text>
                  <span className="result-text">{bm.text}</span>
                </UnstyledButton>
                <ActionIcon color="red" onClick={() => db.libraryBookmarks.delete(bm.key)} aria-label="Delete bookmark">
                  <Trash2 size={18} />
                </ActionIcon>
              </li>
            ))}
          </ol>
        )
      ) : data?.highlights.length === 0 ? (
        <Text c="dimmed" ta="center" p="xl">
          No highlights in this book yet. Tap a sentence, then pick a colour.
        </Text>
      ) : (
        <ol className="results">
          {data?.highlights.map((h) => (
            <li key={h.key}>
              <UnstyledButton className="result" onClick={() => open(h.key)}>
                <Text component="span" size="xs" fw={700} c="var(--accent)" tt="uppercase" className="result-ref">
                  {where(h.key)}
                </Text>
                <span className={`result-text hl-${h.color}`}>{h.text}</span>
              </UnstyledButton>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function markWords(text: string, query: string): ReactNode {
  const words = query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’‘]/g, "['’‘]"));
  if (!words.length) return text;
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}
