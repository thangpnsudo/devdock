// Zustand store for UI-only state (theme, sidebar collapsed, etc).
//
// Per TECH_STACK.md: Server state (TanStack Query) and UI state must not be mixed.
// This store is for ephemeral UI flags only.

import { create } from 'zustand';
import type { Theme } from '@devdock/types';

const SIDEBAR_STORAGE_KEY = 'devdock.sidebar-collapsed';
const initialSidebarCollapsed =
  typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';

export interface UiStore {
  theme: Theme;
  sidebarCollapsed: boolean;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  theme: 'system',
  sidebarCollapsed: initialSidebarCollapsed,
  setTheme: (theme) => set({ theme }),
  toggleSidebar: () =>
    set((state) => {
      const sidebarCollapsed = !state.sidebarCollapsed;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
      return { sidebarCollapsed };
    }),
}));
