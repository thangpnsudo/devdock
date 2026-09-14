// App shell — sidebar + outlet.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Settings,
  TerminalSquare,
} from 'lucide-react';

import { KeyboardHelpModal } from '../components/keyboard-help-modal';
import { DevDockMark } from '../components/devdock-mark';
import { useUiStore } from '../../../stores/ui-store';
import { useToast } from '../components/toast';

export interface AppShellProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { to: '/library', label: 'Library', icon: BookOpen, signal: 'cobalt' },
  {
    to: '/clipboard',
    label: 'Clipboard',
    icon: ClipboardList,
    signal: 'orange',
  },
  { to: '/ssh', label: 'SSH', icon: TerminalSquare, signal: 'lime' },
  { to: '/agents', label: 'Agents', icon: Bot, signal: 'orange' },
  { to: '/settings', label: 'Settings', icon: Settings, signal: 'neutral' },
] as const;

export function AppShell({ children }: AppShellProps): JSX.Element {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [agentAttentionCount, setAgentAttentionCount] = useState(0);
  const agentAttentionRef = useRef(new Map<string, ElectronAgentSnapshot['attention']>());
  const terminalMode = location.pathname === '/' || location.pathname === '/ssh';
  useEffect(() => {
    const focus = ({ sessionId }: { sessionId: string }): void => {
      navigate('/ssh');
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('devdock:terminal-activate', {
            detail: { sessionId },
          }),
        );
      }, 0);
    };
    const removeAgentListener = window.devdockAgents?.onFocusRequested(focus);
    const removeTerminalListener = window.devdockTerminal?.onFocusRequested(focus);
    return () => {
      removeAgentListener?.();
      removeTerminalListener?.();
    };
  }, [navigate]);
  useEffect(() => {
    let cancelled = false;
    const updateAttentionCount = (): void => {
      setAgentAttentionCount(
        [...agentAttentionRef.current.values()].filter((attention) => attention === 'needs-input')
          .length,
      );
    };
    void window.devdockAgents?.list().then((agents) => {
      if (cancelled) return;
      agentAttentionRef.current = new Map(agents.map((agent) => [agent.id, agent.attention]));
      updateAttentionCount();
    });
    const unsubscribe = window.devdockAgents?.onChanged(({ agent }) => {
      const previous = agentAttentionRef.current.get(agent.id) ?? 'none';
      agentAttentionRef.current.set(agent.id, agent.attention);
      updateAttentionCount();
      if (previous !== 'needs-input' && agent.attention === 'needs-input') {
        toast.push(`${agent.displayName} needs your input`, { variant: 'info', durationMs: 8000 });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [toast]);
  return (
    <div
      className={`dd-shell${sidebarCollapsed ? ' dd-shell--collapsed' : ''}${terminalMode ? ' dd-shell--terminal' : ''}`}
    >
      <aside className="dd-shell__sidebar">
        <div className="dd-shell__brand">
          <span className="dd-shell__brand-mark">
            <DevDockMark size={34} />
          </span>
          <div className="dd-shell__brand-copy">
            <h1>DevDock</h1>
            <p>Developer workspace</p>
          </div>
          <button
            type="button"
            className="dd-shell__collapse"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <nav className="dd-shell__nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive || (item.to === '/ssh' && terminalMode)
                  ? 'dd-shell__nav-link dd-shell__nav-link--active'
                  : 'dd-shell__nav-link'
              }
              data-signal={item.signal}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="dd-shell__nav-icon">
                <item.icon size={17} strokeWidth={1.8} aria-hidden="true" />
                {item.to === '/agents' && agentAttentionCount > 0 && (
                  <span
                    className="dd-shell__nav-badge"
                    aria-label={`${agentAttentionCount} agents need input`}
                  >
                    {agentAttentionCount}
                  </span>
                )}
              </span>
              <span className="dd-shell__nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <footer className="dd-shell__footer">
          <small className="dd-shell__status">
            <i /> Local-first · Offline ready
          </small>
          <small>
            DevDock Kit · <kbd>?</kbd> Shortcuts
          </small>
        </footer>
      </aside>
      <main className="dd-shell__main">{children}</main>
      <KeyboardHelpModal />
    </div>
  );
}
