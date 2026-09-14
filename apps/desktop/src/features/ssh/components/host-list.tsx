// SSH host list component — recent hosts on top, full list below.

import type { SshHostDto } from '@devdock/types';
import { Pencil, TerminalSquare, Trash2 } from 'lucide-react';

interface HostListProps {
  hosts: SshHostDto[];
  recentIds: string[];
  onConnect: (id: string) => void;
  onEdit: (host: SshHostDto) => void;
  onDelete: (id: string) => void;
  view?: 'row' | 'grid';
  busy?: boolean;
}

function HostRow({
  host,
  isRecent,
  onConnect,
  onEdit,
  onDelete,
  view,
  busy,
}: {
  host: SshHostDto;
  isRecent: boolean;
  onConnect: (id: string) => void;
  onEdit: (host: SshHostDto) => void;
  onDelete: (id: string) => void;
  view: 'row' | 'grid';
  busy?: boolean | undefined;
}): JSX.Element {
  return (
    <article className={`dd-ssh-row dd-ssh-row--${view}${isRecent ? ' dd-ssh-row--recent' : ''}`}>
      <header className="dd-ssh-row__header">
        <span className="dd-ssh-row__title">{host.title}</span>
        <span className="dd-ssh-row__address">
          {host.username}@{host.host}:{host.port}
        </span>
        {isRecent && <span className="dd-ssh-row__badge">Recent</span>}
      </header>
      {host.description && <p className="dd-ssh-row__description">{host.description}</p>}
      <footer className="dd-ssh-row__actions">
        <button
          type="button"
          onClick={() => onConnect(host.id)}
          disabled={busy}
          aria-label={`Connect to ${host.title}`}
          title="Connect"
        >
          <TerminalSquare size={14} />
        </button>
        <button
          type="button"
          onClick={() => onEdit(host)}
          disabled={busy}
          aria-label={`Edit ${host.title}`}
          title="Edit"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="dd-ssh-row__delete"
          onClick={() => onDelete(host.id)}
          disabled={busy}
          aria-label={`Delete ${host.title}`}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </footer>
    </article>
  );
}

export function HostList({
  hosts,
  recentIds,
  onConnect,
  onEdit,
  onDelete,
  view = 'row',
  busy,
}: HostListProps): JSX.Element {
  if (hosts.length === 0) {
    return <p className="dd-list__empty">No SSH hosts yet. Click "+ New Host" to add one.</p>;
  }
  const recentSet = new Set(recentIds);
  const sorted = [...hosts].sort((a, b) => {
    const aR = recentSet.has(a.id) ? 1 : 0;
    const bR = recentSet.has(b.id) ? 1 : 0;
    return bR - aR;
  });
  return (
    <div className={`dd-ssh-list dd-ssh-list--${view}`}>
      {sorted.map((h) => (
        <HostRow
          key={h.id}
          host={h}
          isRecent={recentSet.has(h.id)}
          onConnect={onConnect}
          onEdit={onEdit}
          onDelete={onDelete}
          view={view}
          busy={busy}
        />
      ))}
    </div>
  );
}
