// Typed Electron bridge for the Library feature.
import type {
  ArchiveItemResponse,
  CreateLibraryResourceRequest,
  CreateScriptRequest,
  CreateScriptResponse,
  DeleteItemResponse,
  Id,
  LibraryItemDto,
  LibraryItemKind,
  LibraryResourceFilter,
  RestoreItemResponse,
  SearchLibraryRequest,
  SearchLibraryResponse,
  ScriptShell,
  ToggleFavoriteResponse,
  UpdateLibraryResourceRequest,
  UpdateScriptRequest,
  UpdateScriptResponse,
} from '@devdock/types';

function libraryBridge(): ElectronLibraryBridge {
  if (!window.devdockLibrary) throw new Error('DevDock requires the Electron runtime.');
  return window.devdockLibrary;
}

export const libraryIpc = {
  /** Lists recent library items (most recently updated first). */
  async listRecent(limit = 50): Promise<LibraryItemDto[]> {
    return libraryBridge().listRecent(limit);
  },

  async listPage(
    limit = 20,
    offset = 0,
    filter: LibraryResourceFilter = 'all',
  ): Promise<{ items: LibraryItemDto[]; total: number }> {
    const bridge = libraryBridge();
    const [items, total] = await Promise.all([
      bridge.listPage({ limit, offset, filter }),
      bridge.count(filter),
    ]);
    return { items, total };
  },

  /** Fetches a single library item by id. */
  async getById(id: Id): Promise<LibraryItemDto | null> {
    return libraryBridge().get(id);
  },

  /** Creates a new Script. */
  async createScript(input: CreateScriptRequest): Promise<CreateScriptResponse> {
    return libraryBridge().createScript(input);
  },

  /** Updates an existing Script. */
  async updateScript(input: UpdateScriptRequest): Promise<UpdateScriptResponse> {
    return libraryBridge().updateScript(input);
  },

  async createResource(input: CreateLibraryResourceRequest): Promise<CreateScriptResponse> {
    return libraryBridge().createResource(input);
  },

  async updateResource(input: UpdateLibraryResourceRequest): Promise<UpdateScriptResponse> {
    return libraryBridge().updateResource(input);
  },

  /** Archives an item. */
  async archive(id: Id): Promise<ArchiveItemResponse> {
    return libraryBridge().archive(id);
  },

  /** Restores a previously archived item. */
  async restore(id: Id): Promise<RestoreItemResponse> {
    return libraryBridge().restore(id);
  },

  /** Soft-deletes an item. */
  async delete(id: Id): Promise<DeleteItemResponse> {
    return libraryBridge().delete(id);
  },

  async deleteMany(ids: Id[]): Promise<DeleteItemResponse> {
    return libraryBridge().deleteMany(ids);
  },

  /** Toggles the favorite flag on an item. */
  async toggleFavorite(id: Id): Promise<ToggleFavoriteResponse> {
    return libraryBridge().toggleFavorite(id);
  },

  /** Executes a full-text search query. */
  async search(input: SearchLibraryRequest): Promise<SearchLibraryResponse> {
    return libraryBridge().search(input);
  },
};

export type {
  LibraryItemDto,
  LibraryItemKind,
  LibraryResourceFilter,
  ScriptShell,
  CreateScriptRequest,
  CreateLibraryResourceRequest,
  UpdateScriptRequest,
  UpdateLibraryResourceRequest,
  SearchLibraryRequest,
  SearchLibraryResponse,
};
