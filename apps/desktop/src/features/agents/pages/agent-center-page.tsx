import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  FolderKanban,
  Pencil,
  RotateCcw,
  Save,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '../../shell/components/toast';
import { AGENT_GUIDES, agentGuideIdForUserAgent, type AgentGuideId } from '../data/agent-guides';
import { agentsIpc } from '../ipc/agents';

const ACTIVE_STATUSES = new Set<ElectronAgentStatus>(['starting', 'working', 'blocked', 'idle']);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? cwd;
}

function upsertAgent(current: ElectronAgentSnapshot[], agent: ElectronAgentSnapshot) {
  const next = current.filter((item) => item.id !== agent.id);
  next.push(agent);
  return next.sort((left, right) => right.startedAt - left.startedAt);
}

export function AgentCenterPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [agents, setAgents] = useState<ElectronAgentSnapshot[]>([]);
  const [providers, setProviders] = useState<
    Array<{
      id: ElectronAgentProviderId;
      displayName: string;
      executable: string;
      available: boolean;
    }>
  >([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [activeGuideId, setActiveGuideId] = useState<AgentGuideId>(() =>
    agentGuideIdForUserAgent(navigator.userAgent),
  );
  const activeGuide = AGENT_GUIDES.find(({ id }) => id === activeGuideId) ?? AGENT_GUIDES[0]!;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([agentsIpc.list(), agentsIpc.providers()])
      .then(([nextAgents, nextProviders]) => {
        if (cancelled) return;
        setAgents(nextAgents);
        setProviders(nextProviders);
      })
      .catch((error) => {
        toast.push(`[agent_runtime] ${errorMessage(error)}`, { variant: 'error' });
      });
    const unsubscribe = agentsIpc.onChanged((agent) =>
      setAgents((current) => upsertAgent(current, agent)),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [toast]);

  const activeCount = agents.filter((agent) => ACTIVE_STATUSES.has(agent.status)).length;
  const attentionCount = agents.filter((agent) => agent.attention === 'needs-input').length;
  const projectGroups = useMemo(() => {
    const grouped = new Map<string, ElectronAgentSnapshot[]>();
    for (const agent of agents) grouped.set(agent.cwd, [...(grouped.get(agent.cwd) ?? []), agent]);
    return [...grouped.entries()]
      .map(([cwd, items]) => ({ cwd, name: projectName(cwd), agents: items }))
      .sort((left, right) => right.agents[0]!.startedAt - left.agents[0]!.startedAt);
  }, [agents]);

  const copyCommand = async (command: string): Promise<void> => {
    try {
      if (window.devdockClipboard) await window.devdockClipboard.copyText(command);
      else await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      window.setTimeout(
        () => setCopiedCommand((current) => (current === command ? null : current)),
        1600,
      );
    } catch (error) {
      toast.push(`Could not copy command: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const openTerminal = (agent: ElectronAgentSnapshot): void => {
    if (!agent.terminalAvailable) return;
    void agentsIpc.markSeen(agent.id).catch(() => undefined);
    navigate('/ssh');
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('devdock:terminal-activate', {
          detail: { sessionId: agent.terminalSessionId },
        }),
      );
    }, 0);
  };

  const removeAgent = async (id: string): Promise<void> => {
    setBusyId(id);
    try {
      await agentsIpc.remove(id);
      setAgents((current) => current.filter((agent) => agent.id !== id));
    } catch (error) {
      toast.push(`[agent_remove] ${errorMessage(error)}`, { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const runAction = async (id: string, action: 'stop' | 'restart'): Promise<void> => {
    setBusyId(id);
    try {
      const agent = action === 'stop' ? await agentsIpc.stop(id) : await agentsIpc.restart(id);
      setAgents((current) => upsertAgent(current, agent));
      if (action === 'restart') openTerminal(agent);
    } catch (error) {
      toast.push(`[agent_${action}] ${errorMessage(error)}`, { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const renameAgent = async (agent: ElectronAgentSnapshot): Promise<void> => {
    const nextName = editingName.trim();
    setEditingId(null);
    if (!nextName || nextName === agent.displayName) return;
    setBusyId(agent.id);
    try {
      const updated = await agentsIpc.rename(agent.id, nextName);
      setAgents((current) => upsertAgent(current, updated));
    } catch (error) {
      toast.push(`[agent_rename] ${errorMessage(error)}`, { variant: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const runGroupAction = async (cwd: string, action: 'stop' | 'restart'): Promise<void> => {
    setBusyGroup(cwd);
    try {
      const updated =
        action === 'stop' ? await agentsIpc.stopGroup(cwd) : await agentsIpc.restartGroup(cwd);
      setAgents((current) => updated.reduce(upsertAgent, current));
    } catch (error) {
      toast.push(`[agent_group_${action}] ${errorMessage(error)}`, { variant: 'error' });
    } finally {
      setBusyGroup(null);
    }
  };

  return (
    <section className="dd-page dd-agent-center">
      <header className="dd-page__header">
        <div>
          <p className="dd-eyebrow">CLI-first agent workspace</p>
          <h2>Agent Center</h2>
          <p>Track every managed agent, grouped automatically by project.</p>
        </div>
        <div className="dd-agent-center__metrics">
          {attentionCount > 0 && <span className="needs-input">{attentionCount} need input</span>}
          <span className="dd-agent-center__summary">
            <i /> {activeCount} active
          </span>
        </div>
      </header>

      <div className="dd-agent-center__layout">
        <aside className="dd-card dd-agent-guide">
          <header>
            <TerminalSquare size={16} />
            <div>
              <strong>Start from your terminal</strong>
              <p>Use the CLI in the project you are already working in.</p>
            </div>
          </header>
          <div className="dd-agent-provider-list">
            {providers.map((item) => (
              <span key={item.id} className={item.available ? 'is-ready' : ''}>
                {item.displayName} · {item.available ? 'ready' : 'not installed'}
              </span>
            ))}
          </div>
          <div className="dd-agent-guide__tabs" role="tablist" aria-label="Operating system">
            {AGENT_GUIDES.map((guide) => (
              <button
                key={guide.id}
                id={`agent-guide-tab-${guide.id}`}
                type="button"
                role="tab"
                aria-selected={activeGuideId === guide.id}
                aria-controls="agent-guide-panel"
                onClick={() => setActiveGuideId(guide.id)}
              >
                {guide.label}
              </button>
            ))}
          </div>
          <div
            id="agent-guide-panel"
            className="dd-agent-guide__panel"
            role="tabpanel"
            aria-labelledby={`agent-guide-tab-${activeGuide.id}`}
          >
            <div className="dd-agent-command-list">
              <p className="dd-agent-command-list__shell">Run in {activeGuide.shell}</p>
              {activeGuide.commands.map((item) => (
                <div key={item.command}>
                  <small>{item.label}</small>
                  <code>{item.command}</code>
                  <button
                    type="button"
                    onClick={() => void copyCommand(item.command)}
                    title="Copy command"
                  >
                    {copiedCommand === item.command ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              ))}
            </div>
            <p className="dd-agent-guide__hint">{activeGuide.hint}</p>
          </div>
        </aside>

        <div className="dd-agent-projects" aria-live="polite">
          {projectGroups.length === 0 && (
            <div className="dd-card dd-agent-empty">
              <TerminalSquare size={22} />
              <strong>No managed agents yet</strong>
              <p>Choose your operating system and copy a command from the guide.</p>
            </div>
          )}
          {projectGroups.map((group) => (
            <section key={group.cwd} className="dd-agent-project">
              <header>
                <FolderKanban size={15} />
                <span className="dd-agent-project__identity">
                  <strong>{group.name}</strong>
                  <code title={group.cwd}>{group.cwd}</code>
                </span>
                <small>
                  {group.agents.length} agent{group.agents.length === 1 ? '' : 's'}
                </small>
                <span className="dd-agent-project__actions">
                  <button
                    type="button"
                    aria-label="Restart group"
                    title="Restart latest agent for each provider"
                    disabled={busyGroup === group.cwd}
                    onClick={() => void runGroupAction(group.cwd, 'restart')}
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Stop group"
                    title="Stop all active agents in this project"
                    disabled={
                      busyGroup === group.cwd ||
                      !group.agents.some((agent) => ACTIVE_STATUSES.has(agent.status))
                    }
                    onClick={() => void runGroupAction(group.cwd, 'stop')}
                  >
                    <Square size={11} />
                  </button>
                </span>
              </header>
              <div className="dd-agent-list">
                {group.agents.map((agent) => {
                  const active = ACTIVE_STATUSES.has(agent.status);
                  return (
                    <article
                      key={agent.id}
                      className={`dd-card dd-agent-row${agent.attention !== 'none' ? ' needs-attention' : ''}`}
                    >
                      <div
                        className="dd-agent-row__main"
                        role="button"
                        tabIndex={agent.terminalAvailable ? 0 : -1}
                        aria-disabled={!agent.terminalAvailable}
                        onClick={() => agent.terminalAvailable && openTerminal(agent)}
                        onKeyDown={(event) => {
                          if (
                            agent.terminalAvailable &&
                            (event.key === 'Enter' || event.key === ' ')
                          ) {
                            openTerminal(agent);
                          }
                        }}
                      >
                        <span className={`dd-agent-status is-${agent.status}`} aria-hidden="true" />
                        <span>
                          {editingId === agent.id ? (
                            <span
                              className="dd-agent-row__rename"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <input
                                value={editingName}
                                maxLength={80}
                                autoFocus
                                onChange={(event) => setEditingName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') void renameAgent(agent);
                                  if (event.key === 'Escape') setEditingId(null);
                                }}
                              />
                              <button
                                type="button"
                                title="Save name"
                                onClick={() => void renameAgent(agent)}
                              >
                                <Save size={12} />
                              </button>
                              <button
                                type="button"
                                title="Cancel"
                                onClick={() => setEditingId(null)}
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ) : (
                            <strong>{agent.displayName}</strong>
                          )}
                          <small>
                            {agent.provider} · {agent.status}
                          </small>
                          {agent.task && <p>{agent.task}</p>}
                          {agent.error && <em>{agent.error}</em>}
                        </span>
                      </div>
                      <div className="dd-agent-row__actions">
                        <button
                          type="button"
                          title="Rename agent and terminal tab"
                          disabled={busyId === agent.id}
                          onClick={() => {
                            setEditingId(agent.id);
                            setEditingName(agent.displayName);
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          title="Open terminal"
                          disabled={!agent.terminalAvailable}
                          onClick={() => openTerminal(agent)}
                        >
                          <TerminalSquare size={14} />
                        </button>
                        <button
                          type="button"
                          title="Restart agent"
                          disabled={busyId === agent.id}
                          onClick={() => void runAction(agent.id, 'restart')}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          type="button"
                          title="Stop agent"
                          disabled={!active || busyId === agent.id}
                          onClick={() => void runAction(agent.id, 'stop')}
                        >
                          <Square size={13} />
                        </button>
                        <button
                          type="button"
                          title={active ? 'Stop and remove agent' : 'Remove from history'}
                          disabled={busyId === agent.id}
                          onClick={() => void removeAgent(agent.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
