// Settings shared by the local Electron main process and renderer.

/**
 * UI theme.
 */
export type Theme = 'system' | 'light' | 'dark';

/**
 * Application settings aggregate.
 */
export interface SettingsDto {
  theme: Theme;
  terminalFont: string;
  terminalFontSize: number;
  clipboardEnabled: boolean;
  clipboardMaxItems: number;
  clipboardRetentionDays: 0 | 7;
  windowGeometry?: WindowGeometryDto;
}

/**
 * Window geometry.
 */
export interface WindowGeometryDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Payload for `save_settings` IPC command (matches Rust `SaveSettingsRequest`).
 */
export interface SaveSettingsRequest {
  theme: string;
  terminalFont: string;
  terminalFontSize: number;
  clipboardEnabled: boolean;
  clipboardMaxItems: number;
  clipboardRetentionDays: 0 | 7;
}

/**
 * Response: `get_settings` (matches Rust `GetSettingsResponse`).
 */
export interface GetSettingsResponse {
  theme: string;
  terminalFont: string;
  terminalFontSize: number;
  clipboardEnabled: boolean;
  clipboardMaxItems: number;
  clipboardRetentionDays: 0 | 7;
}

/**
 * Response: `save_settings`.
 */
export interface SaveSettingsResponse {
  updatedAt: number;
}
