import { ActionIcon, Indicator, Text, Tooltip } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Gem, Settings } from 'lucide-react';
import { db } from '../db';
import { todayIso } from '../prayer';
import { FireFlame } from './FireFlame';
import { InstallButton } from './InstallButton';
import { SyncButton } from './SyncControls';
import { UpdateButton } from './UpdateButton';

interface Props {
  onSettings: () => void;
  onPrayers: () => void;
}

/**
 * The bar across the top of the app: its name, and the things that belong to the whole app rather than to one pane
 * (prayer list, update, install, sync, settings). It stays put whatever is showing below: the Bible, the Library,
 * the list of notes or an open note.
 */
export function AppBar({ onSettings, onPrayers }: Props) {
  const today = todayIso();
  const dueCount = useLiveQuery(
    async () => (await db.prayers.where('followUpOn').belowOrEqual(today).toArray()).filter((p) => !p.answeredAt).length,
    [today],
  );

  return (
    <header className="app-bar">
      <Gem size={18} strokeWidth={1.75} className="app-bar-gem" aria-hidden="true" />
      <Text fw={700} size="lg">
        Rubies
      </Text>
      <div className="spacer" />
      <Tooltip label={dueCount ? `Prayer list · ${dueCount} to follow up` : 'Prayer list'}>
        <Indicator label={dueCount} size={18} color="red" disabled={!dueCount} offset={6}>
          <ActionIcon onClick={onPrayers} aria-label={dueCount ? `Prayer list, ${dueCount} to follow up` : 'Prayer list'}>
            <FireFlame />
          </ActionIcon>
        </Indicator>
      </Tooltip>
      <UpdateButton />
      <InstallButton variant="header" />
      <SyncButton onOpenSettings={onSettings} />
      <ActionIcon onClick={onSettings} aria-label="Settings">
        <Settings />
      </ActionIcon>
    </header>
  );
}
