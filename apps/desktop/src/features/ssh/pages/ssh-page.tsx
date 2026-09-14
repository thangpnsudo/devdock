// Dedicated terminal route. The same workspace is also embedded in Library.

import { SshWorkspace } from '../components/ssh-workspace';

export function SshPage(): JSX.Element {
  return (
    <section className="dd-page dd-page--ssh">
      <SshWorkspace />
    </section>
  );
}
