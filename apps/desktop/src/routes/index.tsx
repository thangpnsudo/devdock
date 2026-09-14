// Route definitions.

import { Route, Routes, useLocation } from 'react-router-dom';

import { ClipboardPage } from '../features/clipboard/pages/clipboard-page';
import { LibraryPage } from '../features/library/pages/library-page';
import { SettingsPage } from '../features/settings/pages/settings-page';
import { SshPage } from '../features/ssh/pages/ssh-page';
import { AgentCenterPage } from '../features/agents/pages/agent-center-page';

export function AppRoutes(): JSX.Element {
  const location = useLocation();
  const terminalSupported = Boolean(window.devdockTerminal);
  const terminalActive =
    terminalSupported && (location.pathname === '/' || location.pathname === '/ssh');
  return (
    <>
      {terminalSupported && (
        <div
          className={`dd-terminal-keepalive${terminalActive ? ' is-active' : ''}`}
          aria-hidden={!terminalActive}
        >
          <SshPage />
        </div>
      )}
      {!terminalActive && (
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/clipboard" element={<ClipboardPage />} />
          <Route path="/agents" element={<AgentCenterPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/ssh" element={<SshPage />} />
        </Routes>
      )}
    </>
  );
}
