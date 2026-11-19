import { Button, Group, Modal, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { Trash2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** What will happen, in a sentence or two. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  icon?: LucideIcon;
}

/**
 * An in-app "are you sure?" for destructive actions, in place of the browser's plain confirm() box: an icon,
 * a clear title, what will happen, and Cancel / a red action button. Cancel has the focus, so Enter doesn't
 * delete by accident; Escape or clicking outside cancels.
 */
export function ConfirmDialog({ opened, onClose, onConfirm, title, children, confirmLabel, cancelLabel = 'Cancel', icon: Icon = Trash2 }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} withCloseButton={false} size={400} padding="xl" aria-labelledby="confirm-title">
      <Stack align="center" gap="sm" ta="center">
        <ThemeIcon size={56} radius="xl" color="red" variant="light" aria-hidden>
          <Icon size={26} />
        </ThemeIcon>
        <Title order={3} id="confirm-title" fz="lg">
          {title}
        </Title>
        <Text c="dimmed" size="sm" component="div">
          {children}
        </Text>
      </Stack>
      <Group grow mt="xl" gap="sm">
        <Button variant="default" onClick={onClose} data-autofocus>
          {cancelLabel}
        </Button>
        <Button
          color="red"
          leftSection={<Icon size={16} />}
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </Group>
    </Modal>
  );
}
