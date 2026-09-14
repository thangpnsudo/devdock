// Common shared types.

/**
 * UUID v7 identifier. String-encoded (matches Rust `Id` representation).
 */
export type Id = string;

/**
 * Unix timestamp in milliseconds (UTC).
 */
export type TimestampMillis = number;

/**
 * Library item kind.
 */
export type LibraryItemKind =
  | 'script'
  | 'clipboard'
  | 'ssh_host'
  | 'note'
  | 'template';
