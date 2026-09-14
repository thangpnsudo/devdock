// TanStack Query hooks for the SSH feature.

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { sshIpc } from '../ipc/ssh';
import type {
  ConnectSshRequest,
  CreateSshHostRequest,
  SaveCommandRequest,
  UpdateSshHostRequest,
} from '@devdock/types';

export const sshKeys = {
  all: ['ssh'] as const,
  hosts: () => [...sshKeys.all, 'hosts'] as const,
  recent: () => [...sshKeys.all, 'recent'] as const,
};

export function useSshHosts() {
  return useQuery({
    queryKey: sshKeys.hosts(),
    queryFn: () => sshIpc.listHosts(),
  });
}

export function useRecentSshHosts() {
  return useQuery({
    queryKey: sshKeys.recent(),
    queryFn: () => sshIpc.listRecent(),
  });
}

export function useCreateSshHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateSshHostRequest) => sshIpc.createHost(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sshKeys.all });
    },
  });
}

export function useUpdateSshHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateSshHostRequest) => sshIpc.updateHost(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sshKeys.all });
    },
  });
}

export function useDeleteSshHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sshIpc.deleteHost(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sshKeys.all });
    },
  });
}

export function useConnectSsh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: ConnectSshRequest) => sshIpc.connect(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sshKeys.recent() });
    },
  });
}

export function useDisconnectSsh() {
  return useMutation({
    mutationFn: (sessionId: { sessionId: string } | string) =>
      sshIpc.disconnect(typeof sessionId === 'string' ? sessionId : sessionId.sessionId),
  });
}

export function useSaveSshCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: SaveCommandRequest) => sshIpc.saveCommand(request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sshKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Hook for consumers that want raw SSH byte access.
// to the live SSH stream (the TerminalView manages its own subscription;
// this hook is provided for downstream reuse — e.g. raw byte viewers).
// ---------------------------------------------------------------------------

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Subscribes to `ssh:data` for the given session, decodes base64, and
 * invokes `onData` with a Uint8Array. Automatically unlistens on unmount
 * or when `sessionId` changes.
 */
export function useSshData(sessionId: string | null, onData: (bytes: Uint8Array) => void): void {
  useEffect(() => {
    if (!sessionId) return undefined;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const fn = await sshIpc.subscribeOutput(sessionId, (event) => {
          try {
            onData(base64ToUint8(event.data));
          } catch {
            /* malformed payload; ignored */
          }
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {
        /* listener setup failed; ignored */
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [sessionId, onData]);
}
