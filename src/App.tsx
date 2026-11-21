import { Button, Center, Loader, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { BellRing, BookOpen, Flame, Library, Music, NotebookPen, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadBible } from './bible/kjv';
import { AppBar } from './components/AppBar';
import { BiblePane, type BibleLocation } from './components/BiblePane';
import { HymnalPane } from './components/HymnalPane';
import { LibraryPane } from './components/LibraryPane';
import { ReaderTabs, type Reader } from './components/ReaderTabs';
import type { Insertion } from './insertion';
import { NoteEditor } from './components/NoteEditor';
import { NotesList } from './components/NotesList';
import { SettingsDialog } from './components/SettingsDialog';
import { PrayerList } from './components/PrayerList';
import { SplitHandle, useSplit } from './components/SplitHandle';
import { requestPersistentStorage } from './db';
import { takeDueReminders } from './prayer';
import { useSettings } from './settings';
import { preloadGoogle } from './sync/google';
import { startSync } from './sync/sync';

const LOC_KEY = 'rubies.location';
const READER_KEY = 'rubies.reader';

function readReader(): Reader {
  try {
    const r = localStorage.getItem(READER_KEY);
    return r === 'library' || r === 'hymnal' ? r : 'bible';
  } catch {
    return 'bible';
  }
}

function readLocation(): BibleLocation {
  try {
    const l = JSON.parse(localStorage.getItem(LOC_KEY) ?? '');
    if (l.book >= 1 && l.book <= 66 && l.chapter >= 1) return { book: l.book, chapter: l.chapter };
  } catch {
    /* first run */
  }
  return { book: 43, chapter: 1 }; // John 1
}

const toast = (message: string) =>
  // Shown in the empty middle of the top bar (see .toast), out of the way of what's being read.
  notifications.show({ message, autoClose: 2200, withCloseButton: false, radius: 'xl', className: 'toast', position: 'top-center' });

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, updateSettings] = useSettings();
  const wide = useMediaQuery('(min-width: 900px)', window.matchMedia('(min-width: 900px)').matches, {
    getInitialValueInEffect: false,
  });
  const [tab, setTab] = useState<'bible' | 'notes'>('notes');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [loc, setLoc] = useState<BibleLocation>(readLocation);
  const [showSettings, setShowSettings] = useState(false);
  const [reader, setReader] = useState<Reader>(readReader);
  const inserter = useRef<((what: Insertion) => void) | null>(null);
  const [canInsert, setCanInsert] = useState(false);
  const { split, setSplit, style: splitStyle } = useSplit();

  const load = useCallback(() => {
    setError(null);
    loadBible()
      .then(() => setReady(true))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    requestPersistentStorage();
    preloadGoogle();
    startSync();
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem(LOC_KEY, JSON.stringify({ book: loc.book, chapter: loc.chapter }));
    } catch {
      /* ignore */
    }
  }, [loc.book, loc.chapter]);

  useEffect(() => {
    try {
      localStorage.setItem(READER_KEY, reader);
    } catch {
      /* ignore */
    }
  }, [reader]);

  const registerInserter = useCallback((fn: ((what: Insertion) => void) | null) => {
    inserter.current = fn;
    setCanInsert(!!fn);
  }, []);

  const openNote = useCallback((id: string) => {
    setNoteId(id);
    setTab('notes');
  }, []);

  const [showPrayers, setShowPrayers] = useState(false);

  // Follow-up reminders: when the app opens and every half hour while it's open, each request whose follow-up
  // date has come is mentioned once a day, in the app and (where the system allows it) as a desktop notification.
  useEffect(() => {
    if (!ready) return;
    const check = async () => {
      const due = await takeDueReminders();
      if (!due.length) return;
      const title = due.length === 1 ? 'Time to follow up on a prayer request' : `Time to follow up on ${due.length} prayer requests`;
      const body = due.length === 1 ? due[0].text : due.map((p) => `• ${p.text.split('\n')[0]}`).slice(0, 4).join('\n');
      notifications.show({
        id: 'prayer-reminder',
        title,
        message: (
          <>
            <Text size="sm" lineClamp={4} style={{ whiteSpace: 'pre-line' }}>
              {body}
            </Text>
            <Button size="compact-sm" variant="light" mt="xs" leftSection={<Flame size={14} />} onClick={() => {
              notifications.hide('prayer-reminder');
              setShowPrayers(true);
            }}>
              Open prayer list
            </Button>
          </>
        ),
        icon: <BellRing size={18} />,
        autoClose: false,
        radius: 'lg',
      });
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const n = new Notification(title, { body, tag: 'rubies-prayer' });
        n.onclick = () => {
          window.focus();
          setShowPrayers(true);
        };
      }
    };
    check();
    const timer = window.setInterval(check, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready]);

  if (error)
    return (
      <Center h="100%">
        <Stack align="center" gap="sm">
          <ThemeIcon size={56} radius="xl" variant="light" color="red">
            <TriangleAlert />
          </ThemeIcon>
          <Text c="dimmed">{error}</Text>
          <Button onClick={load}>Try again</Button>
        </Stack>
      </Center>
    );
  if (!ready)
    return (
      <Center h="100%">
        <Stack align="center" gap="sm">
          <Loader type="dots" />
          <Text c="dimmed">Opening the Bible…</Text>
        </Stack>
      </Center>
    );

  const insert = (what: Insertion) => {
    inserter.current?.(what);
    if (!wide) setTab('notes');
  };
  const readerTabs = <ReaderTabs value={reader} onChange={setReader} />;

  return (
    <div className={`app ${wide ? 'wide' : 'narrow'} show-${tab}`} style={wide ? splitStyle : undefined}>
      <AppBar onSettings={() => setShowSettings(true)} onPrayers={() => setShowPrayers(true)} />
      {reader === 'bible' ? (
        <BiblePane
          loc={loc}
          onNavigate={setLoc}
          onInsert={canInsert ? (refs) => insert({ kind: 'bible', refs }) : undefined}
          onOpenNote={openNote}
          toast={toast}
          tabs={readerTabs}
        />
      ) : reader === 'hymnal' ? (
        <HymnalPane tabs={readerTabs} />
      ) : (
        <LibraryPane
          tabs={readerTabs}
          onInsert={canInsert ? insert : undefined}
          onOpenRef={(r) => {
            setReader('bible');
            setLoc({
              book: r.book,
              chapter: r.chapter,
              focus: r.verse ? [r.verse, r.endChapter && r.endChapter !== r.chapter ? 999 : (r.endVerse ?? r.verse)] : undefined,
              nonce: Date.now(),
            });
          }}
          toast={toast}
        />
      )}
      {wide && <SplitHandle split={split} onChange={setSplit} />}
      {noteId ? (
        <NoteEditor
          noteId={noteId}
          onBack={() => setNoteId(null)}
          registerInserter={registerInserter}
          toast={toast}
          onOpenPrayers={() => setShowPrayers(true)}
          reviewEveryDays={settings.reviewEveryDays}
        />
      ) : (
        <NotesList
          onOpen={openNote}
          reviewEveryDays={settings.reviewEveryDays}
        />
      )}

      <PrayerList opened={showPrayers} onClose={() => setShowPrayers(false)} onOpenNote={openNote} />

      {!wide && (
        <nav className="tabbar" aria-label="Sections">
          {(
            [
              [
                'bible',
                reader === 'library' ? 'Library' : reader === 'hymnal' ? 'Hymnal' : 'Bible',
                reader === 'library' ? Library : reader === 'hymnal' ? Music : BookOpen,
              ],
              ['notes', 'Notes', NotebookPen],
            ] as const
          ).map(([key, label, Icon]) => (
            <UnstyledButton key={key} className="tab" data-active={tab === key || undefined} onClick={() => setTab(key)}>
              <span className="tab-pill">
                <Icon size={22} />
              </span>
              {label}
            </UnstyledButton>
          ))}
        </nav>
      )}

      <SettingsDialog
        opened={showSettings}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setShowSettings(false)}
        toast={toast}
      />
    </div>
  );
}
