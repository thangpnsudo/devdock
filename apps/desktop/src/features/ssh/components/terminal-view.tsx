// Live xterm.js terminal bound to a Tauri-russh session.
//
// Renders an interactive terminal for an active SSH session.
// terminal pane that consumes `ssh:data` Tauri events and pushes
// keystrokes back via `ssh_exec`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { IDisposable } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { sshIpc } from '../ipc/ssh';
import type { SshDataEvent } from '@devdock/types';
import { useToast } from '../../shell/components/toast';
import { settingsIpc } from '../../settings/ipc/settings';

// Local payload type for ssh:error events (matches Rust SshErrorPayload that
// Keeping it local avoids a circular import
// until the Rust side ships.
export interface SshErrorPayload {
  sessionId: string;
  code: string;
  message: string;
  category: string;
}

// Browser-native base64 -> Uint8Array.
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const MIN_COLS = 2;
const MIN_ROWS = 2;

export interface TerminalViewProps {
  sessionId: string;
  hostLabel?: string;
  active?: boolean;
  minimal?: boolean;
  inputTargets?: readonly string[];
  onCommand?: (sessionId: string, command: string) => void;
  onRecover?: (sessionId: string) => void | Promise<void>;
  onClose: () => void;
}

export function isTerminalCopyShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>,
  hasSelection: boolean,
): boolean {
  const key = event.key.toLocaleLowerCase();
  if (event.metaKey && key === 'c') return hasSelection;
  if (!event.ctrlKey || key !== 'c') return false;
  return event.shiftKey || hasSelection;
}

export function isTerminalPasteShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>,
): boolean {
  const key = event.key.toLocaleLowerCase();
  return key === 'v' && ((event.ctrlKey && event.shiftKey) || (event.metaKey && !event.ctrlKey));
}

export function isTerminalRecoveryShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>,
  failed: boolean,
): boolean {
  return (
    failed &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.key.toLocaleLowerCase() === 'c'
  );
}

export function pasteTerminalText(
  terminal: Pick<Terminal, 'focus' | 'paste'> | null,
  content: string,
): boolean {
  if (!terminal || !content) return false;

  // xterm normalizes pasted newlines and adds bracketed-paste markers when
  // requested by the remote shell. Direct PTY writes skip both behaviours.
  terminal.paste(content);
  terminal.focus();
  return true;
}

export function TerminalView({
  sessionId,
  hostLabel,
  active = true,
  minimal = false,
  inputTargets,
  onCommand,
  onRecover,
  onClose,
}: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const decoderRef = useRef(new TextDecoder('utf-8', { fatal: false }));
  const dataDisposableRef = useRef<IDisposable | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const pendingInputRef = useRef('');
  const commandBufferRef = useRef('');
  const onCommandRef = useRef(onCommand);
  const onRecoverRef = useRef(onRecover);
  const inputTargetsRef = useRef<readonly string[]>(inputTargets ?? [sessionId]);
  const flushingInputRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const pasteInFlightRef = useRef(false);
  const failedRef = useRef(false);
  const recoveringRef = useRef(false);
  const [connected, setConnected] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const toast = useToast();

  const copySelection = useCallback(async (): Promise<void> => {
    const selection = termRef.current?.getSelection() ?? '';
    if (!selection) {
      toast.push('Select terminal text to copy.', { variant: 'info' });
      return;
    }
    try {
      await window.devdockClipboard?.copyText(selection);
      toast.push('Terminal selection copied', { variant: 'success' });
    } catch (error) {
      toast.push(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, {
        variant: 'error',
      });
    }
  }, [toast]);

  const flushInput = useCallback(() => {
    if (flushingInputRef.current || !pendingInputRef.current) return;
    const data = pendingInputRef.current;
    pendingInputRef.current = '';
    flushingInputRef.current = true;
    void Promise.all(
      inputTargetsRef.current.map((targetSessionId) =>
        sshIpc.exec({ sessionId: targetSessionId, data }),
      ),
    )
      .catch((err: unknown) => {
        failedRef.current = true;
        setConnected(false);
        toast.push(`Terminal input failed: ${err instanceof Error ? err.message : String(err)}`, {
          variant: 'error',
        });
      })
      .finally(() => {
        flushingInputRef.current = false;
        if (pendingInputRef.current) flushInput();
      });
  }, [sessionId, toast]);

  useEffect(() => {
    inputTargetsRef.current = inputTargets?.length ? inputTargets : [sessionId];
  }, [inputTargets, sessionId]);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    onRecoverRef.current = onRecover;
  }, [onRecover]);

  const handleData = useCallback(
    (data: string) => {
      const ansiCsiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z~]`, 'gu');
      const normalized = data.replace(ansiCsiSequence, '');
      for (const character of normalized) {
        if (character === '\r' || character === '\n') {
          const command = commandBufferRef.current.trim();
          if (command) onCommandRef.current?.(sessionId, command);
          commandBufferRef.current = '';
        } else if (character === '\x7f' || character === '\b') {
          commandBufferRef.current = commandBufferRef.current.slice(0, -1);
        } else if (character === '\x03') {
          commandBufferRef.current = '';
        } else if (character >= ' ' || character === '\t') {
          commandBufferRef.current += character;
        }
      }
      pendingInputRef.current += data;
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        flushInput();
      }, 8);
    },
    [flushInput],
  );

  const pasteClipboard = useCallback(async (): Promise<void> => {
    if (pasteInFlightRef.current) return;
    pasteInFlightRef.current = true;
    try {
      const content = await window.devdockClipboard?.readText();
      pasteTerminalText(termRef.current, content ?? '');
    } catch (error) {
      toast.push(`Paste failed: ${error instanceof Error ? error.message : String(error)}`, {
        variant: 'error',
      });
    } finally {
      pasteInFlightRef.current = false;
    }
  }, [toast]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: {
        background: '#121214',
        foreground: '#ebe9e4',
        cursor: '#8ea2ff',
        selectionBackground: '#2b3766',
        black: '#121214',
        red: '#cc0000',
        green: '#008844',
      },
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    let fitFrame: number | null = null;
    let settleFrame: number | null = null;
    let lastResize = '';
    const fitTerminal = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fit.fit();
      const cols = Math.max(MIN_COLS, term.cols);
      const rows = Math.max(MIN_ROWS, term.rows);
      const resizeKey = `${cols}:${rows}`;
      if (resizeKey === lastResize) return;
      lastResize = resizeKey;
      void sshIpc.resize({ sessionId, cols, rows }).catch(() => undefined);
    };
    const scheduleFit = (settle = false): void => {
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null;
        fitTerminal();
        if (!settle) return;
        if (settleFrame !== null) cancelAnimationFrame(settleFrame);
        settleFrame = requestAnimationFrame(() => {
          settleFrame = null;
          fitTerminal();
        });
      });
    };
    scheduleFit(true);
    // xterm only emits onData while its hidden textarea owns focus. Make a
    // newly opened tab ready to type immediately, and restore focus whenever
    // the user clicks the terminal surface.
    requestAnimationFrame(() => term.focus());

    termRef.current = term;
    fitRef.current = fit;

    const applyAppearance = (settings: {
      terminalFont?: string;
      terminalFontSize?: number;
    }): void => {
      if (settings.terminalFont?.trim()) term.options.fontFamily = settings.terminalFont.trim();
      if (settings.terminalFontSize) {
        term.options.fontSize = Math.max(8, Math.min(32, settings.terminalFontSize));
      }
      scheduleFit(true);
    };
    void settingsIpc
      .get()
      .then(applyAppearance)
      .catch(() => undefined);
    const onSettingsChanged = (event: Event): void => {
      applyAppearance(
        (
          event as CustomEvent<{
            terminalFont?: string;
            terminalFontSize?: number;
          }>
        ).detail,
      );
    };
    window.addEventListener('devdock:settings-changed', onSettingsChanged);

    dataDisposableRef.current = term.onData((d: string) => {
      handleData(d);
    });
    // Chromium/Electron and xterm can both process the native paste accelerator.
    // Capture it before xterm's textarea sees it, cancel the browser default,
    // and forward the clipboard contents to the PTY through exactly one path.
    const onPasteShortcut = (event: KeyboardEvent): void => {
      if (!isTerminalPasteShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!event.repeat) void pasteClipboard();
    };
    container.addEventListener('keydown', onPasteShortcut, true);
    const unlistenElectronPaste = window.devdockTerminal?.onPasteShortcut(() => {
      const focusedElement = document.activeElement;
      const ownsFocus = focusedElement instanceof Node && container.contains(focusedElement);
      const terminalSection = container.closest('.dd-terminal');
      const activeGroupPane = terminalSection
        ?.closest('.dd-group-terminal')
        ?.classList.contains('is-active');
      const visibleStandaloneTerminal = Boolean(
        terminalSection?.classList.contains('is-active') &&
        !terminalSection.closest('.dd-group-terminal'),
      );
      if (!ownsFocus && !activeGroupPane && !visibleStandaloneTerminal) return;
      void pasteClipboard();
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (isTerminalRecoveryShortcut(event, failedRef.current) && onRecoverRef.current) {
        if (!recoveringRef.current) {
          recoveringRef.current = true;
          void Promise.resolve(onRecoverRef.current(sessionId))
            .catch((error: unknown) => {
              toast.push(
                `Recovery failed: ${error instanceof Error ? error.message : String(error)}`,
                {
                  variant: 'error',
                },
              );
            })
            .finally(() => {
              recoveringRef.current = false;
            });
        }
        return false;
      }
      if (isTerminalCopyShortcut(event, term.hasSelection())) {
        void copySelection();
        return false;
      }
      return true;
    });

    const ro = new ResizeObserver(() => {
      scheduleFit(true);
    });
    ro.observe(container);
    resizeObserverRef.current = ro;

    let cancelled = false;
    let unlistenOutput: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    void sshIpc
      .subscribeOutput(sessionId, (event: SshDataEvent) => {
        if (event.sessionId !== sessionId) return;
        try {
          const bytes = base64ToBytes(event.data);
          term.write(decoderRef.current.decode(bytes, { stream: true }));
        } catch (err) {
          toast.push(
            `Decoded ssh:data failed: ${err instanceof Error ? err.message : String(err)}`,
            { variant: 'error' },
          );
        }
      })
      .then((un) => {
        if (cancelled) {
          un();
          return;
        }
        unlistenOutput = un;
      });

    void sshIpc
      .onSshError((payload: SshErrorPayload) => {
        if (payload.sessionId !== sessionId) return;
        failedRef.current = true;
        setConnected(false);
        term.write(`\r\n\x1b[31m[${payload.code}] ${payload.message}\x1b[0m\r\n`);
        if (onRecoverRef.current) {
          term.write(
            '\x1b[33mPress Ctrl+C to close this session and return to a Local terminal.\x1b[0m\r\n',
          );
        }
        toast.push(`[${payload.code}] ${payload.message}`, { variant: 'error' });
      })
      .then((un) => {
        if (cancelled) {
          un();
          return;
        }
        unlistenError = un;
      });

    setConnected(true);

    return () => {
      cancelled = true;
      ro.disconnect();
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      if (settleFrame !== null) cancelAnimationFrame(settleFrame);
      resizeObserverRef.current = null;
      unlistenElectronPaste?.();
      if (unlistenOutput) unlistenOutput();
      if (unlistenError) unlistenError();
      if (dataDisposableRef.current) {
        dataDisposableRef.current.dispose();
        dataDisposableRef.current = null;
      }
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      container.removeEventListener('keydown', onPasteShortcut, true);
      window.removeEventListener('devdock:settings-changed', onSettingsChanged);
      flushTimerRef.current = null;
      pendingInputRef.current = '';
      commandBufferRef.current = '';
      failedRef.current = false;
      recoveringRef.current = false;
      decoderRef.current = new TextDecoder('utf-8', { fatal: false });
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setConnected(false);
    };
  }, [sessionId, handleData, copySelection, pasteClipboard, toast]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (): void => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      const term = termRef.current;
      if (!container || !term || container.clientWidth === 0 || container.clientHeight === 0)
        return;
      fitRef.current?.fit();
      void sshIpc
        .resize({
          sessionId,
          cols: Math.max(MIN_COLS, term.cols),
          rows: Math.max(MIN_ROWS, term.rows),
        })
        .catch(() => undefined);
      term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, sessionId]);

  useEffect(() => {
    const focusTerminal = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId !== sessionId) return;
      requestAnimationFrame(() => termRef.current?.focus());
    };
    window.addEventListener('devdock:terminal-focus', focusTerminal);
    return () => window.removeEventListener('devdock:terminal-focus', focusTerminal);
  }, [sessionId]);

  const shortId = sessionId.slice(0, 8);

  return (
    <section
      data-session-id={sessionId}
      className={`dd-terminal${active ? ' is-active' : ''}${minimal ? ' dd-terminal--minimal' : ''}`}
      aria-label="SSH terminal"
      aria-hidden={!active}
    >
      {!minimal && (
        <header className="dd-terminal__statusbar">
          <span className="dd-terminal__status">
            <span
              className={`dd-terminal__dot ${connected ? 'dd-terminal__dot--ok' : 'dd-terminal__dot--off'}`}
              aria-hidden="true"
            />
            {connected ? 'connected' : 'disconnected'}
          </span>
          <span className="dd-terminal__host">{hostLabel ?? 'ssh host'}</span>
          <code className="dd-terminal__session" title={sessionId}>
            session:{shortId}
          </code>
          <button
            type="button"
            className="dd-terminal__close"
            onClick={onClose}
            aria-label="Close terminal session"
          >
            Close
          </button>
        </header>
      )}
      <div
        className="dd-terminal__surface"
        onMouseDown={() => termRef.current?.focus()}
        onFocus={() => termRef.current?.focus()}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <div ref={containerRef} className="dd-terminal__xterm-host" />
      </div>
      {contextMenu && (
        <div
          className="dd-terminal-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!termRef.current?.hasSelection()}
            onClick={() => {
              setContextMenu(null);
              void copySelection();
            }}
          >
            <span>Copy</span>
            <kbd>Ctrl+Shift+C</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              void pasteClipboard();
            }}
          >
            <span>Paste</span>
            <kbd>Ctrl+Shift+V</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              termRef.current?.selectAll();
              setContextMenu(null);
              termRef.current?.focus();
            }}
          >
            <span>Select all</span>
          </button>
        </div>
      )}
    </section>
  );
}
