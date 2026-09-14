import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
}

type ConfirmRequest = ConfirmOptions & { resolve: (confirmed: boolean) => void };
type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        triggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setRequest((current) => {
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  const close = useCallback((confirmed: boolean) => {
    setRequest((current) => {
      current?.resolve(confirmed);
      return null;
    });
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!request) return undefined;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'Tab') {
        const buttons = [
          ...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
        ];
        if (buttons.length === 0) return;
        const first = buttons[0]!;
        const last = buttons[buttons.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, request]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="dd-modal-backdrop" role="presentation" onMouseDown={() => close(false)}>
          <section
            ref={dialogRef}
            className={`dd-confirm-dialog dd-confirm-dialog--${request.variant ?? 'danger'}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dd-confirm-title"
            aria-describedby="dd-confirm-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="dd-confirm-dialog__icon" aria-hidden="true">
              {request.variant === 'warning' ? <AlertTriangle size={20} /> : <Trash2 size={20} />}
            </span>
            <div>
              <h2 id="dd-confirm-title">{request.title}</h2>
              <p id="dd-confirm-description">{request.description}</p>
            </div>
            <footer>
              <button type="button" onClick={() => close(false)}>
                Cancel
              </button>
              <button ref={confirmRef} type="button" onClick={() => close(true)}>
                {request.confirmLabel ?? 'Delete'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmProvider');
  return confirm;
}
