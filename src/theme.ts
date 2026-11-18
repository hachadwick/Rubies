import { ActionIcon, Button, Modal, Paper, SegmentedControl, TextInput, createTheme, type MantineColorsTuple } from '@mantine/core';

const ruby: MantineColorsTuple = [
  '#fdeef2',
  '#f8d9e1',
  '#f0b0c1',
  '#e8859f',
  '#e06083',
  '#da4a71',
  '#d23d66',
  '#bb3057',
  '#a7284d',
  '#8b1e3f',
];

export const theme = createTheme({
  primaryColor: 'ruby',
  primaryShade: { light: 8, dark: 4 },
  colors: { ruby },
  fontFamily: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  headings: { fontFamily: "'Inter Variable', system-ui, sans-serif", fontWeight: '700' },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    ActionIcon: ActionIcon.extend({ defaultProps: { variant: 'subtle', color: 'gray', size: 'xl', radius: 'md' } }),
    Button: Button.extend({ defaultProps: { radius: 'md' } }),
    TextInput: TextInput.extend({ defaultProps: { radius: 'md' } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: 'md' } }),
    Modal: Modal.extend({ defaultProps: { radius: 'lg', centered: true, overlayProps: { blur: 3, backgroundOpacity: 0.35 } } }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
  },
});

/** Serif face used for Scripture and note body text. */
export const SERIF = "'Literata Variable', 'Iowan Old Style', Georgia, serif";
