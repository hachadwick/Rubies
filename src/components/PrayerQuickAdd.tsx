import { ActionIcon, Anchor, Button, Chip, Group, Popover, Stack, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { Flame, Plus } from 'lucide-react';
import { FireFlame } from './FireFlame';
import { useEffect, useRef, useState } from 'react';
import { addPrayer, FOLLOW_UPS, inDays } from '../prayer';

interface Props {
  noteId: string;
  getNoteTitle: () => string;
  /** Text selected in the note, if any, to start the request with. */
  getSelection: () => string;
  onOpenList: () => void;
  toast: (msg: string) => void;
}

/**
 * Adds to the prayer list without leaving the note: a small pop-over from the note's header (or Ctrl/⌘+Shift+P).
 * Type who or what, pick a follow-up, press Enter, and you're back in the note where you left off.
 */
export function PrayerQuickAdd({ noteId, getNoteTitle, getSelection, onOpenList, toast }: Props) {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState('');
  const [days, setDays] = useState<string>('7');
  const [custom, setCustom] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  const open = () => {
    const sel = getSelection().trim();
    if (sel && !text) setText(sel.slice(0, 500));
    setOpened(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    if (!text.trim()) return;
    const followUpOn = days === 'custom' ? custom || undefined : days === 'none' ? undefined : inDays(Number(days));
    await addPrayer({ text, followUpOn, noteId, noteTitle: getNoteTitle() });
    setText('');
    setOpened(false);
    toast('Added to your prayer list');
  };

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={340} shadow="lg" radius="lg" trapFocus returnFocus withArrow>
      <Popover.Target>
        <Tooltip label="Add to prayer list (Ctrl+Shift+P)" disabled={opened}>
          <ActionIcon onClick={() => (opened ? setOpened(false) : open())} aria-label="Add to prayer list" aria-expanded={opened}>
            {/* The flame with a plus: this adds a request. The plain flame in the top bar opens the list. */}
            <span className="flame-add">
              <FireFlame />
              <Plus size={11} strokeWidth={3.5} className="flame-add-plus" aria-hidden="true" />
            </span>
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Stack gap="sm">
            <Text fw={700}>Add to prayer list</Text>
            <Textarea
              ref={input}
              data-autofocus
              autosize
              minRows={2}
              maxRows={5}
              placeholder="Who or what to pray for"
              aria-label="Who or what to pray for"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <div>
              <Text size="xs" fw={600} c="dimmed" mb={6}>
                Follow up
              </Text>
              <Chip.Group value={days} onChange={(v) => setDays(v as string)}>
                <Group gap={6}>
                  <Chip value="none" size="xs">
                    None
                  </Chip>
                  {FOLLOW_UPS.map((f) => (
                    <Chip key={f.days} value={String(f.days)} size="xs">
                      {f.label}
                    </Chip>
                  ))}
                  <Chip value="custom" size="xs">
                    Date…
                  </Chip>
                </Group>
              </Chip.Group>
              {days === 'custom' && (
                <TextInput
                  mt="xs"
                  type="date"
                  size="xs"
                  aria-label="Follow-up date"
                  min={inDays(0)}
                  value={custom}
                  onChange={(e) => setCustom(e.currentTarget.value)}
                />
              )}
            </div>
            <Group justify="space-between" align="center">
              <Anchor
                component="button"
                type="button"
                size="sm"
                onClick={() => {
                  setOpened(false);
                  onOpenList();
                }}
              >
                Open prayer list
              </Anchor>
              <Button type="submit" size="xs" leftSection={<Flame size={14} />} disabled={!text.trim()}>
                Add
              </Button>
            </Group>
          </Stack>
        </form>
      </Popover.Dropdown>
    </Popover>
  );
}
