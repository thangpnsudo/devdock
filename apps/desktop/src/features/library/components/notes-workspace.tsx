import { Braces, ChevronDown, ChevronUp, FileText, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryItemDto, NoteContentFormat } from '@devdock/types';

import { useConfirm } from '../../shell/components/confirm-dialog';
import { UiSelect } from '../../shell/components/ui-select';
import { useToast } from '../../shell/components/toast';
import {
  useCreateLibraryResource,
  useDeleteItem,
  useLibraryPage,
  useUpdateLibraryResource,
} from '../hooks/use-library';
import { libraryIpc } from '../ipc/library';
import {
  deriveNoteTitle,
  formatJson,
  jsonValidationError,
  nextNoteMatch,
  noteMatchIndexes,
  noteMatchVisualRow,
} from './note-utils';

const OPEN_NOTES_KEY = 'devdock.library.openNotes';
const ACTIVE_NOTE_KEY = 'devdock.library.activeNote';
const NOTE_FORMATS: ReadonlyArray<{ value: NoteContentFormat; label: string }> = [
  { value: 'plain', label: 'Plain text' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
];

type SaveState = 'saved' | 'pending' | 'saving' | 'error';

interface NoteDraft {
  content: string;
  contentFormat: NoteContentFormat;
  revision: number;
  state: SaveState;
}
function storedOpenNotes(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(OPEN_NOTES_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function noteDraft(item: LibraryItemDto): NoteDraft | null {
  if (item.body?.type !== 'note') return null;
  return {
    content: item.body.content,
    contentFormat: item.body.contentFormat,
    revision: 0,
    state: 'saved',
  };
}

interface NotesWorkspaceProps {
  requestedId?: string | null;
  onRequestHandled?: () => void;
}

export function NotesWorkspace({
  requestedId,
  onRequestHandled,
}: NotesWorkspaceProps): JSX.Element {
  const notesQuery = useLibraryPage(200, 0, 'note');
  const create = useCreateLibraryResource();
  const update = useUpdateLibraryResource();
  const remove = useDeleteItem();
  const confirm = useConfirm();
  const toast = useToast();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const draftsRef = useRef<Record<string, NoteDraft>>({});
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Record<string, NoteDraft>>({});
  const [openIds, setOpenIds] = useState<string[]>(storedOpenNotes);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_NOTE_KEY),
  );
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(-1);
  const [listQuery, setListQuery] = useState('');

  const notes = useMemo(
    () => notesQuery.data?.items.filter((item) => item.body?.type === 'note') ?? [],
    [notesQuery.data?.items],
  );
  const notesById = useMemo(() => new Map(notes.map((item) => [item.id, item])), [notes]);
  const visibleNotes = useMemo(() => {
    const normalized = listQuery.trim().toLocaleLowerCase();
    if (!normalized) return notes;
    return notes.filter((note) => {
      const draft = drafts[note.id];
      const title = draft ? deriveNoteTitle(draft.content) : note.title;
      const content = draft?.content ?? (note.body?.type === 'note' ? note.body.content : '');
      return `${title}\n${content}`.toLocaleLowerCase().includes(normalized);
    });
  }, [drafts, listQuery, notes]);
  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const item of notes) {
        if (!next[item.id]) {
          const draft = noteDraft(item);
          if (draft) {
            next[item.id] = draft;
            changed = true;
          }
        }
      }
      if (!changed) {
        draftsRef.current = current;
        return current;
      }
      draftsRef.current = next;
      return next;
    });
  }, [notes]);

  useEffect(() => {
    if (!notesQuery.data) return;
    const knownIds = new Set(notes.map(({ id }) => id));
    setOpenIds((current) =>
      current.filter((id) => knownIds.has(id) || Boolean(draftsRef.current[id])),
    );
    setActiveId((current) =>
      current && (knownIds.has(current) || draftsRef.current[current]) ? current : null,
    );
  }, [notes, notesQuery.data]);

  useEffect(() => {
    localStorage.setItem(OPEN_NOTES_KEY, JSON.stringify(openIds));
  }, [openIds]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_NOTE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_NOTE_KEY);
  }, [activeId]);

  useEffect(() => {
    if (!requestedId || !notesById.has(requestedId)) return;
    setOpenIds((current) => (current.includes(requestedId) ? current : [...current, requestedId]));
    setActiveId(requestedId);
    onRequestHandled?.();
  }, [notesById, onRequestHandled, requestedId]);

  const persist = async (id: string, snapshot: NoteDraft): Promise<void> => {
    timers.current.delete(id);
    setDrafts((current) => {
      const existing = current[id];
      if (!existing || existing.revision !== snapshot.revision) return current;
      const next = {
        ...current,
        [id]: { ...existing, state: 'saving' as const },
      };
      draftsRef.current = next;
      return next;
    });
    try {
      await update.mutateAsync({
        id,
        kind: 'note',
        title: deriveNoteTitle(snapshot.content),
        content: snapshot.content,
        contentFormat: snapshot.contentFormat,
      });
      setDrafts((current) => {
        const existing = current[id];
        if (!existing || existing.revision !== snapshot.revision) return current;
        const next = {
          ...current,
          [id]: { ...existing, state: 'saved' as const },
        };
        draftsRef.current = next;
        return next;
      });
    } catch (error) {
      setDrafts((current) => {
        const existing = current[id];
        if (!existing || existing.revision !== snapshot.revision) return current;
        const next = {
          ...current,
          [id]: { ...existing, state: 'error' as const },
        };
        draftsRef.current = next;
        return next;
      });
      toast.push(error instanceof Error ? error.message : 'Note could not be saved.', {
        variant: 'error',
      });
    }
  };

  const scheduleSave = (id: string, patch: Pick<NoteDraft, 'content' | 'contentFormat'>): void => {
    const current = draftsRef.current[id] ?? {
      content: '',
      contentFormat: 'plain' as const,
      revision: 0,
      state: 'saved' as const,
    };
    const next: NoteDraft = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      state: 'pending',
    };
    const allDrafts = { ...draftsRef.current, [id]: next };
    draftsRef.current = allDrafts;
    setDrafts(allDrafts);
    const previousTimer = timers.current.get(id);
    if (previousTimer) clearTimeout(previousTimer);
    timers.current.set(
      id,
      setTimeout(() => void persist(id, next), 500),
    );
  };

  useEffect(
    () => () => {
      for (const [id, timer] of timers.current) {
        clearTimeout(timer);
        const draft = draftsRef.current[id];
        if (draft?.state === 'pending') {
          void libraryIpc
            .updateResource({
              id,
              kind: 'note',
              title: deriveNoteTitle(draft.content),
              content: draft.content,
              contentFormat: draft.contentFormat,
            })
            .catch(() => undefined);
        }
      }
    },
    [],
  );

  const openNote = (id: string): void => {
    setOpenIds((current) => (current.includes(id) ? current : [...current, id]));
    setActiveId(id);
  };

  const closeNote = (id: string, flush = true): void => {
    const timer = timers.current.get(id);
    const draft = draftsRef.current[id];
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    if (flush && timer && draft) {
      void persist(id, draft);
    }
    setOpenIds((current) => {
      const index = current.indexOf(id);
      const next = current.filter((candidate) => candidate !== id);
      if (activeId === id) setActiveId(next[Math.max(0, index - 1)] ?? null);
      return next;
    });
  };

  const createNote = async (): Promise<void> => {
    try {
      const created = await create.mutateAsync({
        kind: 'note',
        title: 'Untitled',
        content: '',
        contentFormat: 'plain',
      });
      const draft: NoteDraft = {
        content: '',
        contentFormat: 'plain',
        revision: 0,
        state: 'saved',
      };
      draftsRef.current = { ...draftsRef.current, [created.id]: draft };
      setDrafts(draftsRef.current);
      setOpenIds((current) => [...current, created.id]);
      setActiveId(created.id);
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Note could not be created.', {
        variant: 'error',
      });
    }
  };

  const activeDraft = activeId ? drafts[activeId] : undefined;
  const activeItem = activeId ? notesById.get(activeId) : undefined;
  const activeTitle = activeDraft
    ? deriveNoteTitle(activeDraft.content)
    : (activeItem?.title ?? 'Untitled');
  const jsonError =
    activeDraft?.contentFormat === 'json' ? jsonValidationError(activeDraft.content) : null;
  const findMatches = useMemo(
    () => noteMatchIndexes(activeDraft?.content ?? '', findQuery),
    [activeDraft?.content, findQuery],
  );

  const showFind = useCallback((): void => {
    if (!activeDraft) return;
    const editor = editorRef.current;
    const selected = editor?.value.slice(editor.selectionStart, editor.selectionEnd);
    if (selected) setFindQuery(selected);
    setFindOpen(true);
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [activeDraft]);

  const closeFind = useCallback((): void => {
    const editor = editorRef.current;
    const caret = editor?.selectionEnd ?? 0;
    setFindOpen(false);
    setFindQuery('');
    setActiveMatch(-1);
    window.requestAnimationFrame(() => {
      editor?.focus();
      editor?.setSelectionRange(caret, caret);
    });
  }, []);

  const moveFind = useCallback(
    (direction: 1 | -1): void => {
      setActiveMatch((current) => nextNoteMatch(current, findMatches.length, direction));
    },
    [findMatches.length],
  );

  useEffect(() => {
    const onFindShortcut = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'f') return;
      if (!activeDraft) return;
      event.preventDefault();
      showFind();
    };
    window.addEventListener('keydown', onFindShortcut);
    return () => window.removeEventListener('keydown', onFindShortcut);
  }, [activeDraft, showFind]);

  useEffect(() => {
    setFindOpen(false);
    setFindQuery('');
    setActiveMatch(-1);
  }, [activeId]);

  useEffect(() => {
    setActiveMatch(-1);
  }, [findQuery, findMatches.length]);

  useEffect(() => {
    const match = findMatches[activeMatch];
    if (match === undefined) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(match, match + findQuery.length);
    const style = window.getComputedStyle(editor);
    const fontSize = Number.parseFloat(style.fontSize) || 13;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.75;
    const horizontalPadding =
      (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    const characterWidth = fontSize * 0.62;
    const charactersPerRow = Math.max(
      1,
      Math.floor((editor.clientWidth - horizontalPadding) / characterWidth),
    );
    const row = noteMatchVisualRow(editor.value, match, charactersPerRow);
    const matchTop = (Number.parseFloat(style.paddingTop) || 0) + row * lineHeight;
    const matchBottom = matchTop + lineHeight;
    if (matchTop < editor.scrollTop || matchBottom > editor.scrollTop + editor.clientHeight) {
      editor.scrollTop = Math.max(0, matchTop - editor.clientHeight / 2);
    }
  }, [activeMatch, findMatches, findQuery.length]);

  return (
    <div className="dd-notes-workspace">
      <aside className="dd-notes-sidebar">
        <div className="dd-notes-sidebar__header">
          <strong>Notes</strong>
          <button
            type="button"
            onClick={() => void createNote()}
            disabled={create.isPending}
            aria-label="New note"
            title="New note"
          >
            <Plus size={15} />
          </button>
        </div>
        <label className="dd-notes-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={listQuery}
            onChange={(event) => setListQuery(event.target.value)}
            placeholder="Search all notes"
            aria-label="Search all notes"
          />
        </label>
        <div className="dd-notes-list">
          {visibleNotes.map((note) => {
            const draft = drafts[note.id];
            return (
              <button
                key={note.id}
                type="button"
                className={note.id === activeId ? 'is-active' : ''}
                onClick={() => openNote(note.id)}
              >
                <FileText size={14} />
                <span>
                  <strong>{draft ? deriveNoteTitle(draft.content) : note.title}</strong>
                  <small>{new Date(note.updatedAt).toLocaleString()}</small>
                </span>
              </button>
            );
          })}
          {!notesQuery.isPending && visibleNotes.length === 0 && (
            <p>{listQuery ? 'No matching notes.' : 'Press + to create your first note.'}</p>
          )}
        </div>
      </aside>

      <section className="dd-notes-editor">
        <div className="dd-note-tabs" role="tablist" aria-label="Open notes">
          {openIds.map((id) => {
            const draft = drafts[id];
            const title = draft
              ? deriveNoteTitle(draft.content)
              : (notesById.get(id)?.title ?? 'Untitled');
            return (
              <div key={id} className={id === activeId ? 'is-active' : ''}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={id === activeId}
                  onClick={() => openNote(id)}
                >
                  {title}
                </button>
                <button
                  type="button"
                  onClick={() => closeNote(id)}
                  aria-label={`Close ${title}`}
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="dd-note-tabs__add"
            onClick={() => void createNote()}
            aria-label="New note"
            title="New note"
          >
            <Plus size={14} />
          </button>
        </div>

        {activeId && activeDraft ? (
          <>
            <header className="dd-note-editor__toolbar">
              <div>
                <strong>{activeTitle}</strong>
                <span data-state={activeDraft.state}>
                  {activeDraft.state === 'pending'
                    ? 'Unsaved'
                    : activeDraft.state === 'saving'
                      ? 'Saving…'
                      : activeDraft.state === 'error'
                        ? 'Save failed'
                        : 'Saved'}
                </span>
              </div>
              <div>
                <UiSelect
                  value={activeDraft.contentFormat}
                  onValueChange={(contentFormat) =>
                    scheduleSave(activeId, {
                      content: activeDraft.content,
                      contentFormat,
                    })
                  }
                  options={NOTE_FORMATS}
                  ariaLabel="Note content format"
                />
                {activeDraft.contentFormat === 'json' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (jsonError || !activeDraft.content.trim()) return;
                      scheduleSave(activeId, {
                        content: formatJson(activeDraft.content),
                        contentFormat: 'json',
                      });
                    }}
                    disabled={Boolean(jsonError) || !activeDraft.content.trim()}
                  >
                    <Braces size={14} /> Format JSON
                  </button>
                )}
                <button
                  type="button"
                  onClick={showFind}
                  aria-label="Find in note"
                  title="Find in note (Ctrl+F)"
                >
                  <Search size={14} />
                </button>
                <button
                  type="button"
                  className="dd-note-editor__delete"
                  onClick={() => {
                    void confirm({
                      title: 'Delete this note?',
                      description: `“${activeTitle}” will be removed from your local notes.`,
                      confirmLabel: 'Delete note',
                    }).then((confirmed) => {
                      if (!confirmed) return;
                      closeNote(activeId, false);
                      void remove.mutateAsync(activeId).catch((error: unknown) => {
                        toast.push(
                          error instanceof Error ? error.message : 'Note could not be deleted.',
                          { variant: 'error' },
                        );
                      });
                    });
                  }}
                  aria-label="Delete note"
                  title="Delete note"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </header>
            {findOpen && (
              <div className="dd-note-find" role="search">
                <Search size={13} aria-hidden="true" />
                <input
                  ref={findInputRef}
                  type="search"
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeFind();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      moveFind(event.shiftKey ? -1 : 1);
                    }
                  }}
                  placeholder="Find in this note"
                  aria-label="Find in this note"
                />
                <span>
                  {findMatches.length ? `${activeMatch + 1}/${findMatches.length}` : '0/0'}
                </span>
                <button
                  type="button"
                  onClick={() => moveFind(-1)}
                  disabled={!findMatches.length}
                  aria-label="Previous match"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => moveFind(1)}
                  disabled={!findMatches.length}
                  aria-label="Next match"
                >
                  <ChevronDown size={13} />
                </button>
                <button type="button" onClick={closeFind} aria-label="Close find">
                  <X size={13} />
                </button>
              </div>
            )}
            <textarea
              ref={editorRef}
              className="dd-note-editor__surface"
              value={activeDraft.content}
              onChange={(event) => {
                scheduleSave(activeId, {
                  content: event.target.value,
                  contentFormat: activeDraft.contentFormat,
                });
              }}
              onKeyDown={(event) => {
                if (!findOpen) return;
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeFind();
                  return;
                }
                if (event.key === 'Enter' && findQuery) {
                  event.preventDefault();
                  moveFind(event.shiftKey ? -1 : 1);
                }
              }}
              onBlur={() => {
                const timer = timers.current.get(activeId);
                const draft = draftsRef.current[activeId];
                if (timer && draft) {
                  clearTimeout(timer);
                  // Let the pending pointer click finish before autosave updates
                  // React state. A synchronous update during blur can detach a
                  // sidebar NavLink before its click handler reaches the router.
                  timers.current.set(
                    activeId,
                    setTimeout(() => void persist(activeId, draft), 0),
                  );
                }
              }}
              autoFocus
              spellCheck={activeDraft.contentFormat !== 'json'}
              placeholder="Start typing…"
              aria-label="Note content"
            />
            {jsonError && (
              <p className="dd-note-editor__error" role="alert">
                {jsonError}
              </p>
            )}
          </>
        ) : (
          <div className="dd-notes-empty">
            <FileText size={28} />
            <strong>Write without setup</strong>
            <p>Create a note and start typing. DevDock saves it automatically.</p>
          </div>
        )}
      </section>
    </div>
  );
}
