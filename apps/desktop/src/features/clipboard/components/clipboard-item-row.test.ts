import { describe, expect, it, vi } from 'vitest';

import { formatRelative } from './clipboard-item-row';

describe('formatRelative', () => {
  it('formats recent clipboard entries in a compact, user-facing form', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    expect(formatRelative(999_000)).toBe('1s ago');
    expect(formatRelative(880_000)).toBe('2m ago');
    expect(formatRelative(1_000_000)).toBe('0s ago');

    vi.restoreAllMocks();
  });
});
