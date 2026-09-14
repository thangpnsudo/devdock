import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import type {
  ClipboardItemDto,
  CreateLibraryResourceRequest,
  CreateScriptRequest,
  LibraryItemDto,
  LibraryResourceFilter,
  SearchLibraryRequest,
  SearchLibraryResponse,
  SaveSettingsRequest,
  SettingsDto,
  UpdateLibraryResourceRequest,
  UpdateScriptRequest,
} from "@devdock/types";
import type { AgentSnapshot } from "./agent-contract";

const nodeRequire =
  typeof require === "function"
    ? require
    : createRequire(join(process.cwd(), "package.json"));
const { DatabaseSync } = nodeRequire(
  "node:sqlite",
) as typeof import("node:sqlite");

interface LibraryRow {
  id: string;
  kind: LibraryItemDto["kind"];
  title: string;
  description: string | null;
  favorite: number;
  archived: number;
  created_at: number;
  updated_at: number;
  shell: string | null;
  content: string | null;
  text_content: string | null;
  content_format: string | null;
  working_directory: string | null;
}

interface ClipboardRow {
  id: string;
  title: string;
  description: string | null;
  favorite: number;
  archived: number;
  content: string;
  content_type: string;
  source_app: string | null;
  captured_at: number;
  pinned: number;
  saved_script_id: string | null;
}

interface ManagedAgentRow {
  id: string;
  terminal_session_id: string;
  provider: AgentSnapshot["provider"];
  display_name: string;
  cwd: string;
  task: string | null;
  status: AgentSnapshot["status"];
  attention: AgentSnapshot["attention"];
  started_at: number;
  last_activity_at: number;
  finished_at: number | null;
  error: string | null;
}

const CLIPBOARD_DISPLAY_CONTENT = `
  CASE
    WHEN ci.content LIKE 'devdock-image-v1:%' OR ci.content LIKE 'devdock-image-png-v1:%'
    THEN substr(
      ci.content,
      1,
      instr(ci.content, ':')
        + instr(substr(ci.content, instr(ci.content, ':') + 1), ':')
        + instr(substr(
            ci.content,
            instr(ci.content, ':')
              + instr(substr(ci.content, instr(ci.content, ':') + 1), ':')
              + 1
          ), ':')
    )
    ELSE ci.content
  END
`;

function mapLibraryRow(row: LibraryRow): LibraryItemDto {
  const item: LibraryItemDto = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    archived: row.archived !== 0,
    favorite: row.favorite !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.description !== null) item.description = row.description;
  if (row.kind === "script") {
    item.body = {
      type: "script",
      shell: (row.shell ?? "bash") as
        "sh" | "bash" | "zsh" | "powershell" | "cmd",
      content: row.content ?? "",
      ...(row.working_directory
        ? { workingDirectory: row.working_directory }
        : {}),
    };
  } else if (row.kind === "note") {
    item.body = {
      type: "note",
      content: row.text_content ?? "",
      contentFormat: (row.content_format ?? "plain") as
        "plain" | "markdown" | "json",
    };
  }
  return item;
}

function mapClipboardRow(row: ClipboardRow): ClipboardItemDto {
  return {
    id: row.id,
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    favorite: row.favorite !== 0,
    archived: row.archived !== 0,
    content: row.content,
    contentType: row.content_type,
    ...(row.source_app !== null ? { sourceApp: row.source_app } : {}),
    capturedAt: row.captured_at,
    pinned: row.pinned !== 0,
    ...(row.saved_script_id ? { savedScriptId: row.saved_script_id } : {}),
  };
}

/**
 * Electron storage adapter for the existing DevDock SQLite database.
 *
 * It stores all workspace state in a local SQLite database.
 */
export class AppDataStore {
  private readonly database: DatabaseSyncType;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.ensureSchema();
  }

  close(): void {
    this.database.close();
  }

  getSettings(): SettingsDto {
    const defaults: SettingsDto = {
      theme: "dark",
      terminalFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
      terminalFontSize: 13,
      clipboardEnabled: true,
      clipboardMaxItems: 500,
      clipboardRetentionDays: 0,
    };
    const row = this.database
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get("workspace") as { value: string } | undefined;
    if (!row) return defaults;
    try {
      const saved = JSON.parse(row.value) as Partial<SettingsDto>;
      return {
        ...defaults,
        ...saved,
        theme: "dark",
        clipboardMaxItems: Math.max(
          20,
          Math.min(500, saved.clipboardMaxItems ?? 500),
        ),
        clipboardRetentionDays: saved.clipboardRetentionDays === 7 ? 7 : 0,
      };
    } catch {
      return defaults;
    }
  }

  saveSettings(request: SaveSettingsRequest): { updatedAt: number } {
    const updatedAt = Date.now();
    const settings: SettingsDto = {
      theme: "dark",
      terminalFont: request.terminalFont.trim() || "ui-monospace, monospace",
      terminalFontSize: Math.max(8, Math.min(32, request.terminalFontSize)),
      clipboardEnabled: request.clipboardEnabled,
      clipboardMaxItems: Math.max(20, Math.min(500, request.clipboardMaxItems)),
      clipboardRetentionDays: request.clipboardRetentionDays === 7 ? 7 : 0,
    };
    this.database
      .prepare(
        `
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
      )
      .run("workspace", JSON.stringify(settings), updatedAt);
    this.cleanupClipboard(
      settings.clipboardMaxItems,
      settings.clipboardRetentionDays,
    );
    return { updatedAt };
  }

  listRecent(limit = 50): LibraryItemDto[] {
    return this.listItems(limit, 0, "script");
  }

  listItems(
    limit = 20,
    offset = 0,
    filter: LibraryResourceFilter = "all",
  ): LibraryItemDto[] {
    const rows = this.database
      .prepare(
        `
      SELECT li.id, li.kind, li.title, li.description, li.favorite, li.archived,
             li.created_at, li.updated_at, s.shell, s.content, s.working_directory,
             tr.content AS text_content, tr.content_format
        FROM library_items li
        LEFT JOIN scripts s ON s.library_item_id = li.id
        LEFT JOIN text_resources tr ON tr.library_item_id = li.id
       WHERE li.deleted_at IS NULL
         AND li.kind IN ('script', 'note')
         AND li.archived = 0
         AND (? = 'all' OR li.kind = ?)
       ORDER BY li.favorite DESC, li.updated_at DESC
       LIMIT ? OFFSET ?
    `,
      )
      .all(
        filter,
        filter,
        Math.max(1, Math.min(limit, 200)),
        Math.max(0, offset),
      ) as unknown as LibraryRow[];
    return rows.map(mapLibraryRow);
  }

  countItems(filter: LibraryResourceFilter = "all"): number {
    const row = this.database
      .prepare(
        `
      SELECT COUNT(*) AS total FROM library_items
       WHERE deleted_at IS NULL
         AND kind IN ('script', 'note')
         AND archived = 0
         AND (? = 'all' OR kind = ?)
    `,
      )
      .get(filter, filter) as { total: number };
    return row.total;
  }

  listScripts(limit = 20, offset = 0): LibraryItemDto[] {
    return this.listItems(limit, offset, "script");
  }

  countScripts(): number {
    return this.countItems("script");
  }

  getItem(id: string): LibraryItemDto | null {
    const row = this.database
      .prepare(
        `
      SELECT li.id, li.kind, li.title, li.description, li.favorite, li.archived,
             li.created_at, li.updated_at, s.shell, s.content, s.working_directory,
             tr.content AS text_content, tr.content_format
        FROM library_items li
        LEFT JOIN scripts s ON s.library_item_id = li.id
        LEFT JOIN text_resources tr ON tr.library_item_id = li.id
       WHERE li.id = ? AND li.deleted_at IS NULL
    `,
      )
      .get(id) as unknown as LibraryRow | undefined;
    return row ? mapLibraryRow(row) : null;
  }

  createScript(request: CreateScriptRequest): {
    id: string;
    createdAt: number;
  } {
    return this.createResource({ kind: "script", ...request });
  }

  createResource(request: CreateLibraryResourceRequest): {
    id: string;
    createdAt: number;
  } {
    const title = request.title.trim();
    if (!["script", "note"].includes(request.kind)) {
      throw new Error("Unsupported Library item type.");
    }
    if (!title || (request.kind === "script" && !request.content.trim())) {
      throw new Error("A title and content are required.");
    }
    if (title.length > 256)
      throw new Error("Title cannot exceed 256 characters.");
    const id = randomUUID();
    const now = Date.now();
    this.transaction(() => {
      this.database
        .prepare(
          `
        INSERT INTO library_items
          (id, kind, title, description, favorite, archived, created_at, updated_at, sync_version, sync_state)
        VALUES (?, ?, ?, ?, 0, 0, ?, ?, 1, 0)
      `,
        )
        .run(id, request.kind, title, request.description ?? null, now, now);
      if (request.kind === "script") {
        this.database
          .prepare(
            `
          INSERT INTO scripts (id, library_item_id, shell, content, working_directory)
          VALUES (?, ?, ?, ?, ?)
        `,
          )
          .run(
            randomUUID(),
            id,
            request.shell,
            request.content,
            request.workingDirectory ?? null,
          );
      } else {
        this.database
          .prepare(
            `
          INSERT INTO text_resources (id, library_item_id, content, content_format)
          VALUES (?, ?, ?, ?)
        `,
          )
          .run(
            randomUUID(),
            id,
            request.content,
            request.contentFormat ?? "plain",
          );
      }
    });
    return { id, createdAt: now };
  }

  updateScript(request: UpdateScriptRequest): { updatedAt: number } {
    return this.updateResource({ kind: "script", ...request });
  }

  updateResource(request: UpdateLibraryResourceRequest): { updatedAt: number } {
    const now = Date.now();
    this.transaction(() => {
      const current = this.getItem(request.id);
      if (
        !current ||
        current.kind !== request.kind ||
        current.body?.type !== request.kind
      ) {
        throw new Error("Library item was not found.");
      }
      if (
        request.kind === "script" &&
        request.content !== undefined &&
        !request.content.trim()
      ) {
        throw new Error("Content cannot be empty.");
      }
      this.database
        .prepare(
          `
        UPDATE library_items
           SET title = ?, description = ?, updated_at = ?, sync_version = sync_version + 1
         WHERE id = ?
      `,
        )
        .run(
          request.title?.trim() || current.title,
          request.description ?? current.description ?? null,
          now,
          request.id,
        );
      if (request.kind === "script" && current.body.type === "script") {
        this.database
          .prepare(
            `
          UPDATE scripts SET shell = ?, content = ?, working_directory = ? WHERE library_item_id = ?
        `,
          )
          .run(
            request.shell ?? current.body.shell,
            request.content ?? current.body.content,
            request.workingDirectory ?? current.body.workingDirectory ?? null,
            request.id,
          );
      } else if (request.kind === "note" && current.body.type === "note") {
        this.database
          .prepare(
            `
          UPDATE text_resources SET content = ?, content_format = ? WHERE library_item_id = ?
        `,
          )
          .run(
            request.content ?? current.body.content,
            request.contentFormat ?? current.body.contentFormat,
            request.id,
          );
      }
    });
    return { updatedAt: now };
  }

  archive(id: string, archived: boolean): void {
    this.database
      .prepare(
        "UPDATE library_items SET archived = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(archived ? 1 : 0, Date.now(), id);
  }

  deleteItem(id: string): void {
    this.database
      .prepare(
        "UPDATE library_items SET deleted_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(Date.now(), Date.now(), id);
  }

  toggleFavorite(id: string): boolean {
    this.database
      .prepare(
        `
      UPDATE library_items
         SET favorite = CASE favorite WHEN 0 THEN 1 ELSE 0 END, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
    `,
      )
      .run(Date.now(), id);
    const row = this.database
      .prepare("SELECT favorite FROM library_items WHERE id = ?")
      .get(id) as { favorite: number } | undefined;
    if (!row) throw new Error("Library item was not found.");
    return row.favorite !== 0;
  }

  search(request: SearchLibraryRequest): SearchLibraryResponse {
    const query = request.query.trim();
    if (!query) return { total: 0, items: [] };
    const pattern = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const archived = request.includeArchived ? 1 : 0;
    const favorite = request.favoritesOnly ? 1 : 0;
    const conditions = `
      li.deleted_at IS NULL
      AND (? = 1 OR li.archived = 0)
      AND (? = 0 OR li.favorite = 1)
      AND li.kind IN ('script', 'note')
      AND (li.title LIKE ? ESCAPE '\\' OR COALESCE(li.description, '') LIKE ? ESCAPE '\\'
           OR COALESCE(s.content, tr.content, '') LIKE ? ESCAPE '\\')
    `;
    const totalRow = this.database
      .prepare(
        `
      SELECT COUNT(*) AS total FROM library_items li
      LEFT JOIN scripts s ON s.library_item_id = li.id
      LEFT JOIN text_resources tr ON tr.library_item_id = li.id
      WHERE ${conditions}
    `,
      )
      .get(archived, favorite, pattern, pattern, pattern) as { total: number };
    const rows = this.database
      .prepare(
        `
      SELECT li.id, li.title, COALESCE(li.description, s.content, tr.content, '') AS snippet
        FROM library_items li
        LEFT JOIN scripts s ON s.library_item_id = li.id
        LEFT JOIN text_resources tr ON tr.library_item_id = li.id
       WHERE ${conditions}
       ORDER BY li.favorite DESC, li.updated_at DESC
       LIMIT ? OFFSET ?
    `,
      )
      .all(
        archived,
        favorite,
        pattern,
        pattern,
        pattern,
        Math.max(1, Math.min(request.limit ?? 50, 200)),
        Math.max(0, request.offset ?? 0),
      ) as unknown as Array<{ id: string; title: string; snippet: string }>;
    return {
      total: totalRow.total,
      items: rows.map((row, index) => ({
        itemId: row.id,
        rank: index,
        snippet: (row.snippet || row.title).slice(0, 240),
      })),
    };
  }

  listClipboard(
    limit = 50,
    pinnedOnly = false,
    offset = 0,
    query = "",
    sort: "newest" | "oldest" | "favorite" = "newest",
  ): ClipboardItemDto[] {
    const pattern = `%${query.trim()}%`;
    const orderBy =
      sort === "oldest"
        ? "ci.pinned DESC, ci.captured_at ASC"
        : "ci.pinned DESC, ci.captured_at DESC";
    const rows = this.database
      .prepare(
        `
      SELECT li.id, li.title, li.description, li.favorite, li.archived,
             ${CLIPBOARD_DISPLAY_CONTENT} AS content,
             ci.content_type, ci.source_app, ci.captured_at, ci.pinned, ci.saved_script_id
        FROM library_items li
        JOIN clipboard_items ci ON ci.library_item_id = li.id
       WHERE li.deleted_at IS NULL
         AND (? = 0 OR ci.pinned = 1)
         AND (? = '' OR ci.content LIKE ? OR COALESCE(ci.source_app, '') LIKE ?
           OR ci.content_type LIKE ?)
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?
    `,
      )
      .all(
        pinnedOnly ? 1 : 0,
        query.trim(),
        pattern,
        pattern,
        pattern,
        Math.max(1, Math.min(limit, 200)),
        Math.max(0, offset),
      ) as unknown as ClipboardRow[];
    return rows.map(mapClipboardRow);
  }

  countClipboard(pinnedOnly = false, query = ""): number {
    const pattern = `%${query.trim()}%`;
    const row = this.database
      .prepare(
        `
      SELECT COUNT(*) AS total
        FROM library_items li
        JOIN clipboard_items ci ON ci.library_item_id = li.id
       WHERE li.deleted_at IS NULL
         AND (? = 0 OR ci.pinned = 1)
         AND (? = '' OR ci.content LIKE ? OR COALESCE(ci.source_app, '') LIKE ?
           OR ci.content_type LIKE ?)
    `,
      )
      .get(pinnedOnly ? 1 : 0, query.trim(), pattern, pattern, pattern) as {
      total: number;
    };
    return row.total;
  }

  recordClipboard(
    content: string,
    contentType = "text/plain",
    sourceApp?: string,
  ): {
    id: string;
    capturedAt: number;
  } {
    if (!content) throw new Error("Clipboard content is empty.");
    const existing = this.database
      .prepare(
        `
      SELECT ci.library_item_id AS id, ci.captured_at
        FROM clipboard_items ci
        JOIN library_items li ON li.id = ci.library_item_id
       WHERE li.deleted_at IS NULL AND ci.content = ?
       LIMIT 1
    `,
      )
      .get(content) as { id: string; captured_at: number } | undefined;
    if (existing) {
      const settings = this.getSettings();
      this.cleanupClipboard(
        settings.clipboardMaxItems,
        settings.clipboardRetentionDays,
      );
      return { id: existing.id, capturedAt: existing.captured_at };
    }

    const id = randomUUID();
    const now = Date.now();
    const image = contentType.startsWith("image/");
    const title = image
      ? "[image]"
      : content.replace(/\s+/g, " ").slice(0, 120);
    this.transaction(() => {
      this.database
        .prepare(
          `
        INSERT INTO library_items
          (id, kind, title, description, favorite, archived, created_at, updated_at, sync_version, sync_state)
        VALUES (?, 'clipboard', ?, ?, 0, 0, ?, ?, 1, 0)
      `,
        )
        .run(id, title || "[clipboard]", `Captured ${contentType}`, now, now);
      this.database
        .prepare(
          `
        INSERT INTO clipboard_items
          (id, library_item_id, content, content_type, source_app, captured_at, pinned)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `,
        )
        .run(id, id, content, contentType, sourceApp ?? null, now);
    });
    const settings = this.getSettings();
    this.cleanupClipboard(
      settings.clipboardMaxItems,
      settings.clipboardRetentionDays,
    );
    return { id, capturedAt: now };
  }

  cleanupClipboard(maxItems: number, retentionDays: 0 | 7): number {
    const ids = new Set<string>();
    if (retentionDays === 7) {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const expired = this.database
        .prepare(
          `
        SELECT ci.library_item_id AS id
          FROM clipboard_items ci
          JOIN library_items li ON li.id = ci.library_item_id
         WHERE li.deleted_at IS NULL AND ci.captured_at < ?
      `,
        )
        .all(cutoff) as unknown as Array<{ id: string }>;
      expired.forEach((row) => ids.add(row.id));
    }
    const overflow = this.database
      .prepare(
        `
      SELECT ci.library_item_id AS id
        FROM clipboard_items ci
        JOIN library_items li ON li.id = ci.library_item_id
       WHERE li.deleted_at IS NULL
       ORDER BY ci.pinned DESC, ci.captured_at DESC
       LIMIT -1 OFFSET ?
    `,
      )
      .all(Math.max(20, Math.min(500, maxItems))) as unknown as Array<{
      id: string;
    }>;
    overflow.forEach((row) => ids.add(row.id));
    if (ids.size > 0) this.deleteClipboard([...ids]);
    return ids.size;
  }

  pinClipboard(id: string): boolean {
    this.database
      .prepare(
        `
      UPDATE clipboard_items SET pinned = CASE pinned WHEN 0 THEN 1 ELSE 0 END
       WHERE library_item_id = ?
    `,
      )
      .run(id);
    const row = this.database
      .prepare("SELECT pinned FROM clipboard_items WHERE library_item_id = ?")
      .get(id) as { pinned: number } | undefined;
    if (!row) throw new Error("Clipboard entry was not found.");
    return row.pinned !== 0;
  }

  updateClipboard(id: string, content: string): void {
    if (!content.trim()) throw new Error("Clipboard content cannot be empty.");
    this.database
      .prepare(
        `
      UPDATE clipboard_items SET content = ?, content_type = 'text/plain' WHERE library_item_id = ?
    `,
      )
      .run(content, id);
    this.database
      .prepare(
        "UPDATE library_items SET title = ?, updated_at = ? WHERE id = ?",
      )
      .run(content.replace(/\s+/g, " ").slice(0, 120), Date.now(), id);
  }

  deleteClipboard(ids: string[]): void {
    const statement = this.database.prepare(
      "UPDATE library_items SET deleted_at = ?, updated_at = ? WHERE id = ?",
    );
    const now = Date.now();
    this.transaction(() => {
      for (const id of ids) statement.run(now, now, id);
    });
  }

  getClipboardContent(id: string): { content: string; contentType: string } {
    const row = this.database
      .prepare(
        `
      SELECT ci.content, ci.content_type AS contentType
        FROM clipboard_items ci
        JOIN library_items li ON li.id = ci.library_item_id
       WHERE ci.library_item_id = ? AND li.deleted_at IS NULL
    `,
      )
      .get(id) as { content: string; contentType: string } | undefined;
    if (!row) throw new Error("Clipboard entry was not found.");
    return row;
  }

  markClipboardSaved(id: string, scriptId: string): void {
    const result = this.database
      .prepare(
        `
      UPDATE clipboard_items SET saved_script_id = ? WHERE library_item_id = ?
    `,
      )
      .run(scriptId, id);
    if (result.changes === 0) throw new Error("Clipboard entry was not found.");
  }

  listManagedAgents(limit = 100): AgentSnapshot[] {
    const rows = this.database.prepare(`
      SELECT id, terminal_session_id, provider, display_name, cwd, task,
             status, attention, started_at, last_activity_at, finished_at, error
        FROM managed_agents ORDER BY started_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(500, limit))) as unknown as ManagedAgentRow[];
    return rows.map((row) => ({
      id: row.id, terminalSessionId: row.terminal_session_id,
      provider: row.provider, displayName: row.display_name, cwd: row.cwd,
      ...(row.task ? { task: row.task } : {}), status: row.status,
      attention: row.attention, startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
      ...(row.error ? { error: row.error } : {}), terminalAvailable: false,
    }));
  }

  upsertManagedAgent(agent: AgentSnapshot): void {
    this.database.prepare(`
      INSERT INTO managed_agents (
        id, terminal_session_id, provider, display_name, cwd, task,
        status, attention, started_at, last_activity_at, finished_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        terminal_session_id = excluded.terminal_session_id,
        provider = excluded.provider, display_name = excluded.display_name,
        cwd = excluded.cwd, task = excluded.task, status = excluded.status,
        attention = excluded.attention, started_at = excluded.started_at,
        last_activity_at = excluded.last_activity_at,
        finished_at = excluded.finished_at, error = excluded.error
    `).run(
      agent.id, agent.terminalSessionId, agent.provider, agent.displayName,
      agent.cwd, agent.task ?? null, agent.status, agent.attention,
      agent.startedAt, agent.lastActivityAt, agent.finishedAt ?? null,
      agent.error ?? null,
    );
  }

  deleteManagedAgent(id: string): void {
    this.database.prepare("DELETE FROM managed_agents WHERE id = ?").run(id);
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY NOT NULL, parent_id TEXT, name TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_items (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        folder_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        sync_version INTEGER NOT NULL DEFAULT 1,
        sync_state INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY NOT NULL,
        library_item_id TEXT UNIQUE NOT NULL,
        shell TEXT NOT NULL,
        content TEXT NOT NULL,
        working_directory TEXT,
        FOREIGN KEY (library_item_id) REFERENCES library_items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS text_resources (
        id TEXT PRIMARY KEY NOT NULL,
        library_item_id TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        content_format TEXT NOT NULL DEFAULT 'plain',
        FOREIGN KEY (library_item_id) REFERENCES library_items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS clipboard_items (
        id TEXT PRIMARY KEY NOT NULL,
        library_item_id TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text/plain',
        source_app TEXT,
        captured_at INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (library_item_id) REFERENCES library_items(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS managed_agents (
        id TEXT PRIMARY KEY NOT NULL,
        terminal_session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        task TEXT,
        status TEXT NOT NULL,
        attention TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_library_items_updated_at ON library_items(updated_at);
      CREATE INDEX IF NOT EXISTS idx_clipboard_items_captured_at ON clipboard_items(captured_at);
      CREATE INDEX IF NOT EXISTS idx_clipboard_items_pinned ON clipboard_items(pinned);
      CREATE INDEX IF NOT EXISTS idx_managed_agents_started_at ON managed_agents(started_at);
    `);
    const clipboardColumns = this.database
      .prepare("PRAGMA table_info(clipboard_items)")
      .all() as unknown as Array<{ name: string }>;
    if (!clipboardColumns.some((column) => column.name === "saved_script_id")) {
      this.database.exec(
        "ALTER TABLE clipboard_items ADD COLUMN saved_script_id TEXT",
      );
    }
    const textResourceColumns = this.database
      .prepare("PRAGMA table_info(text_resources)")
      .all() as unknown as Array<{ name: string }>;
    if (
      !textResourceColumns.some((column) => column.name === "content_format")
    ) {
      this.database.exec(
        "ALTER TABLE text_resources ADD COLUMN content_format TEXT NOT NULL DEFAULT 'plain'",
      );
    }
    this.migrateLegacyLibraryKindConstraint();
  }

  /**
   * Early DevDock databases restricted `library_items.kind` with a CHECK
   * constraint that predates Notes. SQLite cannot alter a CHECK constraint in
   * place, so rebuild only that table while preserving its data, indexes and
   * FTS triggers. Fresh databases do not need this migration.
   */
  private migrateLegacyLibraryKindConstraint(): void {
    const table = this.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'library_items'",
      )
      .get() as { sql: string | null } | undefined;
    const tableSql = table?.sql ?? "";
    if (
      !/CHECK\s*\(\s*kind\s+IN\s*\(/i.test(tableSql) ||
      /['\"]note['\"]/i.test(tableSql)
    ) {
      return;
    }

    const schemaObjects = this.database
      .prepare(
        `
        SELECT type, name, sql
          FROM sqlite_master
         WHERE (
           (tbl_name = 'library_items' AND type = 'index')
           OR (type = 'trigger' AND instr(lower(sql), 'library_items') > 0)
         )
           AND sql IS NOT NULL
         ORDER BY type, name
      `,
      )
      .all() as unknown as Array<{
      type: "index" | "trigger";
      name: string;
      sql: string;
    }>;

    this.database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.transaction(() => {
        for (const object of schemaObjects) {
          if (object.type !== "trigger") continue;
          const name = object.name.replaceAll('"', '""');
          this.database.exec(`DROP TRIGGER "${name}"`);
        }
        this.database.exec(`
          DROP TABLE IF EXISTS library_items__note_migration;
          CREATE TABLE library_items__note_migration (
            id TEXT PRIMARY KEY NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            favorite INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            folder_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER,
            sync_version INTEGER NOT NULL DEFAULT 1,
            sync_state INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE RESTRICT
          );
          INSERT INTO library_items__note_migration (
            id, kind, title, description, favorite, archived, folder_id,
            created_at, updated_at, deleted_at, sync_version, sync_state
          )
          SELECT
            id, kind, title, description, favorite, archived, folder_id,
            created_at, updated_at, deleted_at, sync_version, sync_state
          FROM library_items;
          DROP TABLE library_items;
          ALTER TABLE library_items__note_migration RENAME TO library_items;
        `);
        for (const object of schemaObjects) this.database.exec(object.sql);
      });
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON");
    }
  }
}
