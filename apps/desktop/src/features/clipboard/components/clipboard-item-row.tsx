// Single clipboard entry row with copy-again / pin / delete actions.

import type { ClipboardItemDto } from '@devdock/types';
import { useEffect, useState } from 'react';
import { BookPlus, Check, Copy, Pencil, Pin, Trash2, X } from 'lucide-react';
import { clipboardIpc } from '../ipc/clipboard';

interface ClipboardItemRowProps {
  item: ClipboardItemDto;
  onCopy: (id: string, content: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, content: string) => void;
  onSaveAsScript: (item: ClipboardItemDto) => void;
  onSelect: (id: string, selected: boolean) => void;
  selected?: boolean;
  busy?: boolean;
  view?: 'table' | 'grid';
}

function ClipboardThumbnail({ id }: { id: string }): JSX.Element {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void clipboardIpc
      .thumbnail(id)
      .then((value) => {
        if (active) setSource(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [id]);
  return source ? (
    <img className="dd-clipboard-thumbnail" src={source} alt="Clipboard preview" />
  ) : (
    <span
      className="dd-clipboard-thumbnail dd-clipboard-thumbnail--loading"
      aria-label="Loading image preview"
    />
  );
}

export function formatRelative(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function ClipboardItemRow({
  item,
  onCopy,
  onTogglePin,
  onDelete,
  onEdit,
  onSaveAsScript,
  onSelect,
  selected,
  busy,
  view = 'table',
}: ClipboardItemRowProps): JSX.Element {
  const isImage =
    item.contentType.startsWith('image/') || item.content.startsWith('devdock-image-v1:');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const saveEdit = (): void => {
    const content = draft.trim();
    if (content && content !== item.content) onEdit(item.id, content);
    setEditing(false);
  };
  const actions = (
    <div className="dd-clipboard-row__actions">
      <button
        type="button"
        className="dd-icon-button"
        onClick={() => onCopy(item.id, item.content)}
        disabled={busy}
        aria-label="Copy to clipboard"
        title="Copy to clipboard"
      >
        <Copy size={15} strokeWidth={1.8} />
      </button>
      {!isImage && (
        <button
          type="button"
          className="dd-icon-button"
          onClick={() => {
            setDraft(item.content);
            setEditing(true);
          }}
          disabled={busy}
          aria-label="Edit entry"
          title="Edit entry"
        >
          <Pencil size={14} />
        </button>
      )}
      {!isImage && !item.savedScriptId && (
        <button
          type="button"
          className="dd-icon-button"
          onClick={() => onSaveAsScript(item)}
          disabled={busy}
          aria-label="Save as Library script"
          title="Save as Library script"
        >
          <BookPlus size={15} />
        </button>
      )}
      <button
        type="button"
        className="dd-icon-button dd-icon-button--danger"
        onClick={() => onDelete(item.id)}
        disabled={busy}
        aria-label="Delete entry"
        title="Delete entry"
      >
        <Trash2 size={15} strokeWidth={1.8} />
      </button>
    </div>
  );

  if (view === 'table') {
    return (
      <tr className="dd-clipboard-table__row">
        <td className="dd-clipboard-table__select-cell">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelect(item.id, event.target.checked)}
            aria-label="Select entry"
          />
        </td>
        <td className="dd-clipboard-table__pin-cell">
          <button
            type="button"
            className={`dd-icon-button dd-icon-button--pin${item.pinned ? ' is-active' : ''}`}
            onClick={() => !busy && onTogglePin(item.id)}
            disabled={busy}
            aria-pressed={item.pinned}
            aria-label={item.pinned ? 'Remove from favorites' : 'Add to favorites'}
            title={item.pinned ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Pin size={15} fill={item.pinned ? 'currentColor' : 'none'} />
          </button>
        </td>
        <td className="dd-clipboard-table__content" title={item.content}>
          {isImage ? (
            <span className="dd-clipboard-image-preview">
              <ClipboardThumbnail id={item.id} />
              <span className="dd-clipboard-image-label">
                Image ·{' '}
                {item.content.replace(/^devdock-image(?:-png)?-v1:(\d+):(\d+):.*/u, '$1 × $2')}
              </span>
            </span>
          ) : editing ? (
            <div className="dd-inline-edit">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveEdit();
                  if (event.key === 'Escape') setEditing(false);
                }}
                autoFocus
              />
              <button
                type="button"
                className="dd-icon-button"
                onClick={saveEdit}
                aria-label="Save edit"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                className="dd-icon-button"
                onClick={() => setEditing(false)}
                aria-label="Cancel edit"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            item.content
          )}
        </td>
        <td className="dd-clipboard-table__source" title={item.sourceApp || 'Local clipboard'}>
          {item.sourceApp || 'Local clipboard'}
        </td>
        <td className="dd-clipboard-table__time" title={new Date(item.capturedAt).toLocaleString()}>
          {item.capturedAt ? formatRelative(item.capturedAt) : '—'}
        </td>
        <td>{actions}</td>
      </tr>
    );
  }

  return (
    <article className="dd-clipboard-row">
      <header className="dd-clipboard-row__header">
        <button
          type="button"
          className="dd-clipboard-row__pin"
          onClick={() => !busy && onTogglePin(item.id)}
          aria-pressed={item.pinned}
          aria-label={item.pinned ? 'Unpin' : 'Pin'}
          title={item.pinned ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Pin size={15} fill={item.pinned ? 'currentColor' : 'none'} />
        </button>
        <span className="dd-clipboard-row__time">{formatRelative(item.capturedAt)}</span>
        <span className="dd-clipboard-row__source">
          {item.sourceApp ? `from ${item.sourceApp}` : item.contentType}
        </span>
      </header>
      <pre className="dd-clipboard-row__content">
        {isImage ? <ClipboardThumbnail id={item.id} /> : <code>{item.content}</code>}
      </pre>
      {actions}
    </article>
  );
}
