import type { Ref } from './bible/reference';

/** Something added to the open note from the reading pane: Bible verses, or sentences from a Library book. */
export type Insertion =
  | { kind: 'bible'; refs: Ref[] }
  | {
      kind: 'quote';
      /** The quoted text, one entry per paragraph. */
      paragraphs: string[];
      /** Where it's from, shown as the quote's name line. */
      cite: string;
    };
