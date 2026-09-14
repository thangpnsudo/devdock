// Top-level App component — sets up providers, router, and shell.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { HashRouter } from 'react-router-dom';

import { AppShell } from './features/shell/layouts/app-shell';
import { ToastProvider } from './features/shell/components/toast';
import { ConfirmProvider } from './features/shell/components/confirm-dialog';
import { AppRoutes } from './routes';
import { settingsIpc } from './features/settings/ipc/settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App(): JSX.Element {
  useEffect(() => {
    void settingsIpc.get().catch(() => undefined);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <HashRouter>
            <AppShell>
              <AppRoutes />
            </AppShell>
          </HashRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
