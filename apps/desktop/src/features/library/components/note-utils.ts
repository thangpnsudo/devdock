export function deriveNoteTitle(content: string): string {
  const firstLine = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, 80) || 'Untitled';
}

export function jsonValidationError(content: string): string | null {
  if (!content.trim()) return null;
  try {
    JSON.parse(content);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    const position = /position\s+(\d+)/i.exec(message)?.[1];
    if (!position) return message;
    const offset = Number(position);
    const before = content.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    return `Invalid JSON at line ${line}, column ${column}.`;
  }
}

export function formatJson(content: string): string {
  return JSON.stringify(JSON.parse(content), null, 2);
}

export function noteMatchIndexes(content: string, query: string): number[] {
  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const normalizedContent = content.toLocaleLowerCase();
  const matches: number[] = [];
  let offset = 0;
  while (offset <= normalizedContent.length - normalizedQuery.length) {
    const match = normalizedContent.indexOf(normalizedQuery, offset);
    if (match === -1) break;
    matches.push(match);
    offset = match + Math.max(1, normalizedQuery.length);
  }
  return matches;
}

export function nextNoteMatch(current: number, total: number, direction: 1 | -1): number {
  if (total === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

export function noteMatchVisualRow(
  content: string,
  offset: number,
  charactersPerRow: number,
): number {
  const width = Math.max(1, Math.floor(charactersPerRow));
  const lines = content.slice(0, Math.max(0, offset)).split('\n');
  const currentLine = lines.pop() ?? '';
  const completedRows = lines.reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / width)),
    0,
  );
  return completedRows + Math.floor(currentLine.length / width);
}
