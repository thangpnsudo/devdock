import { describe, expect, it } from 'vitest';

import {
  agentProvider,
  providerDecisionKinds,
  providerResponseInput,
} from './agent-providers';

describe('agent provider adapters', () => {
  it('uses the interactive CLI syntax supported by each provider', () => {
    expect(agentProvider('codex').args('Review the patch')).toEqual(['Review the patch']);
    expect(agentProvider('claude-code').args('Review the patch')).toEqual(['Review the patch']);
    expect(agentProvider('opencode').args('Review the patch')).toEqual([
      '--prompt',
      'Review the patch',
    ]);
    expect(agentProvider('codex').args()).toEqual([]);
    expect(agentProvider('codex').resumeArgs()).toEqual(['resume', '--last']);
    expect(agentProvider('claude-code').resumeArgs()).toEqual(['--continue']);
    expect(agentProvider('opencode').resumeArgs()).toEqual(['--continue']);
  });

  it('maps explicit remote decisions to options visible in the current prompt', () => {
    const codexPrompt = '1. Yes, proceed\n2. No, and tell Codex what to do differently';
    const claudePrompt = '❯ 1. Yes, allow once\n  2. Always allow\n  3. No, deny';
    expect(providerResponseInput('codex', codexPrompt, { kind: 'approved' })).toBe('1\r');
    expect(providerResponseInput('codex', codexPrompt, { kind: 'denied' })).toBe('2\r');
    expect(providerResponseInput('claude-code', claudePrompt, { kind: 'approved' })).toBe('1\r');
    expect(providerResponseInput('claude-code', claudePrompt, { kind: 'denied' })).toBe('3\r');
  });

  it('writes a bounded single-line answer and rejects decisions without visible options', () => {
    expect(
      providerResponseInput('codex', 'What environment?', {
        kind: 'answered',
        answer: 'staging\nwith fixtures',
      }),
    ).toBe('staging with fixtures\r');
    expect(() => providerResponseInput('codex', 'Continue?', { kind: 'approved' })).toThrow(
      'visible approval option',
    );
  });

  it('does not advertise decision buttons for a free-text question', () => {
    expect(providerDecisionKinds('1. Yes, proceed\n2. No')).toEqual(['approved', 'denied']);
    expect(providerDecisionKinds('Which database?\n1. staging\n2. production')).toEqual([]);
  });

  it('parses Codex options flattened onto one terminal line', () => {
    const prompt =
      'Would you like to run the following command? $ find . -type f › 1. Yes, proceed (y)  2. Yes, and don\'t ask again (p)  3. No, and tell Codex what to do differently (esc)   Press enter to confirm';
    expect(providerDecisionKinds(prompt)).toEqual(['approved', 'denied']);
    expect(providerResponseInput('codex', prompt, { kind: 'approved' })).toBe('y');
    expect(providerResponseInput('codex', prompt, { kind: 'denied' })).toBe('\x1b');
  });

  it('keeps provider-specific prompts and authentication errors isolated', () => {
    expect(agentProvider('codex').needsInput('Approve this command?')).toBe(true);
    expect(
      agentProvider('codex').needsInput(
        'Would you like to run the following command?\n1. Yes, proceed\n2. No',
      ),
    ).toBe(true);
    expect(agentProvider('claude-code').needsInput('Yes, allow?')).toBe(true);
    expect(agentProvider('claude-code').needsInput('Allow for this session')).toBe(true);
    expect(
      agentProvider('codex').needsInput('Which database should I use?\n1. staging\n2. production'),
    ).toBe(true);
    expect(agentProvider('claude-code').needsInput('Choose an option\n1. API\n2. UI')).toBe(true);
    expect(agentProvider('opencode').needsInput('Always allow?')).toBe(true);
    expect(agentProvider('codex').configurationError('401 Unauthorized')).toContain('codex login');
    expect(agentProvider('claude-code').configurationError('Please run /login')).toContain(
      'sign in',
    );
    expect(agentProvider('opencode').configurationError('No provider configured')).toContain(
      'opencode providers',
    );
  });
});
