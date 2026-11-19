import { ActionIcon, Alert, Avatar, Button, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { Cloud, CloudAlert, CloudOff, LogOut, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { DRIVE_ACCESS_MESSAGE, GOOGLE_CLIENT_ID, syncSupported } from '../sync/google';
import { reconnect, signIn, signOut, syncNow, useSyncState, type SyncState } from '../sync/sync';
import { timeAgo } from '../review';

/** Google's "G", for the sign-in button. */
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function statusText(s: SyncState): string {
  switch (s.status) {
    case 'syncing':
      return 'Syncing…';
    case 'paused':
      if (s.needsDriveAccess) return DRIVE_ACCESS_MESSAGE;
      if (s.error) return `Sync paused: ${s.error}`;
      return 'Sync paused: Google sign-in ran out. Reconnect to carry on; your changes are kept on this device.';
    case 'offline':
      return 'Offline. Changes will sync when the internet is back.';
    case 'error':
      return `Last sync failed: ${s.error ?? 'unknown error'}`;
    default:
      return s.lastSyncedAt ? `Synced ${timeAgo(s.lastSyncedAt)}` : 'Not synced yet';
  }
}

/** The "Sync across devices" part of Settings. */
export function SyncSettings() {
  const s = useSyncState();
  const [busy, setBusy] = useState(false);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* shown from the sync state */
    } finally {
      setBusy(false);
    }
  };

  if (!syncSupported()) {
    return (
      <Text size="sm" c="dimmed">
        {!GOOGLE_CLIENT_ID
          ? 'Syncing with Google Drive isn’t set up for this copy of Rubies.'
          : 'Syncing with Google Drive works in the web version of Rubies (installed from the website). The desktop app keeps its notes on this computer; use Export / Import backup to move them.'}
      </Text>
    );
  }

  if (!s.account) {
    return (
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          Sign in with Google to keep your notes, prayer list, highlights and bookmarks the same on every device. They’re
          saved in a private Rubies folder in your own Google Drive that only Rubies can see. Notes already on this device
          are combined with the ones in your account.
        </Text>
        <Button variant="default" leftSection={<GoogleG />} onClick={run(signIn)} loading={busy}>
          Sign in with Google
        </Button>
        {s.error && (
          <Text size="sm" c="red">
            {s.error}
          </Text>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Group wrap="nowrap" gap="sm">
        <Avatar src={s.account.picture} alt="" radius="xl" size={40}>
          {s.account.name.slice(0, 1)}
        </Avatar>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text fw={600} truncate>
            {s.account.name}
          </Text>
          <Text size="sm" c="dimmed" truncate>
            {s.account.email}
          </Text>
        </div>
      </Group>
      {s.status === 'paused' || s.status === 'error' ? (
        <Alert color={s.status === 'error' ? 'red' : 'yellow'} variant="light" p="sm">
          <Text size="sm">{statusText(s)}</Text>
        </Alert>
      ) : (
        <Text size="sm" c="dimmed">
          {statusText(s)}
        </Text>
      )}
      <Group grow>
        {s.status === 'paused' ? (
          <Button variant="light" leftSection={<GoogleG />} onClick={run(reconnect)} loading={busy}>
            {s.needsDriveAccess ? 'Allow Drive access' : 'Reconnect'}
          </Button>
        ) : (
          <Button variant="light" leftSection={<RefreshCw size={18} />} onClick={run(syncNow)} loading={busy || s.status === 'syncing'}>
            Sync now
          </Button>
        )}
        <Button variant="subtle" color="gray" leftSection={<LogOut size={18} />} onClick={run(signOut)}>
          Sign out
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Signing out stops syncing on this device. Your notes stay here and in your Google Drive.
      </Text>
    </Stack>
  );
}

/** The cloud button in the notes header: shows how syncing is going; tap to sync now or reconnect. */
export function SyncButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const s = useSyncState();
  if (!syncSupported() || !s.account) return null;

  const icon =
    s.status === 'syncing' ? (
      <Loader size={18} />
    ) : s.status === 'paused' || s.status === 'offline' ? (
      <CloudOff />
    ) : s.status === 'error' ? (
      <CloudAlert />
    ) : (
      <Cloud />
    );
  const label =
    s.status === 'paused' ? (s.needsDriveAccess ? 'Sync paused: Rubies needs Google Drive access.' : 'Sync paused. Tap to reconnect.') : statusText(s);

  return (
    <Tooltip label={label} multiline maw={260}>
      <ActionIcon
        aria-label={label}
        color={s.status === 'paused' ? 'yellow' : s.status === 'error' ? 'red' : undefined}
        onClick={() => {
          if (s.status === 'paused' && s.needsDriveAccess) onOpenSettings();
          else if (s.status === 'paused') reconnect().catch(onOpenSettings);
          else if (s.status === 'error') onOpenSettings();
          else syncNow();
        }}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}
