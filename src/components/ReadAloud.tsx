import { ActionIcon, Button, Group, Menu, Paper, Text, Tooltip } from '@mantine/core';
import { Check, Gauge, Headphones, Pause, Play, SkipBack, SkipForward, Square, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import {
  pauseReading,
  previewVoice,
  RATES,
  resumeReading,
  setRate,
  setVoice,
  skip,
  speechSupported,
  stopReading,
  useReading,
  useVoices,
  voiceGender,
  voiceLabel,
} from '../speech';

/** The headphones button in a pane's header: starts reading the chapter aloud, or stops it. */
export function ListenButton({ owner, onStart }: { owner: string; onStart: () => void }) {
  const reading = useReading();
  if (!speechSupported()) return null;
  const mine = reading.owner === owner && reading.status !== 'idle';
  return (
    <Tooltip label={mine ? 'Stop reading aloud' : 'Read aloud'}>
      <ActionIcon
        variant={mine ? 'light' : 'subtle'}
        color={mine ? undefined : 'gray'}
        onClick={() => (mine ? stopReading() : onStart())}
        aria-label={mine ? 'Stop reading aloud' : 'Read this chapter aloud'}
      >
        <Headphones />
      </ActionIcon>
    </Tooltip>
  );
}

/** Stops this pane's reading when the pane goes away (e.g. switching between the Bible and the Library). */
export function useStopOnUnmount(owner: string) {
  useEffect(() => () => stopReading(owner), [owner]);
}

/**
 * While a pane is reading aloud: scrolls the piece being read into view. `find` returns its element.
 */
export function useFollowReading(owner: string, find: (id: string) => Element | null | undefined) {
  const reading = useReading();
  const id = reading.owner === owner && reading.status === 'playing' ? reading.current : undefined;
  useEffect(() => {
    if (!id) return;
    const el = find(id);
    if (!el) return;
    const box = el.getBoundingClientRect();
    const view = el.closest('.verses')?.getBoundingClientRect();
    if (view && (box.top < view.top + 40 || box.bottom > view.bottom - 220)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The player at the bottom of a pane while it's reading: back, play/pause, forward, stop, speed and voice. */
export function PlayerBar({ owner, title }: { owner: string; title: string }) {
  const reading = useReading();
  const voices = useVoices();
  if (reading.owner !== owner || reading.status === 'idle') return null;
  const playing = reading.status === 'playing';
  const current = voices.find((v) => v.voiceURI === reading.voiceURI);
  const groups = (['female', 'male', 'other'] as const)
    .map((g) => ({ g, list: voices.filter((v) => voiceGender(v) === g) }))
    .filter((x) => x.list.length);

  return (
    <Paper className="player-bar" shadow="xl" withBorder p={8} role="toolbar" aria-label="Reading aloud">
      <Group gap={4} wrap="nowrap" justify="space-between">
        <Group gap={2} wrap="nowrap">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => skip(-1)} aria-label="Back one">
            <SkipBack size={18} />
          </ActionIcon>
          <ActionIcon size={40} radius="xl" onClick={() => (playing ? pauseReading() : resumeReading())} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => skip(1)} aria-label="Forward one">
            <SkipForward size={18} />
          </ActionIcon>
        </Group>
        <Text size="sm" fw={600} truncate className="player-title">
          {title}
        </Text>
        <Group gap={2} wrap="nowrap">
          <Menu position="top-end" shadow="md">
            <Menu.Target>
              <Button variant="subtle" color="gray" size="compact-sm" leftSection={<Gauge size={15} />} aria-label="Reading speed">
                {reading.rate}×
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Speed</Menu.Label>
              {RATES.map((r) => (
                <Menu.Item key={r} onClick={() => setRate(r)} rightSection={r === reading.rate ? <Check size={14} /> : null}>
                  {r}×
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <Menu position="top-end" shadow="md" width={250}>
            <Menu.Target>
              <Tooltip label={current ? `Voice: ${voiceLabel(current)}` : 'Voice'}>
                <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Choose a voice">
                  <UserRound size={18} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown mah={360} style={{ overflowY: 'auto' }}>
              {!voices.length && <Menu.Label>No English voices on this device</Menu.Label>}
              {groups.map(({ g, list }) => (
                <div key={g}>
                  <Menu.Label>{g === 'female' ? 'Female voices' : g === 'male' ? 'Male voices' : 'Other voices'}</Menu.Label>
                  {list.map((v) => (
                    <Menu.Item
                      key={v.voiceURI}
                      onClick={() => {
                        setVoice(v.voiceURI);
                        if (!playing) previewVoice(v);
                      }}
                      rightSection={v.voiceURI === reading.voiceURI ? <Check size={14} /> : null}
                    >
                      {voiceLabel(v)}
                    </Menu.Item>
                  ))}
                </div>
              ))}
            </Menu.Dropdown>
          </Menu>
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => stopReading()} aria-label="Stop reading">
            <Square size={16} />
          </ActionIcon>
        </Group>
      </Group>
    </Paper>
  );
}
