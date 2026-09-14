// Typed Electron bridge for the Clipboard feature.
import type {
  ClipboardItemDto,
  Id,
  ListClipboardHistoryRequest,
  RecordClipboardCaptureRequest,
} from '@devdock/types';

function clipboardBridge(): ElectronClipboardBridge {
  if (!window.devdockClipboard) throw new Error('DevDock requires the Electron runtime.');
  return window.devdockClipboard;
}

export const clipboardIpc = {
  async listHistory(
    limit = 50,
    pinnedOnly = false,
    offset = 0,
    query = '',
    sort: 'newest' | 'oldest' | 'favorite' = 'newest',
  ): Promise<ClipboardItemDto[]> {
    const request: ListClipboardHistoryRequest = { limit, pinnedOnly, offset, query, sort };
    return clipboardBridge().list(request);
  },

  async countHistory(pinnedOnly = false, query = ''): Promise<number> {
    return clipboardBridge().count({ pinnedOnly, query });
  },

  async pin(id: Id): Promise<{ pinned: boolean }> {
    return clipboardBridge().pin(id);
  },

  async delete(id: Id): Promise<{ success: boolean }> {
    return clipboardBridge().delete(id);
  },

  async deleteMany(ids: Id[]): Promise<{ success: boolean }> {
    return clipboardBridge().deleteMany(ids);
  },

  async update(id: Id, content: string): Promise<void> {
    return clipboardBridge().update({ id, content });
  },

  async copyStored(id: Id): Promise<void> {
    return clipboardBridge().copyStored(id);
  },

  async markSaved(id: Id, scriptId: Id): Promise<void> {
    return clipboardBridge().markSaved({ id, scriptId });
  },

  async thumbnail(id: Id): Promise<string | null> {
    return clipboardBridge().thumbnail(id);
  },

  /** Records a clipboard capture from the UI (used for manual paste). */
  async recordCapture(
    content: string,
    contentType = 'text/plain',
  ): Promise<{ id: Id; capturedAt: number }> {
    const request: RecordClipboardCaptureRequest = { content, contentType };
    return clipboardBridge().record(request);
  },

  /** Writes the given text back to the OS clipboard (copy-again). */
  async copyAgain(content: string): Promise<void> {
    return clipboardBridge().copyText(content);
  },
};
