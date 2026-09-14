// Clipboard page — shows recent clipboard entries with copy/pin/delete actions.

import { useEffect, useState } from 'react';
import type { ClipboardItemDto } from '@devdock/types';
import { ClipboardPaste, Grid2X2, List, Plus, Search, Trash2 } from 'lucide-react';

import {
  useClipboardPage,
  useDeleteClipboard,
  useDeleteClipboardMany,
  usePinClipboard,
  useMarkClipboardSaved,
  useRecordClipboardCapture,
  useUpdateClipboard,
} from '../hooks/use-clipboard';
import { useCreateScript } from '../../library/hooks/use-library';
import { clipboardIpc } from '../ipc/clipboard';
import { ClipboardItemRow } from '../components/clipboard-item-row';
import { useToast } from '../../shell/components/toast';
import { SkeletonList } from '../../shell/components/skeleton';
import { UiSelect } from '../../shell/components/ui-select';
import { useConfirm } from '../../shell/components/confirm-dialog';

type SortOption = 'newest' | 'oldest' | 'favorite';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'favorite', label: 'Favorites first' },
] as const;
const PAGE_SIZE_OPTIONS = [
  { value: '20', label: '20 rows' },
  { value: '50', label: '50 rows' },
  { value: '100', label: '100 rows' },
] as const;

export function ClipboardPage(): JSX.Element {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<'20' | '50' | '100'>('20');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');
  const numericPageSize = Number(pageSize);
  const history = useClipboardPage(numericPageSize, page * numericPageSize, search, sort);
  const pin = usePinClipboard();
  const remove = useDeleteClipboard();
  const removeMany = useDeleteClipboardMany();
  const record = useRecordClipboardCapture();
  const update = useUpdateClipboard();
  const markSaved = useMarkClipboardSaved();
  const createScript = useCreateScript();
  const toast = useToast();
  const confirm = useConfirm();
  const [captureMode, setCaptureMode] = useState(false);
  const [captureInput, setCaptureInput] = useState('');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const items = history.data?.items ?? [];
  const total = history.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / numericPageSize));
  const firstVisible = total === 0 ? 0 : page * numericPageSize + 1;
  const lastVisible = Math.min((page + 1) * numericPageSize, total);
  const pageWindowStart = Math.max(0, Math.min(page - 2, totalPages - 5));
  const visiblePages = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => pageWindowStart + index,
  );

  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [numericPageSize, search, sort]);

  useEffect(() => {
    if (history.data && page >= totalPages) setPage(totalPages - 1);
  }, [history.data, page, totalPages]);

  useEffect(() => {
    if (history.isError) {
      toast.push('Failed to load clipboard history', { variant: 'error', durationMs: 8000 });
    }
  }, [history.isError, toast]);

  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  const handleCopy = async (_id: string, content: string): Promise<void> => {
    try {
      const item = items.find((entry) => entry.id === _id);
      if (item?.contentType === 'image/png') {
        await clipboardIpc.copyStored(_id);
      } else {
        await navigator.clipboard.writeText(content).catch(async () => {
          await clipboardIpc.copyAgain(content);
        });
      }
      toast.push('Copied to clipboard', { variant: 'success' });
    } catch (err) {
      toast.push(`Copy failed: ${errorMessage(err)}`, { variant: 'error' });
    }
  };

  const handleEdit = async (id: string, content: string): Promise<void> => {
    try {
      await update.mutateAsync({ id, content });
      toast.push('Clipboard entry updated', { variant: 'success' });
    } catch (err) {
      toast.push(`Update failed: ${errorMessage(err)}`, { variant: 'error' });
    }
  };

  const handleSelect = (id: string, selected: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleDeleteSelected = async (): Promise<void> => {
    if (!selectedIds.size) return;
    const confirmed = await confirm({
      title: `Delete ${selectedIds.size} clipboard entries?`,
      description: 'The selected entries will be removed from local clipboard history.',
      confirmLabel: 'Delete entries',
    });
    if (!confirmed) return;
    try {
      await removeMany.mutateAsync([...selectedIds]);
      toast.push(`${selectedIds.size} entries deleted`, { variant: 'success' });
      setSelectedIds(new Set());
    } catch (err) {
      toast.push(`Delete failed: ${errorMessage(err)}`, { variant: 'error' });
    }
  };

  const handleTogglePin = async (id: string): Promise<void> => {
    try {
      await pin.mutateAsync(id);
    } catch (err) {
      toast.push(`Pin failed: ${errorMessage(err)}`, { variant: 'error' });
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    const confirmed = await confirm({
      title: 'Delete this clipboard entry?',
      description: 'This entry will be removed from local clipboard history.',
      confirmLabel: 'Delete entry',
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(id);
      toast.push('Entry deleted', { variant: 'success' });
    } catch (err) {
      toast.push(`Delete failed: ${errorMessage(err)}`, { variant: 'error' });
    }
  };

  const handleRecord = async (): Promise<void> => {
    if (!captureInput.trim()) {
      toast.push('Capture content is empty', { variant: 'error' });
      return;
    }
    try {
      await record.mutateAsync({ content: captureInput });
      setCaptureInput('');
      setCaptureMode(false);
      toast.push('Captured to clipboard history', { variant: 'success' });
    } catch (err) {
      toast.push(`Capture failed: ${errorMessage(err)}`, { variant: 'error' });
    }
  };

  const handleSaveAsScript = async (item: ClipboardItemDto): Promise<void> => {
    if (item.contentType.startsWith('image/')) return;
    const firstLine = item.content.trim().split(/\r?\n/u)[0]?.replace(/\s+/gu, ' ') ?? '';
    const title =
      firstLine.slice(0, 72) || `Clipboard ${new Date(item.capturedAt).toLocaleString()}`;
    try {
      const script = await createScript.mutateAsync({
        title,
        content: item.content,
        shell: 'bash',
        description: 'Saved from Clipboard',
      });
      await markSaved.mutateAsync({ id: item.id, scriptId: script.id });
      toast.push('Saved to Script Library', { variant: 'success' });
    } catch (err) {
      toast.push(`Save to Library failed: ${errorMessage(err)}`, { variant: 'error' });
    }
  };

  return (
    <section className="dd-page dd-page--clipboard">
      <header className="dd-page__header">
        <div>
          <span className="dd-eyebrow">Clipboard history</span>
          <h2>Clipboard</h2>
          <p>{total} entries · search, copy, and keep favorites close.</p>
        </div>
        <div className="dd-page__actions">
          <button type="button" onClick={() => setCaptureMode((v) => !v)}>
            {captureMode ? (
              'Cancel'
            ) : (
              <>
                <Plus size={15} /> Manual capture
              </>
            )}
          </button>
        </div>
      </header>

      {captureMode && (
        <div className="dd-clipboard-capture">
          <textarea
            value={captureInput}
            onChange={(event) => setCaptureInput(event.target.value)}
            placeholder="Paste or type content to capture…"
            rows={3}
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              void handleRecord();
            }}
            disabled={record.isPending}
          >
            {record.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      <div className="dd-clipboard-toolbar" aria-label="Clipboard controls">
        <label className="dd-clipboard-search">
          <span aria-hidden="true">
            <Search size={15} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clipboard"
            aria-label="Search clipboard"
          />
        </label>
        <label className="dd-clipboard-sort">
          <span>Sort</span>
          <UiSelect
            value={sort}
            onValueChange={setSort}
            options={SORT_OPTIONS}
            ariaLabel="Sort clipboard"
          />
        </label>
        <label className="dd-clipboard-sort">
          <span>Rows</span>
          <UiSelect
            value={pageSize}
            onValueChange={setPageSize}
            options={PAGE_SIZE_OPTIONS}
            ariaLabel="Rows per page"
            className="dd-ui-select--page-size"
          />
        </label>
        <div className="dd-view-switcher" aria-label="Display mode">
          <button
            type="button"
            className={view === 'table' ? 'is-active' : ''}
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
            aria-label="Table view"
            title="Table view"
          >
            <List size={16} />
          </button>
          <button
            type="button"
            className={view === 'grid' ? 'is-active' : ''}
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
            aria-label="Grid view"
            title="Grid view"
          >
            <Grid2X2 size={15} />
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="dd-selection-bar">
          <span>{selectedIds.size} selected</span>
          <button
            type="button"
            onClick={() => {
              void handleDeleteSelected();
            }}
            disabled={removeMany.isPending}
          >
            <Trash2 size={15} /> Delete selected
          </button>
          <button type="button" onClick={() => setSelectedIds(new Set())}>
            Clear
          </button>
        </div>
      )}

      {history.isPending && <SkeletonList count={4} />}
      {history.isError && (
        <p className="dd-banner dd-banner--error">Failed to load clipboard history.</p>
      )}
      {history.data && items.length === 0 && (
        <div className="dd-empty-state dd-empty-state--orange">
          <span className="dd-empty-state__icon">
            <ClipboardPaste size={24} />
          </span>
          <strong>{search ? 'No matching clipboard entries' : 'Nothing captured yet'}</strong>
          <p>
            {search
              ? 'Try another phrase or clear the current search.'
              : 'Copy text or an image and DevDock will keep it available locally.'}
          </p>
          {search ? (
            <button type="button" onClick={() => setSearch('')}>
              Clear search
            </button>
          ) : (
            <button type="button" onClick={() => setCaptureMode(true)}>
              <Plus size={15} /> Add manually
            </button>
          )}
        </div>
      )}
      {items.length > 0 &&
        (view === 'table' ? (
          <div className="dd-clipboard-table-wrap">
            <table className="dd-clipboard-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={items.length > 0 && items.every((item) => selectedIds.has(item.id))}
                      onChange={(event) =>
                        setSelectedIds(
                          event.target.checked ? new Set(items.map((item) => item.id)) : new Set(),
                        )
                      }
                      aria-label="Select all entries"
                    />
                  </th>
                  <th aria-label="Pin to top" />
                  <th>Content</th>
                  <th>Source</th>
                  <th>Date</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ClipboardItemRow
                    key={item.id}
                    item={item}
                    view="table"
                    onCopy={(id, content) => {
                      void handleCopy(id, content);
                    }}
                    onTogglePin={(id) => {
                      void handleTogglePin(id);
                    }}
                    onDelete={(id) => {
                      void handleDelete(id);
                    }}
                    onEdit={(id, content) => {
                      void handleEdit(id, content);
                    }}
                    onSaveAsScript={(entry) => {
                      void handleSaveAsScript(entry);
                    }}
                    onSelect={handleSelect}
                    selected={selectedIds.has(item.id)}
                    busy={
                      pin.isPending ||
                      remove.isPending ||
                      update.isPending ||
                      createScript.isPending ||
                      markSaved.isPending
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dd-clipboard-list dd-clipboard-list--grid">
            {items.map((item) => (
              <ClipboardItemRow
                key={item.id}
                item={item}
                view="grid"
                onCopy={(id, content) => {
                  void handleCopy(id, content);
                }}
                onTogglePin={(id) => {
                  void handleTogglePin(id);
                }}
                onDelete={(id) => {
                  void handleDelete(id);
                }}
                onEdit={(id, content) => {
                  void handleEdit(id, content);
                }}
                onSaveAsScript={(entry) => {
                  void handleSaveAsScript(entry);
                }}
                onSelect={handleSelect}
                selected={selectedIds.has(item.id)}
                busy={
                  pin.isPending ||
                  remove.isPending ||
                  update.isPending ||
                  createScript.isPending ||
                  markSaved.isPending
                }
              />
            ))}
          </div>
        ))}
      {!history.isPending && (
        <nav className="dd-pagination" aria-label="Clipboard pages">
          <span className="dd-pagination__summary">
            {firstVisible}–{lastVisible} of {total}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0}
          >
            Previous
          </button>
          <div className="dd-pagination__pages" aria-label={`Page ${page + 1} of ${totalPages}`}>
            {visiblePages.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className={pageNumber === page ? 'is-active' : ''}
                onClick={() => setPage(pageNumber)}
                aria-current={pageNumber === page ? 'page' : undefined}
              >
                {pageNumber + 1}
              </button>
            ))}
          </div>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
