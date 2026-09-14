// Typed Electron bridge for local settings.

import type { SaveSettingsRequest, SettingsDto } from '@devdock/types';

function settingsBridge(): ElectronSettingsBridge {
  if (!window.devdockSettings) throw new Error('DevDock requires the Electron runtime.');
  return window.devdockSettings;
}

export const settingsIpc = {
  async get(): Promise<SettingsDto> {
    const settings = await settingsBridge().get();
    const normalized: SettingsDto = { ...settings, theme: 'dark' };
    localStorage.setItem('devdock:settings', JSON.stringify(normalized));
    applyTheme();
    return normalized;
  },
  async save(request: SaveSettingsRequest): Promise<{ updatedAt: number }> {
    const normalized: SaveSettingsRequest = { ...request, theme: 'dark' };
    const result = await settingsBridge().save(normalized);
    localStorage.setItem('devdock:settings', JSON.stringify(normalized));
    applyTheme();
    window.dispatchEvent(new CustomEvent('devdock:settings-changed', { detail: normalized }));
    return result;
  },
} as const;

function applyTheme(): void {
  document.documentElement.dataset.theme = 'dark';
}

export type { SaveSettingsRequest, SettingsDto } from '@devdock/types';
