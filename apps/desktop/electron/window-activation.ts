export interface ActivatableWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  moveTop(): void;
}

export function activateWindow(window: ActivatableWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.moveTop();
}
