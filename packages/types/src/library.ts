// Library contracts shared by the renderer and Electron IPC layer.

import type { Id, LibraryItemKind, TimestampMillis } from "./common";

// Re-export shared types for downstream convenience.
export type { Id, TimestampMillis };

/**
 * Library item DTO returned over IPC.
 */
export interface LibraryItemDto {
  id: Id;
  kind: LibraryItemKind;
  title: string;
  description?: string;
  archived: boolean;
  favorite: boolean;
  createdAt: TimestampMillis;
  updatedAt: TimestampMillis;
  body?: BodyDto;
}

/**
 * Variant body payload for a library item.
 */
export type BodyDto =
  | {
      type: "script";
      shell: ScriptShell;
      content: string;
      workingDirectory?: string;
    }
  | {
      type: "clipboard";
      content: string;
      contentType: string;
      capturedAt: TimestampMillis;
      pinned: boolean;
    }
  | {
      type: "ssh_host";
      host: string;
      port: number;
      username: string;
      authMethod: SshAuthMethod;
    }
  | {
      type: "note";
      content: string;
      contentFormat: NoteContentFormat;
    };

export type LibraryResourceKind = "script" | "note";
export type LibraryResourceFilter = "all" | LibraryResourceKind;
export type NoteContentFormat = "plain" | "markdown" | "json";

/**
 * Supported script shells.
 */
export type ScriptShell = "sh" | "bash" | "zsh" | "powershell" | "cmd";

/**
 * Supported SSH authentication methods.
 */
export type SshAuthMethod = "public_key" | "password" | "agent";

/**
 * Request: `create_script`.
 */
export interface CreateScriptRequest {
  /** Script title. */
  title: string;
  /** Script body. */
  content: string;
  /** Shell interpreter. */
  shell: ScriptShell;
  /** Optional working directory. */
  workingDirectory?: string;
  /** Optional description. */
  description?: string;
  /** Optional tag names. */
  tags?: string[];
}

/**
 * Response: `create_script`.
 */
export interface CreateScriptResponse {
  id: Id;
  createdAt: TimestampMillis;
}

interface CreateTextResourceRequest {
  title: string;
  content: string;
  description?: string;
  tags?: string[];
}

export type CreateLibraryResourceRequest =
  | ({ kind: "script" } & CreateScriptRequest)
  | ({
      kind: "note";
      contentFormat?: NoteContentFormat;
    } & CreateTextResourceRequest);

/**
 * Request: `update_script`.
 */
export interface UpdateScriptRequest {
  id: Id;
  title?: string;
  content?: string;
  shell?: ScriptShell;
  workingDirectory?: string;
  description?: string;
}

/**
 * Response: `update_script`.
 */
export interface UpdateScriptResponse {
  updatedAt: TimestampMillis;
}

export type UpdateLibraryResourceRequest =
  | ({ kind: "script" } & UpdateScriptRequest)
  | {
      id: Id;
      kind: "note";
      title?: string;
      content?: string;
      contentFormat?: NoteContentFormat;
      description?: string;
    };

/**
 * Request: `archive_item` / `restore_item` / `delete_item` / `toggle_favorite`.
 */
export interface ItemIdRequest {
  id: Id;
}

/**
 * Response: `delete_item`.
 */
export interface DeleteItemResponse {
  success: boolean;
}

/**
 * Response: `archive_item`.
 */
export interface ArchiveItemResponse {
  archived: boolean;
}

/**
 * Response: `restore_item`.
 */
export interface RestoreItemResponse {
  restored: boolean;
}

/**
 * Response: `toggle_favorite`.
 */
export interface ToggleFavoriteResponse {
  favorite: boolean;
}

/**
 * Request: `get_item`.
 */
export interface GetItemRequest {
  id: Id;
}

/**
 * Request: `search_library`.
 */
export interface SearchLibraryRequest {
  query: string;
  limit?: number;
  offset?: number;
  favoritesOnly?: boolean;
  includeArchived?: boolean;
}

/**
 * Response: `search_library`.
 */
export interface SearchLibraryResponse {
  total: number;
  items: SearchHitDto[];
}

/**
 * A single search hit.
 */
export interface SearchHitDto {
  itemId: Id;
  /** FTS5 rank score. */
  rank: number;
  /** Excerpt with matched terms. */
  snippet: string;
}
