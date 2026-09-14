// SSH contracts shared by the renderer and Electron IPC layer.

import type { Id, SshAuthMethod as SshAuthMethodDto } from './library';
import type { TimestampMillis } from './common';

// Re-export SshAuthMethod from library for downstream convenience.
export type { SshAuthMethod } from './library';

/**
 * DTO for an SSH host profile.
 */
export interface SshHostDto {
  id: Id;
  /** Library item title (matches `SshHostDto.title` on the Rust side). */
  title: string;
  /** Optional description. */
  description?: string;
  /** Favorite flag. */
  favorite: boolean;
  /** Archived flag. */
  archived: boolean;
  /** SSH host (e.g. "example.com" or "192.168.1.1"). */
  host: string;
  /** TCP port. */
  port: number;
  /** Login username. */
  username: string;
  /** Authentication method ("password" | "public_key"). */
  authMethod: SshAuthMethodDto;
  /** Whether this device has an OS-encrypted password for the host. */
  hasSavedPassword?: boolean;
}

/**
 * Stable identifier for an active SSH session (client-side, for IPC routing).
 */
export type SshSessionIdDto = string;

/**
 * Request: `create_ssh_host`.
 */
export interface CreateSshHostRequest {
  /** Library item title. */
  title: string;
  /** Optional description. */
  description?: string;
  /** Host. */
  host: string;
  /** Port (1-65535). */
  port: number;
  /** Username. */
  username: string;
  /** Auth method: "password" | "public_key". */
  authMethod: string;
  /** Optional credential payload to store in the OS Keychain. */
  credential?: string;
  /** Password supplied for encrypted local storage. Never returned by list APIs. */
  password?: string;
  /** Save or remove the encrypted password for this host. */
  savePassword?: boolean;
}

/**
 * Request: `update_ssh_host`.
 */
export interface UpdateSshHostRequest {
  /** Library / SSH host id. */
  id: Id;
  /** New title. */
  title: string;
  /** Optional new description. */
  description?: string;
  /** New host. */
  host: string;
  /** New port. */
  port: number;
  /** New username. */
  username: string;
  /** New auth method. */
  authMethod: string;
  /** Optional new credential. */
  credential?: string;
  /** Replacement password; blank keeps the existing encrypted password. */
  password?: string;
  /** Save or remove the encrypted password for this host. */
  savePassword?: boolean;
}

/**
 * Request: `connect_ssh`.
 */
export interface ConnectSshRequest {
  /** Library / SSH host id. */
  id: Id;
  /** Optional override credential (otherwise read from keychain). */
  credential?: string;
}

/**
 * Response: `connect_ssh`.
 */
export interface ConnectSshResponse {
  /** Active session id. */
  sessionId: SshSessionIdDto;
}

/**
 * Request: `ssh_exec` (write to PTY stdin).
 */
export interface SshExecRequest {
  /** Active session id. */
  sessionId: SshSessionIdDto;
  /** UTF-8 terminal input. */
  data: string;
}

/**
 * Request: `ssh_resize` (PTY window change).
 */
export interface SshResizeRequest {
  /** Active session id. */
  sessionId: SshSessionIdDto;
  /** New width in columns. */
  cols: number;
  /** New height in rows. */
  rows: number;
}

/**
 * Response: `list_recent_hosts` (top-N most-recently used).
 */
export interface ListRecentHostsResponse {
  /** Recent hosts ordered by last_connected_at DESC. */
  hosts: SshHostDto[];
}

/**
 * Request: `save_command_to_library` (the "Save command" button).
 */
export interface SaveCommandRequest {
  /** Active session id. */
  sessionId: SshSessionIdDto;
  /** Command text. */
  command: string;
  /** Optional description. */
  description?: string;
}

/**
 * Response: `save_command_to_library`.
 */
export interface SaveCommandResponse {
  /** The new Script library item id. */
  id: Id;
}

/**
 * Backwards-compatible alias for `ConnectSshRequest`.
 * @deprecated Use `ConnectSshRequest` instead.
 */
export type SshConnectRequest = ConnectSshRequest;

/**
 * Authentication material. Credentials are loaded from the OS keychain on demand.
 */
export type SshAuth =
  | { method: 'public_key'; keyPath: string }
  | { method: 'password'; password: string }
  | { method: 'agent' };

/**
 * Event emitted by the backend when new SSH output is available.
 */
export interface SshDataEvent {
  sessionId: string;
  data: string;
  at: TimestampMillis;
}
