import { ActionIcon, Badge, Button, Drawer, Group, Menu, Stack, Text, Textarea, ThemeIcon, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { BellRing, CalendarClock, Check, Flame, NotebookPen, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, type Prayer } from '../db';
import { FireFlame } from './FireFlame';
import { addPrayer, FOLLOW_UPS, inDays, isDue, relativeDay, todayIso, updatePrayer } from '../prayer';
import { formatDate } from '../util';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  opened: boolean;
  onClose: () => void;
  onOpenNote: (id: string) => void;
}

const added = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The prayer list: each request with the date it was added (and the note it came from), its follow-up date,
 * and ways to mark it answered, move the follow-up, or delete it. Follow-ups that are due come first.
 */
export function PrayerList({ opened, onClose, onOpenNote }: Props) {
  const prayers = useLiveQuery(() => db.prayers.orderBy('createdAt').reverse().toArray(), []);
  const [text, setText] = useState('');
  const [removing, setRemoving] = useState<Prayer | null>(null);
  const today = todayIso();

  const groups = useMemo(() => {
    const all = prayers ?? [];
    const open = all.filter((p) => !p.answeredAt);
    const byFollowUp = (a: Prayer, b: Prayer) => (a.followUpOn ?? '').localeCompare(b.followUpOn ?? '');
    return [
      { key: 'due', title: 'Follow up now', items: open.filter((p) => isDue(p, today)).sort(byFollowUp) },
      { key: 'soon', title: 'Coming up', items: open.filter((p) => p.followUpOn && p.followUpOn > today).sort(byFollowUp) },
      { key: 'open', title: 'Praying', items: open.filter((p) => !p.followUpOn) },
      { key: 'answered', title: 'Answered', items: all.filter((p) => p.answeredAt).sort((a, b) => b.answeredAt! - a.answeredAt!) },
    ].filter((g) => g.items.length);
  }, [prayers, today]);

  const add = async () => {
    if (!text.trim()) return;
    await addPrayer({ text, followUpOn: inDays(7) });
    setText('');
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      padding="lg"
      title={
        <Group gap="xs">
          <FireFlame size={22} />
          <Title order={3}>Prayer list</Title>
        </Group>
      }
    >
      <Stack gap="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Group align="flex-end" gap="xs" wrap="nowrap">
            <Textarea
              style={{ flex: 1 }}
              autosize
              minRows={1}
              maxRows={4}
              placeholder="Add someone or something to pray for"
              aria-label="Add a prayer request"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button type="submit" disabled={!text.trim()}>
              Add
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            New requests get a follow-up in a week; change it on the request.
          </Text>
        </form>

        {prayers?.length === 0 && (
          <Stack align="center" gap="xs" ta="center" mt="xl">
            <ThemeIcon size={64} radius="xl" variant="light">
              <Flame size={32} strokeWidth={1.6} />
            </ThemeIcon>
            <Text fw={600}>No prayer requests yet</Text>
            <Text size="sm" c="dimmed" maw={320}>
              Add someone or something to pray for above. The flame at the top of the app brings you back here from anywhere.
            </Text>
          </Stack>
        )}

        {groups.map((g) => (
          <section key={g.key} aria-label={g.title}>
            <Group gap={6} mb="xs">
              <Text size="xs" fw={700} tt="uppercase" c={g.key === 'due' ? 'red' : 'dimmed'} style={{ letterSpacing: '0.06em' }}>
                {g.title}
              </Text>
              <Badge size="xs" variant="light" color={g.key === 'due' ? 'red' : 'gray'} circle>
                {g.items.length}
              </Badge>
            </Group>
            <Stack gap="sm">
              {g.items.map((p) => (
                <article key={p.id} className={`prayer-card ${isDue(p, today) ? 'is-due' : ''} ${p.answeredAt ? 'is-answered' : ''}`}>
                  <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} td={p.answeredAt ? 'line-through' : undefined}>
                    {p.text}
                  </Text>
                  <Text size="xs" c="dimmed" mt={6}>
                    Added {added(p.createdAt)}
                    {p.noteTitle && (
                      <>
                        {' · from '}
                        {p.noteId ? (
                          <UnstyledButton
                            className="prayer-note-link"
                            onClick={() => {
                              onClose();
                              onOpenNote(p.noteId!);
                            }}
                          >
                            <NotebookPen size={12} /> {p.noteTitle}
                          </UnstyledButton>
                        ) : (
                          p.noteTitle
                        )}
                      </>
                    )}
                  </Text>
                  <Group justify="space-between" mt="sm" gap="xs" wrap="nowrap">
                    {p.answeredAt ? (
                      <Badge variant="light" color="teal" leftSection={<Check size={12} />}>
                        Answered {added(p.answeredAt)}
                      </Badge>
                    ) : (
                      <Menu position="bottom-start" shadow="md" withinPortal>
                        <Menu.Target>
                          <Button
                            size="compact-xs"
                            variant="light"
                            color={isDue(p, today) ? 'red' : p.followUpOn ? undefined : 'gray'}
                            leftSection={isDue(p, today) ? <BellRing size={13} /> : <CalendarClock size={13} />}
                          >
                            {p.followUpOn
                              ? `Follow up ${formatDate(p.followUpOn, { day: 'numeric', month: 'short' })} · ${relativeDay(p.followUpOn, today)}`
                              : 'Set a follow-up'}
                          </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Label>Follow up in</Menu.Label>
                          {FOLLOW_UPS.map((f) => (
                            <Menu.Item key={f.days} onClick={() => updatePrayer(p.id, { followUpOn: inDays(f.days), remindedOn: undefined })}>
                              {f.label}
                            </Menu.Item>
                          ))}
                          <Menu.Item closeMenuOnClick={false}>
                            <input
                              type="date"
                              aria-label="Follow-up date"
                              className="prayer-date-input"
                              min={inDays(0)}
                              defaultValue={p.followUpOn}
                              onChange={(e) => e.currentTarget.value && updatePrayer(p.id, { followUpOn: e.currentTarget.value, remindedOn: undefined })}
                            />
                          </Menu.Item>
                          {p.followUpOn && (
                            <>
                              <Menu.Divider />
                              <Menu.Item onClick={() => updatePrayer(p.id, { followUpOn: undefined })}>No follow-up</Menu.Item>
                            </>
                          )}
                        </Menu.Dropdown>
                      </Menu>
                    )}
                    <Group gap={2} wrap="nowrap">
                      {p.answeredAt ? (
                        <Tooltip label="Back to praying">
                          <ActionIcon size="md" onClick={() => updatePrayer(p.id, { answeredAt: undefined })} aria-label="Mark as not answered">
                            <RotateCcw size={16} />
                          </ActionIcon>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Mark answered">
                          <ActionIcon size="md" color="teal" onClick={() => updatePrayer(p.id, { answeredAt: Date.now() })} aria-label="Mark as answered">
                            <Check size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Delete">
                        <ActionIcon size="md" color="red" onClick={() => setRemoving(p)} aria-label="Delete this request">
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </article>
              ))}
            </Stack>
          </section>
        ))}
      </Stack>

      <ConfirmDialog
        opened={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && db.prayers.delete(removing.id)}
        title="Delete this request?"
        confirmLabel="Delete"
      >
        <Text fw={600} c="var(--mantine-color-text)" mb={4} lineClamp={3}>
          {removing?.text}
        </Text>
        It will be removed from your prayer list. To keep it, mark it answered instead.
      </ConfirmDialog>
    </Drawer>
  );
}
