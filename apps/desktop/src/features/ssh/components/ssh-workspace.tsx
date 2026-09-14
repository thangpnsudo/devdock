import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  BookPlus,
  Clipboard,
  Copy,
  Files,
  GripVertical,
  Grid2X2,
  History,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Server,
  PanelsTopLeft,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import type { LibraryItemDto, SshHostDto, UpdateSshHostRequest } from '@devdock/types';

import {
  useClipboardHistory,
  useMarkClipboardSaved,
  useRecordClipboardCapture,
} from '../../clipboard/hooks/use-clipboard';
import { clipboardIpc } from '../../clipboard/ipc/clipboard';
import { useCreateScript, useRecentLibraryItems } from '../../library/hooks/use-library';
import { ScriptForm } from '../../library/components/script-form';
import { useToast } from '../../shell/components/toast';
import { useConfirm } from '../../shell/components/confirm-dialog';
import { agentsIpc } from '../../agents/ipc/agents';
import { sshIpc } from '../ipc/ssh';
import { HostForm } from './host-form';
import { HostList } from './host-list';
import { TerminalView } from './terminal-view';
import { SftpWorkspace } from './sftp-workspace';
import {
  useConnectSsh,
  useCreateSshHost,
  useDeleteSshHost,
  useDisconnectSsh,
  useRecentSshHosts,
  useSshHosts,
  useUpdateSshHost,
} from '../hooks/use-ssh';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface TerminalTab {
  id: string;
  label: string;
  kind: 'local' | 'ssh';
  agentId?: string;
  agentStatus?: ElectronAgentStatus;
  agentAttention?: ElectronAgentSnapshot['attention'];
}

export function updateAgentTerminalTabs(
  current: TerminalTab[],
  agent: ElectronAgentSnapshot,
): TerminalTab[] {
  if (!current.some((tab) => tab.id === agent.terminalSessionId)) return current;
  return current.map((tab) =>
    tab.id === agent.terminalSessionId
      ? {
          ...tab,
          label: agent.displayName,
          agentId: agent.id,
          agentStatus: agent.status,
          agentAttention: agent.attention,
        }
      : tab,
  );
}

interface TerminalGroup {
  id: string;
  name: string;
  sessionIds: string[];
  broadcast: boolean;
  paneWeights: Record<string, number>;
  rowWeights: number[];
  layoutRows: string[][];
}

interface CommandHistoryEntry {
  id: string;
  sessionId: string;
  terminalLabel: string;
  command: string;
  ranAt: number;
}

type UtilityTab = 'scripts' | 'clipboard' | 'history';
type ConnectionsTab = 'hosts' | 'groups';
export type TerminalDropZone = 'top' | 'right' | 'bottom' | 'left';

const UTILITY_PANEL_STORAGE_KEY = 'devdock:ssh-utility-width';
const UTILITY_PANEL_MIN_WIDTH = 326;
const UTILITY_PANEL_MAX_WIDTH = 640;
const UTILITY_PANEL_DEFAULT_WIDTH = 326;

export function clampUtilityPanelWidth(width: number, max = UTILITY_PANEL_MAX_WIDTH): number {
  return Math.round(Math.max(UTILITY_PANEL_MIN_WIDTH, Math.min(max, width)));
}

export function terminalDropZone(
  pointer: { x: number; y: number },
  bounds: { left: number; top: number; width: number; height: number },
): TerminalDropZone {
  const x = Math.max(0, Math.min(1, (pointer.x - bounds.left) / Math.max(bounds.width, 1)));
  const y = Math.max(0, Math.min(1, (pointer.y - bounds.top) / Math.max(bounds.height, 1)));
  const horizontalDistance = Math.abs(x - 0.5);
  const verticalDistance = Math.abs(y - 0.5);
  if (verticalDistance >= horizontalDistance) return y < 0.5 ? 'top' : 'bottom';
  return x < 0.5 ? 'left' : 'right';
}

export function moveTerminalLayout(
  rows: readonly (readonly string[])[],
  sourceSessionId: string,
  targetSessionId: string,
  zone: TerminalDropZone,
): string[][] {
  if (!sourceSessionId || sourceSessionId === targetSessionId) {
    return rows.map((row) => [...row]);
  }
  const next = rows
    .map((row) => row.filter((sessionId) => sessionId !== sourceSessionId))
    .filter((row) => row.length > 0);
  const targetRowIndex = next.findIndex((row) => row.includes(targetSessionId));
  if (targetRowIndex < 0) return next;
  if (zone === 'top' || zone === 'bottom') {
    next.splice(targetRowIndex + (zone === 'bottom' ? 1 : 0), 0, [sourceSessionId]);
    return next;
  }
  const targetIndex = next[targetRowIndex]!.indexOf(targetSessionId);
  next[targetRowIndex]!.splice(targetIndex + (zone === 'right' ? 1 : 0), 0, sourceSessionId);
  return next;
}

export function appendSessionsToLayout(
  rows: readonly (readonly string[])[],
  sessionIds: readonly string[],
): string[][] {
  const next = rows.map((row) => [...row]);
  const placed = new Set(next.flat());
  const incoming = [...new Set(sessionIds)].filter((sessionId) => !placed.has(sessionId));
  if (incoming.length === 0) return next;
  if (next.length === 0) return [incoming];
  next[next.length - 1]!.push(...incoming);
  return next;
}

function arrangeTerminalRows(items: TerminalTab[]): TerminalTab[][] {
  if (items.length <= 3) return [items];
  const rows: TerminalTab[][] = [];
  for (let index = 0; index < items.length; index += 3) rows.push(items.slice(index, index + 3));
  if (rows.length > 1 && rows.at(-1)?.length === 1) {
    const previous = rows.at(-2);
    const last = rows.at(-1);
    if (previous && last) last.unshift(previous.pop() as TerminalTab);
  }
  return rows;
}

function terminalRows(group: TerminalGroup, items: TerminalTab[]): TerminalTab[][] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows = group.layoutRows
    .map((row) =>
      row.map((id) => byId.get(id)).filter((item): item is TerminalTab => Boolean(item)),
    )
    .filter((row) => row.length > 0);
  if (rows.length === 0) return arrangeTerminalRows(items);
  const placed = new Set(rows.flat().map((item) => item.id));
  const missing = items.filter((item) => !placed.has(item.id));
  if (missing.length > 0) {
    rows[0]!.push(...missing);
  }
  return rows;
}

export function SshWorkspace(): JSX.Element {
  const hosts = useSshHosts();
  const recent = useRecentSshHosts();
  const scripts = useRecentLibraryItems(100);
  const clipboard = useClipboardHistory(60);
  const createScript = useCreateScript();
  const recordClipboard = useRecordClipboardCapture();
  const markClipboardSaved = useMarkClipboardSaved();
  const createHostMutation = useCreateSshHost();
  const updateHostMutation = useUpdateSshHost();
  const removeHost = useDeleteSshHost();
  const connect = useConnectSsh();
  const disconnect = useDisconnectSsh();
  const toast = useToast();
  const confirm = useConfirm();

  const [createHostOpen, setCreateHostOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<SshHostDto | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connectionsTab, setConnectionsTab] = useState<ConnectionsTab>('hosts');
  const [hostView, setHostView] = useState<'row' | 'grid'>('row');
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groups, setGroups] = useState<TerminalGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [paneDrop, setPaneDrop] = useState<{
    groupId: string;
    targetSessionId: string;
    zone: TerminalDropZone;
  } | null>(null);
  const draggedSessionIdRef = useRef<string | null>(null);
  const [utilityOpen, setUtilityOpen] = useState(true);
  const [utilityWidth, setUtilityWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(UTILITY_PANEL_STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) return clampUtilityPanelWidth(saved);
    } catch {
      // Fall back to a responsive default when storage is unavailable.
    }
    return UTILITY_PANEL_DEFAULT_WIDTH;
  });
  const utilityWidthRef = useRef(utilityWidth);
  const [utilityTab, setUtilityTab] = useState<UtilityTab>('scripts');
  const [scriptFormOpen, setScriptFormOpen] = useState(false);
  const [clipboardFormOpen, setClipboardFormOpen] = useState(false);
  const [clipboardInput, setClipboardInput] = useState('');
  const [filter, setFilter] = useState('');
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingTabValue, setRenamingTabValue] = useState('');
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'terminal' | 'sftp'>('terminal');
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('devdock:command-history');
      return saved ? (JSON.parse(saved) as CommandHistoryEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void sshIpc
      .listTerminalSessions()
      .then((sessions) => {
        if (cancelled || sessions.length === 0) return;
        const activeIds = new Set(sessions.map((session) => session.id));
        setTabs((current) => {
          const labels = new Map(current.map((tab) => [tab.id, tab.label]));
          return sessions.map((session) => ({
            id: session.id,
            kind: session.kind,
            label:
              labels.get(session.id) ??
              (session.purpose === 'agent'
                ? (session.label ?? 'Agent terminal')
                : session.kind === 'ssh'
                  ? `${session.username ?? 'ssh'}@${session.host ?? 'host'}`
                  : 'Local shell'),
          }));
        });
        setGroups((current) =>
          current
            .map((group) => ({
              ...group,
              sessionIds: group.sessionIds.filter((id) => activeIds.has(id)),
              layoutRows: group.layoutRows
                .map((row) => row.filter((id) => activeIds.has(id)))
                .filter((row) => row.length > 0),
            }))
            .filter((group) => group.sessionIds.length > 1),
        );
        setActiveSession((current) =>
          current && activeIds.has(current) ? current : sessions[0]!.id,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncAgent = (agent: ElectronAgentSnapshot): void => {
      setTabs((current) => {
        const existing = current.find((tab) => tab.id === agent.terminalSessionId);
        if (existing) {
          return updateAgentTerminalTabs(current, agent);
        }
        if (!agent.terminalAvailable) return current;
        void sshIpc.listTerminalSessions().then((sessions) => {
          if (cancelled || !sessions.some((session) => session.id === agent.terminalSessionId))
            return;
          setTabs((latest) =>
            latest.some((tab) => tab.id === agent.terminalSessionId)
              ? latest
              : [
                  ...latest,
                  {
                    id: agent.terminalSessionId,
                    label: agent.displayName,
                    kind: 'local',
                    agentId: agent.id,
                    agentStatus: agent.status,
                    agentAttention: agent.attention,
                  },
                ],
          );
        });
        return current;
      });
    };
    void agentsIpc.list().then((items) => {
      if (!cancelled) items.forEach(syncAgent);
    });
    const unsubscribe = agentsIpc.onChanged(syncAgent);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const activateTerminal = (event: Event): void => {
      const { sessionId } = (event as CustomEvent<{ sessionId?: string }>).detail ?? {};
      if (!sessionId) return;
      const activate = (): void => {
        const group = groups.find((item) => item.sessionIds.includes(sessionId));
        setWorkspaceMode('terminal');
        setActiveSession(sessionId);
        setActiveGroupId(group?.id ?? null);
        requestAnimationFrame(() =>
          window.dispatchEvent(
            new CustomEvent('devdock:terminal-focus', {
              detail: { sessionId },
            }),
          ),
        );
      };
      if (tabs.some((tab) => tab.id === sessionId)) {
        activate();
        return;
      }
      void sshIpc
        .listTerminalSessions()
        .then((sessions) => {
          const session = sessions.find((item) => item.id === sessionId);
          if (!session) return;
          setTabs((current) =>
            current.some((tab) => tab.id === sessionId)
              ? current
              : [
                  ...current,
                  {
                    id: session.id,
                    kind: session.kind,
                    label:
                      session.kind === 'ssh'
                        ? `${session.username ?? 'ssh'}@${session.host ?? 'host'}`
                        : (session.label ?? 'Agent terminal'),
                  },
                ],
          );
          activate();
        })
        .catch(() => undefined);
    };
    window.addEventListener('devdock:terminal-activate', activateTerminal);
    return () => window.removeEventListener('devdock:terminal-activate', activateTerminal);
  }, [groups, tabs]);

  useEffect(() => {
    const terminalExited = (event: Event): void => {
      const { sessionId } = (event as CustomEvent<{ sessionId?: string; expected?: boolean }>)
        .detail;
      if (!sessionId) return;
      setTabs((current) => current.filter((tab) => tab.id !== sessionId));
      setGroups((current) =>
        current
          .map((group) => ({
            ...group,
            sessionIds: group.sessionIds.filter((id) => id !== sessionId),
            layoutRows: group.layoutRows
              .map((row) => row.filter((id) => id !== sessionId))
              .filter((row) => row.length > 0),
          }))
          .filter((group) => group.sessionIds.length > 1),
      );
      setActiveSession((current) => {
        if (current !== sessionId) return current;
        const remaining = tabs.filter((tab) => tab.id !== sessionId);
        return remaining.at(-1)?.id ?? null;
      });
    };
    window.addEventListener('devdock:terminal-exited', terminalExited);
    return () => window.removeEventListener('devdock:terminal-exited', terminalExited);
  }, [tabs]);

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;

  const saveTabName = async (tab: TerminalTab): Promise<void> => {
    const nextName = renamingTabValue.trim();
    setRenamingTabId(null);
    if (!nextName || nextName === tab.label) return;
    try {
      if (tab.agentId) await agentsIpc.rename(tab.agentId, nextName);
      setTabs((current) =>
        current.map((item) => (item.id === tab.id ? { ...item, label: nextName } : item)),
      );
    } catch (error) {
      toast.push(`Could not rename terminal: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const hostItems = hosts.data ?? [];
  const recentIds = (recent.data?.hosts ?? []).map((host) => host.id);
  const scriptItems = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return (scripts.data ?? []).filter((item) => {
      if (item.body?.type !== 'script') return false;
      return (
        !query ||
        item.title.toLocaleLowerCase().includes(query) ||
        item.body.content.toLocaleLowerCase().includes(query)
      );
    });
  }, [filter, scripts.data]);
  const clipboardItems = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return (clipboard.data ?? []).filter(
      (item) =>
        !query ||
        item.content.toLocaleLowerCase().includes(query) ||
        item.contentType.toLocaleLowerCase().includes(query),
    );
  }, [clipboard.data, filter]);
  const commandHistoryItems = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return commandHistory.filter(
      (item) =>
        !query ||
        item.command.toLocaleLowerCase().includes(query) ||
        item.terminalLabel.toLocaleLowerCase().includes(query),
    );
  }, [commandHistory, filter]);
  const activeGroupTabs = activeGroup
    ? activeGroup.sessionIds
        .map((sessionId) => tabs.find((tab) => tab.id === sessionId))
        .filter((tab): tab is TerminalTab => tab !== undefined)
    : [];
  const activeGroupRows = activeGroup ? terminalRows(activeGroup, activeGroupTabs) : [];
  const activeGroupRowWeights = activeGroupRows.map(
    (_, index) => activeGroup?.rowWeights[index] ?? 1,
  );
  const groupedSessionIds = new Set(groups.flatMap((group) => group.sessionIds));
  const standaloneTabs = tabs.filter((tab) => !groupedSessionIds.has(tab.id));

  useEffect(() => {
    localStorage.setItem('devdock:command-history', JSON.stringify(commandHistory.slice(0, 300)));
  }, [commandHistory]);

  const recordCommand = (sessionId: string, command: string): void => {
    const normalized = command.trim();
    if (!normalized) return;
    const terminalLabel = tabs.find((tab) => tab.id === sessionId)?.label ?? 'Terminal';
    setCommandHistory((current) =>
      [
        {
          id: crypto.randomUUID(),
          sessionId,
          terminalLabel,
          command: normalized,
          ranAt: Date.now(),
        },
        ...current,
      ].slice(0, 300),
    );
  };

  const connectHost = async (id: string, remoteCwd?: string): Promise<void> => {
    try {
      const host = hostItems.find((item) => item.id === id);
      if (!host) throw new Error('SSH host was not found');
      const result = window.devdockTerminal
        ? await sshIpc.connectHost(host, remoteCwd)
        : await connect.mutateAsync({ id });
      const tab: TerminalTab = {
        id: result.sessionId,
        label: `${host.username}@${host.host}`,
        kind: 'ssh',
      };
      setTabs((current) => [...current, tab]);
      setActiveSession(tab.id);
      setActiveGroupId(null);
      setWorkspaceMode('terminal');
    } catch (error) {
      toast.push(`Connect failed: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const startLocalTerminal = async (cwd?: string): Promise<void> => {
    try {
      const result = await sshIpc.startLocalTerminal(cwd);
      const index = tabs.filter((tab) => tab.kind === 'local').length + 1;
      const tab: TerminalTab = {
        id: result.sessionId,
        label: index === 1 ? 'Local terminal' : `Local terminal (${index})`,
        kind: 'local',
      };
      setTabs((current) => [...current, tab]);
      setActiveSession(tab.id);
      setActiveGroupId(null);
      setWorkspaceMode('terminal');
    } catch (error) {
      toast.push(`Could not start local terminal: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const closeTab = (id: string): void => {
    const remaining = tabs.filter((tab) => tab.id !== id);
    const containingGroup = groups.find((group) => group.sessionIds.includes(id));
    const remainingGroupSessionIds =
      containingGroup?.sessionIds.filter((sessionId) => sessionId !== id) ?? [];
    setTabs(remaining);
    setGroups((current) =>
      current
        .map((group) => ({
          ...group,
          sessionIds: group.sessionIds.filter((sessionId) => sessionId !== id),
          layoutRows: group.layoutRows
            .map((row) => row.filter((sessionId) => sessionId !== id))
            .filter((row) => row.length > 0),
        }))
        .filter((group) => group.sessionIds.length > 1),
    );
    if (
      containingGroup &&
      remainingGroupSessionIds.length <= 1 &&
      activeGroupId === containingGroup.id
    ) {
      setActiveGroupId(null);
    }
    if (activeSession === id) {
      setActiveSession(remainingGroupSessionIds[0] ?? remaining.at(-1)?.id ?? null);
    }
    void disconnect.mutateAsync(id).catch(() => undefined);
  };

  const recoverFailedTerminal = async (id: string): Promise<void> => {
    const failedTab = tabs.find((tab) => tab.id === id);
    if (failedTab?.kind !== 'ssh') return;
    const localTab = tabs.find(
      (tab) => tab.kind === 'local' && !groups.some((group) => group.sessionIds.includes(tab.id)),
    );
    closeTab(id);
    if (localTab) {
      setActiveGroupId(null);
      setActiveSession(localTab.id);
      setWorkspaceMode('terminal');
      toast.push('Expired SSH session closed. Switched to Local terminal.', { variant: 'info' });
      return;
    }
    await startLocalTerminal();
    toast.push('Expired SSH session closed. Local terminal opened.', { variant: 'info' });
  };

  const dissolveGroup = (group: TerminalGroup): void => {
    setGroups((current) => current.filter((item) => item.id !== group.id));
    if (activeGroupId === group.id) {
      setActiveGroupId(null);
      setActiveSession(group.sessionIds[0] ?? null);
    }
  };

  const createHost = async (request: unknown): Promise<void> => {
    try {
      await createHostMutation.mutateAsync(
        request as Parameters<typeof createHostMutation.mutateAsync>[0],
      );
      setCreateHostOpen(false);
      toast.push('Host saved', { variant: 'success' });
    } catch (error) {
      toast.push(`Could not save host: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const updateHost = async (request: unknown): Promise<void> => {
    try {
      await updateHostMutation.mutateAsync(request as UpdateSshHostRequest);
      setEditingHost(null);
      toast.push('Host updated', { variant: 'success' });
    } catch (error) {
      toast.push(`Could not update host: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const createGroup = (): void => {
    const name = groupName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setGroups((current) => [
      ...current,
      {
        id,
        name,
        sessionIds: [],
        broadcast: false,
        paneWeights: {},
        rowWeights: [1, 1],
        layoutRows: [],
      },
    ]);
    setGroupName('');
    setGroupFormOpen(false);
    setActiveGroupId(id);
  };

  const addSessionToGroup = (groupId: string, sessionId: string): void => {
    if (!tabs.some((tab) => tab.id === sessionId)) return;
    setGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId || group.sessionIds.includes(sessionId)) return group;
        const layoutRows = appendSessionsToLayout(group.layoutRows, [sessionId]);
        return {
          ...group,
          sessionIds: [...group.sessionIds, sessionId],
          layoutRows,
          rowWeights: layoutRows.map((_, index) => group.rowWeights[index] ?? 1),
        };
      }),
    );
    setActiveGroupId(groupId);
    setActiveSession(sessionId);
  };

  const groupSessions = (sourceSessionId: string, targetSessionId: string): void => {
    if (!sourceSessionId || sourceSessionId === targetSessionId) return;
    const sourceGroup = groups.find((group) => group.sessionIds.includes(sourceSessionId));
    const targetGroup = groups.find((group) => group.sessionIds.includes(targetSessionId));
    if (sourceGroup?.id === targetGroup?.id && sourceGroup) {
      setActiveGroupId(sourceGroup.id);
      return;
    }
    const id = targetGroup?.id ?? sourceGroup?.id ?? crypto.randomUUID();
    const existing = targetGroup ?? sourceGroup;
    const sessionIds = [
      ...new Set([
        ...(targetGroup?.sessionIds ?? [targetSessionId]),
        ...(sourceGroup?.sessionIds ?? [sourceSessionId]),
        targetSessionId,
        sourceSessionId,
      ]),
    ];
    const existingRows = existing
      ? existing.layoutRows.length > 0
        ? existing.layoutRows
        : [existing.sessionIds]
      : [];
    const layoutRows = appendSessionsToLayout(existingRows, sessionIds);
    const merged: TerminalGroup = {
      id,
      name: existing?.name ?? `Workspace ${groups.length + 1}`,
      sessionIds,
      broadcast: false,
      paneWeights: {
        ...(sourceGroup?.paneWeights ?? {}),
        ...(targetGroup?.paneWeights ?? {}),
      },
      rowWeights: layoutRows.map((_, index) => existing?.rowWeights[index] ?? 1),
      layoutRows,
    };
    setGroups((current) => [
      ...current.filter((group) => group.id !== sourceGroup?.id && group.id !== targetGroup?.id),
      merged,
    ]);
    setActiveGroupId(id);
    setActiveSession(targetSessionId);
  };

  const dropSessionOnPane = (
    groupId: string,
    sourceSessionId: string,
    targetSessionId: string,
    zone: TerminalDropZone,
  ): void => {
    if (!sourceSessionId || sourceSessionId === targetSessionId) return;
    setGroups((current) => {
      const targetGroup = current.find((group) => group.id === groupId);
      if (!targetGroup) return current;
      const sourceGroup = current.find((group) => group.sessionIds.includes(sourceSessionId));
      const targetRows = terminalRows(
        targetGroup,
        targetGroup.sessionIds
          .map((id) => tabs.find((tab) => tab.id === id))
          .filter((tab): tab is TerminalTab => Boolean(tab)),
      ).map((row) => row.map((tab) => tab.id));
      const layoutRows = moveTerminalLayout(targetRows, sourceSessionId, targetSessionId, zone);
      const next = current.map((group) => {
        if (group.id === groupId) {
          return {
            ...group,
            sessionIds: [...new Set([...group.sessionIds, sourceSessionId])],
            layoutRows,
            rowWeights: layoutRows.map((_, index) => group.rowWeights[index] ?? 1),
          };
        }
        if (group.id !== sourceGroup?.id) return group;
        return {
          ...group,
          sessionIds: group.sessionIds.filter((id) => id !== sourceSessionId),
          layoutRows: group.layoutRows
            .map((row) => row.filter((id) => id !== sourceSessionId))
            .filter((row) => row.length > 0),
        };
      });
      return next.filter((group) => group.id === groupId || group.sessionIds.length > 1);
    });
    setPaneDrop(null);
    setActiveGroupId(groupId);
    setActiveSession(sourceSessionId);
  };

  const beginPaneResize = (
    group: TerminalGroup,
    leftSessionId: string,
    rightSessionId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    const row = event.currentTarget.parentElement;
    if (!row) return;
    const startX = event.clientX;
    const width = row.getBoundingClientRect().width;
    const leftStart = group.paneWeights[leftSessionId] ?? 1;
    const rightStart = group.paneWeights[rightSessionId] ?? 1;
    const rowSessionIds = [...row.querySelectorAll<HTMLElement>('[data-session-id]')]
      .map((element) => element.dataset.sessionId)
      .filter((id): id is string => Boolean(id));
    const totalWeight = rowSessionIds.reduce(
      (total, id) => total + (group.paneWeights[id] ?? 1),
      0,
    );
    const onMove = (moveEvent: PointerEvent): void => {
      const delta = ((moveEvent.clientX - startX) / Math.max(width, 1)) * totalWeight;
      const nextLeft = Math.max(0.35, leftStart + delta);
      const nextRight = Math.max(0.35, rightStart - delta);
      setGroups((current) =>
        current.map((item) =>
          item.id === group.id
            ? {
                ...item,
                paneWeights: {
                  ...item.paneWeights,
                  [leftSessionId]: nextLeft,
                  [rightSessionId]: nextRight,
                },
              }
            : item,
        ),
      );
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginRowResize = (
    group: TerminalGroup,
    rowIndex: number,
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    const layout = event.currentTarget.parentElement;
    if (!layout) return;
    const startY = event.clientY;
    const height = layout.getBoundingClientRect().height;
    const rows = activeGroupRows;
    const weights = rows.map((_, index) => group.rowWeights[index] ?? 1);
    const beforeStart = weights[rowIndex] ?? 1;
    const afterStart = weights[rowIndex + 1] ?? 1;
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const onMove = (moveEvent: PointerEvent): void => {
      const delta = ((moveEvent.clientY - startY) / Math.max(height, 1)) * totalWeight;
      const next = [...weights];
      next[rowIndex] = Math.max(0.35, beforeStart + delta);
      next[rowIndex + 1] = Math.max(0.35, afterStart - delta);
      setGroups((current) =>
        current.map((item) => (item.id === group.id ? { ...item, rowWeights: next } : item)),
      );
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const saveUtilityWidth = (width: number): void => {
    utilityWidthRef.current = width;
    setUtilityWidth(width);
    try {
      localStorage.setItem(UTILITY_PANEL_STORAGE_KEY, String(width));
    } catch {
      // Resizing should still work when persistent storage is unavailable.
    }
  };

  const utilityResizeMax = (canvasWidth: number): number =>
    Math.max(
      UTILITY_PANEL_MIN_WIDTH,
      Math.min(UTILITY_PANEL_MAX_WIDTH, canvasWidth - (connectionsOpen ? 270 : 0) - 280),
    );

  const beginUtilityResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const canvas = event.currentTarget.closest('.dd-terminal-workspace__canvas');
    if (!(canvas instanceof HTMLElement)) return;
    const startX = event.clientX;
    const startWidth = utilityWidthRef.current;
    const maxWidth = utilityResizeMax(canvas.getBoundingClientRect().width);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: PointerEvent): void => {
      const nextWidth = clampUtilityPanelWidth(startWidth + startX - moveEvent.clientX, maxWidth);
      utilityWidthRef.current = nextWidth;
      setUtilityWidth(nextWidth);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveUtilityWidth(utilityWidthRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resizeUtilityWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    let nextWidth = utilityWidthRef.current;
    if (event.key === 'ArrowLeft') nextWidth += 16;
    else if (event.key === 'ArrowRight') nextWidth -= 16;
    else if (event.key === 'Home') nextWidth = UTILITY_PANEL_MIN_WIDTH;
    else if (event.key === 'End') nextWidth = UTILITY_PANEL_MAX_WIDTH;
    else return;
    event.preventDefault();
    saveUtilityWidth(clampUtilityPanelWidth(nextWidth));
  };

  const toggleBroadcast = async (group: TerminalGroup): Promise<void> => {
    if (!group.broadcast) {
      const confirmed = await confirm({
        title: `Enable Broadcast for “${group.name}”?`,
        description: `Every keystroke will be sent to all ${group.sessionIds.length} terminals.`,
        confirmLabel: 'Enable Broadcast',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    setGroups((current) =>
      current.map((item) =>
        item.id === group.id ? { ...item, broadcast: !item.broadcast } : item,
      ),
    );
  };

  const sendToTerminal = async (
    content: string,
    execute: boolean,
    successMessage: string,
  ): Promise<void> => {
    if (!activeSession) {
      toast.push('Open a terminal first.', { variant: 'info' });
      return;
    }
    try {
      const targetIds =
        activeGroup?.broadcast && activeGroup.sessionIds.includes(activeSession)
          ? activeGroup.sessionIds
          : [activeSession];
      await Promise.all(
        targetIds.map((sessionId) =>
          sshIpc.exec({
            sessionId,
            data: execute ? `${content.replace(/\n*$/u, '')}\n` : content,
          }),
        ),
      );
      if (execute) {
        content
          .split(/\r?\n/u)
          .filter(Boolean)
          .forEach((command) => {
            recordCommand(activeSession, command);
          });
      }
      window.dispatchEvent(
        new CustomEvent('devdock:terminal-focus', {
          detail: { sessionId: activeSession },
        }),
      );
      toast.push(successMessage, { variant: 'success', durationMs: 1800 });
    } catch (error) {
      toast.push(`Could not send to terminal: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const runScript = (item: LibraryItemDto): void => {
    if (item.body?.type !== 'script') return;
    void sendToTerminal(item.body.content, true, `Ran “${item.title}”`);
  };

  const copyUtilityContent = async (content: string, clipboardId?: string): Promise<void> => {
    try {
      if (clipboardId) {
        await clipboardIpc.copyStored(clipboardId);
      } else if (window.devdockClipboard) {
        await window.devdockClipboard.copyText(content);
      } else {
        await navigator.clipboard.writeText(content);
      }
      toast.push('Copied to system clipboard', { variant: 'success', durationMs: 1800 });
    } catch (error) {
      toast.push(`Copy failed: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const pasteClipboardContent = (content: string, isImage: boolean): void => {
    if (isImage) {
      toast.push('Images cannot be pasted as terminal input.', { variant: 'info' });
      return;
    }
    void sendToTerminal(content, false, 'Pasted into terminal');
  };

  const saveUtilityScript = async (
    content: string,
    fallbackTitle: string,
    source: 'Clipboard' | 'Terminal history',
    clipboardId?: string,
  ): Promise<void> => {
    const firstLine = content.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, ' ') ?? '';
    const title = firstLine.slice(0, 72) || fallbackTitle;
    try {
      const script = await createScript.mutateAsync({
        title,
        content,
        shell: 'bash',
        description: `Saved from ${source}`,
      });
      if (clipboardId)
        await markClipboardSaved.mutateAsync({ id: clipboardId, scriptId: script.id });
      toast.push('Saved to Script Library', { variant: 'success' });
    } catch (error) {
      toast.push(`Save to Library failed: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  const saveClipboard = async (): Promise<void> => {
    if (!clipboardInput.trim()) return;
    try {
      await recordClipboard.mutateAsync({ content: clipboardInput });
      setClipboardInput('');
      setClipboardFormOpen(false);
      toast.push('Clipboard item saved', { variant: 'success' });
    } catch (error) {
      toast.push(`Could not save clipboard item: ${errorMessage(error)}`, { variant: 'error' });
    }
  };

  return (
    <div
      className={`dd-terminal-workspace${utilityOpen ? '' : ' dd-terminal-workspace--utility-closed'}${connectionsOpen ? '' : ' dd-terminal-workspace--connections-closed'}`}
      style={{ '--dd-utility-width': `${utilityWidth}px` } as CSSProperties}
    >
      <header className="dd-terminal-workspace__topbar">
        <button
          type="button"
          className={`dd-workspace-tool${connectionsOpen ? ' is-active' : ''}`}
          onClick={() => setConnectionsOpen((open) => !open)}
          aria-label="Connections"
          title="Connections"
        >
          {connectionsOpen ? <Server size={15} /> : <PanelLeftOpen size={15} />}
          <span>Connections</span>
        </button>
        <div className="dd-workspace-mode">
          <button
            type="button"
            className={workspaceMode === 'sftp' ? 'is-active' : ''}
            onClick={() => setWorkspaceMode('sftp')}
          >
            <PanelsTopLeft size={14} /> SFTP
          </button>
          <button
            type="button"
            className={workspaceMode === 'terminal' ? 'is-active' : ''}
            onClick={() => setWorkspaceMode('terminal')}
          >
            <TerminalSquare size={14} /> Terminal
          </button>
        </div>

        <div className="dd-terminal-tabs" role="tablist" aria-label="Terminal workspaces">
          {groups
            .filter((group) => group.sessionIds.length > 0)
            .map((group) => (
              <div
                key={group.id}
                className={`dd-terminal-tab dd-terminal-tab--workspace${group.id === activeGroupId ? ' is-active' : ''}${group.sessionIds.some((sessionId) => tabs.find((tab) => tab.id === sessionId)?.agentAttention === 'needs-input') ? ' needs-input' : ''}`}
                data-workspace-id={group.id}
                draggable
                onDragStart={(event) => {
                  const sessionId = group.sessionIds[0];
                  if (!sessionId) return;
                  draggedSessionIdRef.current = sessionId;
                  event.dataTransfer.setData('application/x-devdock-session', sessionId);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  draggedSessionIdRef.current = null;
                  setPaneDrop(null);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const targetSessionId = group.sessionIds[0];
                  if (!targetSessionId) return;
                  groupSessions(
                    event.dataTransfer.getData('application/x-devdock-session'),
                    targetSessionId,
                  );
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={group.id === activeGroupId}
                  onClick={() => {
                    setWorkspaceMode('terminal');
                    setActiveGroupId(group.id);
                    setActiveSession((current) =>
                      current && group.sessionIds.includes(current)
                        ? current
                        : (group.sessionIds[0] ?? null),
                    );
                  }}
                  title={`${group.name} · ${group.sessionIds.length} terminals`}
                >
                  <Grid2X2 size={14} />
                  <span>{group.name}</span>
                  <span className="dd-terminal-tab__count">{group.sessionIds.length}</span>
                </button>
                <button
                  type="button"
                  className="dd-terminal-tab__close"
                  onClick={() => dissolveGroup(group)}
                  aria-label={`Ungroup ${group.name}`}
                  title="Ungroup workspace"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          {standaloneTabs.map((tab) => (
            <div
              key={tab.id}
              className={`dd-terminal-tab${tab.id === activeSession ? ' is-active' : ''}${tab.agentAttention === 'needs-input' ? ' needs-input' : ''}`}
              draggable
              onDragStart={(event) => {
                draggedSessionIdRef.current = tab.id;
                event.dataTransfer.setData('application/x-devdock-session', tab.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                draggedSessionIdRef.current = null;
                setPaneDrop(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                groupSessions(event.dataTransfer.getData('application/x-devdock-session'), tab.id);
              }}
            >
              {renamingTabId === tab.id ? (
                <input
                  className="dd-terminal-tab__rename"
                  value={renamingTabValue}
                  maxLength={80}
                  autoFocus
                  onChange={(event) => setRenamingTabValue(event.target.value)}
                  onBlur={() => void saveTabName(tab)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') void saveTabName(tab);
                    if (event.key === 'Escape') setRenamingTabId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeSession}
                  onClick={() => {
                    setWorkspaceMode('terminal');
                    setActiveGroupId(null);
                    setActiveSession(tab.id);
                    if (tab.agentId) void agentsIpc.markSeen(tab.agentId).catch(() => undefined);
                  }}
                  onDoubleClick={() => {
                    if (!tab.agentId) return;
                    setRenamingTabId(tab.id);
                    setRenamingTabValue(tab.label);
                  }}
                  title={`${tab.label}${tab.agentId ? ' · Double-click to rename' : ''}`}
                >
                  <span className="dd-terminal-tab__dot" />
                  <span>{tab.label}</span>
                </button>
              )}
              <button
                type="button"
                className="dd-terminal-tab__close"
                onClick={() => closeTab(tab.id)}
                aria-label={`Close ${tab.label}`}
                title="Close terminal"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="dd-terminal-tabs__add"
            onClick={() => {
              void startLocalTerminal();
            }}
            aria-label="Add local terminal"
            title="New local terminal"
          >
            <Plus size={17} />
          </button>
        </div>

        {!utilityOpen && (
          <button
            type="button"
            className="dd-workspace-tool dd-workspace-tool--icon"
            onClick={() => setUtilityOpen(true)}
            aria-label="Open utility panel"
            title="Open utility panel"
          >
            <PanelRightOpen size={17} />
          </button>
        )}
      </header>

      <main className="dd-terminal-workspace__canvas" hidden={workspaceMode === 'sftp'}>
        {connectionsOpen && (
          <aside className="dd-connections-panel">
            <header className="dd-connections-panel__tabs">
              <button
                type="button"
                className={connectionsTab === 'hosts' ? 'is-active' : ''}
                onClick={() => setConnectionsTab('hosts')}
              >
                <Server size={14} /> Hosts <span>{hostItems.length}</span>
              </button>
              <button
                type="button"
                className={connectionsTab === 'groups' ? 'is-active' : ''}
                onClick={() => setConnectionsTab('groups')}
              >
                <Files size={14} /> Groups <span>{groups.length}</span>
              </button>
              <button
                type="button"
                className="dd-connections-panel__collapse"
                onClick={() => setConnectionsOpen(false)}
                aria-label="Collapse connections"
                title="Collapse connections"
              >
                <PanelLeftClose size={15} />
              </button>
            </header>

            {connectionsTab === 'hosts' ? (
              <>
                <div className="dd-connections-panel__toolbar">
                  <button
                    type="button"
                    onClick={() => {
                      void startLocalTerminal();
                    }}
                    title="New local terminal"
                    aria-label="New local terminal"
                  >
                    <TerminalSquare size={14} />
                  </button>
                  <div className="dd-host-view-switcher">
                    <button
                      type="button"
                      className={hostView === 'row' ? 'is-active' : ''}
                      onClick={() => setHostView('row')}
                      aria-label="Row view"
                      title="Row view"
                    >
                      <List size={14} />
                    </button>
                    <button
                      type="button"
                      className={hostView === 'grid' ? 'is-active' : ''}
                      onClick={() => setHostView('grid')}
                      aria-label="Grid view"
                      title="Grid view"
                    >
                      <Grid2X2 size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingHost(null);
                      setCreateHostOpen((open) => !open);
                    }}
                    aria-label="Add host"
                    title="Add host"
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {createHostOpen && (
                  <div className="dd-connection-form">
                    <HostForm
                      mode={{ kind: 'create' }}
                      busy={createHostMutation.isPending}
                      onSubmit={createHost}
                      onCancel={() => setCreateHostOpen(false)}
                    />
                  </div>
                )}
                {editingHost && (
                  <div className="dd-connection-form">
                    <HostForm
                      key={editingHost.id}
                      mode={{
                        kind: 'edit',
                        id: editingHost.id,
                        initial: {
                          id: editingHost.id,
                          title: editingHost.title,
                          host: editingHost.host,
                          port: editingHost.port,
                          username: editingHost.username,
                          authMethod: editingHost.authMethod,
                          ...(editingHost.hasSavedPassword ? { hasSavedPassword: true } : {}),
                          ...(editingHost.description
                            ? { description: editingHost.description }
                            : {}),
                        },
                      }}
                      busy={updateHostMutation.isPending}
                      onSubmit={updateHost}
                      onCancel={() => setEditingHost(null)}
                    />
                  </div>
                )}
                <div className="dd-connections-panel__content">
                  {hosts.isError && (
                    <p className="dd-banner dd-banner--error">Failed to load SSH hosts.</p>
                  )}
                  <HostList
                    hosts={hostItems}
                    recentIds={recentIds}
                    view={hostView}
                    onConnect={(id) => {
                      void connectHost(id);
                    }}
                    onEdit={(host) => {
                      setCreateHostOpen(false);
                      setEditingHost(host);
                    }}
                    onDelete={(id) => {
                      void confirm({
                        title: 'Delete this SSH host?',
                        description:
                          'The saved connection will be removed from this device. Active sessions are not closed.',
                        confirmLabel: 'Delete host',
                      }).then((confirmed) => {
                        if (confirmed) void removeHost.mutateAsync(id);
                      });
                    }}
                    busy={connect.isPending || removeHost.isPending || updateHostMutation.isPending}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="dd-connections-panel__toolbar">
                  <span className="dd-group-hint">Drag terminal tabs into a group</span>
                  <button
                    type="button"
                    onClick={() => setGroupFormOpen((open) => !open)}
                    aria-label="Create group"
                    title="Create group"
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {groupFormOpen && (
                  <div className="dd-group-create">
                    <input
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') createGroup();
                      }}
                      placeholder="Group name"
                      autoFocus
                    />
                    <button type="button" onClick={createGroup} disabled={!groupName.trim()}>
                      Create
                    </button>
                  </div>
                )}
                <div className="dd-connections-panel__content dd-terminal-groups">
                  {groups.length === 0 && (
                    <p className="dd-utility-empty">
                      Create a group, then drag terminal tabs here.
                    </p>
                  )}
                  {groups.map((group) => (
                    <article
                      key={group.id}
                      className={`dd-terminal-group${group.id === activeGroupId ? ' is-active' : ''}${group.broadcast ? ' is-broadcasting' : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        addSessionToGroup(
                          group.id,
                          event.dataTransfer.getData('application/x-devdock-session'),
                        );
                      }}
                    >
                      <button
                        type="button"
                        className="dd-terminal-group__main"
                        onClick={() => {
                          setActiveGroupId(group.id);
                          setActiveSession(group.sessionIds[0] ?? null);
                        }}
                      >
                        <strong>{group.name}</strong>
                        <span>{group.sessionIds.length} terminals · drop tabs here</span>
                      </button>
                      <button
                        type="button"
                        className={`dd-broadcast-toggle${group.broadcast ? ' is-active' : ''}`}
                        onClick={() => toggleBroadcast(group)}
                        disabled={group.sessionIds.length < 2}
                        aria-pressed={group.broadcast}
                        title={group.broadcast ? 'Disable Broadcast' : 'Enable Broadcast'}
                      >
                        {group.broadcast ? 'LIVE' : 'Broadcast'}
                      </button>
                      <button
                        type="button"
                        className="dd-terminal-group__delete"
                        onClick={() => {
                          setGroups((current) => current.filter((item) => item.id !== group.id));
                          if (activeGroupId === group.id) setActiveGroupId(null);
                        }}
                        aria-label={`Delete group ${group.name}`}
                        title="Delete group"
                      >
                        <X size={13} />
                      </button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </aside>
        )}
        <div className="dd-terminal-workspace__terminal">
          {activeGroup && activeGroupTabs.length > 0 ? (
            <div
              className={`dd-terminal-group-grid${activeGroup.broadcast ? ' is-broadcasting' : ''}`}
            >
              <div className="dd-terminal-group-grid__status">
                <strong>{activeGroup.name}</strong>
                <span>{activeGroupTabs.length} terminals</span>
                <span className="dd-terminal-layout__hint">
                  <GripVertical size={12} /> Drag a pane header to rearrange
                </span>
                <button
                  type="button"
                  className={`dd-broadcast-toggle${activeGroup.broadcast ? ' is-active' : ''}`}
                  onClick={() => toggleBroadcast(activeGroup)}
                  disabled={activeGroupTabs.length < 2}
                  aria-pressed={activeGroup.broadcast}
                >
                  {activeGroup.broadcast ? 'Broadcast LIVE' : 'Broadcast'}
                </button>
              </div>
              <div
                className="dd-terminal-layout"
                style={{
                  gridTemplateRows: activeGroupRows
                    .map((_, index) => `${activeGroupRowWeights[index]}fr`)
                    .join(' '),
                }}
              >
                {activeGroupRows.map((row, rowIndex) => {
                  const rowWeights = row.map((tab) => activeGroup.paneWeights[tab.id] ?? 1);
                  const totalRowWeight = rowWeights.reduce((total, weight) => total + weight, 0);
                  return (
                    <Fragment key={row.map((tab) => tab.id).join(':')}>
                      <div className="dd-terminal-layout-row">
                        <div
                          className="dd-terminal-layout-row__cells"
                          style={{
                            gridTemplateColumns: rowWeights
                              .map((weight) => `${weight}fr`)
                              .join(' '),
                          }}
                        >
                          {row.map((tab) => (
                            <section
                              key={tab.id}
                              data-session-id={tab.id}
                              data-drop-label={
                                paneDrop?.targetSessionId === tab.id
                                  ? `Split ${paneDrop.zone}`
                                  : undefined
                              }
                              className={`dd-group-terminal${tab.id === activeSession ? ' is-active' : ''}${paneDrop?.groupId === activeGroup.id && paneDrop.targetSessionId === tab.id ? ` is-drop-${paneDrop.zone}` : ''}`}
                              onMouseDown={() => setActiveSession(tab.id)}
                              onDragOver={(event) => {
                                const sourceSessionId = draggedSessionIdRef.current;
                                if (!sourceSessionId || sourceSessionId === tab.id) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                const bounds = event.currentTarget.getBoundingClientRect();
                                const zone = terminalDropZone(
                                  { x: event.clientX, y: event.clientY },
                                  bounds,
                                );
                                setPaneDrop((current) =>
                                  current?.groupId === activeGroup.id &&
                                  current.targetSessionId === tab.id &&
                                  current.zone === zone
                                    ? current
                                    : { groupId: activeGroup.id, targetSessionId: tab.id, zone },
                                );
                              }}
                              onDragLeave={(event) => {
                                if (event.currentTarget.contains(event.relatedTarget as Node))
                                  return;
                                setPaneDrop((current) =>
                                  current?.targetSessionId === tab.id ? null : current,
                                );
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const sourceSessionId =
                                  draggedSessionIdRef.current ??
                                  event.dataTransfer.getData('application/x-devdock-session');
                                const zone =
                                  paneDrop?.groupId === activeGroup.id &&
                                  paneDrop.targetSessionId === tab.id
                                    ? paneDrop.zone
                                    : terminalDropZone(
                                        { x: event.clientX, y: event.clientY },
                                        event.currentTarget.getBoundingClientRect(),
                                      );
                                dropSessionOnPane(activeGroup.id, sourceSessionId, tab.id, zone);
                                draggedSessionIdRef.current = null;
                              }}
                            >
                              <header
                                draggable
                                onDragStart={(event) => {
                                  draggedSessionIdRef.current = tab.id;
                                  event.dataTransfer.setData(
                                    'application/x-devdock-session',
                                    tab.id,
                                  );
                                  event.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => {
                                  draggedSessionIdRef.current = null;
                                  setPaneDrop(null);
                                }}
                                title="Drag to split or rearrange this workspace"
                              >
                                <GripVertical
                                  className="dd-terminal-pane-grip"
                                  size={12}
                                  aria-hidden="true"
                                />
                                <span className="dd-terminal-tab__dot" />
                                <strong>{tab.label}</strong>
                                <button
                                  type="button"
                                  onClick={() => closeTab(tab.id)}
                                  aria-label={`Close ${tab.label}`}
                                >
                                  <X size={12} />
                                </button>
                              </header>
                              <TerminalView
                                sessionId={tab.id}
                                hostLabel={tab.label}
                                active
                                minimal
                                inputTargets={
                                  activeGroup.broadcast
                                    ? activeGroupTabs.map((item) => item.id)
                                    : [tab.id]
                                }
                                onCommand={recordCommand}
                                {...(tab.kind === 'ssh'
                                  ? { onRecover: recoverFailedTerminal }
                                  : {})}
                                onClose={() => closeTab(tab.id)}
                              />
                            </section>
                          ))}
                        </div>
                        {row.slice(0, -1).map((tab, index) => {
                          const left =
                            (rowWeights
                              .slice(0, index + 1)
                              .reduce((total, weight) => total + weight, 0) /
                              totalRowWeight) *
                            100;
                          return (
                            <div
                              key={`pane-resizer:${tab.id}`}
                              className="dd-terminal-resizer dd-terminal-resizer--vertical"
                              style={{ left: `${left}%` }}
                              onPointerDown={(event) =>
                                beginPaneResize(activeGroup, tab.id, row[index + 1]!.id, event)
                              }
                              role="separator"
                              aria-orientation="vertical"
                            />
                          );
                        })}
                      </div>
                      {rowIndex < activeGroupRows.length - 1 && (
                        <div
                          className="dd-terminal-resizer dd-terminal-resizer--horizontal"
                          style={{
                            top: `${
                              (activeGroupRowWeights
                                .slice(0, rowIndex + 1)
                                .reduce((total, weight) => total + weight, 0) /
                                activeGroupRowWeights.reduce(
                                  (total, weight) => total + weight,
                                  0,
                                )) *
                              100
                            }%`,
                          }}
                          onPointerDown={(event) => beginRowResize(activeGroup, rowIndex, event)}
                          role="separator"
                          aria-orientation="horizontal"
                        />
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          ) : tabs.length > 0 ? (
            <div className="dd-terminal-stack">
              {tabs.map((tab) => (
                <TerminalView
                  key={tab.id}
                  sessionId={tab.id}
                  hostLabel={tab.label}
                  active={tab.id === activeSession}
                  minimal
                  onCommand={recordCommand}
                  {...(tab.kind === 'ssh' ? { onRecover: recoverFailedTerminal } : {})}
                  onClose={() => closeTab(tab.id)}
                />
              ))}
            </div>
          ) : (
            <div className="dd-terminal-empty">
              <TerminalSquare size={34} strokeWidth={1.4} />
              <strong>Start your workspace</strong>
              <span>Open a local shell or connect to a saved server.</span>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    void startLocalTerminal();
                  }}
                >
                  <TerminalSquare size={15} /> Local terminal
                </button>
                <button type="button" onClick={() => setConnectionsOpen(true)}>
                  <Server size={15} /> SSH connection
                </button>
              </div>
            </div>
          )}
        </div>

        {utilityOpen && (
          <aside className="dd-terminal-utility">
            <div
              className="dd-terminal-utility__resizer"
              role="separator"
              aria-label="Resize utility panel"
              aria-orientation="vertical"
              aria-valuemin={UTILITY_PANEL_MIN_WIDTH}
              aria-valuemax={UTILITY_PANEL_MAX_WIDTH}
              aria-valuenow={utilityWidth}
              tabIndex={0}
              title="Drag to resize · Double-click to reset"
              onPointerDown={beginUtilityResize}
              onKeyDown={resizeUtilityWithKeyboard}
              onDoubleClick={() => saveUtilityWidth(UTILITY_PANEL_DEFAULT_WIDTH)}
            />
            <header className="dd-terminal-utility__tabs">
              <button
                type="button"
                className={utilityTab === 'scripts' ? 'is-active' : ''}
                onClick={() => {
                  setUtilityTab('scripts');
                  setFilter('');
                }}
              >
                <Files size={15} /> Scripts <span>{scriptItems.length}</span>
              </button>
              <button
                type="button"
                className={utilityTab === 'clipboard' ? 'is-active' : ''}
                onClick={() => {
                  setUtilityTab('clipboard');
                  setFilter('');
                }}
              >
                <Clipboard size={15} /> Clipboard <span>{clipboardItems.length}</span>
              </button>
              <button
                type="button"
                className={utilityTab === 'history' ? 'is-active' : ''}
                onClick={() => {
                  setUtilityTab('history');
                  setFilter('');
                }}
              >
                <History size={15} /> History <span>{commandHistory.length}</span>
              </button>
              <button
                type="button"
                className="dd-terminal-utility__collapse"
                onClick={() => setUtilityOpen(false)}
                aria-label="Collapse utility panel"
                title="Collapse panel"
              >
                <PanelRightClose size={16} />
              </button>
            </header>

            <div className="dd-terminal-utility__toolbar">
              <label>
                <Search size={14} />
                <input
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={`Search ${utilityTab}`}
                  aria-label={`Search ${utilityTab}`}
                />
              </label>
              {utilityTab === 'history' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedHistoryIds.size > 0) {
                      setCommandHistory((current) =>
                        current.filter((item) => !selectedHistoryIds.has(item.id)),
                      );
                      setSelectedHistoryIds(new Set());
                    } else {
                      setCommandHistory([]);
                    }
                  }}
                  disabled={commandHistory.length === 0}
                  aria-label={
                    selectedHistoryIds.size > 0
                      ? 'Delete selected history'
                      : 'Clear command history'
                  }
                  title={selectedHistoryIds.size > 0 ? 'Delete selected' : 'Clear all history'}
                >
                  <Trash2 size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    utilityTab === 'scripts'
                      ? setScriptFormOpen((open) => !open)
                      : setClipboardFormOpen((open) => !open)
                  }
                  aria-label={utilityTab === 'scripts' ? 'Add script' : 'Add clipboard item'}
                  title={utilityTab === 'scripts' ? 'Add script' : 'Add clipboard item'}
                >
                  <Plus size={17} />
                </button>
              )}
            </div>

            {utilityTab === 'scripts' ? (
              <div className="dd-terminal-utility__content">
                {scriptFormOpen && (
                  <div className="dd-utility-form">
                    <ScriptForm
                      busy={createScript.isPending}
                      onCancel={() => setScriptFormOpen(false)}
                      onSubmit={async (request) => {
                        await createScript.mutateAsync(request);
                        setScriptFormOpen(false);
                        toast.push('Script created', { variant: 'success' });
                      }}
                    />
                  </div>
                )}
                {!scripts.isPending && scriptItems.length === 0 && (
                  <p className="dd-utility-empty">No saved scripts.</p>
                )}
                <div className="dd-utility-list">
                  {scriptItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="dd-utility-row"
                      onClick={() => runScript(item)}
                      title="Run in active terminal"
                    >
                      <span className="dd-utility-row__icon">
                        <TerminalSquare size={14} />
                      </span>
                      <span className="dd-utility-row__body">
                        <strong>{item.title}</strong>
                        <code>{item.body?.type === 'script' ? item.body.content : ''}</code>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : utilityTab === 'clipboard' ? (
              <div className="dd-terminal-utility__content">
                {clipboardFormOpen && (
                  <div className="dd-clipboard-quick-add">
                    <textarea
                      value={clipboardInput}
                      onChange={(event) => setClipboardInput(event.target.value)}
                      placeholder="Text to save…"
                      rows={3}
                      autoFocus
                    />
                    <div>
                      <button type="button" onClick={() => setClipboardFormOpen(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void saveClipboard();
                        }}
                        disabled={!clipboardInput.trim() || recordClipboard.isPending}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
                {!clipboard.isPending && clipboardItems.length === 0 && (
                  <p className="dd-utility-empty">No saved clipboard entries.</p>
                )}
                <div className="dd-utility-list">
                  {clipboardItems.map((item) => (
                    <div key={item.id} className="dd-utility-row dd-utility-row--actionable">
                      <button
                        type="button"
                        className="dd-utility-row__main"
                        onClick={() =>
                          pasteClipboardContent(item.content, item.contentType.startsWith('image/'))
                        }
                        title={
                          item.contentType.startsWith('image/')
                            ? 'Image cannot be pasted into terminal'
                            : 'Paste into active terminal'
                        }
                      >
                        <span className="dd-utility-row__icon">
                          <Clipboard size={14} />
                        </span>
                        <span className="dd-utility-row__body">
                          <strong>
                            {item.contentType.startsWith('image/')
                              ? 'Saved image'
                              : item.content.slice(0, 46)}
                          </strong>
                          <code>{item.sourceApp || item.contentType}</code>
                        </span>
                      </button>
                      <span className="dd-utility-row__actions">
                        <button
                          type="button"
                          onClick={() => {
                            void copyUtilityContent(
                              item.content,
                              item.contentType.startsWith('image/') ? item.id : undefined,
                            );
                          }}
                          aria-label="Copy to system clipboard"
                          title="Copy to system clipboard"
                        >
                          <Copy size={13} />
                        </button>
                        {!item.contentType.startsWith('image/') && !item.savedScriptId && (
                          <button
                            type="button"
                            onClick={() => {
                              void saveUtilityScript(
                                item.content,
                                `Clipboard ${new Date(item.capturedAt).toLocaleString()}`,
                                'Clipboard',
                                item.id,
                              );
                            }}
                            disabled={createScript.isPending || markClipboardSaved.isPending}
                            aria-label="Save as Library script"
                            title="Save as Library script"
                          >
                            <BookPlus size={13} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="dd-terminal-utility__content">
                {commandHistoryItems.length > 0 && (
                  <div className="dd-history-selection">
                    <label>
                      <input
                        type="checkbox"
                        checked={commandHistoryItems.every((item) =>
                          selectedHistoryIds.has(item.id),
                        )}
                        onChange={(event) =>
                          setSelectedHistoryIds(
                            event.target.checked
                              ? new Set(commandHistoryItems.map((item) => item.id))
                              : new Set(),
                          )
                        }
                      />
                      Select all
                    </label>
                    <span>{selectedHistoryIds.size} selected</span>
                  </div>
                )}
                {commandHistoryItems.length === 0 && (
                  <p className="dd-utility-empty">Commands you run will appear here.</p>
                )}
                <div className="dd-utility-list">
                  {commandHistoryItems.map((item) => (
                    <div key={item.id} className="dd-history-row">
                      <input
                        type="checkbox"
                        checked={selectedHistoryIds.has(item.id)}
                        onChange={(event) => {
                          setSelectedHistoryIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                        aria-label={`Select command ${item.command}`}
                      />
                      <div className="dd-utility-row dd-utility-row--history dd-utility-row--actionable">
                        <button
                          type="button"
                          className="dd-utility-row__main"
                          onClick={() => {
                            void sendToTerminal(
                              item.command,
                              false,
                              'Command pasted into terminal',
                            );
                          }}
                          title="Paste into active terminal"
                        >
                          <span className="dd-utility-row__icon">
                            <History size={14} />
                          </span>
                          <span className="dd-utility-row__body">
                            <strong>{item.command}</strong>
                            <code>
                              {item.terminalLabel} · {new Date(item.ranAt).toLocaleTimeString()}
                            </code>
                          </span>
                        </button>
                        <span className="dd-utility-row__actions">
                          <button
                            type="button"
                            onClick={() => {
                              void copyUtilityContent(item.command);
                            }}
                            aria-label="Copy command to system clipboard"
                            title="Copy command"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void saveUtilityScript(
                                item.command,
                                `Command ${new Date(item.ranAt).toLocaleString()}`,
                                'Terminal history',
                              );
                            }}
                            disabled={createScript.isPending}
                            aria-label="Save command as Library script"
                            title="Save as Library script"
                          >
                            <BookPlus size={13} />
                          </button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </main>
      <SftpWorkspace
        hosts={hostItems}
        hidden={workspaceMode !== 'sftp'}
        onOpenTerminal={({ hostId, path }) => {
          if (hostId) void connectHost(hostId, path);
          else void startLocalTerminal(path);
        }}
      />
    </div>
  );
}
