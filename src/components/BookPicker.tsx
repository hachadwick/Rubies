import { ActionIcon, Button, Group, Modal, SegmentedControl, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { BOOKS, bookById } from '../bible/books';
import { chapterCount } from '../bible/kjv';

interface Props {
  opened: boolean;
  current: number;
  onPick: (book: number, chapter: number) => void;
  onClose: () => void;
}

export function BookPicker({ opened, current, onPick, onClose }: Props) {
  const [book, setBook] = useState<number | null>(null);
  const [testament, setTestament] = useState<'OT' | 'NT'>(bookById(current).testament);

  const close = () => {
    setBook(null);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      size="xl"
      title={
        <Group gap="xs">
          {book && (
            <ActionIcon size="lg" onClick={() => setBook(null)} aria-label="Back to books">
              <ChevronLeft />
            </ActionIcon>
          )}
          <Title order={3}>{book ? bookById(book).name : 'Choose a book'}</Title>
        </Group>
      }
    >
      {book ? (
        <SimpleGrid cols={{ base: 5, xs: 7, sm: 10 }} spacing={8}>
          {Array.from({ length: chapterCount(book) }, (_, i) => (
            <Button
              key={i}
              variant="default"
              px={0}
              h={48}
              onClick={() => {
                setBook(null);
                onPick(book, i + 1);
              }}
            >
              {i + 1}
            </Button>
          ))}
        </SimpleGrid>
      ) : (
        <Stack>
          <SegmentedControl
            fullWidth
            value={testament}
            onChange={(v) => setTestament(v as 'OT' | 'NT')}
            data={[
              { value: 'OT', label: 'Old Testament' },
              { value: 'NT', label: 'New Testament' },
            ]}
          />
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 4 }} spacing={8}>
            {BOOKS.filter((b) => b.testament === testament).map((b) => (
              <Button
                key={b.id}
                variant={b.id === current ? 'light' : 'default'}
                justify="flex-start"
                h={48}
                onClick={() => (chapterCount(b.id) === 1 ? (setBook(null), onPick(b.id, 1)) : setBook(b.id))}
                title={b.name}
              >
                <Text inherit truncate>
                  {b.name}
                </Text>
              </Button>
            ))}
          </SimpleGrid>
        </Stack>
      )}
    </Modal>
  );
}
