import {
  Button,
  Divider,
  FileButton,
  Group,
  Modal,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core';
import { Download, Monitor, Moon, Sun, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { exportBackup, importBackup } from '../db';
import type { Settings } from '../settings';
import { SERIF } from '../theme';
import { saveFile } from '../util';

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
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    if (opened) navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [opened]);

  const doExport = async () => {
    const backup = await exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    await saveFile(`rubies-backup-${stamp}.json`, JSON.stringify(backup), 'application/json');
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

        <Section title="Your data">
          <Text size="sm" c="dimmed">
            Notes, highlights and bookmarks are stored only on this device
            {persisted === true ? ' (protected from automatic clean-up)' : ''}. Export a backup to keep a copy or to move
            them to another device, then import it there.
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
        </Section>

        <Divider />

        <Section title="Install">
          <Text size="sm" c="dimmed">
            <b>iPad:</b> in Safari tap Share → Add to Home Screen. <b>Android:</b> Chrome menu → Install app.{' '}
            <b>Windows / Mac:</b> the install icon in the Chrome or Edge address bar. Once installed, Rubies works with no
            internet connection.
          </Text>
        </Section>

        <Section title="About">
          <Text size="sm" c="dimmed">
            Scripture text: King James Version (1769 Oxford edition), public domain in the United States.
          </Text>
        </Section>
      </Stack>
    </Modal>
  );
}
