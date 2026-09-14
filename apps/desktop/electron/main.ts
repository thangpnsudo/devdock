import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  Tray,
} from 'electron';

import type {
  CreateTerminalRequest,
  TerminalCloseRequest,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from './terminal-contract';
import { TerminalSessionManager } from './terminal-session-manager';
import { SshHostStore, type SaveSshHostRequest } from './ssh-host-store';
import { SftpManager, type FileEndpoint } from './sftp-manager';
import { AppDataStore } from './app-data-store';
import { AgentManager } from './agent-manager';
import type { StartAgentRequest } from './agent-contract';
import { DevDockAgentApi } from './agent-api';
import { AgentControlServer } from './agent-control-server';
import { agentControlDescriptorPath, agentControlEndpoint } from './agent-control-paths';
import { parseAgentCli, runAgentCli } from './agent-cli';
import { activateWindow } from './window-activation';

const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let sshHostStore: SshHostStore | null = null;
let appDataStore: AppDataStore | null = null;
let sftpEngine: SftpManager | null = null;
let agentManager: AgentManager | null = null;
let agentApi: DevDockAgentApi | null = null;
let agentControlServer: AgentControlServer | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let clipboardTimer: NodeJS.Timeout | null = null;
let lastClipboardFingerprint = '';
let lastClipboardCleanupAt = 0;
let terminalSmokeWrites = '';
let terminalSmokeOutput = '';

const terminalManager = new TerminalSessionManager({
  onData: (event) => {
    if (process.env.DEVDOCK_TERMINAL_SMOKE === '1') terminalSmokeOutput += event.data;
    agentManager?.onTerminalData(event);
    agentControlServer?.publishData(event);
    mainWindow?.webContents.send('terminal:data', event);
  },
  onExit: (event) => {
    agentManager?.onTerminalExit(event);
    agentControlServer?.publishExit(event);
    mainWindow?.webContents.send('terminal:exit', event);
  },
});

function requireAgentManager(): AgentManager {
  if (!agentManager) throw new Error('Agent runtime is not ready.');
  return agentManager;
}

function requireAgentApi(): DevDockAgentApi {
  if (!agentApi) throw new Error('Agent API is not ready.');
  return agentApi;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  activateWindow(mainWindow);
  updateTray();
}

function openLocalTerminalWindow(cwd: string): { sessionId: string } {
  const sessionId = terminalManager.create({ kind: 'local', cwd });
  const focus = (): void => {
    showMainWindow();
    mainWindow?.webContents.send('terminal:focus-requested', { sessionId });
  };
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow().then(focus).catch((error: unknown) => {
      console.error('[devdock] could not open terminal window', error);
    });
  } else {
    focus();
  }
  return { sessionId };
}

function updateTray(): void {
  const active =
    agentManager
      ?.list()
      .filter((agent) => ['starting', 'working', 'blocked', 'idle'].includes(agent.status))
      .length ?? 0;
  if (active === 0 && !backgroundRuntime && (!mainWindow || mainWindow.isVisible())) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(join(__dirname, '../resources/icons/icon.png'));
    tray.setToolTip('DevDock');
    tray.on('click', showMainWindow);
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open DevDock', click: showMainWindow },
      { label: `${active} active agent${active === 1 ? '' : 's'}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Quit DevDock',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}


async function runTerminalSmoke(window: BrowserWindow): Promise<void> {
  const marker = `DEVDock_ELECTRON_PTY_${Date.now()}`;
  let buttonReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    buttonReady = await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('button')]
        .some((element) => element.textContent?.includes('Local terminal'))
    `);
    if (buttonReady) break;
    await delay(50);
  }
  if (!buttonReady) throw new Error('Local terminal button was not found');

  await window.webContents.executeJavaScript(`
    window.__devdockTerminalSmoke = new Promise((resolve, reject) => {
      const marker = ${JSON.stringify(marker)};
      const timer = setTimeout(() => reject(new Error('terminal UI smoke test timed out')), 8000);
      const unsubscribe = window.devdockTerminal.onData((event) => {
        if (!event.data.split('').filter((character) => character > ' ').join('').includes(marker)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(marker);
      });
    });
    (async () => {
      const button = [...document.querySelectorAll('button')]
        .find((element) => element.textContent?.includes('Local terminal'));
      button.click();
    })();
  `);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const focused = await window.webContents.executeJavaScript(`
      (() => {
        const textarea = document.querySelector('.xterm-helper-textarea');
        if (!textarea) return false;
        textarea.focus();
        return document.activeElement === textarea;
      })()
    `);
    if (focused) break;
    await delay(50);
  }

  await window.webContents.insertText(`echo ${marker}`);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
  const result = await window.webContents.executeJavaScript('window.__devdockTerminalSmoke');
  let markerRendered = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    markerRendered = (await window.webContents.executeJavaScript(`
      (document.querySelector('.dd-terminal.is-active .xterm-rows')?.textContent ?? '')
        .includes(${JSON.stringify(marker)})
    `)) as boolean;
    if (markerRendered) break;
    await delay(50);
  }
  if (!markerRendered) throw new Error('Terminal marker was not rendered before copy smoke.');

  if (clipboardTimer) clearInterval(clipboardTimer);
  clipboardTimer = null;
  const clipboardBeforeCopySmoke = clipboard.readText();
  clipboard.writeText('');
  const contextMenuReady = (await window.webContents.executeJavaScript(`
    (() => {
      const surface = document.querySelector('.dd-terminal.is-active .dd-terminal__surface');
      if (!surface) return false;
      const bounds = surface.getBoundingClientRect();
      surface.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + 120,
        clientY: bounds.top + 90,
      }));
      return true;
    })()
  `)) as boolean;
  if (!contextMenuReady) throw new Error('Terminal context menu surface was not found.');
  let selectedAll = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    selectedAll = (await window.webContents.executeJavaScript(`
      (() => {
        const button = [...document.querySelectorAll('.dd-terminal-context-menu button')]
          .find((element) => element.textContent?.includes('Select all'));
        button?.click();
        return Boolean(button);
      })()
    `)) as boolean;
    if (selectedAll) break;
    await delay(50);
  }
  if (!selectedAll) throw new Error('Terminal Select all action was not found.');
  let copyActionReady = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    copyActionReady = (await window.webContents.executeJavaScript(`
      (() => {
        const surface = document.querySelector('.dd-terminal.is-active .dd-terminal__surface');
        if (!surface) return false;
        if (!document.querySelector('.dd-terminal-context-menu')) {
          const bounds = surface.getBoundingClientRect();
          surface.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: bounds.left + 120,
            clientY: bounds.top + 90,
          }));
          return false;
        }
        const button = [...document.querySelectorAll('.dd-terminal-context-menu button')]
          .find((element) => element.textContent?.includes('Copy'));
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()
    `)) as boolean;
    if (copyActionReady) break;
    await delay(50);
  }
  if (!copyActionReady) throw new Error('Terminal Copy action was not ready after Select all.');
  let copiedTerminalText = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    copiedTerminalText = clipboard.readText();
    // xterm inserts line breaks in copied text when the rendered row wraps.
    // Ignore whitespace so a narrow smoke window does not turn a valid copy
    // into a false negative.
    if (copiedTerminalText.replace(/\s/g, '').includes(marker)) break;
    await delay(50);
  }
  if (!copiedTerminalText.replace(/\s/g, '').includes(marker)) {
    clipboard.writeText(clipboardBeforeCopySmoke);
    throw new Error('Terminal selection was not copied to the system clipboard.');
  }

  const pasteMarker = `${marker}_PASTE_ONCE`;
  terminalSmokeWrites = '';
  terminalSmokeOutput = '';
  clipboard.writeText(pasteMarker);
  const pasteTargetReady = (await window.webContents.executeJavaScript(`
    (() => {
      const terminal = document.querySelector('.dd-terminal.is-active');
      const textarea = terminal?.querySelector('.xterm-helper-textarea');
      if (!textarea) return false;
      terminal.querySelector('.dd-terminal__surface')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
      textarea.focus();
      return document.activeElement === textarea;
    })()
  `)) as boolean;
  if (!pasteTargetReady) {
    clipboard.writeText(clipboardBeforeCopySmoke);
    throw new Error('Terminal paste target was not ready.');
  }
  window.show();
  window.focus();
  window.webContents.focus();
  await delay(100);
  window.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'V',
    modifiers: ['control', 'shift'],
  });
  window.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: 'V',
    modifiers: ['control', 'shift'],
  });
  await delay(120);
  let pastedMarkerCount = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    pastedMarkerCount = (await window.webContents.executeJavaScript(`
      (() => {
        const output = document.querySelector(
          '.dd-terminal.is-active .xterm-rows',
        )?.textContent ?? '';
        return output.split(${JSON.stringify(pasteMarker)}).length - 1;
      })()
    `)) as number;
    if (pastedMarkerCount > 0) break;
    await delay(50);
  }
  let writtenMarkerCount = terminalSmokeWrites.split(pasteMarker).length - 1;
  let pasteDelivery: 'native' | 'ipc-fallback' = 'native';
  if (writtenMarkerCount === 0) {
    // Electron's synthetic sendInputEvent occasionally misses the Wayland
    // before-input-event accelerator even though real keyboard input does not.
    // Exercise the exact renderer IPC path separately so the paste pipeline is
    // still verified without treating a compositor automation race as an app failure.
    pasteDelivery = 'ipc-fallback';
    window.webContents.send('terminal:paste-shortcut');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      writtenMarkerCount = terminalSmokeWrites.split(pasteMarker).length - 1;
      pastedMarkerCount = (await window.webContents.executeJavaScript(`
        (() => {
          const output = document.querySelector(
            '.dd-terminal.is-active .xterm-rows',
          )?.textContent ?? '';
          return output.split(${JSON.stringify(pasteMarker)}).length - 1;
        })()
      `)) as number;
      if (writtenMarkerCount > 0 && pastedMarkerCount > 0) break;
      await delay(50);
    }
  }
  const outputMarkerCount = terminalSmokeOutput.split(pasteMarker).length - 1;
  const clearInput = process.platform === 'win32'
    ? { keyCode: 'ESCAPE', modifiers: [] as string[] }
    : { keyCode: 'U', modifiers: ['control'] };
  window.webContents.sendInputEvent({ type: 'keyDown', ...clearInput });
  window.webContents.sendInputEvent({ type: 'keyUp', ...clearInput });
  clipboard.writeText(clipboardBeforeCopySmoke);
  if (writtenMarkerCount !== 1) {
    throw new Error(
      `Ctrl+Shift+V pipeline counts: writes=${writtenMarkerCount}, ` +
        `pty-output=${outputMarkerCount}, rendered=${pastedMarkerCount}.`,
    );
  }

  const retainedDomMarker = `retained-${Date.now()}`;
  await window.webContents.executeJavaScript(`
    document.querySelector('.dd-terminal.is-active').dataset.smokeIdentity =
      ${JSON.stringify(retainedDomMarker)}
  `);

  const secondMarker = `${marker}_SECOND`;
  await window.webContents.executeJavaScript(`
    window.__devdockSecondTerminalSmoke = new Promise((resolve, reject) => {
      const marker = ${JSON.stringify(secondMarker)};
      const timer = setTimeout(() => reject(new Error('second terminal smoke test timed out')), 8000);
      const output = new Map();
      const unsubscribe = window.devdockTerminal.onData((event) => {
        const combined = (output.get(event.sessionId) ?? '') + event.data;
        output.set(event.sessionId, combined.slice(-4096));
        if (!combined.split('').filter((character) => character > ' ').join('').includes(marker)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(marker);
      });
    });
    document.querySelector('button[aria-label="Add local terminal"]').click();
  `);
  let secondTerminalReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    secondTerminalReady = await window.webContents.executeJavaScript(
      `document.querySelectorAll('.dd-terminal-stack > .dd-terminal').length === 2`,
    );
    if (secondTerminalReady) break;
    await delay(50);
  }
  if (!secondTerminalReady) throw new Error('Second terminal was not mounted.');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const focused = await window.webContents.executeJavaScript(`
      (() => {
        const textarea = document.querySelector('.dd-terminal.is-active .xterm-helper-textarea');
        if (!textarea) return false;
        textarea.focus();
        return document.activeElement === textarea;
      })()
    `);
    if (focused) break;
    await delay(50);
  }
  await window.webContents.insertText(`echo ${secondMarker}`);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
  const secondResult = await window.webContents.executeJavaScript(
    'window.__devdockSecondTerminalSmoke',
  );
  await window.webContents.executeJavaScript(
    `document.querySelector('.dd-terminal-tabs [role="tab"]').click()`,
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const firstActive = await window.webContents.executeJavaScript(`
      document.querySelector('.dd-terminal-stack > .dd-terminal:first-child')
        ?.classList.contains('is-active') ?? false
    `);
    if (firstActive) break;
    await delay(25);
  }
  const retained = (await window.webContents.executeJavaScript(`
    (() => {
      const activeTerminal = document.querySelector('.dd-terminal.is-active');
      return {
        terminalCount: document.querySelectorAll('.dd-terminal-stack > .dd-terminal').length,
        output: activeTerminal?.querySelector('.xterm-rows')?.textContent ?? '',
        identity: activeTerminal?.dataset.smokeIdentity ?? '',
      };
    })()
  `)) as { terminalCount: number; output: string; identity: string };
  if (retained.terminalCount !== 2 || retained.identity !== retainedDomMarker) {
    throw new Error('Terminal tab state was not retained after switching tabs.');
  }
  console.info('[terminal-smoke] stage tabs-retained');
  const groupMarker = `${marker}_BROADCAST`;
  const groupReady = await window.webContents.executeJavaScript(`
    (async () => {
      const nextFrame = () => new Promise(requestAnimationFrame);
      const tabs = [...document.querySelectorAll('.dd-terminal-tab')];
      if (tabs.length !== 2) return false;
      const transfer = new DataTransfer();
      tabs[1].dispatchEvent(new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer: transfer,
      }));
      tabs[0].dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        dataTransfer: transfer,
      }));
      await nextFrame();
      const groupedTerminals = [...document.querySelectorAll('.dd-group-terminal')];
      groupedTerminals[1]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await nextFrame();
      document.querySelector('.dd-terminal-group-grid__status .dd-broadcast-toggle')?.click();
      await nextFrame();
      document.querySelector('.dd-confirm-dialog footer button:last-child')?.click();
      await nextFrame();
      const cells = document.querySelector('.dd-terminal-layout-row__cells');
      const resizer = document.querySelector('.dd-terminal-resizer--vertical');
      if (!cells || !resizer) return false;
      const before = getComputedStyle(cells).gridTemplateColumns;
      const bounds = resizer.getBoundingClientRect();
      resizer.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: bounds.x,
        pointerId: 1,
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: bounds.x + 48,
        pointerId: 1,
      }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      await nextFrame();
      const after = getComputedStyle(cells).gridTemplateColumns;
      window.__devdockResizeSmoke = before !== after;
      window.__devdockGroupSmoke = new Promise((resolve, reject) => {
        const marker = ${JSON.stringify(groupMarker)};
        const sessions = new Set();
        const history = new Map();
        const timer = setTimeout(() => reject(new Error(
          'group Broadcast smoke test timed out: ' + JSON.stringify([...history.entries()]),
        )), 8000);
        const unsubscribe = window.devdockTerminal.onData((event) => {
          const combined = ((history.get(event.sessionId) ?? '') + event.data).slice(-4096);
          history.set(event.sessionId, combined);
          if (combined.split('').filter((character) => character > ' ').join('').includes(marker)) {
            sessions.add(event.sessionId);
          }
          if (sessions.size < 2) return;
          clearTimeout(timer);
          unsubscribe();
          resolve([...sessions]);
        });
      });
      return document.querySelectorAll('.dd-group-terminal').length === 2
        && document.querySelectorAll('.dd-terminal-tab').length === 1
        && Boolean(document.querySelector('.dd-terminal-tab--workspace.is-active'))
        && Boolean(document.querySelector('.dd-terminal-group-grid.is-broadcasting'))
        && window.__devdockResizeSmoke;
    })()
  `);
  if (!groupReady) throw new Error('Terminal group drag/drop setup failed.');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const focused = await window.webContents.executeJavaScript(`
      (() => {
        const textarea = document.querySelector('.dd-group-terminal.is-active .xterm-helper-textarea')
          ?? document.querySelector('.dd-group-terminal .xterm-helper-textarea');
        if (!textarea) return false;
        textarea.focus();
        return document.activeElement === textarea;
      })()
    `);
    if (focused) break;
    await delay(50);
  }
  await window.webContents.insertText(`echo ${groupMarker}`);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
  const broadcastSessions = (await window.webContents.executeJavaScript(
    'window.__devdockGroupSmoke',
  )) as string[];
  if (broadcastSessions.length !== 2) throw new Error('Broadcast did not reach both terminals.');
  console.info('[terminal-smoke] stage broadcast');
  const splitLayoutReady = (await window.webContents.executeJavaScript(`
    (async () => {
      const nextFrame = () => new Promise(requestAnimationFrame);
      const terminals = [...document.querySelectorAll('.dd-group-terminal')];
      const sourceHeader = terminals[1]?.querySelector('header');
      const target = terminals[0];
      if (!sourceHeader || !target) return false;
      const transfer = new DataTransfer();
      sourceHeader.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer: transfer,
      }));
      const bounds = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.bottom - 4,
        dataTransfer: transfer,
      }));
      target.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.bottom - 4,
        dataTransfer: transfer,
      }));
      await nextFrame();
      return document.querySelectorAll('.dd-terminal-layout-row').length === 2
        && Boolean(document.querySelector('.dd-terminal-resizer--horizontal'));
    })()
  `)) as boolean;
  if (!splitLayoutReady) throw new Error('Terminal bottom-half split layout failed.');
  console.info('[terminal-smoke] stage split-layout');
  const routeStateRetained = (await Promise.race([
    window.webContents.executeJavaScript(`
    (async () => {
      const nextFrame = () => new Promise(requestAnimationFrame);
      window.location.hash = '#/clipboard';
      for (let attempt = 0; attempt < 20; attempt += 1) await nextFrame();
      if (!document.querySelector('.dd-page--clipboard')) return false;
      window.location.hash = '#/ssh';
      for (let attempt = 0; attempt < 20; attempt += 1) await nextFrame();
      const sftpTab = [...document.querySelectorAll('.dd-workspace-mode button')]
        .find((button) => button.textContent?.includes('SFTP'));
      const modeOrder = [...document.querySelectorAll('.dd-workspace-mode button')]
        .map((button) => button.textContent?.trim());
      sftpTab?.click();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await nextFrame();
        if (document.querySelectorAll('.dd-sftp-panel:first-child .dd-sftp-row').length >= 3) break;
      }
      const sftpVisible = document.querySelectorAll('.dd-sftp-panel').length === 2;
      const localPanel = document.querySelector('.dd-sftp-panel:first-child');
      const localRows = [...localPanel.querySelectorAll('.dd-sftp-row')];
      localPanel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await nextFrame();
      localRows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextFrame();
      localRows[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await nextFrame();
      const shiftSelectionWorks =
        localPanel.querySelectorAll('.dd-sftp-row.is-selected').length === 3;
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
      }));
      await nextFrame();
      const ctrlCopyWorks = localPanel.querySelector('.dd-sftp-panel__footer')
        ?.textContent?.includes('ready to copy') ?? false;
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'x',
        ctrlKey: true,
        bubbles: true,
      }));
      await nextFrame();
      const ctrlCutWorks = localPanel.querySelector('.dd-sftp-panel__footer')
        ?.textContent?.includes('ready to move') ?? false;
      localPanel.querySelector('button[title="New folder"]')?.click();
      await nextFrame();
      const folderDialogWorks = Boolean(document.querySelector('.dd-file-dialog'));
      [...document.querySelectorAll('.dd-file-dialog button')]
        .find((button) => button.textContent?.includes('Cancel'))
        ?.click();
      const search = localPanel.querySelector('input[aria-label="Search files and folders"]');
      const firstName = localRows[0]?.querySelector('.dd-sftp-row__name > span')?.textContent ?? '';
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(search, firstName);
      search?.dispatchEvent(new Event('input', { bubbles: true }));
      await nextFrame();
      localPanel.querySelector('.dd-sftp-row')?.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true }),
      );
      for (let attempt = 0; attempt < 20; attempt += 1) await nextFrame();
      const searchResetWorks = search?.value === '';
      localPanel.querySelector('button[aria-label="Grid view"]')?.click();
      await nextFrame();
      const gridViewWorks = Boolean(localPanel.querySelector('.dd-sftp-table--grid'));
      localPanel.querySelector('button[aria-label="List view"]')?.click();
      await nextFrame();
      const listViewWorks = Boolean(localPanel.querySelector('.dd-sftp-table--list'));
      const addPane = [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Add pane'));
      addPane?.click();
      await nextFrame();
      const multiPaneVisible = document.querySelectorAll('.dd-sftp-panel').length === 3;
      const toolbarHasNoScrollbar = [...document.querySelectorAll('.dd-sftp-actions')]
        .every((toolbar) => toolbar.scrollWidth <= toolbar.clientWidth + 1);
      document.querySelector('.dd-terminal-tab--workspace button[role="tab"]')?.click();
      await nextFrame();
      const terminalOpenedFromSessionTab =
        !document.querySelector('.dd-terminal-workspace__canvas')?.hidden
        && Boolean(document.querySelector('.dd-sftp-workspace')?.hidden);
      const historyTab = [...document.querySelectorAll('.dd-terminal-utility__tabs button')]
        .find((button) => button.textContent?.includes('History'));
      historyTab?.click();
      await nextFrame();
      const historyText = document.querySelector('.dd-terminal-utility__content')?.textContent ?? '';
      return {
        groupedTerminals: document.querySelectorAll('.dd-group-terminal').length === 2,
        workspaceTab: document.querySelectorAll('.dd-terminal-tab--workspace').length === 1,
        broadcast: Boolean(document.querySelector('.dd-terminal-group-grid.is-broadcasting')),
        sftpVisible,
        multiPaneVisible,
        shiftSelectionWorks,
        folderDialogWorks,
        searchResetWorks,
        modeOrderWorks: modeOrder.join('|') === 'SFTP|Terminal',
        ctrlCopyWorks,
        ctrlCutWorks,
        gridViewWorks,
        listViewWorks,
        toolbarHasNoScrollbar,
        terminalOpenedFromSessionTab,
        historyFirst: historyText.includes(${JSON.stringify(marker)}),
        historySecond: historyText.includes(${JSON.stringify(secondMarker)}),
        historyActions: document.querySelectorAll(
          '.dd-history-row .dd-utility-row__actions button',
        ).length >= 2,
      };
    })()
    `),
    delay(15_000).then(() => {
      throw new Error('Terminal workspace smoke test timed out.');
    }),
  ])) as Record<string, boolean>;
  const failedWorkspaceChecks = Object.entries(routeStateRetained)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedWorkspaceChecks.length > 0) {
    throw new Error(`Terminal workspace checks failed: ${failedWorkspaceChecks.join(', ')}`);
  }
  console.info('[terminal-smoke] stage workspace');
  const layout = (await window.webContents.executeJavaScript(`
    (async () => {
      const shellToggle = document.querySelector('button[aria-label="Collapse navigation"]')
        ?? document.querySelector('button[aria-label="Expand navigation"]');
      const utilityToggle = document.querySelector('button[aria-label="Collapse utility panel"]');
      const workspace = document.querySelector('.dd-terminal-workspace');
      if (!shellToggle || !utilityToggle || !workspace) return { valid: false };
      const wasCollapsed = document.querySelector('.dd-shell').classList.contains('dd-shell--collapsed');
      shellToggle.click();
      await new Promise(requestAnimationFrame);
      (document.querySelector('button[aria-label="Collapse navigation"]')
        ?? document.querySelector('button[aria-label="Expand navigation"]')).click();
      await new Promise(requestAnimationFrame);
      utilityToggle.click();
      await new Promise(requestAnimationFrame);
      const utilityClosed = !document.querySelector('.dd-terminal-utility')
        && Boolean(document.querySelector('button[aria-label="Open utility panel"]'));
      document.querySelector('button[aria-label="Open utility panel"]')?.click();
      await new Promise(requestAnimationFrame);
      const restored = Boolean(document.querySelector('.dd-terminal-utility'));
      return {
        valid: true,
        sidebarRestored: document.querySelector('.dd-shell').classList.contains('dd-shell--collapsed')
          === wasCollapsed,
        utilityClosed,
        restored,
      };
    })()
  `)) as {
    valid: boolean;
    sidebarRestored?: boolean;
    utilityClosed?: boolean;
    restored?: boolean;
  };
  if (!layout.valid || !layout.sidebarRestored || !layout.utilityClosed || !layout.restored) {
    throw new Error('Collapsible workspace layout smoke test failed.');
  }
  console.info('[terminal-smoke] stage layout');
  const bridgeData = (await window.webContents.executeJavaScript(`
    Promise.all([
      window.devdockLibrary.listRecent(5),
      window.devdockClipboard.list({ limit: 5, pinnedOnly: false, offset: 0 }),
      window.devdockClipboard.count({ pinnedOnly: false, query: '' }),
      window.devdockSettings.get(),
      window.devdockSftp.localHome().then(async (home) => ({
        home,
        entries: await window.devdockSftp.listLocal({ path: home }),
      })),
    ]).then(([library, clipboard, clipboardTotal, settings, localFiles]) => ({
      libraryIsArray: Array.isArray(library),
      clipboardIsArray: Array.isArray(clipboard),
      clipboardTotalIsNumber: Number.isFinite(clipboardTotal),
      settingsValid: Number.isFinite(settings.clipboardMaxItems)
        && settings.clipboardMaxItems <= 500
        && settings.theme === 'dark',
      localSftpValid: typeof localFiles.home === 'string'
        && localFiles.home.length > 0
        && Array.isArray(localFiles.entries),
    }))
  `)) as {
    libraryIsArray: boolean;
    clipboardIsArray: boolean;
    clipboardTotalIsNumber: boolean;
    settingsValid: boolean;
    localSftpValid: boolean;
  };
  const failedBridgeChecks = Object.entries(bridgeData)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedBridgeChecks.length > 0) {
    throw new Error(`Electron bridge checks failed: ${failedBridgeChecks.join(', ')}`);
  }
  console.info(
    `[terminal-smoke] PASS ${result} ${secondResult} tabs=2 broadcast=2 resize=ok navigation=retained data=ok copy=ok paste=once delivery=${pasteDelivery}`,
  );
}

async function waitForAgentSmoke(
  window: BrowserWindow,
  expression: string,
  failure: string,
  attempts = 120,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await delay(50);
  }
  throw new Error(failure);
}

async function runAgentSmoke(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`window.location.hash = '#/agents'`);
  await waitForAgentSmoke(
    window,
    `Boolean(document.querySelector('.dd-agent-guide') && document.querySelector('.dd-agent-command-list'))`,
    'Agent Center did not render.',
  );
  const guideTabsWork = (await window.webContents.executeJavaScript(`
    (async () => {
      const tabs = [...document.querySelectorAll('.dd-agent-guide__tabs [role="tab"]')];
      if (tabs.map((tab) => tab.textContent?.trim()).join('|') !== 'Linux|macOS|Windows') return false;
      tabs[2].click();
      await new Promise(requestAnimationFrame);
      const windowsCommand = document.querySelector('.dd-agent-command-list code')?.textContent ?? '';
      tabs[0].click();
      await new Promise(requestAnimationFrame);
      const linuxCommands = [...document.querySelectorAll('.dd-agent-command-list code')]
        .map((command) => command.textContent?.trim());
      return windowsCommand.includes('DevDock.exe') && linuxCommands.includes('devdock codex .');
    })()
  `)) as boolean;
  if (!guideTabsWork) throw new Error('Platform-specific agent CLI guides did not switch correctly.');
  await window.webContents.executeJavaScript(`
    (async () => {
      await window.devdockAgents.start({
        provider: 'codex',
        cwd: await window.devdockSftp.localHome(),
        displayName: 'Smoke primary',
        task: 'Exercise deterministic lifecycle',
      });
    })()
  `);
  await waitForAgentSmoke(
    window,
    `window.devdockAgents.list().then((agents) => agents.length === 1 && agents[0].status === 'blocked')`,
    'Primary fake agent did not reach blocked state.',
  );
  await waitForAgentSmoke(
    window,
    `(() => {
      const actions = [...document.querySelectorAll('.dd-agent-project__actions button')];
      return Boolean(
        document.querySelector('.dd-shell__nav-badge')
        && document.querySelector('.dd-agent-row.needs-attention')
        && actions.length === 2
        && actions.every((button) => button.getBoundingClientRect().width <= 24.5)
      );
    })()`,
    'Blocked agent did not produce Agent Center attention indicators.',
  );
  const agents = (await window.webContents.executeJavaScript(`
    (async () => {
      const cwd = await window.devdockSftp.localHome();
      await Promise.all([
        window.devdockAgents.start({ provider: 'codex', cwd, displayName: 'Smoke secondary' }),
        window.devdockAgents.start({ provider: 'codex', cwd, displayName: 'Smoke tertiary' }),
      ]);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const items = await window.devdockAgents.list();
        if (items.length === 3 && items.every((item) => item.status === 'blocked')) return items;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Multiple fake agents did not reach blocked state.');
    })()
  `)) as Array<{ id: string; terminalSessionId: string; displayName: string }>;
  if (new Set(agents.map((agent) => agent.terminalSessionId)).size !== 3) {
    throw new Error('Managed agents did not receive independent terminal sessions.');
  }

  const externalArguments = [
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    'agent',
    'codex',
    '--cwd',
    app.getPath('home'),
    '--name',
    'Smoke external',
    '--detach',
  ];
  const externalEnvironment = {
    ...process.env,
    DEVDOCK_AGENT_RUNTIME_FILE: agentControlDescriptorPath(app.getPath('userData')),
  };
  const externalStart = await execFileAsync(process.execPath, externalArguments, {
    env: externalEnvironment,
    timeout: 10_000,
  });
  const externalId = externalStart.stdout.trim().split('\t')[0] ?? '';
  if (!externalId) throw new Error('External DevDock CLI did not return an agent id.');
  await waitForAgentSmoke(
    window,
    `window.devdockAgents.status(${JSON.stringify(externalId)}).then((state) => state?.status === 'blocked')`,
    'Externally started agent did not reach the managed runtime.',
  );
  const externalList = await execFileAsync(
    process.execPath,
    [...(app.isPackaged ? [] : [app.getAppPath()]), 'agent', 'list'],
    { env: externalEnvironment, timeout: 10_000 },
  );
  if (!externalList.stdout.includes(externalId)) {
    throw new Error('Externally started agent was missing from `devdock agent list`.');
  }
  await execFileAsync(
    process.execPath,
    [...(app.isPackaged ? [] : [app.getAppPath()]), 'agent', 'stop', externalId],
    { env: externalEnvironment, timeout: 10_000 },
  );
  await execFileAsync(
    process.execPath,
    [...(app.isPackaged ? [] : [app.getAppPath()]), 'agent', 'remove', externalId],
    { env: externalEnvironment, timeout: 10_000 },
  );
  if (requireAgentApi().getAgent(externalId)) {
    throw new Error('Externally removed agent remained in Agent Center history.');
  }

  window.close();
  await delay(100);
  if (window.isVisible() || !requireAgentManager().hasActiveAgents()) {
    throw new Error('Closing the window did not preserve active agents in the tray runtime.');
  }
  window.show();

  const loaded = new Promise<void>((resolve) =>
    window.webContents.once('did-finish-load', () => resolve()),
  );
  window.webContents.reload();
  await Promise.race([
    loaded,
    delay(10_000).then(() => {
      throw new Error('Renderer reload timed out during agent smoke test.');
    }),
  ]);
  await window.webContents.executeJavaScript(`window.location.hash = '#/agents'`);
  await waitForAgentSmoke(
    window,
    `document.querySelectorAll('.dd-agent-row').length === 3`,
    'Agent Center did not restore three managed agents after renderer reload.',
  );

  const primary = agents.find((agent) => agent.displayName === 'Smoke primary');
  const secondary = agents.find((agent) => agent.displayName === 'Smoke secondary');
  const tertiary = agents.find((agent) => agent.displayName === 'Smoke tertiary');
  if (!primary || !secondary || !tertiary) throw new Error('Fake agent identities were lost.');
  const replayValid = (await window.webContents.executeJavaScript(`
    window.devdockAgents.readTerminal(${JSON.stringify(primary.id)})
      .then((result) => result.replay.some((event) => event.data.includes('DEVDock_FAKE_AGENT_WORKING')))
  `)) as boolean;
  if (!replayValid)
    throw new Error('Agent terminal output was not replayed after renderer reload.');

  window.webContents.send('agent:focus-requested', {
    agentId: secondary.id,
    sessionId: secondary.terminalSessionId,
  });
  await waitForAgentSmoke(
    window,
    `window.location.hash === '#/ssh' && Boolean(document.querySelector('[data-session-id="${secondary.terminalSessionId}"]'))`,
    'Secondary agent terminal did not open before restart.',
  );
  const restartedSecondary = (await window.webContents.executeJavaScript(`
    window.devdockAgents.restart(${JSON.stringify(secondary.id)})
  `)) as { terminalSessionId: string };
  if (restartedSecondary.terminalSessionId === secondary.terminalSessionId) {
    throw new Error('Restart did not replace the old terminal session.');
  }
  window.webContents.send('agent:focus-requested', {
    agentId: secondary.id,
    sessionId: restartedSecondary.terminalSessionId,
  });
  await waitForAgentSmoke(
    window,
    `Boolean(document.querySelector('[data-session-id="${restartedSecondary.terminalSessionId}"]'))
      && !document.querySelector('[data-session-id="${secondary.terminalSessionId}"]')`,
    'Restart did not replace the open terminal tab with the resumed session.',
  );
  const restartProducedErrorToast = (await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('.dd-toast--error')]
      .some((toast) => toast.textContent?.includes('terminal_exit'))
  `)) as boolean;
  if (restartProducedErrorToast) {
    throw new Error('Expected agent restart was shown as a terminal action failure.');
  }

  window.webContents.send('agent:focus-requested', {
    agentId: primary.id,
    sessionId: primary.terminalSessionId,
  });
  await waitForAgentSmoke(
    window,
    `window.location.hash === '#/ssh' && Boolean(document.querySelector('[data-session-id="${primary.terminalSessionId}"]'))`,
    'Agent focus event did not open the correct terminal.',
  );
  await waitForAgentSmoke(
    window,
    `Boolean(document.querySelector('.dd-terminal-tab.needs-input button[title^="Smoke primary"]'))`,
    'Blocked agent did not remain highlighted on its terminal tab.',
  );
  await window.webContents.executeJavaScript(
    `window.devdockAgents.writeTerminal(${JSON.stringify(primary.id)}, 'continue\\r')`,
  );
  await waitForAgentSmoke(
    window,
    `window.devdockAgents.status(${JSON.stringify(primary.id)}).then((state) => state?.status === 'exited')`,
    'Primary fake agent did not finish after input.',
  );

  await window.webContents.executeJavaScript(`
    (async () => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = await window.devdockAgents.status(${JSON.stringify(secondary.id)});
        if (state?.status === 'blocked') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await window.devdockAgents.stop(${JSON.stringify(secondary.id)});
    })()
  `);
  const stopProducedErrorToast = (await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('.dd-toast--error')]
      .some((toast) => toast.textContent?.includes('terminal_exit'))
  `)) as boolean;
  if (stopProducedErrorToast) {
    throw new Error('Expected agent stop was shown as a terminal action failure.');
  }
  await window.webContents.executeJavaScript(`window.location.hash = '#/agents'`);
  await waitForAgentSmoke(
    window,
    `Boolean([...document.querySelectorAll('.dd-agent-row')]
      .find((row) => row.textContent?.includes('Smoke tertiary')))`,
    'Active agent row was not available for UI removal.',
  );
  const clickedRemove = (await window.webContents.executeJavaScript(`
    (() => {
      const row = [...document.querySelectorAll('.dd-agent-row')]
        .find((element) => element.textContent?.includes('Smoke tertiary'));
      const button = row?.querySelector('button[title="Stop and remove agent"]');
      button?.click();
      return Boolean(button);
    })()
  `)) as boolean;
  if (!clickedRemove) throw new Error('Active agent remove button was not enabled.');
  await waitForAgentSmoke(
    window,
    `window.devdockAgents.get(${JSON.stringify(tertiary.id)}).then((agent) => agent === null)`,
    'Active agent was not stopped and removed by the Agent Center button.',
  );
  const removeProducedErrorToast = (await window.webContents.executeJavaScript(`
    Boolean(document.querySelector('.dd-toast--error'))
  `)) as boolean;
  if (removeProducedErrorToast) {
    throw new Error('Agent Center remove action produced an error toast.');
  }
  const finalStates = requireAgentManager()
    .list()
    .map((agent) => agent.status)
    .sort();
  if (finalStates.join('|') !== 'exited|stopped') {
    throw new Error(`Unexpected final agent states: ${finalStates.join(', ')}`);
  }
  console.info(
    '[agent-smoke] PASS lifecycle=ok reload=replayed focus=ok restart=resumed-tab stop=clean remove=ui-ok tray=retained agents=3 external-cli=ok',
  );
}

function registerTerminalIpc(): void {
  ipcMain.handle('terminal:list', () => terminalManager.list());
  ipcMain.handle('terminal:attach', (event, sessionId: string) =>
    terminalManager.attach(sessionId, event.sender.id),
  );
  ipcMain.handle('terminal:detach', (event, sessionId: string) => {
    terminalManager.detach(sessionId, event.sender.id);
  });
  ipcMain.handle('terminal:create', async (_event, request: CreateTerminalRequest) => {
    let resolved = request;
    if (request.kind === 'ssh' && request.hostId) {
      const host = await sshHostStore?.get(request.hostId);
      if (!host) throw new Error('SSH host was not found.');
      const password =
        host.authMethod === 'password' ? await sshHostStore?.savedPassword(host.id) : undefined;
      resolved = {
        ...request,
        host: host.host,
        port: host.port,
        username: host.username,
        ...(host.authMethod === 'public_key' && host.credential
          ? { identityFile: host.credential }
          : {}),
        ...(password ? { password } : {}),
      };
    }
    return { sessionId: terminalManager.create(resolved) };
  });
  ipcMain.handle('terminal:write', (_event, request: TerminalWriteRequest) => {
    if (process.env.DEVDOCK_TERMINAL_SMOKE === '1') terminalSmokeWrites += request.data;
    terminalManager.write(request.sessionId, request.data);
    agentManager?.onTerminalInput(request.sessionId);
  });
  ipcMain.handle('terminal:resize', (_event, request: TerminalResizeRequest) => {
    terminalManager.resize(request.sessionId, request.cols, request.rows);
  });
  ipcMain.handle('terminal:close', (_event, request: TerminalCloseRequest) => {
    terminalManager.close(request.sessionId);
  });
  ipcMain.handle('ssh-host:list', () => sshHostStore?.listPublic() ?? []);
  ipcMain.handle('ssh-host:create', (_event, request: SaveSshHostRequest) => {
    if (!sshHostStore) throw new Error('SSH host storage is not ready.');
    return sshHostStore.create(request);
  });
  ipcMain.handle('ssh-host:update', (_event, request: SaveSshHostRequest & { id: string }) => {
    if (!sshHostStore) throw new Error('SSH host storage is not ready.');
    return sshHostStore.update(request);
  });
  ipcMain.handle('ssh-host:delete', (_event, id: string) => {
    if (!sshHostStore) throw new Error('SSH host storage is not ready.');
    return sshHostStore.delete(id);
  });
  ipcMain.handle('ssh-host:recent', async () => ({
    hosts: (await sshHostStore?.recentPublic()) ?? [],
  }));
  ipcMain.handle('ssh-host:mark-connected', (_event, id: string) => {
    if (!sshHostStore) throw new Error('SSH host storage is not ready.');
    return sshHostStore.markConnected(id);
  });
  ipcMain.handle('library:list-recent', (_event, limit: number) => dataStore().listRecent(limit));
  ipcMain.handle(
    'library:list-page',
    (
      _event,
      request: {
        limit: number;
        offset: number;
        filter?: Parameters<AppDataStore['listItems']>[2];
      },
    ) => dataStore().listItems(request.limit, request.offset, request.filter),
  );
  ipcMain.handle('library:count', (_event, filter?: Parameters<AppDataStore['countItems']>[0]) =>
    dataStore().countItems(filter),
  );
  ipcMain.handle('library:get', (_event, id: string) => dataStore().getItem(id));
  ipcMain.handle(
    'library:create-script',
    (_event, request: Parameters<AppDataStore['createScript']>[0]) =>
      dataStore().createScript(request),
  );
  ipcMain.handle(
    'library:update-script',
    (_event, request: Parameters<AppDataStore['updateScript']>[0]) =>
      dataStore().updateScript(request),
  );
  ipcMain.handle(
    'library:create-resource',
    (_event, request: Parameters<AppDataStore['createResource']>[0]) =>
      dataStore().createResource(request),
  );
  ipcMain.handle(
    'library:update-resource',
    (_event, request: Parameters<AppDataStore['updateResource']>[0]) =>
      dataStore().updateResource(request),
  );
  ipcMain.handle('library:archive', (_event, id: string) => {
    dataStore().archive(id, true);
    return { archived: true };
  });
  ipcMain.handle('library:restore', (_event, id: string) => {
    dataStore().archive(id, false);
    return { restored: true };
  });
  ipcMain.handle('library:delete', (_event, id: string) => {
    dataStore().deleteItem(id);
    return { success: true };
  });
  ipcMain.handle('library:delete-many', (_event, ids: string[]) => {
    ids.forEach((id) => dataStore().deleteItem(id));
    return { success: true };
  });
  ipcMain.handle('library:toggle-favorite', (_event, id: string) => ({
    favorite: dataStore().toggleFavorite(id),
  }));
  ipcMain.handle('library:search', (_event, request: Parameters<AppDataStore['search']>[0]) =>
    dataStore().search(request),
  );
  ipcMain.handle(
    'clipboard:list',
    (
      _event,
      request: {
        limit: number;
        pinnedOnly: boolean;
        offset: number;
        query?: string;
        sort?: 'newest' | 'oldest' | 'favorite';
      },
    ) => {
      if (!appDataStore) return [];
      return dataStore().listClipboard(
        request.limit,
        request.pinnedOnly,
        request.offset,
        request.query,
        request.sort,
      );
    },
  );
  ipcMain.handle('clipboard:count', (_event, request: { pinnedOnly: boolean; query?: string }) => {
    if (!appDataStore) return 0;
    return dataStore().countClipboard(request.pinnedOnly, request.query);
  });
  ipcMain.handle('clipboard:pin', (_event, id: string) => ({
    pinned: dataStore().pinClipboard(id),
  }));
  ipcMain.handle('clipboard:delete', (_event, id: string) => {
    dataStore().deleteClipboard([id]);
    return { success: true };
  });
  ipcMain.handle('clipboard:delete-many', (_event, ids: string[]) => {
    dataStore().deleteClipboard(ids);
    return { success: true };
  });
  ipcMain.handle('clipboard:update', (_event, request: { id: string; content: string }) =>
    dataStore().updateClipboard(request.id, request.content),
  );
  ipcMain.handle(
    'clipboard:record',
    (_event, request: { content: string; contentType?: string; sourceApp?: string }) =>
      dataStore().recordClipboard(request.content, request.contentType, request.sourceApp),
  );
  ipcMain.handle('clipboard:copy-text', (_event, content: string) => clipboard.writeText(content));
  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  ipcMain.handle('clipboard:copy-stored', (_event, id: string) => copyStoredClipboard(id));
  ipcMain.handle('clipboard:mark-saved', (_event, request: { id: string; scriptId: string }) =>
    dataStore().markClipboardSaved(request.id, request.scriptId),
  );
  ipcMain.handle('clipboard:thumbnail', (_event, id: string) => clipboardThumbnail(id));
  ipcMain.handle('settings:get', () => dataStore().getSettings());
  ipcMain.handle('settings:save', (_event, request: Parameters<AppDataStore['saveSettings']>[0]) =>
    dataStore().saveSettings(request),
  );
  ipcMain.handle(
    'sftp:list',
    (
      _event,
      request: {
        hostId: string;
        path: string;
        credential?: string;
      },
    ) => sftp().list(request.hostId, request.path, request.credential),
  );
  ipcMain.handle('sftp:local-home', () => sftp().localHome());
  ipcMain.handle('sftp:list-local', (_event, request: { path: string }) =>
    sftp().listLocal(request.path),
  );
  ipcMain.handle('sftp:mkdir-local', (_event, request: { path: string }) =>
    sftp().mkdirLocal(request.path),
  );
  ipcMain.handle(
    'sftp:remove-local',
    (
      _event,
      request: {
        path: string;
        directory: boolean;
      },
    ) => sftp().removeLocal(request.path, request.directory),
  );
  ipcMain.handle(
    'sftp:mkdir',
    (
      _event,
      request: {
        hostId: string;
        path: string;
        credential?: string;
      },
    ) => sftp().mkdir(request.hostId, request.path, request.credential),
  );
  ipcMain.handle(
    'sftp:remove',
    (
      _event,
      request: {
        hostId: string;
        path: string;
        directory: boolean;
        credential?: string;
      },
    ) => sftp().remove(request.hostId, request.path, request.directory, request.credential),
  );
  ipcMain.handle(
    'sftp:transfer',
    (
      _event,
      request: {
        sourceHostId: string;
        sourcePath: string;
        targetHostId: string;
        targetDirectory: string;
        sourceCredential?: string;
        targetCredential?: string;
      },
    ) =>
      sftp().transfer(
        request.sourceHostId,
        request.sourcePath,
        request.targetHostId,
        request.targetDirectory,
        request.sourceCredential,
        request.targetCredential,
      ),
  );
  ipcMain.handle(
    'sftp:upload',
    (
      _event,
      request: {
        hostId: string;
        localPaths: string[];
        targetDirectory: string;
        credential?: string;
      },
    ) =>
      sftp().upload(
        request.hostId,
        request.localPaths,
        request.targetDirectory,
        request.credential,
      ),
  );
  ipcMain.handle(
    'sftp:download',
    (
      _event,
      request: {
        hostId: string;
        remotePaths: string[];
        targetDirectory: string;
        credential?: string;
      },
    ) =>
      sftp().download(
        request.hostId,
        request.remotePaths,
        request.targetDirectory,
        request.credential,
      ),
  );
  ipcMain.handle(
    'sftp:rename-item',
    (
      _event,
      request: {
        endpoint: FileEndpoint;
        path: string;
        nextPath: string;
      },
    ) => sftp().renameItem(request.endpoint, request.path, request.nextPath),
  );
  ipcMain.handle(
    'sftp:remove-items',
    (
      _event,
      request: {
        endpoint: FileEndpoint;
        paths: string[];
      },
    ) => sftp().removeItems(request.endpoint, request.paths),
  );
  ipcMain.handle(
    'sftp:transfer-items',
    (
      _event,
      request: {
        source: FileEndpoint;
        target: FileEndpoint;
        sourcePaths: string[];
        targetDirectory: string;
        mode: 'copy' | 'move';
      },
    ) =>
      sftp().transferItems(
        request.source,
        request.target,
        request.sourcePaths,
        request.targetDirectory,
        request.mode,
      ),
  );
}

function registerAgentIpc(): void {
  ipcMain.handle('agent:providers', () => requireAgentApi().providers());
  ipcMain.handle('agent:list', () => requireAgentApi().listAgents());
  ipcMain.handle('agent:get', (_event, id: string) => requireAgentApi().getAgent(id));
  ipcMain.handle('agent:status', (_event, id: string) => requireAgentApi().getAgentStatus(id));
  ipcMain.handle('agent:start', (_event, request: StartAgentRequest) =>
    requireAgentApi().startAgent(request),
  );
  ipcMain.handle(
    'agent:group-start',
    (_event, request: import('./agent-contract').StartAgentGroupRequest) =>
      requireAgentApi().startAgentGroup(request),
  );
  ipcMain.handle('agent:group-stop', (_event, cwd: string) =>
    requireAgentApi().stopAgentGroup(cwd),
  );
  ipcMain.handle('agent:group-restart', (_event, cwd: string) =>
    requireAgentApi().restartAgentGroup(cwd),
  );
  ipcMain.handle('agent:stop', (_event, id: string) => requireAgentApi().stopAgent(id));
  ipcMain.handle('agent:restart', (_event, id: string) => requireAgentApi().restartAgent(id));
  ipcMain.handle('agent:rename', (_event, id: string, displayName: string) =>
    requireAgentApi().renameAgent(id, displayName),
  );
  ipcMain.handle('agent:mark-seen', (_event, id: string) => requireAgentApi().markAgentSeen(id));
  ipcMain.handle('agent:remove', (_event, id: string) => requireAgentApi().removeAgent(id));
  ipcMain.handle('agent:terminal-read', (_event, id: string) =>
    requireAgentApi().readAgentTerminal(id),
  );
  ipcMain.handle('agent:terminal-write', (_event, id: string, data: string) =>
    requireAgentApi().writeAgentTerminal(id, data),
  );
  ipcMain.handle('agent:choose-directory', async () => {
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: 'Choose project directory',
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({
          title: 'Choose project directory',
          properties: ['openDirectory', 'createDirectory'],
        });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}

function dataStore(): AppDataStore {
  if (!appDataStore) throw new Error('Application storage is not ready.');
  return appDataStore;
}

function sftp(): SftpManager {
  if (!sftpEngine) throw new Error('SFTP engine is not ready.');
  return sftpEngine;
}

function copyStoredClipboard(id: string): void {
  const item = dataStore().getClipboardContent(id);
  if (!item.contentType.startsWith('image/')) {
    clipboard.writeText(item.content);
    return;
  }
  const pngMatch = /^devdock-image-png-v1:(\d+):(\d+):(.+)$/.exec(item.content);
  if (pngMatch) {
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(pngMatch[3], 'base64')));
    return;
  }
  const rawMatch = /^devdock-image-v1:(\d+):(\d+):(.+)$/.exec(item.content);
  if (!rawMatch) throw new Error('Stored image data is invalid.');
  const width = Number(rawMatch[1]);
  const height = Number(rawMatch[2]);
  const rgba = Buffer.from(rawMatch[3], 'hex');
  if (rgba.length !== width * height * 4)
    throw new Error('Stored image dimensions do not match its payload.');
  for (let index = 0; index < rgba.length; index += 4) {
    const red = rgba[index];
    rgba[index] = rgba[index + 2];
    rgba[index + 2] = red;
  }
  clipboard.writeImage(nativeImage.createFromBitmap(rgba, { width, height }));
}

function clipboardThumbnail(id: string): string | null {
  const item = dataStore().getClipboardContent(id);
  if (!item.contentType.startsWith('image/')) return null;
  const pngMatch = /^devdock-image-png-v1:(\d+):(\d+):(.+)$/u.exec(item.content);
  if (!pngMatch) return null;
  const image = nativeImage.createFromBuffer(Buffer.from(pngMatch[3], 'base64'));
  if (image.isEmpty()) return null;
  return image.resize({ width: 180, height: 112, quality: 'good' }).toDataURL();
}

function pollClipboard(): void {
  try {
    const settings = dataStore().getSettings();
    const now = Date.now();
    if (now - lastClipboardCleanupAt >= 60_000) {
      dataStore().cleanupClipboard(settings.clipboardMaxItems, settings.clipboardRetentionDays);
      lastClipboardCleanupAt = now;
    }
    if (!settings.clipboardEnabled) return;
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const png = image.toPNG();
      if (png.length > 0 && png.length <= 10 * 1024 * 1024) {
        const fingerprint = `image:${createHash('sha256').update(png).digest('hex')}`;
        if (fingerprint !== lastClipboardFingerprint) {
          lastClipboardFingerprint = fingerprint;
          const size = image.getSize();
          dataStore().recordClipboard(
            `devdock-image-png-v1:${size.width}:${size.height}:${png.toString('base64')}`,
            'image/png',
          );
        }
      }
      return;
    }
    const text = clipboard.readText();
    if (!text) return;
    const fingerprint = `text:${createHash('sha256').update(text).digest('hex')}`;
    if (fingerprint === lastClipboardFingerprint) return;
    lastClipboardFingerprint = fingerprint;
    dataStore().recordClipboard(text, 'text/plain');
  } catch (error) {
    console.warn('[devdock] clipboard poll failed', error);
  }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f0f11',
    icon: join(__dirname, '../resources/icons/icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: process.env.DEVDOCK_TERMINAL_SMOKE !== '1',
    },
  });

  let revealTimer: NodeJS.Timeout | null = null;
  const revealWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    mainWindow.show();
    mainWindow.focus();
  };
  mainWindow.once('ready-to-show', revealWindow);
  mainWindow.webContents.once('did-finish-load', revealWindow);
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[devdock] renderer load failed (${code}) ${description}: ${url}`);
    revealWindow();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    terminalManager.detachClient(mainWindow?.webContents.id ?? -1);
    console.error(`[devdock] renderer process exited: ${details.reason} (${details.exitCode})`);
  });
  mainWindow.on('close', (event) => {
    if (isQuitting || !agentManager?.hasActiveAgents()) return;
    event.preventDefault();
    mainWindow?.hide();
    updateTray();
  });
  revealTimer = setTimeout(revealWindow, 1_500);
  mainWindow.on('closed', () => {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = null;
    terminalManager.closeAll();
    mainWindow = null;
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isLinuxTerminalPaste =
      input.control && input.shift && input.key.toLocaleLowerCase() === 'v';
    if (!isLinuxTerminalPaste) return;

    // Own the Linux terminal accelerator at the webContents boundary, but let
    // the active TerminalView read the clipboard and write to its PTY. Using
    // insertText here depends on xterm's hidden textarea retaining focus and
    // can silently lose the paste after pane or route changes.
    event.preventDefault();
    if (input.type === 'keyDown' && !input.isAutoRepeat) {
      mainWindow?.webContents.send('terminal:paste-shortcut');
    }
  });

  const rendererUrl = process.env.DEVDOCK_RENDERER_URL;
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  if (process.env.DEVDOCK_TERMINAL_SMOKE === '1') {
    await runTerminalSmoke(mainWindow);
    await runAgentSmoke(mainWindow);
    terminalManager.closeAll();
    app.exit(0);
  } else if (process.env.DEVDOCK_UI_CAPTURE) {
    await delay(800);
    const image = await mainWindow.webContents.capturePage();
    await writeFile(process.env.DEVDOCK_UI_CAPTURE, image.toPNG());
    app.quit();
  }
}

const cliInvocation = parseAgentCli(process.argv);
const backgroundRuntime = process.argv.includes('--devdock-background-runtime');
if (process.env.DEVDOCK_USER_DATA_DIR) {
  app.setPath('userData', process.env.DEVDOCK_USER_DATA_DIR);
}

if (cliInvocation) {
  const runtimeDisplayArguments = process.argv.filter(
    (argument) =>
      argument.startsWith('--ozone-platform=') ||
      argument === '--disable-gpu' ||
      argument === '--disable-gpu-sandbox',
  );
  const runtimeArguments = app.isPackaged
    ? [...runtimeDisplayArguments, '--devdock-background-runtime']
    : [
        app.getAppPath(),
        ...runtimeDisplayArguments,
        '--devdock-background-runtime',
      ];
  void runAgentCli(
    cliInvocation,
    process.execPath,
    runtimeArguments,
    agentControlDescriptorPath(app.getPath('userData')),
  )
    .then(() => app.exit(0))
    .catch((error: unknown) => {
      process.stderr.write(`[devdock] ${error instanceof Error ? error.message : String(error)}\n`);
      app.exit(1);
    });
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) app.exit(0);
  else {
    app.on('second-instance', showMainWindow);
    registerTerminalIpc();
    registerAgentIpc();
    void app
    .whenReady()
    .then(async () => {
      const dataHome = process.env.XDG_DATA_HOME
        ? process.env.XDG_DATA_HOME
        : join(app.getPath('home'), '.local', 'share');
      appDataStore = new AppDataStore(join(dataHome, 'devdock', 'devdock.db'));
      sshHostStore = new SshHostStore(join(app.getPath('userData'), 'ssh-hosts.json'), {
        available: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        encrypt: (password) => safeStorage.encryptString(password).toString('base64'),
        decrypt: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
      });
      sftpEngine = new SftpManager(sshHostStore);
      agentManager = new AgentManager(
        terminalManager,
        {
          onChanged: (agent) => {
            mainWindow?.webContents.send('agent:changed', { agent });
            if (
              agent.attention !== 'none' &&
              !mainWindow?.isFocused() &&
              Notification.isSupported()
            ) {
              const notification = new Notification({
                title:
                  agent.attention === 'needs-input'
                    ? `${agent.displayName} needs your input`
                    : agent.status === 'error'
                      ? `${agent.displayName} stopped with an error`
                      : `${agent.displayName} finished`,
                body:
                  agent.error ??
                  (agent.attention === 'needs-input'
                    ? 'Open DevDock to continue the agent.'
                    : 'Open DevDock to review the terminal.'),
              });
              notification.on('click', () => {
                showMainWindow();
                mainWindow?.webContents.send('agent:focus-requested', {
                  agentId: agent.id,
                  sessionId: agent.terminalSessionId,
                });
                agentManager?.markSeen(agent.id);
              });
              notification.show();
            }
            updateTray();
          },
        },
        appDataStore,
      );
      agentManager.recoverInterrupted();
      agentApi = new DevDockAgentApi(agentManager, terminalManager);
      agentControlServer = new AgentControlServer(
        agentApi,
        agentControlEndpoint(app.getPath('userData')),
        agentControlDescriptorPath(app.getPath('userData')),
        openLocalTerminalWindow,
      );
      await agentControlServer.start();
      updateTray();
      clipboardTimer = setInterval(pollClipboard, 750);
      pollClipboard();
      if (!backgroundRuntime) await createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow();
      });
    })
    .catch((error: unknown) => {
      console.error('[devdock] startup failed', error);
      app.exit(1);
    });

    app.on('before-quit', () => {
    isQuitting = true;
    agentManager?.prepareForShutdown();
    terminalManager.closeAll();
    sftpEngine?.closeAll();
    sftpEngine = null;
    if (clipboardTimer) clearInterval(clipboardTimer);
    clipboardTimer = null;
    appDataStore?.close();
    appDataStore = null;
    agentControlServer?.close();
    agentControlServer = null;
    agentApi = null;
    agentManager = null;
    tray?.destroy();
    tray = null;
    });
    app.on('window-all-closed', () => {
      if (!backgroundRuntime && process.platform !== 'darwin') app.quit();
    });
  }
}
