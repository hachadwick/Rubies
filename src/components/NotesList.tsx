import { ActionIcon, Badge, Button, Group, Stack, Text, TextInput, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, NotebookPen, PenLine, Plus, Search, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, kindLabel, newNote, type Note, type NoteKind } from '../db';
import { formatDate, noteTitle } from '../util';

interface Props {
  onOpen: (id: string) => void;
  onSettings: () => void;
}

const KIND_COLOR: Record<NoteKind, string> = { sermon: 'ruby', sermonette: 'grape', 'bible-study': 'teal' };

export function NotesList({ onOpen, onSettings }: Props) {
  const [q, setQ] = useState('');
  const notes = useLiveQuery(() => db.notes.orderBy('date').reverse().toArray(), []);

  const groups = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = (notes ?? []).filter((n) => {
      if (!terms.length) return true;
      const hay = [kindLabel(n.kind), n.title, n.speaker, n.church, n.passage, n.bodyText, n.date].join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    const map = new Map<string, Note[]>();
    for (const n of filtered) {
      const label = formatDate(n.date, { month: 'long', year: 'numeric' }) || 'Undated';
      map.set(label, [...(map.get(label) ?? []), n]);
    }
    return [...map];
  }, [notes, q]);

  const create = async () => {
    const n = newNote();
    // Pre-fill church/speaker from the most recent note — usually the same place each week.
    const last = notes?.[0];
    if (last) {
      n.church = last.church;
      n.speaker = last.speaker;
    }
    await db.notes.add(n);
    onOpen(n.id);
  };

  return (
    <section className="pane notes-pane" aria-label="Sermon notes">
      <header className="pane-head">
        <Title order={2} size="h3" pl={6}>
          Notes
        </Title>
        <div className="spacer" />
        <ActionIcon onClick={onSettings} aria-label="Settings">
          <Settings />
        </ActionIcon>
      </header>
      <div className="lookup">
        <TextInput
          type="search"
          size="md"
          radius="xl"
          variant="filled"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Search notes"
          aria-label="Search notes"
          leftSection={<Search size={18} />}
        />
      </div>
      <div className="list-scroll">
        {notes?.length === 0 && (
          <Stack align="center" gap="sm" maw={440} mx="auto" mt={48} ta="center">
            <ThemeIcon size={72} radius="xl" variant="light">
              <NotebookPen size={36} strokeWidth={1.6} />
            </ThemeIcon>
            <Title order={2}>Welcome to Rubies</Title>
            <Text>
              Start a note when the message begins. Look up verses in the Bible beside it, tap a verse to highlight, bookmark
              or add it to your note, and switch to <b>Write</b> to take notes with Apple Pencil or a stylus.
            </Text>
            <Text size="sm" c="dimmed">
              Notes are saved on this device only. Use Settings → Export backup to move them to another device.
            </Text>
          </Stack>
        )}
        {notes && notes.length > 0 && groups.length === 0 && (
          <Text c="dimmed" ta="center" p="xl">
            No notes match “{q}”.
          </Text>
        )}
        {groups.map(([label, ns]) => (
          <section key={label}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="lg" mb="xs" style={{ letterSpacing: '0.06em' }}>
              {label}
            </Text>
            <Stack gap="sm">
              {ns.map((n) => (
                <UnstyledButton key={n.id} className="note-card" onClick={() => onOpen(n.id)}>
                  <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
                    <Text fw={700} size="lg" truncate>
                      {noteTitle(n)}
                    </Text>
                    <Badge variant="light" color={KIND_COLOR[n.kind ?? 'sermon']} radius="sm" style={{ flex: 'none' }}>
                      {kindLabel(n.kind)}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {[formatDate(n.date), n.speaker, n.church].filter(Boolean).join(' · ')}
                  </Text>
                  {n.passage && n.title && (
                    <Group gap={6} mt={4} c="var(--mantine-primary-color-filled)">
                      <BookOpen size={14} />
                      <Text size="sm" fw={600} inherit>
                        {n.passage}
                      </Text>
                    </Group>
                  )}
                  {n.bodyText.trim() ? (
                    <Text size="sm" c="dimmed" lineClamp={2} mt={6}>
                      {n.bodyText.trim()}
                    </Text>
                  ) : (
                    n.ink.length > 0 && (
                      <Group gap={6} mt={6} c="dimmed">
                        <PenLine size={14} />
                        <Text size="sm" inherit>
                          Handwritten notes
                        </Text>
                      </Group>
                    )
                  )}
                </UnstyledButton>
              ))}
            </Stack>
          </section>
        ))}
      </div>
      <Button className="fab" size="lg" radius="xl" leftSection={<Plus />} onClick={create}>
        New note
      </Button>
    </section>
  );
}
