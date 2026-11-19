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
import { cssVariablesResolver, theme } from './theme';
import { startInstall } from './install';
import { startUpdates } from './update';

startUpdates();
startInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
      <Notifications position="bottom-center" limit={2} />
      <App />
    </MantineProvider>
  </StrictMode>,
);
