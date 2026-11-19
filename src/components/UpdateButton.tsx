import { Button, Tooltip } from '@mantine/core';
import { ArrowDownToLine } from 'lucide-react';
import { useState } from 'react';
import { applyUpdate, useUpdateAvailable } from '../update';

/** Appears in the notes header when a new version of Rubies has been published; tap to switch to it. */
export function UpdateButton() {
  const available = useUpdateAvailable();
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  return (
    <Tooltip label="A new version of Rubies is ready. Tap to update; your notes are kept.">
      <Button
        size="compact-md"
        radius="xl"
        variant="light"
        leftSection={<ArrowDownToLine size={16} />}
        loading={busy}
        onClick={() => {
          setBusy(true);
          applyUpdate();
        }}
        mx={4}
      >
        Update
      </Button>
    </Tooltip>
  );
}
