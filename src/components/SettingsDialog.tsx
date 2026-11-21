import {
  Anchor,
  Button,
  Divider,
  FileButton,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core';
import { Download, FolderArchive, Monitor, Moon, Sun, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db, exportBackup, importBackup } from '../db';
import { exportNotesZip } from '../exporting';
import { useInstall } from '../install';
import { REVIEW_CHOICES } from '../review';
import type { Settings } from '../settings';
import { SERIF } from '../theme';
import { saveFile } from '../util';
import { InstallButton } from './InstallButton';
import { SyncSettings } from './SyncControls';

interface Props {
  opened: boolean;
  settings: Settings;
  onChange: (p: Partial<Settings>) => void;
  onClose: () => void;
  toast: (msg: string) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="xs">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.06em' }}>
        {title}
      </Text>
      {children}
    </Stack>
  );
}

const iconLabel = (Icon: typeof Sun, label: string) => (
  <Group gap={6} wrap="nowrap" justify="center">
    <Icon size={16} />
    {label}
  </Group>
);

export function SettingsDialog({ opened, settings, onChange, onClose, toast }: Props) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { installed } = useInstall();
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    if (opened) navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [opened]);

  const doExport = async () => {
    const backup = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    await saveFile(`rubies-backup-${stamp}.json`, JSON.stringify(backup), 'application/json');
  };

  /** Every note as its own Word file or PDF, in one zip (the same as in a note's export menu). */
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null);
  const exportAll = async (format: 'docx' | 'pdf') => {
    const kind = format === 'pdf' ? 'PDFs' : 'Word documents';
    setExporting(format);
    try {
      const notes = await db.notes.toArray();
      if (!notes.length) return toast('There are no notes to export yet');
      const count = await exportNotesZip(notes, format);
      toast(`Exported ${count} ${count === 1 ? 'note' : 'notes'} as ${kind}`);
    } catch (err) {
      console.error(err);
      toast(`Export failed: ${(err as Error).message}`);
    } finally {
      setExporting(null);
    }
  };

  const doImport = async (f: File | null) => {
    if (!f) return;
    try {
      const r = await importBackup(JSON.parse(await f.text()));
      toast(`Imported ${r.notes} note(s), ${r.highlights} highlight(s), ${r.bookmarks} bookmark(s)`);
      onClose();
    } catch (err) {
      alert(`Could not import: ${(err as Error).message}`);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Title order={3}>Settings</Title>} size="lg">
      <Stack gap="xl">
        <Section title="Appearance">
          <SegmentedControl
            fullWidth
            value={colorScheme}
            onChange={(v) => setColorScheme(v as MantineColorScheme)}
            data={[
              { value: 'auto', label: iconLabel(Monitor, 'System') },
              { value: 'light', label: iconLabel(Sun, 'Light') },
              { value: 'dark', label: iconLabel(Moon, 'Dark') },
            ]}
          />
          <Text size="sm" fw={500} mt="sm">
            Bible text size
          </Text>
          <Slider
            min={14}
            max={30}
            value={settings.bibleFontSize}
            onChange={(v) => onChange({ bibleFontSize: v })}
            label={(v) => `${v}px`}
          />
          <Text style={{ fontFamily: SERIF, fontSize: 'var(--bible-size)', lineHeight: 1.6 }}>
            In the beginning was the Word, and the Word was with God.
          </Text>
          <Text size="sm" fw={500} mt="sm">
            Note text size
          </Text>
          <Slider
            min={13}
            max={26}
            value={settings.noteFontSize}
            onChange={(v) => onChange({ noteFontSize: v })}
            label={(v) => `${v}px`}
          />
        </Section>

        <Divider />

        <Section title="Reviewing notes">
          <Select
            label="Remind me to review a note"
            description="A note that hasn't been marked reviewed in this long is suggested for review on the notes list."
            data={REVIEW_CHOICES}
            value={String(settings.reviewEveryDays)}
            onChange={(v) => v !== null && onChange({ reviewEveryDays: Number(v) })}
            allowDeselect={false}
          />
        </Section>

        <Divider />

        <Section title="Sync across devices">
          <SyncSettings />
        </Section>

        <Divider />

        <Section title="Your data">
          <Text size="sm" c="dimmed">
            Notes, highlights and bookmarks are stored on this device
            {persisted === true ? ' (protected from automatic clean-up)' : ''}. Export a backup to keep a copy of your
            own, or to move them to a device that isn’t signed in.
          </Text>
          <Group grow>
            <Button variant="light" leftSection={<Download size={18} />} onClick={doExport}>
              Export backup
            </Button>
            <FileButton onChange={doImport} accept="application/json,.json">
              {(props) => (
                <Button variant="light" leftSection={<Upload size={18} />} {...props}>
                  Import backup
                </Button>
              )}
            </FileButton>
          </Group>
          <Text size="sm" c="dimmed" mt="sm">
            Or export every note to read or print elsewhere: one file per note, together in a zip.
          </Text>
          <Group grow>
            <Button
              variant="light"
              leftSection={<FolderArchive size={18} />}
              onClick={() => exportAll('docx')}
              loading={exporting === 'docx'}
              disabled={exporting === 'pdf'}
            >
              All notes as Word
            </Button>
            <Button
              variant="light"
              leftSection={<FolderArchive size={18} />}
              onClick={() => exportAll('pdf')}
              loading={exporting === 'pdf'}
              disabled={exporting === 'docx'}
            >
              All notes as PDF
            </Button>
          </Group>
        </Section>

        <Divider />

        <Section title="Install">
          {installed ? (
            <Text size="sm" c="dimmed">
              Rubies is installed on this device and works with no internet connection.
            </Text>
          ) : (
            <>
              <Text size="sm" c="dimmed">
                Install Rubies to open it like any other app, in its own window, with no internet connection needed.
              </Text>
              <InstallButton variant="settings" />
            </>
          )}
        </Section>

        <Section title="About">
          <Text size="sm" c="dimmed">
            Scripture text: King James Version (1769 Oxford edition), public domain in the United States.
          </Text>
          <Text size="sm">
            <Anchor href="https://hachadwick.github.io/Rubies/privacy.html" target="_blank" rel="noopener">
              Privacy policy
            </Anchor>
          </Text>
        </Section>
      </Stack>
    </Modal>
  );
}
