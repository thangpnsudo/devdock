// Top-right corner toast notifications with auto-dismiss.
// Used for error/success/info feedback across the app.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as Toast from '@radix-ui/react-toast';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastVariant = 'error' | 'info' | 'success';

export interface ToastItem {
  /// Unique id used by React key + dismiss.
  id: string;
  /// Visual variant.
  variant: ToastVariant;
  /// Message body.
  message: string;
  /// Stable support code shown for failed actions.
  errorCode?: string;
  /// Auto-dismiss after this many ms; 0 disables.
  durationMs: number;
}

interface ToastContextValue {
  /** Push a new toast. Returns its id for programmatic dismissal. */
  push(
    message: string,
    opts?: { variant?: ToastVariant; durationMs?: number; code?: string },
  ): string;
  /** Dismiss by id. */
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Provider: render once near the application root. */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback<ToastContextValue['push']>((message, opts) => {
    const id = `t${++counterRef.current}`;
    const variant = opts?.variant ?? 'info';
    const item: ToastItem = {
      id,
      message,
      variant,
      durationMs: opts?.durationMs ?? (variant === 'success' ? 1600 : 5000),
      ...(variant === 'error' ? { errorCode: opts?.code ?? 'ERR_ACTION' } : {}),
    };
    setItems((prev) => [...prev, item]);
    return id;
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast.Provider duration={5000} swipeDirection="right">
        <Toast.Viewport className="dd-toast-stack" />
        {items.map((item) => (
          <ToastBubble key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

function ToastBubble({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }): JSX.Element {
  useEffect(() => {
    if (item.durationMs <= 0) return undefined;
    const timer = window.setTimeout(onDismiss, item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.durationMs, onDismiss]);

  if (item.variant === 'success') {
    return (
      <Toast.Root
        className="dd-toast dd-toast--success"
        open
        onOpenChange={(open) => !open && onDismiss()}
        duration={item.durationMs}
      >
        <Toast.Title className="dd-sr-only">{item.message || 'Done'}</Toast.Title>
        <span className="dd-toast__status" aria-hidden="true">
          <CheckCircle2 size={14} strokeWidth={2.8} />
        </span>
      </Toast.Root>
    );
  }

  return (
    <Toast.Root
      className={`dd-toast dd-toast--${item.variant}`}
      open
      onOpenChange={(open) => !open && onDismiss()}
      duration={item.durationMs}
    >
      <span className="dd-toast__status" aria-hidden="true">
        {item.variant === 'error' && <XCircle size={14} />}
        {item.variant === 'info' && <Info size={14} />}
      </span>
      <div className="dd-toast__body">
        {item.variant === 'error' && (
          <Toast.Title className="dd-toast__title">
            <span>Action failed</span>
            <code>{item.errorCode}</code>
          </Toast.Title>
        )}
        <Toast.Description className="dd-toast__message">{item.message}</Toast.Description>
      </div>
      <Toast.Close className="dd-toast__close" aria-label="Dismiss notification">
        <X size={12} />
      </Toast.Close>
    </Toast.Root>
  );
}

/** Hook: consume the toast context. Throws if used outside the provider. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}
