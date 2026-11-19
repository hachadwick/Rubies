import { UnstyledButton } from '@mantine/core';
import { BookOpen, Library } from 'lucide-react';

export type Reader = 'bible' | 'library';

/** The switch at the top of the reading pane between the Bible and the Library. */
export function ReaderTabs({ value, onChange }: { value: Reader; onChange: (r: Reader) => void }) {
  return (
    <div className="reader-tabs" role="tablist" aria-label="Read">
      {(
        [
          ['bible', 'Bible', BookOpen],
          ['library', 'Library', Library],
        ] as const
      ).map(([key, label, Icon]) => (
        <UnstyledButton
          key={key}
          role="tab"
          aria-selected={value === key}
          className="reader-tab"
          data-active={value === key || undefined}
          onClick={() => onChange(key)}
        >
          <Icon size={17} />
          {label}
        </UnstyledButton>
      ))}
    </div>
  );
}
