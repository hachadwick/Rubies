import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CloseButton,
  Group,
  Kbd,
  Menu,
  Modal,
  Paper,
  Progress,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookCopy,
  BookText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  EllipsisVertical,
  FileUp,
  Library,
  NotebookPen,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, type LibraryBook } from '../db';
import type { Insertion } from '../insertion';
import { citation, deleteBook, importPdf, normalize } from '../library/library';
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
  toast: (msg: string) => void;
}

export function LibraryPane({ tabs, onInsert, toast }: Props) {
  const [place, setPlace] = useState<Place | null>(readPlace);

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
        <Reader book={book} place={place} onPlace={setPlace} onClose={() => setPlace(null)} onInsert={onInsert} toast={toast} />
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
  toast,
}: {
  book: LibraryBook;
  place: Place;
  onPlace: (p: Place) => void;
  onClose: () => void;
  onInsert?: (what: Insertion) => void;
  toast: (msg: string) => void;
}) {
  const index = Math.min(place.section, Math.max(0, book.sections.length - 1));
  const section = useLiveQuery(() => db.librarySections.get([book.id, index]), [book.id, index]);
  const [selected, setSelected] = useState<string[]>([]);
  const [flash, setFlash] = useState<[number, number] | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ query: string; hits: Hit[]; total: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // On moving to another section or a search result: clear the selection, scroll, and flash the sentence.
  useEffect(() => {
    setSelected([]);
    const el = scroller.current;
    if (!el || !section) return;
    if (place.focus) {
      setFlash(place.focus);
      requestAnimationFrame(() =>
        el.querySelector(`[data-s="${place.focus![0]}:${place.focus![1]}"]`)?.scrollIntoView({ block: 'center' }),
      );
      const t = setTimeout(() => setFlash(null), 2200);
      return () => clearTimeout(t);
    }
    el.scrollTop = 0;
  }, [book.id, index, place.focus, place.nonce, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number, focus?: [number, number]) => {
    setSearch(null);
    onPlace({ bookId: book.id, section: i, focus, nonce: Date.now() });
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

  const cite = citation(book, picked.pages);
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

  const atStart = index === 0;
  const atEnd = index >= book.sections.length - 1;
  const inFlash = (pi: number, si: number) => flash && flash[0] === pi && flash[1] === si;

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

      <div className="verses book-text" ref={scroller} hidden={!!search}>
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
                return (
                  <Fragment key={si}>
                    <span
                      data-s={key}
                      className={[
                        'sent',
                        p.h && si === 0 && p.s.length > 1 && 'sent-label',
                        selected.includes(key) && 'selected',
                        inFlash(pi, si) && 'flash',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => toggle(key)}
                    >
                      {s}
                    </span>{' '}
                  </Fragment>
                );
              })}
            </p>
          );
        })}
      </div>

      {selected.length > 0 && !search && (
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
          <Group gap={4} justify="flex-end">
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
        </Paper>
      )}

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

function markWords(text: string, query: string): ReactNode {
  const words = query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’‘]/g, "['’‘]"));
  if (!words.length) return text;
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}
