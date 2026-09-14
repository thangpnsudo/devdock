import { describe, expect, it } from 'vitest';

import {
  appendSessionsToLayout,
  clampUtilityPanelWidth,
  moveTerminalLayout,
  terminalDropZone,
  updateAgentTerminalTabs,
} from './ssh-workspace';

describe('terminal workspace drop zones', () => {
  const bounds = { left: 100, top: 50, width: 400, height: 300 };

  it('maps the dominant half of a terminal to a split direction', () => {
    expect(terminalDropZone({ x: 300, y: 60 }, bounds)).toBe('top');
    expect(terminalDropZone({ x: 490, y: 200 }, bounds)).toBe('right');
    expect(terminalDropZone({ x: 300, y: 340 }, bounds)).toBe('bottom');
    expect(terminalDropZone({ x: 110, y: 200 }, bounds)).toBe('left');
  });
});

describe('agent terminal tabs', () => {
  it('updates the custom name and keeps needs-input visible on the tab', () => {
    const tabs = updateAgentTerminalTabs([{ id: 'terminal-1', label: 'Codex', kind: 'local' }], {
      id: 'agent-1',
      terminalSessionId: 'terminal-1',
      provider: 'codex',
      displayName: 'Paster · auth review',
      cwd: '/workspace/paster',
      status: 'blocked',
      attention: 'needs-input',
      startedAt: 1,
      lastActivityAt: 2,
      terminalAvailable: true,
    });

    expect(tabs[0]).toEqual(
      expect.objectContaining({
        label: 'Paster · auth review',
        agentId: 'agent-1',
        agentStatus: 'blocked',
        agentAttention: 'needs-input',
      }),
    );
  });
});

describe('terminal utility panel width', () => {
  it('keeps the user width inside the supported range', () => {
    expect(clampUtilityPanelWidth(120)).toBe(326);
    expect(clampUtilityPanelWidth(420)).toBe(420);
    expect(clampUtilityPanelWidth(900)).toBe(640);
  });

  it('honors a smaller dynamic maximum when terminal space is limited', () => {
    expect(clampUtilityPanelWidth(500, 360)).toBe(360);
  });
});

describe('terminal workspace layout', () => {
  it('places a terminal below another terminal', () => {
    expect(moveTerminalLayout([['one', 'two']], 'two', 'one', 'bottom')).toEqual([
      ['one'],
      ['two'],
    ]);
  });

  it('supports rearranging terminals across multiple rows', () => {
    expect(moveTerminalLayout([['one', 'two'], ['three']], 'one', 'three', 'right')).toEqual([
      ['two'],
      ['three', 'one'],
    ]);
  });

  it('does not duplicate a terminal when it is dropped repeatedly', () => {
    expect(moveTerminalLayout([['one'], ['two', 'three']], 'three', 'one', 'top')).toEqual([
      ['three'],
      ['one'],
      ['two'],
    ]);
  });

  it('preserves a custom layout when a new terminal joins the workspace', () => {
    expect(
      appendSessionsToLayout([['one', 'two'], ['three']], ['one', 'two', 'three', 'four']),
    ).toEqual([
      ['one', 'two'],
      ['three', 'four'],
    ]);
  });

  it('does not duplicate a terminal already present in the workspace', () => {
    expect(appendSessionsToLayout([['one'], ['two', 'three']], ['three'])).toEqual([
      ['one'],
      ['two', 'three'],
    ]);
  });
});
