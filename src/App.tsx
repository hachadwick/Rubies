import { Button, Center, Loader, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { BookOpen, NotebookPen, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadBible } from './bible/kjv';
import type { Ref } from './bible/reference';
import { BiblePane, type BibleLocation } from './components/BiblePane';
import { NoteEditor } from './components/NoteEditor';
import { NotesList } from './components/NotesList';
import { SettingsDialog } from './components/SettingsDialog';
import { requestPersistentStorage } from './db';
import { useSettings } from './settings';

const LOC_KEY = 'rubies.location';

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
  notifications.show({ message, autoClose: 2200, withCloseButton: false, radius: 'xl', className: 'toast' });

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
  const inserter = useRef<((refs: Ref[]) => void) | null>(null);
  const [canInsert, setCanInsert] = useState(false);

  const load = useCallback(() => {
    setError(null);
    loadBible()
      .then(() => setReady(true))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    requestPersistentStorage();
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem(LOC_KEY, JSON.stringify({ book: loc.book, chapter: loc.chapter }));
    } catch {
      /* ignore */
    }
  }, [loc.book, loc.chapter]);

  const registerInserter = useCallback((fn: ((refs: Ref[]) => void) | null) => {
    inserter.current = fn;
    setCanInsert(!!fn);
  }, []);

  const openNote = useCallback((id: string) => {
    setNoteId(id);
    setTab('notes');
  }, []);

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

  return (
    <div className={`app ${wide ? 'wide' : 'narrow'} show-${tab}`}>
      <BiblePane
        loc={loc}
        onNavigate={setLoc}
        onInsert={
          canInsert
            ? (refs) => {
                inserter.current?.(refs);
                if (!wide) setTab('notes');
              }
            : undefined
        }
        onOpenNote={openNote}
        toast={toast}
      />
      {noteId ? (
        <NoteEditor
          noteId={noteId}
          onBack={() => setNoteId(null)}
          registerInserter={registerInserter}
          toast={toast}
        />
      ) : (
        <NotesList onOpen={openNote} onSettings={() => setShowSettings(true)} />
      )}

      {!wide && (
        <nav className="tabbar" aria-label="Sections">
          {(
            [
              ['bible', 'Bible', BookOpen],
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
