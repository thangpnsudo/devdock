export type AgentGuideId = 'linux' | 'macos' | 'windows';

export interface AgentGuide {
  id: AgentGuideId;
  label: string;
  shell: string;
  commands: ReadonlyArray<{ label: string; command: string }>;
  hint: string;
}

const MAC_EXECUTABLE = '"/Applications/DevDock.app/Contents/MacOS/DevDock"';
const WINDOWS_EXECUTABLE = '& "$env:LOCALAPPDATA\\Programs\\DevDock\\DevDock.exe"';

export const AGENT_GUIDES: readonly AgentGuide[] = [
  {
    id: 'linux',
    label: 'Linux',
    shell: 'Terminal',
    commands: [
      { label: 'Open DevDock here', command: 'devdock .' },
      { label: 'Start Codex here', command: 'devdock codex .' },
      { label: 'Start Claude here', command: 'devdock claude .' },
      {
        label: 'Start an agent group',
        command: 'devdock agent group start codex,claude --cwd . --task "Review this project"',
      },
      { label: 'List all agents', command: 'devdock agent list' },
    ],
    hint: 'Run these commands from the project directory.',
  },
  {
    id: 'macos',
    label: 'macOS',
    shell: 'Terminal',
    commands: [
      { label: 'Open DevDock here', command: `${MAC_EXECUTABLE} .` },
      { label: 'Start Codex here', command: `${MAC_EXECUTABLE} codex .` },
      { label: 'Start Claude here', command: `${MAC_EXECUTABLE} claude .` },
      {
        label: 'Start an agent group',
        command: `${MAC_EXECUTABLE} agent group start codex,claude --cwd . --task "Review this project"`,
      },
      { label: 'List all agents', command: `${MAC_EXECUTABLE} agent list` },
    ],
    hint: 'These commands use the app installed in /Applications.',
  },
  {
    id: 'windows',
    label: 'Windows',
    shell: 'PowerShell',
    commands: [
      { label: 'Open DevDock here', command: `${WINDOWS_EXECUTABLE} .` },
      { label: 'Start Codex here', command: `${WINDOWS_EXECUTABLE} codex .` },
      { label: 'Start Claude here', command: `${WINDOWS_EXECUTABLE} claude .` },
      {
        label: 'Start an agent group',
        command: `${WINDOWS_EXECUTABLE} agent group start codex,claude --cwd . --task "Review this project"`,
      },
      { label: 'List all agents', command: `${WINDOWS_EXECUTABLE} agent list` },
    ],
    hint: 'If you chose a custom install folder, replace the DevDock.exe path.',
  },
] as const;

export function agentGuideIdForUserAgent(userAgent: string): AgentGuideId {
  if (/windows/i.test(userAgent)) return 'windows';
  if (/macintosh|mac os/i.test(userAgent)) return 'macos';
  return 'linux';
}
