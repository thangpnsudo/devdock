import { describe, expect, it } from 'vitest';

import {
  deriveNoteTitle,
  formatJson,
  jsonValidationError,
  nextNoteMatch,
  noteMatchIndexes,
  noteMatchVisualRow,
} from './note-utils';

describe('note utilities', () => {
  it('derives a compact title from the first non-empty line', () => {
    expect(deriveNoteTitle('\n  Release checklist  \n- test')).toBe('Release checklist');
    expect(deriveNoteTitle('')).toBe('Untitled');
    expect(deriveNoteTitle('x'.repeat(100))).toHaveLength(80);
  });

  it('formats valid JSON without changing invalid input', () => {
    expect(formatJson('{"channel":"local"}')).toBe('{\n  "channel": "local"\n}');
    expect(jsonValidationError('{"channel":}')).toMatch(/JSON|line/u);
    expect(jsonValidationError('{"channel":"local"}')).toBeNull();
  });

  it('finds note content case-insensitively and cycles through matches', () => {
    expect(noteMatchIndexes('Build, test, then BUILD', 'build')).toEqual([0, 18]);
    expect(noteMatchIndexes('content', '')).toEqual([]);
    expect(nextNoteMatch(1, 2, 1)).toBe(0);
    expect(nextNoteMatch(0, 2, -1)).toBe(1);
    expect(noteMatchVisualRow('first\nsecond\nthird', 13, 80)).toBe(2);
    expect(noteMatchVisualRow('abcdefghijkl', 10, 5)).toBe(2);
  });
});
