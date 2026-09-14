import { agentControlDescriptorPath } from './agent-control-paths';
import { parseAgentCli, runAgentCli } from './agent-cli';

async function main(): Promise<void> {
  const invocation = parseAgentCli(process.argv);
  if (!invocation) throw new Error('Run `devdock --help` to see available commands.');

  const runtimeExecutable = process.env.DEVDOCK_GUI_EXECUTABLE;
  if (!runtimeExecutable) throw new Error('DevDock runtime executable is not configured.');

  const runtimeArguments =
    process.platform === 'linux'
      ? [
          '--ozone-platform=x11',
          '--disable-gpu',
          '--disable-gpu-sandbox',
          '--devdock-background-runtime',
        ]
      : ['--devdock-background-runtime'];
  await runAgentCli(
    invocation,
    runtimeExecutable,
    runtimeArguments,
    agentControlDescriptorPath(),
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`[devdock] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
