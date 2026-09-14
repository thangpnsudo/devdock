import { LibraryBig, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { GlobalSearch } from '../../search/components/global-search';
import { useConfirm } from '../../shell/components/confirm-dialog';
import { SkeletonList } from '../../shell/components/skeleton';
import { useToast } from '../../shell/components/toast';
import { LibraryItemDetail } from '../components/library-item-detail';
import { LibraryItemList } from '../components/library-item-list';
import { NotesWorkspace } from '../components/notes-workspace';
import { ScriptForm } from '../components/script-form';
import {
  useCreateScript,
  useDeleteItem,
  useDeleteItems,
  useLibraryItem,
  useLibraryPage,
  useToggleFavorite,
  useUpdateScript,
} from '../hooks/use-library';
import type { LibraryItemDto } from '@devdock/types';

type LibraryView = 'scripts' | 'notes';

export function LibraryPage(): JSX.Element {
  const [view, setView] = useState<LibraryView>('scripts');
  const [page, setPage] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get('item') ?? searchParams.get('script');
  const requestedItem = useLibraryItem(requestedId);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const pageSize = 20;
  const list = useLibraryPage(pageSize, page * pageSize, 'script');
  const create = useCreateScript();
  const update = useUpdateScript();
  const remove = useDeleteItem();
  const removeMany = useDeleteItems();
  const favorite = useToggleFavorite();
  const toast = useToast();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryItemDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedQuery = useLibraryItem(selectedId);
  const selected = items.find((item) => item.id === selectedId) ?? selectedQuery.data ?? null;

  useEffect(() => {
    if (list.data && page >= totalPages) setPage(totalPages - 1);
  }, [list.data, page, totalPages]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectedId(null);
  }, [page]);

  useEffect(() => {
    const item = requestedItem.data;
    if (!requestedId || !item) return;
    if (item.body?.type === 'note') {
      setView('notes');
      setPendingNoteId(item.id);
    } else if (item.body?.type === 'script') {
      setView('scripts');
      setSelectedId(item.id);
    }
    setSearchParams({}, { replace: true });
  }, [requestedId, requestedItem.data, setSearchParams]);

  const runAction = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
    try {
      await action();
      toast.push(success, { variant: 'success' });
      return true;
    } catch (error) {
      toast.push(error instanceof Error ? error.message : String(error), {
        variant: 'error',
      });
      return false;
    }
  };

  const switchView = (next: LibraryView): void => {
    setView(next);
    setCreateOpen(false);
    setEditing(null);
    setSelectedId(null);
    setSelectedIds(new Set());
  };

  return (
    <section className="dd-page dd-page--library">
      <header className="dd-page__header">
        <div>
          <span className="dd-eyebrow">Your working library</span>
          <h2>
            {view === 'notes' ? 'Write first. Organize later.' : 'Keep useful commands close.'}
          </h2>
          <p>
            {view === 'notes'
              ? 'Open a note and start typing. Every change is saved automatically.'
              : 'Save, review and reuse scripts without leaving your workflow.'}
          </p>
        </div>
        {view === 'scripts' && (
          <div className="dd-page__actions">
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setCreateOpen((value) => !value);
              }}
            >
              {createOpen ? (
                'Cancel'
              ) : (
                <>
                  <Plus size={15} /> New script
                </>
              )}
            </button>
          </div>
        )}
      </header>

      {view === 'scripts' && <GlobalSearch />}

      <div className="dd-library-filters" role="tablist" aria-label="Library view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'scripts'}
          className={view === 'scripts' ? 'is-active' : ''}
          onClick={() => switchView('scripts')}
        >
          Scripts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'notes'}
          className={view === 'notes' ? 'is-active' : ''}
          onClick={() => switchView('notes')}
        >
          Notes
        </button>
      </div>

      {view === 'notes' ? (
        <NotesWorkspace
          requestedId={pendingNoteId}
          onRequestHandled={() => setPendingNoteId(null)}
        />
      ) : (
        <>
          {createOpen && (
            <ScriptForm
              busy={create.isPending}
              onCancel={() => setCreateOpen(false)}
              onSubmit={async (input) => {
                if (await runAction(() => create.mutateAsync(input), 'Script created')) {
                  setCreateOpen(false);
                }
              }}
            />
          )}

          {editing && (
            <ScriptForm
              key={editing.id}
              initial={editing}
              busy={update.isPending}
              onCancel={() => setEditing(null)}
              onSubmit={async (input) => {
                const saved = await runAction(
                  () => update.mutateAsync({ id: editing.id, ...input }),
                  'Script updated',
                );
                if (saved) setEditing(null);
              }}
            />
          )}

          {list.isPending && <SkeletonList count={5} />}
          {list.isError && (
            <p className="dd-banner dd-banner--error">Scripts could not be loaded.</p>
          )}
          {list.data && items.length === 0 && (
            <div className="dd-empty-state">
              <span className="dd-empty-state__icon">
                <LibraryBig size={24} />
              </span>
              <strong>Your script library starts here</strong>
              <p>Save a command once and keep it ready for the next task.</p>
              <button type="button" onClick={() => setCreateOpen(true)}>
                <Plus size={15} /> Create first script
              </button>
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="dd-selection-bar">
              <span>{selectedIds.size} selected</span>
              <button
                type="button"
                disabled={removeMany.isPending}
                onClick={() => {
                  void confirm({
                    title: `Delete ${selectedIds.size} scripts?`,
                    description: 'The selected scripts will be removed from your local Library.',
                    confirmLabel: 'Delete scripts',
                  }).then((confirmed) => {
                    if (!confirmed) return;
                    void runAction(
                      () => removeMany.mutateAsync([...selectedIds]),
                      `${selectedIds.size} scripts deleted`,
                    ).then((deleted) => {
                      if (deleted) setSelectedIds(new Set());
                    });
                  });
                }}
              >
                <Trash2 size={14} /> Delete selected
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())}>
                Clear
              </button>
            </div>
          )}

          {items.length > 0 && (
            <div className="dd-library-grid">
              <LibraryItemList
                items={items}
                selectedId={selectedId}
                selectedIds={selectedIds}
                onSelectEntry={(id, checked) =>
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
                onSelectAll={(checked) =>
                  setSelectedIds(checked ? new Set(items.map(({ id }) => id)) : new Set())
                }
                onSelect={setSelectedId}
                onToggleFavorite={(id) =>
                  void runAction(() => favorite.mutateAsync(id), 'Favorite updated')
                }
                onEdit={(item) => {
                  setCreateOpen(false);
                  setEditing(item);
                }}
                onDelete={(id) => {
                  const item = items.find((candidate) => candidate.id === id);
                  void confirm({
                    title: 'Delete this script?',
                    description: item
                      ? `“${item.title}” will be removed from your local Library.`
                      : 'This script will be removed from your local Library.',
                    confirmLabel: 'Delete script',
                  }).then((confirmed) => {
                    if (!confirmed) return;
                    if (id === selectedId) setSelectedId(null);
                    void runAction(() => remove.mutateAsync(id), 'Script deleted');
                  });
                }}
              />
              <LibraryItemDetail item={selected} />
            </div>
          )}

          {!list.isPending && (
            <nav className="dd-pagination" aria-label="Script pages">
              <span className="dd-pagination__summary">
                {total === 0 ? 0 : page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of{' '}
                {total}
              </span>
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                Previous
              </button>
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
