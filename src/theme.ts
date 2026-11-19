import {
  ActionIcon,
  Button,
  Loader,
  Modal,
  Radio,
  Paper,
  SegmentedControl,
  TextInput,
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';

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
    Button: Button.extend({
      defaultProps: { radius: 'md' },
      // Filled ruby buttons get pale pink text in dark mode, like the soft icons (white in light mode).
      vars: (_theme, props) =>
        (props.variant ?? 'filled') === 'filled' && (!props.color || props.color === 'ruby')
          ? { root: { '--button-color': 'var(--rubies-on-filled)' } }
          : { root: {} },
    }),
    TextInput: TextInput.extend({ defaultProps: { radius: 'md' } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: 'md' } }),
    Modal: Modal.extend({ defaultProps: { radius: 'lg', centered: true, overlayProps: { blur: 3, backgroundOpacity: 0.35 } } }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
    Loader: Loader.extend({ defaultProps: { color: 'var(--accent)' } }),
    // Radio dots stay the readable accent pink in dark mode, rather than the deep ruby of filled buttons.
    Radio: Radio.extend({ vars: () => ({ root: { '--radio-color': 'var(--accent)' } }) }),
  },
});

/**
 * In dark mode, filled buttons (New note, Add, Mark as reviewed…) use the same deep ruby with pale pink text as the
 * soft "light" style, instead of bright pink. Accent text (verse numbers, references) stays pink via --accent.
 */
const DEEP_RUBY = '#460f20';
const DEEP_RUBY_HOVER = '#5c1529';
const PALE_PINK = '#fdeef2';
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--rubies-on-filled': '#fff' },
  dark: {
    '--rubies-on-filled': PALE_PINK,
    '--mantine-primary-color-filled': DEEP_RUBY,
    '--mantine-primary-color-filled-hover': DEEP_RUBY_HOVER,
    '--mantine-primary-color-contrast': PALE_PINK,
    '--mantine-color-ruby-filled': DEEP_RUBY,
    '--mantine-color-ruby-filled-hover': DEEP_RUBY_HOVER,
    '--mantine-color-ruby-contrast': PALE_PINK,
  },
});

/** Serif face used for Scripture and note body text. */
export const SERIF = "'Literata Variable', 'Iowan Old Style', Georgia, serif";
