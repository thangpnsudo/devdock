import type { LibraryItemDto } from '@devdock/types';
import { Pencil, Play, Trash2 } from 'lucide-react';

interface LibraryItemListProps {
  items: LibraryItemDto[];
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onEdit: (item: LibraryItemDto) => void;
  onDelete: (id: string) => void;
  onRun?: (item: LibraryItemDto) => void;
  selectedId: string | null;
  selectedIds: Set<string>;
  onSelectEntry: (id: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
}

function formatTimestamp(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '';
}

function itemDetail(item: LibraryItemDto): string {
  return item.body?.type === 'script' ? item.body.shell : item.kind;
}

export function LibraryItemList({
  items,
  onSelect,
  onToggleFavorite,
  onEdit,
  onDelete,
  selectedId,
  onRun,
  selectedIds,
  onSelectEntry,
  onSelectAll,
}: LibraryItemListProps): JSX.Element {
  return (
    <table className="dd-list">
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              checked={items.length > 0 && items.every((item) => selectedIds.has(item.id))}
              onChange={(event) => onSelectAll(event.target.checked)}
              aria-label="Select all library items"
            />
          </th>
          <th aria-label="favorite" />
          <th>Title</th>
          <th>Type</th>
          <th>Updated</th>
          <th aria-label="actions" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.id}
            className={
              item.id === selectedId ? 'dd-list__row dd-list__row--selected' : 'dd-list__row'
            }
            onClick={() => onSelect(item.id)}
          >
            <td onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={(event) => onSelectEntry(item.id, event.target.checked)}
                aria-label={`Select ${item.title}`}
              />
            </td>
            <td>
              <button
                type="button"
                className="dd-list__favorite"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite(item.id);
                }}
                aria-label={item.favorite ? 'Unfavorite' : 'Favorite'}
                title={item.favorite ? 'Unfavorite' : 'Favorite'}
              >
                {item.favorite ? '★' : '☆'}
              </button>
            </td>
            <td className="dd-list__title">{item.title}</td>
            <td className="dd-list__shell">
              <span className={`dd-kind dd-kind--${item.kind}`}>{itemDetail(item)}</span>
            </td>
            <td className="dd-list__time">{formatTimestamp(item.updatedAt)}</td>
            <td className="dd-list__actions">
              {onRun && item.body?.type === 'script' && (
                <button
                  type="button"
                  className="dd-list__run"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRun(item);
                  }}
                  aria-label={`Run ${item.title} in terminal`}
                  title="Run in active terminal"
                >
                  <Play size={14} fill="currentColor" />
                </button>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(item);
                }}
                aria-label={`Edit ${item.title}`}
                title={`Edit ${item.kind}`}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="dd-list__delete"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(item.id);
                }}
                aria-label={`Delete ${item.title}`}
                title={`Delete ${item.kind}`}
              >
                <Trash2 size={14} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
