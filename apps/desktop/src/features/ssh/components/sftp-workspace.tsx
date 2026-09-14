import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from 'react';
import type { SshHostDto } from '@devdock/types';
import {
  ChevronLeft,
  CheckSquare,
  ClipboardCopy,
  ClipboardPaste,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  HardDrive,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Server,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';

import { UiSelect } from '../../shell/components/ui-select';
import { useToast } from '../../shell/components/toast';
import { useConfirm } from '../../shell/components/confirm-dialog';

interface SftpWorkspaceProps {
  hosts: SshHostDto[];
  onOpenTerminal: (request: { hostId?: string; path: string }) => void;
  hidden?: boolean;
}

type SftpEntry = Awaited<ReturnType<NonNullable<Window['devdockSftp']>['list']>>[number];
type FileEndpoint = Parameters<NonNullable<Window['devdockSftp']>['transferItems']>[0]['source'];
type PaneView = 'grid' | 'list';

interface FilePane {
  id: string;
  sourceId: string;
  path: string;
  entries: SftpEntry[];
  selectedPaths: string[];
  anchorPath: string | undefined;
  loading: boolean;
  connected: boolean;
  filter: string;
  view: PaneView;
}

interface FileClipboard {
  sourcePaneId: string;
  source: FileEndpoint;
  paths: string[];
  mode: 'copy' | 'move';
}

interface DragPayload {
  sourcePaneId: string;
  paths: string[];
}

interface FileDialog {
  kind: 'mkdir' | 'rename';
  paneId: string;
  value: string;
}

interface FileContextMenu {
  paneId: string;
  x: number;
  y: number;
  directory: string;
  paths: string[];
}

const LOCAL_SOURCE = 'local';
const SFTP_PANES_STORAGE_KEY = 'devdock:sftp-panes';
let paneSequence = 0;

function createPane(sourceId = '', path = '/'): FilePane {
  paneSequence += 1;
  return {
    id: `files-${paneSequence}`,
    sourceId,
    path,
    entries: [],
    selectedPaths: [],
    anchorPath: undefined,
    loading: false,
    connected: false,
    filter: '',
    view: 'list',
  };
}

interface PersistedFilePane {
  sourceId: string;
  path: string;
  view: PaneView;
}

export function parsePersistedFilePanes(raw: string | null): PersistedFilePane[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.length === 0 || value.length > 6) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const pane = item as Record<string, unknown>;
      if (
        typeof pane.sourceId !== 'string' ||
        pane.sourceId.length > 512 ||
        typeof pane.path !== 'string' ||
        pane.path.length > 4096 ||
        (pane.view !== 'list' && pane.view !== 'grid')
      )
        return [];
      return [{ sourceId: pane.sourceId, path: pane.path, view: pane.view }];
    });
  } catch {
    return [];
  }
}

function initialFilePanes(): FilePane[] {
  let persisted: PersistedFilePane[] = [];
  try {
    persisted = parsePersistedFilePanes(localStorage.getItem(SFTP_PANES_STORAGE_KEY));
  } catch {
    // Use the default panes when storage is unavailable.
  }
  if (persisted.length === 0) return [createPane(LOCAL_SOURCE, ''), createPane()];
  return persisted.map((pane) => ({
    ...createPane(pane.sourceId, pane.path),
    view: pane.view,
  }));
}

function remoteSource(hostId: string): string {
  return `host:${hostId}`;
}

function hostIdFromSource(sourceId: string): string | null {
  return sourceId.startsWith('host:') ? sourceId.slice(5) : null;
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  const parent = parts.slice(0, -1).join('/');
  return parent ? `/${parent}` : '/';
}

function childPath(directory: string, name: string): string {
  return `${directory === '/' ? '' : directory}/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function fileKind(entry: SftpEntry): string {
  if (entry.type === 'directory') return 'Folder';
  if (entry.type === 'link') return 'Link';
  const extension = entry.name.split('.').pop();
  return extension && extension !== entry.name ? extension.toUpperCase() : 'File';
}

function gridColumns(count: number): number {
  if (count <= 2) return count;
  if (count === 4) return 2;
  return 3;
}

export function fileShortcutAction(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key'>,
  hasSelection: boolean,
  canPaste: boolean,
): 'copy' | 'move' | 'paste' | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLocaleLowerCase();
  if (key === 'c' && hasSelection) return 'copy';
  if (key === 'x' && hasSelection) return 'move';
  if (key === 'v' && canPaste) return 'paste';
  return null;
}

export function resolveHostCredential(
  host: Pick<SshHostDto, 'authMethod' | 'hasSavedPassword'> | undefined,
  enteredCredential: string | undefined,
): string | undefined | null {
  if (!host || host.authMethod !== 'password') return undefined;
  if (enteredCredential) return enteredCredential;
  return host.hasSavedPassword ? undefined : null;
}

export function setPathSelected(
  paths: readonly string[],
  path: string,
  checked: boolean,
): string[] {
  const selected = new Set(paths);
  if (checked) selected.add(path);
  else selected.delete(path);
  return [...selected];
}

export function SftpWorkspace({
  hosts,
  onOpenTerminal,
  hidden = false,
}: SftpWorkspaceProps): JSX.Element {
  const bridge = window.devdockSftp;
  const toast = useToast();
  const confirm = useConfirm();
  const [home, setHome] = useState('');
  const [panes, setPanes] = useState<FilePane[]>(initialFilePanes);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);
  const [activePaneId, setActivePaneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FileDialog | null>(null);
  const [contextMenu, setContextMenu] = useState<FileContextMenu | null>(null);
  const homeRequestStartedRef = useRef(false);
  const restoredPanesLoadedRef = useRef(false);

  const sourceOptions = useMemo(
    () => [
      { value: LOCAL_SOURCE, label: 'Local' },
      ...hosts.map((host) => ({ value: remoteSource(host.id), label: host.title })),
    ],
    [hosts],
  );

  useEffect(() => {
    if (panes.some((pane) => pane.id === activePaneId)) return;
    setActivePaneId(panes[0]?.id ?? '');
  }, [activePaneId, panes]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SFTP_PANES_STORAGE_KEY,
        JSON.stringify(
          panes.map((pane) => ({
            sourceId: pane.sourceId,
            path: pane.path,
            view: pane.view,
          })),
        ),
      );
    } catch {
      // The live workspace remains usable when persistence is unavailable.
    }
  }, [panes]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (): void => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const updatePane = useCallback((paneId: string, update: (pane: FilePane) => FilePane): void => {
    setPanes((current) => current.map((pane) => (pane.id === paneId ? update(pane) : pane)));
  }, []);

  const credentialForHost = useCallback(
    (hostId: string): string | undefined | null => {
      const host = hosts.find((candidate) => candidate.id === hostId);
      return resolveHostCredential(host, credentials[hostId]);
    },
    [credentials, hosts],
  );

  const endpointFor = useCallback(
    (pane: FilePane): FileEndpoint | null => {
      if (pane.sourceId === LOCAL_SOURCE) return { kind: 'local' };
      const hostId = hostIdFromSource(pane.sourceId);
      if (!hostId) return null;
      const credential = credentialForHost(hostId);
      if (credential === null) return null;
      return {
        kind: 'remote',
        hostId,
        ...(credential ? { credential } : {}),
      };
    },
    [credentialForHost],
  );

  const loadPane = useCallback(
    async (paneId: string, path: string, sourceOverride?: string): Promise<void> => {
      if (!bridge) return;
      const pane = panes.find((candidate) => candidate.id === paneId);
      const sourceId = sourceOverride ?? pane?.sourceId ?? '';
      if (!sourceId) return;
      updatePane(paneId, (current) => ({
        ...current,
        sourceId,
        path,
        loading: true,
        selectedPaths: [],
        anchorPath: undefined,
        filter: '',
      }));
      try {
        let entries: SftpEntry[];
        if (sourceId === LOCAL_SOURCE) {
          entries = await bridge.listLocal({ path });
        } else {
          const hostId = hostIdFromSource(sourceId);
          if (!hostId) return;
          const credential = credentialForHost(hostId);
          if (credential === null) {
            updatePane(paneId, (current) => ({ ...current, loading: false, connected: false }));
            return;
          }
          entries = await bridge.list({
            hostId,
            path,
            ...(credential ? { credential } : {}),
          });
        }
        updatePane(paneId, (current) => ({
          ...current,
          path,
          entries,
          loading: false,
          connected: true,
        }));
      } catch (error) {
        const hostId = hostIdFromSource(sourceId);
        if (hostId && hosts.find((host) => host.id === hostId)?.authMethod === 'password') {
          setCredentials((current) => ({ ...current, [hostId]: '' }));
        }
        updatePane(paneId, (current) => ({
          ...current,
          entries: [],
          loading: false,
          connected: false,
        }));
        toast.push(`Files failed: ${error instanceof Error ? error.message : String(error)}`, {
          variant: 'error',
        });
      }
    },
    [bridge, credentialForHost, hosts, panes, toast, updatePane],
  );

  useEffect(() => {
    if (!bridge || home || homeRequestStartedRef.current) return;
    homeRequestStartedRef.current = true;
    void bridge
      .localHome()
      .then((localHome) => {
        setHome(localHome);
      })
      .catch((error: unknown) => toast.push(String(error), { variant: 'error' }));
  }, [bridge, home, toast]);

  useEffect(() => {
    if (!bridge || !home || restoredPanesLoadedRef.current) return;
    restoredPanesLoadedRef.current = true;
    for (const pane of panes) {
      if (!pane.sourceId) continue;
      const path = pane.path || (pane.sourceId === LOCAL_SOURCE ? home : '/');
      void loadPane(pane.id, path, pane.sourceId);
    }
  }, [bridge, home, loadPane, panes]);

  const reloadPane = useCallback(
    async (paneId: string): Promise<void> => {
      const pane = panes.find((candidate) => candidate.id === paneId);
      if (pane) await loadPane(pane.id, pane.path);
    },
    [loadPane, panes],
  );

  const selectSource = (paneId: string, sourceId: string): void => {
    const path = sourceId === LOCAL_SOURCE ? home || '/' : '/';
    updatePane(paneId, (pane) => ({
      ...createPane(sourceId, path),
      id: pane.id,
      view: pane.view,
    }));
    if (sourceId === LOCAL_SOURCE) {
      void loadPane(paneId, path, sourceId);
      return;
    }
    const hostId = hostIdFromSource(sourceId);
    if (!hostId) return;
    if (credentialForHost(hostId) !== null) {
      void loadPane(paneId, '/', sourceId);
    }
  };

  const transferItems = useCallback(
    async (
      sourcePaneId: string,
      targetPaneId: string,
      paths: string[],
      mode: 'copy' | 'move',
      targetDirectory?: string,
    ): Promise<void> => {
      if (!bridge || paths.length === 0) return;
      const sourcePane = panes.find((pane) => pane.id === sourcePaneId);
      const targetPane = panes.find((pane) => pane.id === targetPaneId);
      if (!sourcePane || !targetPane) return;
      const source = endpointFor(sourcePane);
      const target = endpointFor(targetPane);
      if (!source || !target) {
        toast.push('Connect both file panes before transferring.', { variant: 'info' });
        return;
      }
      setBusy(true);
      try {
        await bridge.transferItems({
          source,
          target,
          sourcePaths: paths,
          targetDirectory: targetDirectory ?? targetPane.path,
          mode,
        });
        await reloadPane(targetPaneId);
        if (mode === 'move') await reloadPane(sourcePaneId);
        toast.push(`${paths.length} item(s) ${mode === 'move' ? 'moved' : 'copied'}`, {
          variant: 'success',
        });
        if (mode === 'move') setFileClipboard(null);
      } catch (error) {
        toast.push(`Transfer failed: ${error instanceof Error ? error.message : String(error)}`, {
          variant: 'error',
        });
      } finally {
        setBusy(false);
        setDragTarget(null);
      }
    },
    [bridge, endpointFor, panes, reloadPane, toast],
  );

  const copyPaths = (pane: FilePane, paths: string[], mode: 'copy' | 'move'): void => {
    const endpoint = endpointFor(pane);
    if (!endpoint || paths.length === 0) return;
    setFileClipboard({
      sourcePaneId: pane.id,
      source: endpoint,
      paths,
      mode,
    });
    toast.push(`${paths.length} item(s) ready to ${mode}`, { variant: 'info' });
  };

  const copyOrCut = (pane: FilePane, mode: 'copy' | 'move'): void => {
    copyPaths(pane, pane.selectedPaths, mode);
  };

  const pasteInto = async (pane: FilePane, targetDirectory = pane.path): Promise<void> => {
    if (!fileClipboard || !bridge) return;
    const target = endpointFor(pane);
    if (!target) {
      toast.push('Connect this pane before pasting.', { variant: 'info' });
      return;
    }
    setBusy(true);
    try {
      await bridge.transferItems({
        source: fileClipboard.source,
        target,
        sourcePaths: fileClipboard.paths,
        targetDirectory,
        mode: fileClipboard.mode,
      });
      await reloadPane(pane.id);
      if (fileClipboard.mode === 'move') {
        await reloadPane(fileClipboard.sourcePaneId);
        setFileClipboard(null);
      }
      toast.push(`${fileClipboard.paths.length} item(s) pasted`, { variant: 'success' });
    } catch (error) {
      toast.push(`Paste failed: ${error instanceof Error ? error.message : String(error)}`, {
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.matches('input, textarea, [contenteditable="true"]') ||
        target?.closest('[role="dialog"]')
      )
        return;
      const pane = panes.find((candidate) => candidate.id === activePaneId);
      if (!pane) return;
      const action = fileShortcutAction(
        event,
        pane.selectedPaths.length > 0,
        Boolean(fileClipboard && pane.connected),
      );
      if (action === 'copy' || action === 'move') {
        event.preventDefault();
        copyOrCut(pane, action);
      } else if (action === 'paste') {
        event.preventDefault();
        void pasteInto(pane);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePaneId, credentials, fileClipboard, panes]);

  const createDirectory = async (pane: FilePane, name: string): Promise<void> => {
    if (!bridge) return;
    const endpoint = endpointFor(pane);
    if (!endpoint) return;
    if (!name || name.includes('/')) return;
    try {
      const path = childPath(pane.path, name);
      if (endpoint.kind === 'local') await bridge.mkdirLocal({ path });
      else {
        await bridge.mkdir({
          hostId: endpoint.hostId,
          path,
          ...(endpoint.credential ? { credential: endpoint.credential } : {}),
        });
      }
      await reloadPane(pane.id);
      toast.push(`Folder “${name}” created`, { variant: 'success' });
    } catch (error) {
      toast.push(
        `Create folder failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          variant: 'error',
        },
      );
    }
  };

  const renameSelected = async (pane: FilePane, name: string): Promise<void> => {
    if (!bridge || pane.selectedPaths.length !== 1) return;
    const endpoint = endpointFor(pane);
    const entry = pane.entries.find((candidate) => candidate.path === pane.selectedPaths[0]);
    if (!endpoint || !entry) return;
    if (!name || name === entry.name || name.includes('/')) return;
    try {
      await bridge.renameItem({
        endpoint,
        path: entry.path,
        nextPath: childPath(parentPath(entry.path), name),
      });
      await reloadPane(pane.id);
      toast.push(`Renamed to “${name}”`, { variant: 'success' });
    } catch (error) {
      toast.push(`Rename failed: ${error instanceof Error ? error.message : String(error)}`, {
        variant: 'error',
      });
    }
  };

  const removeSelected = async (pane: FilePane): Promise<void> => {
    if (!bridge || pane.selectedPaths.length === 0) return;
    const endpoint = endpointFor(pane);
    if (!endpoint) return;
    const confirmed = await confirm({
      title: `Permanently delete ${pane.selectedPaths.length} item(s)?`,
      description:
        'Selected files and folder contents will be deleted from this source. This action cannot be undone.',
      confirmLabel: 'Delete permanently',
    });
    if (!confirmed) return;
    try {
      await bridge.removeItems({ endpoint, paths: pane.selectedPaths });
      await reloadPane(pane.id);
      toast.push(`${pane.selectedPaths.length} item(s) deleted`, { variant: 'success' });
    } catch (error) {
      toast.push(`Delete failed: ${error instanceof Error ? error.message : String(error)}`, {
        variant: 'error',
      });
    }
  };

  const selectEntry = (
    pane: FilePane,
    visibleEntries: SftpEntry[],
    entry: SftpEntry,
    event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ): void => {
    updatePane(pane.id, (current) => {
      const selected = new Set(current.selectedPaths);
      if (event.shiftKey && current.anchorPath) {
        const anchorIndex = visibleEntries.findIndex(
          (candidate) => candidate.path === current.anchorPath,
        );
        const nextIndex = visibleEntries.findIndex((candidate) => candidate.path === entry.path);
        if (anchorIndex >= 0 && nextIndex >= 0) {
          const [start, end] =
            anchorIndex < nextIndex ? [anchorIndex, nextIndex] : [nextIndex, anchorIndex];
          if (!event.ctrlKey && !event.metaKey) selected.clear();
          for (const candidate of visibleEntries.slice(start, end + 1)) {
            selected.add(candidate.path);
          }
        }
      } else if (event.ctrlKey || event.metaKey) {
        if (selected.has(entry.path)) selected.delete(entry.path);
        else selected.add(entry.path);
      } else {
        selected.clear();
        selected.add(entry.path);
      }
      return {
        ...current,
        selectedPaths: [...selected],
        anchorPath: event.shiftKey ? (current.anchorPath ?? entry.path) : entry.path,
      };
    });
  };

  const renderBreadcrumbs = (pane: FilePane): JSX.Element => {
    const segments = pane.path.split('/').filter(Boolean);
    return (
      <nav className="dd-sftp-breadcrumbs" aria-label="File path">
        <button
          type="button"
          onClick={() => {
            void loadPane(pane.id, '/');
          }}
        >
          <HardDrive size={14} />
        </button>
        {segments.map((segment, index) => {
          const path = `/${segments.slice(0, index + 1).join('/')}`;
          return (
            <span key={path}>
              <span>/</span>
              <button
                type="button"
                onClick={() => {
                  void loadPane(pane.id, path);
                }}
              >
                {segment}
              </button>
            </span>
          );
        })}
      </nav>
    );
  };

  const onDrop = (event: DragEvent, targetPane: FilePane, targetDirectory?: string): void => {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(null);
    const raw = event.dataTransfer.getData('application/x-devdock-files');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DragPayload;
      if (!Array.isArray(payload.paths)) return;
      void transferItems(
        payload.sourcePaneId,
        targetPane.id,
        payload.paths,
        event.shiftKey ? 'move' : 'copy',
        targetDirectory,
      );
    } catch {
      toast.push('Invalid drag payload.', { variant: 'error' });
    }
  };

  const showContextMenu = (
    event: MouseEvent,
    pane: FilePane,
    directory: string,
    paths: string[],
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    setActivePaneId(pane.id);
    setContextMenu({
      paneId: pane.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 150)),
      directory,
      paths,
    });
  };

  const renderPane = (pane: FilePane): JSX.Element => {
    const hostId = hostIdFromSource(pane.sourceId);
    const host = hosts.find((candidate) => candidate.id === hostId);
    const hasManualCredentialState = host
      ? Object.prototype.hasOwnProperty.call(credentials, host.id)
      : false;
    const needsPassword =
      host?.authMethod === 'password' &&
      !pane.connected &&
      !pane.loading &&
      (!host.hasSavedPassword || hasManualCredentialState);
    const selected = new Set(pane.selectedPaths);
    const visibleEntries = pane.entries.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(pane.filter.trim().toLocaleLowerCase()),
    );

    const renderEntry = (entry: SftpEntry): JSX.Element => {
      const isSelected = selected.has(entry.path);
      const className = `${pane.view === 'grid' ? 'dd-sftp-card' : 'dd-sftp-row'}${isSelected ? ' is-selected' : ''}`;
      return (
        <div
          key={entry.path}
          role="row"
          draggable
          className={className}
          onClick={(event) => selectEntry(pane, visibleEntries, entry, event)}
          onDoubleClick={() => {
            if (entry.type === 'directory') void loadPane(pane.id, entry.path);
          }}
          onContextMenu={(event) => {
            const paths = isSelected ? pane.selectedPaths : [entry.path];
            if (!isSelected) {
              updatePane(pane.id, (current) => ({
                ...current,
                selectedPaths: [entry.path],
                anchorPath: entry.path,
              }));
            }
            showContextMenu(
              event,
              pane,
              entry.type === 'directory' ? entry.path : pane.path,
              paths,
            );
          }}
          onDragStart={(event) => {
            const paths = isSelected ? pane.selectedPaths : [entry.path];
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData(
              'application/x-devdock-files',
              JSON.stringify({ sourcePaneId: pane.id, paths } satisfies DragPayload),
            );
          }}
          onDragOver={(event) => {
            if (entry.type !== 'directory') return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = event.shiftKey ? 'move' : 'copy';
          }}
          onDrop={(event) => {
            if (entry.type === 'directory') onDrop(event, pane, entry.path);
          }}
        >
          <span role="cell" className="dd-sftp-row__name">
            <input
              type="checkbox"
              checked={isSelected}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                updatePane(pane.id, (current) => ({
                  ...current,
                  selectedPaths: setPathSelected(current.selectedPaths, entry.path, checked),
                  anchorPath: checked
                    ? entry.path
                    : current.anchorPath === entry.path
                      ? undefined
                      : current.anchorPath,
                }));
              }}
              aria-label={`Select ${entry.name}`}
            />
            {entry.type === 'directory' ? <Folder size={17} /> : <File size={16} />}
            <span>{entry.name}</span>
          </span>
          <span role="cell">{formatDate(entry.modifiedAt)}</span>
          <span role="cell">{entry.type === 'file' ? formatSize(entry.size) : '—'}</span>
          <span role="cell">{fileKind(entry)}</span>
        </div>
      );
    };

    return (
      <section
        key={pane.id}
        className={`dd-sftp-panel${activePaneId === pane.id ? ' is-active-pane' : ''}${needsPassword ? ' has-password' : ''}${dragTarget === pane.id ? ' is-drop-target' : ''}`}
        onMouseDown={() => setActivePaneId(pane.id)}
        onDragOver={(event) => {
          if (!pane.sourceId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = event.shiftKey ? 'move' : 'copy';
          setDragTarget(pane.id);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragTarget(null);
        }}
        onDrop={(event) => onDrop(event, pane)}
      >
        <header className="dd-sftp-panel__header">
          <div className="dd-sftp-panel__identity">
            {pane.sourceId === LOCAL_SOURCE ? <HardDrive size={15} /> : <Server size={15} />}
            <UiSelect
              value={pane.sourceId}
              onValueChange={(sourceId) => selectSource(pane.id, sourceId)}
              options={sourceOptions}
              ariaLabel="File source"
              placeholder="Select Local or host"
            />
          </div>
          <label className="dd-sftp-filter">
            <Search size={14} />
            <input
              value={pane.filter}
              onChange={(event) =>
                updatePane(pane.id, (current) => ({
                  ...current,
                  filter: event.target.value,
                }))
              }
              placeholder="Search files and folders"
              aria-label="Search files and folders"
            />
          </label>
          <div className="dd-sftp-actions">
            <button
              type="button"
              disabled={!pane.sourceId}
              onClick={() => {
                void reloadPane(pane.id);
              }}
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              disabled={!pane.connected}
              onClick={() => setDialog({ kind: 'mkdir', paneId: pane.id, value: '' })}
              title="New folder"
            >
              <FolderPlus size={14} />
            </button>
            <button
              type="button"
              disabled={pane.selectedPaths.length === 0}
              onClick={() => copyOrCut(pane, 'copy')}
              title="Copy"
            >
              <ClipboardCopy size={14} />
            </button>
            <button
              type="button"
              disabled={pane.selectedPaths.length === 0}
              onClick={() => copyOrCut(pane, 'move')}
              title="Cut"
            >
              <Scissors size={14} />
            </button>
            <button
              type="button"
              disabled={!fileClipboard || !pane.connected}
              onClick={() => {
                void pasteInto(pane);
              }}
              title="Paste"
            >
              <ClipboardPaste size={14} />
            </button>
            <button
              type="button"
              disabled={pane.selectedPaths.length !== 1}
              onClick={() => {
                const selectedEntry = pane.entries.find(
                  (entry) => entry.path === pane.selectedPaths[0],
                );
                if (selectedEntry) {
                  setDialog({
                    kind: 'rename',
                    paneId: pane.id,
                    value: selectedEntry.name,
                  });
                }
              }}
              title="Rename"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() =>
                updatePane(pane.id, (current) => ({
                  ...current,
                  view: current.view === 'list' ? 'grid' : 'list',
                }))
              }
              title={pane.view === 'list' ? 'Grid view' : 'List view'}
              aria-label={pane.view === 'list' ? 'Grid view' : 'List view'}
              aria-pressed={pane.view === 'grid'}
            >
              {pane.view === 'list' ? <Grid2X2 size={14} /> : <List size={14} />}
            </button>
            <button
              type="button"
              disabled={pane.selectedPaths.length === 0}
              onClick={() => {
                void removeSelected(pane);
              }}
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
            {panes.length > 1 && (
              <button
                type="button"
                onClick={() => setPanes((current) => current.filter((item) => item.id !== pane.id))}
                title="Close pane"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </header>

        {needsPassword && host && (
          <form
            className="dd-sftp-password"
            onSubmit={(event) => {
              event.preventDefault();
              void loadPane(pane.id, pane.path);
            }}
          >
            <input
              type="password"
              value={credentials[host.id] ?? ''}
              onChange={(event) =>
                setCredentials((current) => ({
                  ...current,
                  [host.id]: event.target.value,
                }))
              }
              placeholder={`Password for ${host.username}@${host.host}`}
              autoComplete="off"
            />
            <button type="submit" disabled={!credentials[host.id]}>
              Connect
            </button>
          </form>
        )}

        <div className="dd-sftp-pathbar">
          <button
            type="button"
            disabled={!pane.connected || pane.path === '/'}
            onClick={() => {
              void loadPane(pane.id, parentPath(pane.path));
            }}
            title="Parent folder"
          >
            <ChevronLeft size={16} />
          </button>
          {renderBreadcrumbs(pane)}
        </div>

        <div className={`dd-sftp-table dd-sftp-table--${pane.view}`} role="table">
          {pane.view === 'list' && (
            <div className="dd-sftp-table__head" role="row">
              <span role="columnheader">Name</span>
              <span role="columnheader">Date modified</span>
              <span role="columnheader">Size</span>
              <span role="columnheader">Kind</span>
            </div>
          )}
          <div
            className="dd-sftp-table__body"
            role="rowgroup"
            onContextMenu={(event) => {
              const target = event.target instanceof HTMLElement ? event.target : null;
              if (target?.closest('.dd-sftp-row, .dd-sftp-card')) return;
              showContextMenu(event, pane, pane.path, pane.selectedPaths);
            }}
          >
            {pane.loading && <div className="dd-sftp-status">Loading…</div>}
            {!pane.loading && !pane.sourceId && (
              <div className="dd-sftp-empty">
                <span>
                  <FolderOpen size={25} />
                </span>
                <strong>Add a file source</strong>
                <p>Select Local or a saved SSH host in this pane.</p>
              </div>
            )}
            {!pane.loading && pane.sourceId && pane.connected && visibleEntries.length === 0 && (
              <div className="dd-sftp-status">No files found</div>
            )}
            {!pane.loading && pane.connected && visibleEntries.map(renderEntry)}
          </div>
        </div>

        <footer className="dd-sftp-panel__footer">
          <span>
            {pane.selectedPaths.length
              ? `${pane.selectedPaths.length} selected`
              : `${visibleEntries.length} items`}
          </span>
          <span>
            {fileClipboard
              ? `${fileClipboard.paths.length} ready to ${fileClipboard.mode}`
              : 'Drag to copy · Shift+drag to move'}
          </span>
        </footer>
      </section>
    );
  };

  const columns = gridColumns(panes.length);
  const gridStyle = {
    '--dd-file-columns': columns,
  } as CSSProperties;
  const contextPane = contextMenu
    ? panes.find((pane) => pane.id === contextMenu.paneId)
    : undefined;
  const contextEntries = contextPane
    ? contextPane.entries.filter((entry) =>
        entry.name.toLocaleLowerCase().includes(contextPane.filter.trim().toLocaleLowerCase()),
      )
    : [];

  return (
    <main className="dd-sftp-workspace" hidden={hidden}>
      <header className="dd-sftp-workspace__toolbar">
        <div>
          <strong>File workspace</strong>
          <span>
            {panes.length} pane{panes.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPanes((current) => [...current, createPane()])}
          title="Add file pane"
          aria-label="Add file pane"
        >
          <Plus size={15} /> Add pane
        </button>
      </header>
      <div className="dd-sftp-columns" style={gridStyle}>
        {panes.map(renderPane)}
      </div>
      {contextMenu && contextPane && (
        <div
          className="dd-sftp-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!contextPane.connected}
            onClick={() => {
              setContextMenu(null);
              const hostId = hostIdFromSource(contextPane.sourceId);
              onOpenTerminal({
                path: contextMenu.directory,
                ...(hostId ? { hostId } : {}),
              });
            }}
          >
            <TerminalSquare size={14} />
            <span>Open in terminal</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={contextMenu.paths.length === 0}
            onClick={() => {
              setContextMenu(null);
              copyPaths(contextPane, contextMenu.paths, 'copy');
            }}
          >
            <ClipboardCopy size={14} />
            <span>Copy</span>
            <kbd>Ctrl+C</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!fileClipboard || !contextPane.connected}
            onClick={() => {
              setContextMenu(null);
              void pasteInto(contextPane, contextMenu.directory);
            }}
          >
            <ClipboardPaste size={14} />
            <span>Paste</span>
            <kbd>Ctrl+V</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={contextEntries.length === 0}
            onClick={() => {
              setContextMenu(null);
              updatePane(contextPane.id, (current) => ({
                ...current,
                selectedPaths: contextEntries.map((entry) => entry.path),
                anchorPath: contextEntries[0]?.path,
              }));
            }}
          >
            <CheckSquare size={14} />
            <span>Select All</span>
            <kbd>Ctrl+A</kbd>
          </button>
        </div>
      )}
      {busy && <div className="dd-sftp-progress">Working with files…</div>}
      {dialog && (
        <div className="dd-file-dialog-backdrop" role="presentation">
          <form
            className="dd-file-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              const pane = panes.find((candidate) => candidate.id === dialog.paneId);
              const value = dialog.value.trim();
              if (!pane || !value || value.includes('/')) return;
              setDialog(null);
              if (dialog.kind === 'mkdir') void createDirectory(pane, value);
              else void renameSelected(pane, value);
            }}
          >
            <header>
              <strong>{dialog.kind === 'mkdir' ? 'New folder' : 'Rename item'}</strong>
              <button type="button" onClick={() => setDialog(null)} aria-label="Close dialog">
                <X size={15} />
              </button>
            </header>
            <label>
              <span>{dialog.kind === 'mkdir' ? 'Folder name' : 'New name'}</span>
              <input
                autoFocus
                value={dialog.value}
                onChange={(event) =>
                  setDialog((current) =>
                    current ? { ...current, value: event.target.value } : current,
                  )
                }
                onFocus={(event) => event.currentTarget.select()}
                placeholder={dialog.kind === 'mkdir' ? 'New folder' : 'Item name'}
              />
            </label>
            {dialog.value.includes('/') && <p>Names cannot contain “/”.</p>}
            <footer>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="submit" disabled={!dialog.value.trim() || dialog.value.includes('/')}>
                {dialog.kind === 'mkdir' ? 'Create' : 'Rename'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}
