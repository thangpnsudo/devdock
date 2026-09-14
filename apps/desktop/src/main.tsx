// React 19 entry point.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/global.css';
import './styles/terminal-workspace.css';
import './styles/app-shell.css';
import './styles/shared-controls.css';
import './styles/terminal-redesign.css';
import './styles/feature-screens.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
