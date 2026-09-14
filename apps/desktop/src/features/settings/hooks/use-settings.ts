// TanStack Query hooks for the Settings feature.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SaveSettingsRequest } from '@devdock/types';

import { settingsIpc } from '../ipc/settings';

export const settingsKeys = {
  all: ['settings'] as const,
  current: () => [...settingsKeys.all, 'current'] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.current(),
    queryFn: () => settingsIpc.get(),
    staleTime: 5 * 60_000,
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveSettingsRequest) => settingsIpc.save(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}
