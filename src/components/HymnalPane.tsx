import { ActionIcon, Loader, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronLeft, ChevronRight, Delete, Hash, Maximize, Minimize, Search, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { drawPage, LAST_PAGE, neighbour, PAGE_RATIO, searchSongs, songAt, songPages, type Song } from '../hymnal/hymnal';

const PAGE_KEY = 'rubies.hymnalPage';

function readPage(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_KEY));
    return n >= 1 && n <= LAST_PAGE ? Math.round(n) : 1;
  } catch {
    return 1;
  }
}

/** One page of music, drawn to fit the width of whatever it's put in (and redrawn sharp when that changes). */
function HymnPage({ page }: { page: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    setState('loading');
    let stop: (() => void) | null = null;
    let drawn = 0;
    let timer = 0;
    const draw = () => {
      const width = el.clientWidth;
      // Nothing to do while hidden, or for a change too small to see.
      if (width < 20 || Math.abs(width - drawn) < 2) return;
      drawn = width;
      stop?.();
      stop = drawPage(page, cv, width, (error) => setState(error ? 'error' : 'ready'));
    };
    draw();
    const watch = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(draw, 120);
    });
    watch.observe(el);
    return () => {
      watch.disconnect();
      window.clearTimeout(timer);
      stop?.();
    };
  }, [page]);

  return (
    <div ref={box} className="hymn-page" data-page={page} style={{ aspectRatio: String(PAGE_RATIO) }}>
      <canvas ref={canvas} role="img" aria-label={`Hymnal page ${page}`} hidden={state !== 'ready'} />
      {state === 'loading' && <Loader type="dots" color="gray" className="hymn-page-state" />}
      {state === 'error' && (
        <div className="hymn-page-state">
          <TriangleAlert />
          <Text size="sm">This page couldn’t be shown.</Text>
        </div>
      )}
    </div>
  );
}

/**
 * The Hymnal: the book of songs sung in church, built into the app like the Bible. Each page of music is shown
 * as printed, by its printed page number, and can be opened full screen.
 */
export function HymnalPane({ tabs }: { tabs: ReactNode }) {
  const [page, setPage] = useState(readPage);
  const [query, setQuery] = useState('');
  const [listing, setListing] = useState(false);
  const [full, setFull] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const song = songAt(page);

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_KEY, String(page));
    } catch {
      /* ignore */
    }
  }, [page]);

  // Show the page that was asked for: the top of the song, or its second page.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-page="${page}"]`);
    el.scrollTop = target && page !== song.page ? target.offsetTop - el.offsetTop : 0;
  }, [page, song.page, listing]);

  const go = (p: number) => {
    setPage(Math.min(Math.max(p, 1), LAST_PAGE));
    setListing(false);
    setQuery('');
  };

  const typed = query.trim();
  const typedPage = /^\d+$/.test(typed) ? Number(typed) : null;
  const results = typed ? searchSongs(typed) : null;
  const prev = neighbour(song, -1);
  const next = neighbour(song, 1);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (typedPage !== null && typedPage >= 1 && typedPage <= LAST_PAGE) go(typedPage);
    else if (results?.length === 1) go(results[0].page);
    else return;
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const list = results ?? (listing ? searchSongs('') : null);

  return (
    <section className="pane bible-pane hymnal-pane" aria-label="Hymnal">
      {tabs}
      <header className="pane-head">
        <UnstyledButton className="lib-title" onClick={() => setListing((v) => !v)} aria-expanded={listing} aria-label="Choose a song">
          <div className="lib-title-text">
            <Text size="xs" c="dimmed" fw={600} truncate>
              {song.pages === 2 ? `Pages ${song.page}–${song.page + 1}` : `Page ${song.page}`}
              {song.ref && ` · ${song.ref}`}
            </Text>
            <Text fw={700} fz={18} truncate>
              {song.title}
            </Text>
          </div>
          <ChevronDown size={18} className="lib-title-chevron" />
        </UnstyledButton>
        <ActionIcon onClick={() => prev && go(prev.page)} aria-label="Previous song" disabled={!prev}>
          <ChevronLeft />
        </ActionIcon>
        <ActionIcon onClick={() => next && go(next.page)} aria-label="Next song" disabled={!next}>
          <ChevronRight />
        </ActionIcon>
        <Tooltip label="Full screen">
          <ActionIcon onClick={() => setFull(true)} aria-label="Show this song full screen">
            <Maximize />
          </ActionIcon>
        </Tooltip>
      </header>

      <form onSubmit={submit} role="search" className="lookup">
        <TextInput
          type="search"
          size="md"
          radius="xl"
          variant="filled"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Go to a page number or search titles…"
          aria-label="Go to a page of the hymnal or search its songs"
          inputMode="search"
          enterKeyHint="go"
          leftSection={<Search size={18} />}
        />
      </form>

      {list ? (
        <div className="panel">
          {typedPage !== null && typedPage > LAST_PAGE && (
            <Text c="dimmed" ta="center" p="lg">
              The hymnal has {LAST_PAGE} pages.
            </Text>
          )}
          {list.length === 0 && !(typedPage !== null && typedPage > LAST_PAGE) && (
            <Text c="dimmed" ta="center" p="lg">
              No songs match “{typed}”.
            </Text>
          )}
          <ul className="results">
            {/* A page number that's the second page of a song still goes to that page. */}
            {typedPage !== null && typedPage >= 1 && typedPage <= LAST_PAGE && songAt(typedPage).page !== typedPage && (
              <SongRow song={songAt(typedPage)} page={typedPage} onGo={go} />
            )}
            {list.map((s) => (
              <SongRow key={s.page} song={s} page={s.page} current={!typed && s === song} onGo={go} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="hymn-scroll" ref={scroller}>
          {songPages(song).map((p) => (
            <HymnPage key={p} page={p} />
          ))}
        </div>
      )}

      {full && <FullScreen page={page} onPage={setPage} onClose={() => setFull(false)} />}
    </section>
  );
}

function SongRow({ song, page, current, onGo }: { song: Song; page: number; current?: boolean; onGo: (page: number) => void }) {
  return (
    <li>
      <UnstyledButton className="result hymn-row" data-current={current || undefined} onClick={() => onGo(page)}>
        <span className="hymn-row-page">{page}</span>
        <span className="hymn-row-text">
          <Text fw={600} truncate>
            {song.title}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {[song.ref, song.by].filter(Boolean).join(' · ')}
          </Text>
        </span>
      </UnstyledButton>
    </li>
  );
}

/**
 * A song filling the whole screen, one page at a time. A song on two pages is swiped (or arrowed) between its
 * pages; the buttons at the top move to the next or previous song, and fade away while nothing is touched.
 */
function FullScreen({ page, onPage, onClose }: { page: number; onPage: (page: number) => void; onClose: () => void }) {
  const song = songAt(page);
  const pages = songPages(song);
  const slides = useRef<HTMLDivElement>(null);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef(0);
  // Going to another page without leaving full screen: the digits typed so far (null while the keypad is closed).
  const [typing, setTyping] = useState<string | null>(null);
  const goTimer = useRef(0);
  const typedPage = typing ? Number(typing) : 0;

  const goTo = useCallback(
    (p: number) => {
      window.clearTimeout(goTimer.current);
      setTyping(null);
      if (p >= 1 && p <= LAST_PAGE) onPage(p);
    },
    [onPage],
  );
  /** Adds a digit. As soon as the number can't be the start of a longer page number, it goes there by itself. */
  const press = useCallback(
    (digit: string) => {
      window.clearTimeout(goTimer.current);
      setTyping((was) => {
        const now = ((was ?? '') + digit).replace(/^0+/, '');
        const n = Number(now);
        // A digit that would run past the last page isn't taken.
        if (n > LAST_PAGE) return was ?? '';
        // A moment to see the number before the page turns.
        window.clearTimeout(goTimer.current);
        if (n >= 1 && n * 10 > LAST_PAGE) goTimer.current = window.setTimeout(() => goTo(n), 220);
        return now;
      });
    },
    [goTo],
  );
  const erase = useCallback(() => {
    window.clearTimeout(goTimer.current);
    setTyping((was) => (was ?? '').slice(0, -1));
  }, []);
  useEffect(() => () => window.clearTimeout(goTimer.current), []);

  const wake = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), 3500);
  }, []);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(hideTimer.current);
  }, [wake, song.page]);

  // Really full screen where the browser allows it (hiding its own bars); the page covers the app either way.
  useEffect(() => {
    const root = document.documentElement;
    let entered = false;
    root
      .requestFullscreen?.()
      .then(() => (entered = true))
      .catch(() => {});
    const changed = () => {
      // Left with Esc or the browser's own button.
      if (entered && !document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the slide in view in step with the page (after a swipe it already is).
  useLayoutEffect(() => {
    const el = slides.current;
    if (!el) return;
    const left = (page - song.page) * el.clientWidth;
    if (Math.abs(el.scrollLeft - left) > el.clientWidth / 2) el.scrollTo({ left, behavior: 'instant' as ScrollBehavior });
  }, [page, song.page]);

  const turn = useCallback(
    (dir: 1 | -1, acrossSongs: boolean) => {
      const to = page + dir;
      if (pages.includes(to)) {
        // Slide across; the page number follows the slide (see onScroll).
        slides.current?.scrollTo({ left: (to - song.page) * slides.current.clientWidth, behavior: 'smooth' });
      } else if (acrossSongs) {
        const other = neighbour(song, dir);
        // Going back lands on the last page of the song before.
        if (other) onPage(dir === 1 ? other.page : other.page + other.pages - 1);
      }
    },
    [page, pages, song, onPage],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Typing a number goes to that page, with or without the keypad open.
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) press(e.key);
      else if (typing !== null && e.key === 'Backspace') erase();
      else if (typing !== null && e.key === 'Enter') goTo(typedPage);
      else if (typing !== null && e.key === 'Escape') setTyping(null);
      else if (typing !== null) return;
      else if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') turn(1, true);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1, true);
      else return;
      e.preventDefault();
      wake();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [turn, onClose, wake, typing, typedPage, press, erase, goTo]);

  const onScroll = () => {
    const el = slides.current;
    if (!el || !el.clientWidth) return;
    const at = song.page + Math.min(Math.round(el.scrollLeft / el.clientWidth), pages.length - 1);
    if (at !== page) onPage(at);
  };

  const prev = neighbour(song, -1);
  const next = neighbour(song, 1);

  // On top of the whole app, not inside the pane (which clips what's in it).
  return createPortal(
      <div className="hymn-full" data-controls={controls || undefined} role="dialog" aria-label={`${song.title}, full screen`} onPointerMove={(e) => e.pointerType === 'mouse' && wake()}>
        <div className="hymn-slides" ref={slides} onScroll={onScroll} onClick={() => (controls ? setControls(false) : wake())}>
          {pages.map((p) => (
            <div className="hymn-slide" key={p}>
              <div className="hymn-fit">
                <HymnPage page={p} />
              </div>
            </div>
          ))}
        </div>

        {/* In the corners, where a page that fits the screen leaves room: the song on one side, the buttons on the other. */}
        <div className="hymn-full-title hymn-full-chip">
          <Text fw={700} size="sm" lineClamp={3}>
            {song.page} · {song.title}
          </Text>
          {pages.length > 1 && (
            <Text size="xs">
              Page {page - song.page + 1} of {pages.length} · swipe to turn
            </Text>
          )}
        </div>
        <div className="hymn-full-actions hymn-full-chip" onPointerDown={wake}>
          <ActionIcon variant="filled" color="dark" onClick={() => prev && onPage(prev.page)} disabled={!prev} aria-label="Previous song">
            <ChevronLeft />
          </ActionIcon>
          <ActionIcon variant="filled" color="dark" onClick={() => next && onPage(next.page)} disabled={!next} aria-label="Next song">
            <ChevronRight />
          </ActionIcon>
          <ActionIcon variant="filled" color="dark" onClick={onClose} aria-label="Leave full screen">
            <Minimize />
          </ActionIcon>
        </div>

        {/* Always there (dimmer while the other buttons are away), so another page is one tap and its number away. */}
        <UnstyledButton className="hymn-goto" onClick={() => setTyping('')} aria-label="Go to a page">
          <Hash size={18} />
          Go to
        </UnstyledButton>

        {typing !== null && (
          <div className="hymn-keypad-back" onClick={() => setTyping(null)}>
            <div className="hymn-keypad" role="group" aria-label="Go to a page" onClick={(e) => e.stopPropagation()}>
              <div className="hymn-keypad-number" aria-live="polite">
                {typing || <span>Page</span>}
              </div>
              <Text size="sm" ta="center" truncate className="hymn-keypad-title">
                {typedPage ? songAt(typedPage).title : `1 to ${LAST_PAGE}`}
              </Text>
              <div className="hymn-keys">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <UnstyledButton key={d} className="hymn-key" onClick={() => press(d)}>
                    {d}
                  </UnstyledButton>
                ))}
                <UnstyledButton className="hymn-key" onClick={erase} aria-label="Delete the last digit" disabled={!typing}>
                  <Delete />
                </UnstyledButton>
                <UnstyledButton className="hymn-key" onClick={() => press('0')}>
                  0
                </UnstyledButton>
                <UnstyledButton className="hymn-key hymn-key-go" onClick={() => goTo(typedPage)} disabled={!typedPage}>
                  Go
                </UnstyledButton>
              </div>
            </div>
          </div>
        )}

        {pages.length > 1 && (
          <div className="hymn-dots" aria-hidden="true">
            {pages.map((p) => (
              <span key={p} data-active={p === page || undefined} />
            ))}
          </div>
        )}
      </div>,
    document.body,
  );
}
