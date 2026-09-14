// TanStack Query hooks for the Clipboard feature.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Id } from '@devdock/types';

import { clipboardIpc } from '../ipc/clipboard';

export const clipboardKeys = {
  all: ['clipboard'] as const,
  history: (limit: number, pinnedOnly: boolean, offset: number) =>
    [...clipboardKeys.all, 'history', limit, pinnedOnly, offset] as const,
};

// The Rust engine polls the platform clipboard every 500ms. Refresh slightly
// less frequently while this page is visible so newly captured entries appear
// without a navigation round-trip, while avoiding background IPC when users
// are working elsewhere in the app.
const HISTORY_REFRESH_MS = 750;

export function useClipboardHistory(limit = 50, pinnedOnly = false, offset = 0) {
  return useQuery({
    queryKey: clipboardKeys.history(limit, pinnedOnly, offset),
    queryFn: () => clipboardIpc.listHistory(limit, pinnedOnly, offset),
    refetchInterval: HISTORY_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

export function useClipboardPage(
  limit = 20,
  offset = 0,
  query = '',
  sort: 'newest' | 'oldest' | 'favorite' = 'newest',
) {
  return useQuery({
    queryKey: [...clipboardKeys.history(limit, false, offset), query, sort, 'page'],
    queryFn: async () => {
      const [items, total] = await Promise.all([
        clipboardIpc.listHistory(limit, false, offset, query, sort),
        clipboardIpc.countHistory(false, query),
      ]);
      return { items, total };
    },
    placeholderData: (previous) => previous,
    refetchInterval: HISTORY_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

export function usePinClipboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => clipboardIpc.pin(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clipboardKeys.all });
    },
  });
}

export function useDeleteClipboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => clipboardIpc.delete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clipboardKeys.all });
    },
  });
}

export function useDeleteClipboardMany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: Id[]) => clipboardIpc.deleteMany(ids),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clipboardKeys.all });
    },
  });
}

export function useUpdateClipboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: Id; content: string }) => clipboardIpc.update(id, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clipboardKeys.all });
    },
  });
}

export function useMarkClipboardSaved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scriptId }: { id: Id; scriptId: Id }) =>
      clipboardIpc.markSaved(id, scriptId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clipboardKeys.all });
    },
  });
}

export function useRecordClipboardCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; contentType?: string }) =>
      clipboardIpc.recordCapture(input.content, input.contentType ?? 'text/plain'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clipboardKeys.all });
    },
  });
}
