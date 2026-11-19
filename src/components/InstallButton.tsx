import { ActionIcon, Button, CopyButton, Group, List, Modal, Stack, Text, Tooltip } from '@mantine/core';
import { Check, Copy, EllipsisVertical, Ellipsis, MonitorDown, Share, SquarePlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  appUrl,
  detectPlatform,
  promptInstall,
  setInstallButtonHidden,
  useInstall,
  type InstallPlatform,
} from '../install';

const Key = ({ children }: { children: ReactNode }) => (
  <Text span fw={600} style={{ whiteSpace: 'nowrap' }}>
    {children}
  </Text>
);

const inline = (Icon: typeof Share) => <Icon size={16} style={{ verticalAlign: '-3px', margin: '0 2px' }} />;

function OpenElsewhere({ browsers }: { browsers: string }) {
  return (
    <Stack gap="xs">
      <Text size="sm">
        This browser can’t install apps. Open this address in <b>{browsers}</b>, then tap Install again:
      </Text>
      <Group gap="xs" wrap="nowrap">
        <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
          {appUrl()}
        </Text>
        <CopyButton value={appUrl()}>
          {({ copied, copy }) => (
            <Button size="compact-sm" variant="light" onClick={copy} leftSection={copied ? <Check size={14} /> : <Copy size={14} />}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </CopyButton>
      </Group>
    </Stack>
  );
}

function Steps({ platform }: { platform: InstallPlatform }) {
  switch (platform) {
    case 'ios-safari':
    case 'ios-other':
      return (
        <List type="ordered" spacing="xs" size="sm">
          <List.Item>
            Tap the <Key>Share {inline(Share)}</Key> button
            {platform === 'ios-safari' ? (
              <> (at the bottom of the screen on iPhone, top right on iPad; if you don’t see it, tap {inline(Ellipsis)} first)</>
            ) : (
              <> in the address bar (or the browser’s {inline(Ellipsis)} menu)</>
            )}
            .
          </List.Item>
          <List.Item>
            Scroll down and tap <Key>Add to Home Screen {inline(SquarePlus)}</Key>.
          </List.Item>
          <List.Item>
            Make sure <Key>Open as Web App</Key> is on, then tap <Key>Add</Key>.
          </List.Item>
          <List.Item>Open Rubies from its icon on your Home Screen from now on.</List.Item>
        </List>
      );
    case 'mac-safari':
      return (
        <List type="ordered" spacing="xs" size="sm">
          <List.Item>
            In the menu bar at the top of the screen, choose <Key>File → Add to Dock…</Key> (or click{' '}
            <Key>Share {inline(Share)}</Key> in the toolbar → <Key>Add to Dock</Key>).
          </List.Item>
          <List.Item>
            Click <Key>Add</Key>. Rubies appears in your Dock and in Launchpad / Applications.
          </List.Item>
          <List.Item>
            <Text span size="sm" c="dimmed">
              Don’t see “Add to Dock”? It needs macOS Sonoma (14) or newer. On older Macs, use Chrome or Edge instead.
            </Text>
          </List.Item>
        </List>
      );
    case 'android':
      return (
        <List type="ordered" spacing="xs" size="sm">
          <List.Item>
            Tap the browser’s menu <Key>{inline(EllipsisVertical)}</Key> (top right in Chrome).
          </List.Item>
          <List.Item>
            Tap <Key>Install app</Key> or <Key>Add to Home screen</Key>, then <Key>Install</Key>.
          </List.Item>
        </List>
      );
    case 'chrome':
      return (
        <List type="ordered" spacing="xs" size="sm">
          <List.Item>
            Click the install icon <Key>{inline(MonitorDown)}</Key> at the right end of the address bar. No icon? Open
            the menu <Key>{inline(EllipsisVertical)}</Key> → <Key>Cast, save and share</Key> →{' '}
            <Key>Install page as app…</Key>
          </List.Item>
          <List.Item>
            Click <Key>Install</Key>. Rubies gets its own window, plus a Start menu (Windows) or Applications / Dock
            (Mac) icon.
          </List.Item>
        </List>
      );
    case 'edge':
      return (
        <List type="ordered" spacing="xs" size="sm">
          <List.Item>
            Click the install icon <Key>{inline(MonitorDown)}</Key> at the right end of the address bar. No icon? Open
            the menu <Key>{inline(Ellipsis)}</Key> → <Key>Apps</Key> → <Key>Install Rubies</Key>.
          </List.Item>
          <List.Item>
            Click <Key>Install</Key>. Rubies gets its own window and a Start menu icon (you can pin it to the taskbar).
          </List.Item>
        </List>
      );
    case 'firefox':
      return <OpenElsewhere browsers="Chrome, Edge or (on a Mac) Safari" />;
    default:
      return <OpenElsewhere browsers="Chrome, Edge or Safari" />;
  }
}

const TITLES: Record<InstallPlatform, string> = {
  'ios-safari': 'Install on iPhone / iPad',
  'ios-other': 'Install on iPhone / iPad',
  'mac-safari': 'Install on your Mac',
  android: 'Install on Android',
  chrome: 'Install from Chrome',
  edge: 'Install from Edge',
  firefox: 'Install Rubies',
  other: 'Install Rubies',
};

/** Help for installing, shown when the browser can't install with one tap. */
function InstallHelp({ opened, onClose, inHeader }: { opened: boolean; onClose: () => void; inHeader: boolean }) {
  const platform = detectPlatform();
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700} size="xl">{TITLES[platform]}</Text>}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Installed, Rubies opens like any other app, in its own window, and works with no internet connection. Your
          notes stay as they are.
        </Text>
        <Steps platform={platform} />
        <Group justify="space-between" mt="xs">
          {inHeader ? (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              onClick={() => {
                setInstallButtonHidden(true);
                onClose();
              }}
            >
              Hide this button
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Install Rubies as an app. Uses the browser's own install dialog when it offers one (Chrome, Edge, Android), and
 * otherwise shows steps for this device. `variant="header"` is a compact icon for the notes header, hidden once
 * installed or dismissed; `variant="settings"` is a full button for the Settings dialog.
 */
export function InstallButton({ variant }: { variant: 'header' | 'settings' }) {
  const { installed, canPrompt, hidden } = useInstall();
  const [help, setHelp] = useState(false);
  const inHeader = variant === 'header';
  if (installed || (inHeader && hidden)) return null;

  const install = async () => {
    if (canPrompt) await promptInstall();
    else setHelp(true);
  };

  return (
    <>
      {inHeader ? (
        <Tooltip label="Install Rubies as an app">
          <ActionIcon onClick={install} aria-label="Install Rubies as an app" className="install-blink">
            <MonitorDown />
          </ActionIcon>
        </Tooltip>
      ) : (
        <Group gap="sm" align="center">
          <Button leftSection={<MonitorDown size={18} />} onClick={install}>
            Install Rubies
          </Button>
          {hidden && (
            <Button variant="subtle" size="compact-sm" onClick={() => setInstallButtonHidden(false)}>
              Show in the header again
            </Button>
          )}
        </Group>
      )}
      <InstallHelp opened={help} onClose={() => setHelp(false)} inHeader={inHeader} />
    </>
  );
}
