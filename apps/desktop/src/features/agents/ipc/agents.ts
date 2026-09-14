export const agentsIpc = {
  async providers() {
    if (!window.devdockAgents) return [];
    return window.devdockAgents.providers();
  },
  async list() {
    if (!window.devdockAgents) return [];
    return window.devdockAgents.list();
  },
  async get(id: string) {
    if (!window.devdockAgents) return null;
    return window.devdockAgents.get(id);
  },
  async status(id: string) {
    if (!window.devdockAgents) return null;
    return window.devdockAgents.status(id);
  },
  async start(request: Parameters<NonNullable<typeof window.devdockAgents>['start']>[0]) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.start(request);
  },
  async startGroup(request: Parameters<NonNullable<typeof window.devdockAgents>['startGroup']>[0]) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.startGroup(request);
  },
  async stopGroup(cwd: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.stopGroup(cwd);
  },
  async restartGroup(cwd: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.restartGroup(cwd);
  },
  async stop(id: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.stop(id);
  },
  async restart(id: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.restart(id);
  },
  async rename(id: string, displayName: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.rename(id, displayName);
  },
  async markSeen(id: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.markSeen(id);
  },
  async remove(id: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.remove(id);
  },
  async readTerminal(id: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.readTerminal(id);
  },
  async writeTerminal(id: string, data: string) {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.writeTerminal(id, data);
  },
  async chooseDirectory() {
    if (!window.devdockAgents) throw new Error('Agent runtime is unavailable.');
    return window.devdockAgents.chooseDirectory();
  },
  onChanged(handler: (agent: ElectronAgentSnapshot) => void): () => void {
    return window.devdockAgents?.onChanged(({ agent }) => handler(agent)) ?? (() => undefined);
  },
};
