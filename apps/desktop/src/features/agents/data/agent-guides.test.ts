import { describe, expect, it } from 'vitest';

import { AGENT_GUIDES, agentGuideIdForUserAgent } from './agent-guides';

describe('agent CLI guides', () => {
  it('provides working launch commands for Linux, macOS, and Windows', () => {
    expect(AGENT_GUIDES.map((guide) => guide.id)).toEqual(['linux', 'macos', 'windows']);
    expect(AGENT_GUIDES[0]?.commands.map(({ command }) => command)).toContain('devdock codex .');
    expect(AGENT_GUIDES[1]?.commands[0]?.command).toContain(
      '/Applications/DevDock.app/Contents/MacOS/DevDock',
    );
    expect(AGENT_GUIDES[2]?.commands[0]?.command).toContain('DevDock.exe');
  });

  it('selects the guide matching the current desktop platform', () => {
    expect(agentGuideIdForUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(agentGuideIdForUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(
      'macos',
    );
    expect(agentGuideIdForUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
  });
});
