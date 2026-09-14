import type { AgentProviderId } from './agent-contract';

export interface AgentProviderAdapter {
  id: AgentProviderId;
  displayName: string;
  executable: string;
  args(task?: string): string[];
  resumeArgs(): string[];
  needsInput(output: string): boolean;
  configurationError(output: string): string | null;
}

export type RemoteAgentResponse =
  { kind: 'approved' | 'denied' } | { kind: 'answered'; answer: string };

type RemoteDecisionKind = 'approved' | 'denied';

function visibleDecisionOption(prompt: string, kind: RemoteDecisionKind): RegExpMatchArray | undefined {
  const options = [
    ...prompt.matchAll(
      /(?:^|[\r\n]+|[›❯>]\s*|\s{2,})(\d+)[.)]\s*(.*?)(?=(?:[\r\n]+|[›❯>]\s*|\s{2,})\d+[.)]\s|$)/giu,
    ),
  ];
  const pattern =
    kind === 'approved'
      ? /^(?:yes\b|approve\b|allow once\b|proceed\b)/iu
      : /^(?:no\b|deny\b|reject\b)/iu;
  return options.find((match) => pattern.test(match[2]!.trim()));
}

export function providerDecisionKinds(prompt: string): RemoteDecisionKind[] {
  return (['approved', 'denied'] as const).filter((kind) => visibleDecisionOption(prompt, kind));
}

export function providerResponseInput(
  provider: AgentProviderId,
  prompt: string,
  response: RemoteAgentResponse,
): string {
  if (provider !== 'codex' && provider !== 'claude-code') {
    throw new Error('Remote responses are not supported for this provider.');
  }
  if (response.kind === 'answered') {
    const answer = response.answer
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 2_000);
    if (!answer) throw new Error('The remote answer is empty.');
    return `${answer}\r`;
  }

  const option = visibleDecisionOption(prompt, response.kind);
  if (!option)
    throw new Error(
      `The current prompt has no visible ${response.kind === 'approved' ? 'approval' : 'denial'} option.`,
    );
  if (provider === 'codex') {
    const shortcut = option[2]!.match(/\((y|n|esc)\)/iu)?.[1]?.toLowerCase();
    if (response.kind === 'approved' && shortcut === 'y') return 'y';
    if (response.kind === 'denied' && shortcut === 'n') return 'n';
    if (response.kind === 'denied' && shortcut === 'esc') return '\x1b';
  }
  return `${option[1]}\r`;
}

const GENERIC_INPUT_PATTERN =
  /(?:do you want to (?:proceed|continue)|would you like to (?:run|continue|proceed)|allow (?:this|the) (?:command|action|tool)|press enter to confirm|waiting for (?:your )?input|requires? (?:your )?(?:approval|permission)|(?:approval|permission) (?:is )?required|confirm (?:this|the) (?:action|command)|continue\?)/iu;
const QUESTION_INPUT_PATTERN =
  /(?:(?:choose|select) (?:an? )?(?:option|answer)|(?:which|what|how|where|when|who)[^\n?]{0,200}\?\s*\r?\n\s*\d+[.)])/iu;

const adapters: Record<AgentProviderId, AgentProviderAdapter> = {
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    executable: 'claude',
    args: (task) => (task ? [task] : []),
    resumeArgs: () => ['--continue'],
    needsInput: (output) =>
      GENERIC_INPUT_PATTERN.test(output) ||
      QUESTION_INPUT_PATTERN.test(output) ||
      /(?:yes, allow|no, deny|allow once|allow for this session|always allow)/iu.test(output),
    configurationError: (output) =>
      /(?:not logged in|please (?:run )?\/login|authentication required|invalid api key)/iu.test(
        output,
      )
        ? 'Claude Code needs authentication. Run `claude` in a terminal and sign in, then restart the agent.'
        : null,
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    executable: 'codex',
    args: (task) => (task ? [task] : []),
    resumeArgs: () => ['resume', '--last'],
    needsInput: (output) =>
      GENERIC_INPUT_PATTERN.test(output) ||
      QUESTION_INPUT_PATTERN.test(output) ||
      /(?:approve|deny)(?: this command)?|yes, proceed|tell codex what to do differently/iu.test(
        output,
      ),
    configurationError: (output) =>
      /(?:not logged in|missing.*(?:api key|credentials)|authentication required|401 unauthorized)/iu.test(
        output,
      )
        ? 'Codex needs authentication. Run `codex login` in a terminal, then restart the agent.'
        : null,
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    executable: 'opencode',
    args: (task) => (task ? ['--prompt', task] : []),
    resumeArgs: () => ['--continue'],
    needsInput: (output) =>
      GENERIC_INPUT_PATTERN.test(output) ||
      /(?:approve|reject|always allow|allow once)/iu.test(output),
    configurationError: (output) =>
      /(?:no provider configured|provider.*not configured|missing.*api key|authentication required)/iu.test(
        output,
      )
        ? 'OpenCode needs a configured provider. Run `opencode providers` in a terminal, then restart the agent.'
        : null,
  },
};

export function agentProvider(id: AgentProviderId): AgentProviderAdapter {
  return adapters[id];
}

export function agentProviders(): AgentProviderAdapter[] {
  return Object.values(adapters);
}
