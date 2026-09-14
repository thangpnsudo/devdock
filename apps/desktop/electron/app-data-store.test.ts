import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AppDataStore } from "./app-data-store";

const { DatabaseSync } = createRequire(join(process.cwd(), "package.json"))(
  "node:sqlite",
) as typeof import("node:sqlite");

describe("AppDataStore", () => {
  it("migrates the legacy kind constraint before creating a note", () => {
    const directory = mkdtempSync(join(tmpdir(), "devdock-legacy-notes-"));
    const databasePath = join(directory, "devdock.db");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE folders (
        id TEXT PRIMARY KEY NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE library_items (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('script', 'clipboard', 'ssh_host', 'snippet', 'template')
        ),
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
      CREATE INDEX idx_library_items_kind ON library_items(kind);
      CREATE TABLE library_item_updates (
        item_id TEXT NOT NULL
      );
      CREATE TRIGGER library_items_test_update AFTER UPDATE ON library_items
      BEGIN
        INSERT INTO library_item_updates (item_id) VALUES (NEW.id);
      END;
      CREATE TABLE scripts (
        id TEXT PRIMARY KEY NOT NULL,
        library_item_id TEXT UNIQUE NOT NULL,
        shell TEXT NOT NULL,
        content TEXT NOT NULL,
        working_directory TEXT,
        FOREIGN KEY (library_item_id) REFERENCES library_items(id) ON DELETE CASCADE
      );
      CREATE TRIGGER scripts_test_update AFTER UPDATE ON scripts
      BEGIN
        INSERT INTO library_item_updates (item_id)
        SELECT id FROM library_items WHERE id = NEW.library_item_id;
      END;
      INSERT INTO library_items (
        id, kind, title, created_at, updated_at
      ) VALUES ('legacy-script', 'script', 'Keep me', 1, 1);
      INSERT INTO scripts (
        id, library_item_id, shell, content
      ) VALUES ('legacy-script-body', 'legacy-script', 'bash', 'echo kept');
    `);
    legacy.close();

    const store = new AppDataStore(databasePath);
    expect(store.getItem("legacy-script")).toMatchObject({
      title: "Keep me",
      body: { type: "script", content: "echo kept" },
    });
    store.updateScript({
      id: "legacy-script",
      title: "Still here",
      content: "echo kept",
      shell: "bash",
    });
    const note = store.createResource({
      kind: "note",
      title: "Untitled",
      content: "",
      contentFormat: "plain",
    });
    expect(store.getItem(note.id)).toMatchObject({
      kind: "note",
      body: { type: "note", content: "" },
    });
    store.upsertManagedAgent({
      id: "migration-agent",
      terminalSessionId: "migration-terminal",
      provider: "codex",
      displayName: "Migration check",
      cwd: directory,
      status: "stopped",
      attention: "none",
      startedAt: 10,
      lastActivityAt: 20,
      terminalAvailable: false,
    });
    expect(store.listManagedAgents()).toMatchObject([
      { id: "migration-agent", displayName: "Migration check" },
    ]);
    store.close();

    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    const schema = migrated
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'library_items'",
      )
      .get() as { sql: string };
    expect(schema.sql).not.toContain("CHECK");
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_library_items_kind'",
        )
        .get(),
    ).toBeDefined();
    expect(
      migrated
        .prepare("SELECT display_name FROM managed_agents WHERE id = 'migration-agent'")
        .get(),
    ).toMatchObject({ display_name: "Migration check" });
    expect(
      migrated
        .prepare(
          "SELECT item_id FROM library_item_updates WHERE item_id = 'legacy-script'",
        )
        .get(),
    ).toBeDefined();
    migrated.close();
  });

  it("persists scripts and clipboard history with Electron-shaped DTOs", () => {
    const directory = mkdtempSync(join(tmpdir(), "devdock-data-"));
    const store = new AppDataStore(join(directory, "devdock.db"));
    const script = store.createScript({
      title: "Deploy",
      content: "echo ready",
      shell: "bash",
      description: "Deployment helper",
    });
    expect(store.listRecent()).toMatchObject([
      {
        id: script.id,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
        body: { type: "script", content: "echo ready", shell: "bash" },
      },
    ]);
    expect(store.search({ query: "ready" }).items[0]?.itemId).toBe(script.id);
    store.updateScript({
      id: script.id,
      title: "Deploy production",
      content: "echo updated",
      shell: "zsh",
      description: "",
      workingDirectory: "",
    });
    expect(store.getItem(script.id)).toMatchObject({
      title: "Deploy production",
      body: { type: "script", content: "echo updated", shell: "zsh" },
    });

    const note = store.createResource({
      kind: "note",
      title: "Untitled",
      content: "",
      contentFormat: "plain",
    });
    expect(store.countItems()).toBe(2);
    expect(store.listItems(20, 0, "note")).toMatchObject([
      {
        id: note.id,
        kind: "note",
        body: { type: "note", content: "", contentFormat: "plain" },
      },
    ]);
    store.updateResource({
      id: note.id,
      kind: "note",
      title: "Release metadata",
      content: '{"channel":"local"}',
      contentFormat: "json",
    });
    expect(store.getItem(note.id)).toMatchObject({
      kind: "note",
      title: "Release metadata",
      body: {
        type: "note",
        content: '{"channel":"local"}',
        contentFormat: "json",
      },
    });
    expect(store.search({ query: "local" }).items[0]?.itemId).toBe(note.id);
    expect(() =>
      store.updateResource({
        id: script.id,
        kind: "note",
        content: "wrong kind",
      }),
    ).toThrow("Library item was not found");
    expect(store.listRecent().every(({ kind }) => kind === "script")).toBe(
      true,
    );
    expect(() =>
      store.createResource({
        kind: "plugin" as "note",
        title: "Unsupported",
        content: "unsafe",
      }),
    ).toThrow("Unsupported Library item type");
    const text = store.recordClipboard("clipboard value", "text/plain", "test");
    const image = store.recordClipboard(
      "devdock-image-png-v1:2:3:aGVsbG8=",
      "image/png",
    );
    store.markClipboardSaved(text.id, script.id);
    store.pinClipboard(text.id);
    expect(store.listClipboard(50)).toMatchObject([
      {
        id: text.id,
        content: "clipboard value",
        sourceApp: "test",
        pinned: true,
        savedScriptId: script.id,
      },
      {
        id: image.id,
        content: "devdock-image-png-v1:2:3:",
        contentType: "image/png",
      },
    ]);
    for (let index = 0; index < 23; index += 1) {
      store.recordClipboard(
        `page item ${index}`,
        "text/plain",
        "pagination-test",
      );
    }
    expect(store.countClipboard()).toBe(25);
    expect(store.listClipboard(20)).toHaveLength(20);
    expect(store.listClipboard(20, false, 20)).toHaveLength(5);
    expect(store.countClipboard(false, "page item 12")).toBe(1);
    expect(store.listClipboard(20, false, 0, "page item 12")[0]?.content).toBe(
      "page item 12",
    );
    store.saveSettings({
      theme: "light",
      terminalFont: "JetBrains Mono",
      terminalFontSize: 14,
      clipboardEnabled: true,
      clipboardMaxItems: 20,
      clipboardRetentionDays: 7,
    });
    expect(store.getSettings()).toMatchObject({
      clipboardMaxItems: 20,
      clipboardRetentionDays: 7,
      terminalFontSize: 14,
      theme: "dark",
    });
    expect(store.countClipboard()).toBe(20);

    store.upsertManagedAgent({
      id: "agent-1", terminalSessionId: "terminal-1", provider: "codex",
      displayName: "Backend review", cwd: directory, task: "Review the API",
      status: "working", attention: "none", startedAt: 100,
      lastActivityAt: 200, terminalAvailable: true,
    });
    expect(store.listManagedAgents()).toMatchObject([{
      id: "agent-1", provider: "codex", status: "working", terminalAvailable: false,
    }]);

    store.updateClipboard(text.id, "updated value");
    expect(store.getClipboardContent(text.id).content).toBe("updated value");
    store.deleteClipboard([text.id]);
    expect(store.listClipboard(50).some((entry) => entry.id === text.id)).toBe(
      false,
    );
    store.close();

    const reopened = new AppDataStore(join(directory, "devdock.db"));
    expect(reopened.getItem(script.id)?.body?.type).toBe("script");
    expect(reopened.getItem(note.id)).toMatchObject({
      kind: "note",
      body: {
        type: "note",
        content: '{"channel":"local"}',
        contentFormat: "json",
      },
    });
    expect(reopened.listManagedAgents()[0]).toMatchObject({
      id: "agent-1", task: "Review the API",
    });
    reopened.deleteManagedAgent("agent-1");
    expect(reopened.listManagedAgents()).toEqual([]);
    reopened.close();
  });
});
