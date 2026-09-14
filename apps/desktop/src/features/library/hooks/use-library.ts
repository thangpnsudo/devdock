// TanStack Query hooks for the Library feature.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateLibraryResourceRequest,
  CreateScriptRequest,
  Id,
  LibraryResourceFilter,
  SearchLibraryRequest,
  UpdateLibraryResourceRequest,
  UpdateScriptRequest,
} from '@devdock/types';

import { libraryIpc } from '../ipc/library';

export const libraryKeys = {
  all: ['library'] as const,
  list: () => [...libraryKeys.all, 'list'] as const,
  detail: (id: Id) => [...libraryKeys.all, 'detail', id] as const,
  search: (q: string) => [...libraryKeys.all, 'search', q] as const,
};

/** Lists recent library items. */
export function useRecentLibraryItems(limit = 50) {
  return useQuery({
    queryKey: [...libraryKeys.list(), limit],
    queryFn: () => libraryIpc.listRecent(limit),
  });
}

export function useLibraryPage(limit = 20, offset = 0, filter: LibraryResourceFilter = 'all') {
  return useQuery({
    queryKey: [...libraryKeys.list(), 'page', limit, offset, filter],
    queryFn: () => libraryIpc.listPage(limit, offset, filter),
    placeholderData: (previous) => previous,
  });
}

/** Fetches a single library item by id. */
export function useLibraryItem(id: Id | null) {
  return useQuery({
    queryKey: id ? libraryKeys.detail(id) : libraryKeys.all,
    queryFn: () => (id ? libraryIpc.getById(id) : null),
    enabled: id !== null,
  });
}

/** Mutation: create a new Script. */
export function useCreateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScriptRequest) => libraryIpc.createScript(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
    },
  });
}

/** Mutation: update an existing Script. */
export function useUpdateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateScriptRequest) => libraryIpc.updateScript(input),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
      void qc.invalidateQueries({ queryKey: libraryKeys.detail(variables.id) });
    },
  });
}

export function useCreateLibraryResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLibraryResourceRequest) => libraryIpc.createResource(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
    },
  });
}

export function useUpdateLibraryResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLibraryResourceRequest) => libraryIpc.updateResource(input),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
      void qc.invalidateQueries({ queryKey: libraryKeys.detail(variables.id) });
    },
  });
}

/** Mutation: archive an item. */
export function useArchiveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => libraryIpc.archive(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
      void qc.invalidateQueries({ queryKey: libraryKeys.detail(id) });
    },
  });
}

/** Mutation: restore an item. */
export function useRestoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => libraryIpc.restore(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
      void qc.invalidateQueries({ queryKey: libraryKeys.detail(id) });
    },
  });
}

/** Mutation: delete an item. */
export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => libraryIpc.delete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
    },
  });
}

export function useDeleteItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: Id[]) => libraryIpc.deleteMany(ids),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
    },
  });
}

/** Mutation: toggle favorite flag. */
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => libraryIpc.toggleFavorite(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: libraryKeys.list() });
      void qc.invalidateQueries({ queryKey: libraryKeys.detail(id) });
    },
  });
}

/** Search hook (debounced via the caller if desired). */
export function useSearch(query: string) {
  return useQuery({
    queryKey: libraryKeys.search(query),
    queryFn: () =>
      libraryIpc.search({
        query,
        limit: 25,
        offset: 0,
        favoritesOnly: false,
        includeArchived: false,
      } satisfies SearchLibraryRequest),
    enabled: query.trim().length > 0,
  });
}
