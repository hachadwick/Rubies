import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Indicator,
  Radio,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Flame, History, NotebookPen, Plus, Search, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, hasSpeaker, kindLabel, newNote, NOTE_KINDS, type Note, type NoteKind } from '../db';
import { todayIso } from '../prayer';
import { intervalLabel, isStale, reviewedAt, timeAgo } from '../review';
import { formatDate, noteTitle } from '../util';

interface Props {
  onOpen: (id: string) => void;
  onSettings: () => void;
  onPrayers: () => void;
  /** The review interval from Settings (0 = no review reminders). */
  reviewEveryDays: number;
}

/** Which notes to show: every type, or one. */
type KindFilter = 'all' | NoteKind;
const KIND_KEY = 'rubies.notesKind';
const SNOOZE_KEY = 'rubies.reviewSnoozedOn';

function readStored<T extends string>(key: string, allowed: readonly string[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && allowed.includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

const KIND_COLOR: Record<NoteKind, string> = { sermon: 'ruby', sermonette: 'grape', 'bible-study': 'teal', 'personal-study': 'indigo' };

type SortBy = 'date' | 'type';
const SORT_KEY = 'rubies.notesSort';

function readSort(): SortBy {
  try {
    return localStorage.getItem(SORT_KEY) === 'type' ? 'type' : 'date';
  } catch {
    return 'date';
  }
}

export function NotesList({ onOpen, onSettings, onPrayers, reviewEveryDays }: Props) {
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>(() =>
    readStored<KindFilter>(KIND_KEY, ['all', ...NOTE_KINDS.map((k) => k.value)], 'all'),
  );
  const changeKind = (v: string) => {
    setKindFilter(v as KindFilter);
    store(KIND_KEY, v);
  };
  // "Notes to review": just the stale ones, longest unreviewed first.
  const [reviewOnly, setReviewOnly] = useState(false);
  const [snoozedOn, setSnoozedOn] = useState(() => readStored<string>(SNOOZE_KEY, [todayIso()], ''));
  const [sortBy, setSortBy] = useState<SortBy>(readSort);
  const changeSort = (v: string) => {
    setSortBy(v as SortBy);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };
  const notes = useLiveQuery(() => db.notes.orderBy('date').reverse().toArray(), []);
  const today = todayIso();
  const dueCount = useLiveQuery(
    async () => (await db.prayers.where('followUpOn').belowOrEqual(today).toArray()).filter((p) => !p.answeredAt).length,
    [today],
  );

  const stale = useMemo(
    () => (notes ?? []).filter((n) => isStale(n, reviewEveryDays)).sort((a, b) => reviewedAt(a) - reviewedAt(b)),
    [notes, reviewEveryDays],
  );
  const staleIds = useMemo(() => new Set(stale.map((n) => n.id)), [stale]);

  const groups = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = (reviewOnly ? stale : notes ?? []).filter((n) => {
      if (kindFilter !== 'all' && (n.kind ?? 'sermon') !== kindFilter) return false;
      if (!terms.length) return true;
      const hay = [kindLabel(n.kind), n.title, n.speaker, n.church, n.passage, n.bodyText, n.date].join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    if (reviewOnly) return filtered.length ? ([['Notes to review', filtered]] as [string, Note[]][]) : [];
    // By date: a section per month, newest first. By type: a section per type, in the usual order (Sermon,
    // Sermonette, Bible Study, Personal Study), newest first within each.
    const map = new Map<string, Note[]>();
    if (sortBy === 'type') for (const k of NOTE_KINDS) map.set(k.label, []);
    for (const n of filtered) {
      const label = sortBy === 'type' ? kindLabel(n.kind) : formatDate(n.date, { month: 'long', year: 'numeric' }) || 'Undated';
      map.set(label, [...(map.get(label) ?? []), n]);
    }
    return [...map].filter(([, ns]) => ns.length);
  }, [notes, q, sortBy, kindFilter, reviewOnly, stale]);

  const showReviewPrompt = stale.length > 0 && !reviewOnly && !q.trim() && snoozedOn !== todayIso();

  const create = async () => {
    const n = newNote();
    // Pre-fill church/speaker from the most recent message note — usually the same place each week. (Personal
    // study notes have neither, so they're skipped.)
    const last = notes?.find((x) => hasSpeaker(x.kind));
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
        <Tooltip label={dueCount ? `Prayer list · ${dueCount} to follow up` : 'Prayer list'}>
          <Indicator label={dueCount} size={18} color="red" disabled={!dueCount} offset={6}>
            <ActionIcon onClick={onPrayers} aria-label={dueCount ? `Prayer list, ${dueCount} to follow up` : 'Prayer list'}>
              <Flame />
            </ActionIcon>
          </Indicator>
        </Tooltip>
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
        <Radio.Group value={kindFilter} onChange={changeKind} aria-label="Show notes of type" mt="sm">
          <Group gap="md" wrap="wrap">
            <Radio value="all" label="All" size="sm" />
            {NOTE_KINDS.map((k) => (
              <Radio key={k.value} value={k.value} label={k.label} size="sm" color={KIND_COLOR[k.value]} />
            ))}
          </Group>
        </Radio.Group>
        <Group gap="xs" mt="xs" justify="flex-end" align="center">
          <Text size="xs" c="dimmed" fw={600} id="notes-sort-label">
            Sort by
          </Text>
          <SegmentedControl
            size="xs"
            radius="xl"
            value={sortBy}
            onChange={changeSort}
            aria-labelledby="notes-sort-label"
            data={[
              { value: 'date', label: 'Date' },
              { value: 'type', label: 'Type' },
            ]}
          />
        </Group>
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
        {showReviewPrompt && (
          <div className="review-prompt" role="region" aria-label="Notes to review">
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <ThemeIcon variant="light" color="orange" radius="xl" size="lg" style={{ flex: 'none' }}>
                <History size={18} />
              </ThemeIcon>
              <div style={{ minWidth: 0 }}>
                <Text fw={700}>
                  {stale.length === 1 ? '1 note is ready for review' : `${stale.length} notes are ready for review`}
                </Text>
                <Text size="sm" c="dimmed">
                  You haven't looked back at {stale.length === 1 ? 'it' : 'these'} in over {intervalLabel(reviewEveryDays)}.
                </Text>
              </div>
            </Group>
            <Stack gap={2} mt="xs">
              {stale.slice(0, 3).map((n) => (
                <UnstyledButton key={n.id} className="review-prompt-item" onClick={() => onOpen(n.id)}>
                  <Text size="sm" fw={600} truncate>
                    {noteTitle(n)}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ flex: 'none' }}>
                    {n.lastReviewedAt ? `reviewed ${timeAgo(n.lastReviewedAt)}` : `written ${timeAgo(n.createdAt)}`}
                  </Text>
                </UnstyledButton>
              ))}
            </Stack>
            <Group gap="xs" mt="sm" justify="flex-end">
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setSnoozedOn(todayIso());
                  store(SNOOZE_KEY, todayIso());
                }}
              >
                Not today
              </Button>
              {stale.length > 3 && (
                <Button size="compact-sm" variant="light" onClick={() => setReviewOnly(true)}>
                  See all {stale.length}
                </Button>
              )}
              <Button size="compact-sm" leftSection={<History size={14} />} onClick={() => onOpen(stale[0].id)}>
                Review the oldest
              </Button>
            </Group>
          </div>
        )}
        {reviewOnly && (
          <Group justify="space-between" mt="md">
            <Text size="sm" c="dimmed">
              Notes not reviewed in over {intervalLabel(reviewEveryDays)}, longest first.
            </Text>
            <Button size="compact-sm" variant="subtle" onClick={() => setReviewOnly(false)}>
              Show all notes
            </Button>
          </Group>
        )}
        {notes && notes.length > 0 && groups.length === 0 && (
          <Text c="dimmed" ta="center" p="xl">
            {reviewOnly
              ? 'No notes left to review. Nicely done.'
              : q.trim()
                ? `No ${kindFilter === 'all' ? '' : `${kindLabel(kindFilter)} `}notes match “${q}”.`
                : `No ${kindLabel(kindFilter as NoteKind)} notes yet.`}
          </Text>
        )}
        {groups.map(([label, ns]) => (
          <section key={label}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="lg" mb="xs" style={{ letterSpacing: '0.06em' }}>
              {label}
              {(sortBy === 'type' || reviewOnly) && ` · ${ns.length}`}
            </Text>
            <Stack gap="sm">
              {ns.map((n) => (
                <UnstyledButton key={n.id} className="note-card" onClick={() => onOpen(n.id)}>
                  <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
                    <Text fw={700} size="lg" truncate>
                      {noteTitle(n)}
                    </Text>
                    {staleIds.has(n.id) && (
                      <Tooltip label={n.lastReviewedAt ? `Last reviewed ${timeAgo(n.lastReviewedAt)}` : `Not reviewed since it was written ${timeAgo(n.createdAt)}`}>
                        <Badge variant="light" color="orange" radius="sm" leftSection={<History size={11} />} style={{ flex: 'none', marginLeft: 'auto' }}>
                          Review
                        </Badge>
                      </Tooltip>
                    )}
                    <Badge variant="light" color={KIND_COLOR[n.kind ?? 'sermon']} radius="sm" style={{ flex: 'none' }}>
                      {kindLabel(n.kind)}
                    </Badge>
                  </Group>
                  {/* Just the date and when it was last reviewed: no speaker, location, passage or preview of the text. */}
                  <Text size="sm" c="dimmed">
                    {formatDate(n.date)}
                    {' · '}
                    <Text span inherit c={staleIds.has(n.id) ? 'orange' : undefined} fw={staleIds.has(n.id) ? 600 : undefined}>
                      {n.lastReviewedAt ? `Last reviewed ${timeAgo(n.lastReviewedAt)}` : 'Not reviewed yet'}
                    </Text>
                  </Text>
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
