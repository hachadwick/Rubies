import { Flame, type LucideProps } from 'lucide-react';
import { useId } from 'react';

/** The prayer-list flame, drawn in fire colours: red at the base, through orange, to yellow at the tip. */
export function FireFlame(props: LucideProps) {
  const id = `fire-${useId().replace(/:/g, '')}`;
  return (
    <Flame {...props} color={`url(#${id})`}>
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="50%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#facc15" />
        </linearGradient>
      </defs>
    </Flame>
  );
}
