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
import App from './App';
import { theme } from './theme';
import { startUpdates } from './update';

startUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-center" limit={2} />
      <App />
    </MantineProvider>
  </StrictMode>,
);
