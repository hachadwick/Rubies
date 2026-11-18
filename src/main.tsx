import '@fontsource-variable/inter';
import '@fontsource-variable/literata';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/tiptap/styles.css';
import './styles.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { theme } from './theme';

// Offline caching is only needed on the web; the desktop app (app:// scheme) ships its files locally.
if (location.protocol.startsWith('http')) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-center" limit={2} />
      <App />
    </MantineProvider>
  </StrictMode>,
);
