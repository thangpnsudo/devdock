// Clipboard contracts shared by the renderer and Electron IPC layer.

import type { Id, TimestampMillis } from './common';

/**
 * MIME types supported by the clipboard engine.
 */
export type ClipboardMime =
  | 'text/plain'
  | 'text/html'
  | 'image/png'
  | 'text/uri-list';

/**
 * DTO for a clipboard entry returned over IPC.
 */
export interface ClipboardItemDto {
  id: Id;
  title: string;
  description?: string;
  favorite: boolean;
  archived: boolean;
  content: string;
  contentType: string;
  sourceApp?: string;
  capturedAt: TimestampMillis;
  pinned: boolean;
  savedScriptId?: Id;
}

/**
 * Payload for the `clipboard:write` IPC command.
 */
export interface ClipboardWriteRequest {
  content: string;
  contentType: ClipboardMime | string;
}

/**
 * Request: `record_clipboard_capture`.
 */
export interface RecordClipboardCaptureRequest {
  content: string;
  contentType?: string;
  sourceApp?: string;
}

/**
 * Response: `record_clipboard_capture`.
 */
export interface RecordClipboardCaptureResponse {
  id: Id;
  capturedAt: TimestampMillis;
}

/**
 * Request: `list_clipboard_history`.
 */
export interface ListClipboardHistoryRequest {
  limit?: number;
  pinnedOnly?: boolean;
  offset?: number;
  query?: string;
  sort?: 'newest' | 'oldest' | 'favorite';
}

/**
 * Response: `pin_clipboard_item`.
 */
export interface PinClipboardItemResponse {
  pinned: boolean;
}

/** Replace one captured text entry in place. */
export interface UpdateClipboardItemRequest {
  id: Id;
  content: string;
}

/** Soft-delete a selected group of clipboard entries. */
export interface DeleteClipboardItemsRequest {
  ids: Id[];
}

/**
 * Generic item-id request re-exported for clipboard consumers.
 */
export type { ItemIdRequest } from './library';
