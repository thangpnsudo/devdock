// SSH host create / update form.

import { useState } from 'react';

import type { CreateSshHostRequest, SshHostDto, UpdateSshHostRequest } from '@devdock/types';

type Mode =
  | { kind: 'create' }
  | {
      kind: 'edit';
      id: string;
      initial: UpdateSshHostRequest & Pick<SshHostDto, 'hasSavedPassword'>;
    };

interface HostFormProps {
  mode: Mode;
  busy?: boolean;
  onSubmit: (request: CreateSshHostRequest | UpdateSshHostRequest) => Promise<void> | void;
  onCancel: () => void;
}

const AUTH_OPTIONS: Array<{ value: 'password' | 'public_key'; label: string }> = [
  { value: 'password', label: 'Password or MFA prompt in terminal' },
  { value: 'public_key', label: 'SSH agent or private key path' },
];

export function HostForm({ mode, busy, onSubmit, onCancel }: HostFormProps): JSX.Element {
  const initial = mode.kind === 'edit' ? mode.initial : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [authMethod, setAuthMethod] = useState<'password' | 'public_key'>(
    (initial?.authMethod as 'password' | 'public_key') ?? 'public_key',
  );
  const [credential, setCredential] = useState('');
  const [savePassword, setSavePassword] = useState(initial?.hasSavedPassword ?? false);
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!title.trim() || !host.trim() || !username.trim()) return;
    if (authMethod === 'password' && savePassword && !password && !initial?.hasSavedPassword)
      return;
    const portNum = Math.max(1, Math.min(65535, parseInt(port, 10) || 22));
    if (mode.kind === 'create') {
      const req: CreateSshHostRequest = {
        title: title.trim(),
        authMethod: authMethod,
        port: portNum,
        host: host.trim(),
        username: username.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(credential.trim() ? { credential: credential.trim() } : {}),
        ...(authMethod === 'password'
          ? {
              savePassword,
              ...(savePassword && password ? { password } : {}),
            }
          : { savePassword: false }),
      };
      await onSubmit(req);
    } else {
      const req: UpdateSshHostRequest = {
        id: mode.id,
        title: title.trim(),
        authMethod: authMethod,
        port: portNum,
        host: host.trim(),
        username: username.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(credential.trim() ? { credential: credential.trim() } : {}),
        ...(authMethod === 'password'
          ? {
              savePassword,
              ...(savePassword && password ? { password } : {}),
            }
          : { savePassword: false }),
      };
      await onSubmit(req);
    }
  };

  return (
    <form className="dd-form dd-ssh-form" onSubmit={handleSubmit}>
      <label className="dd-field">
        <span>Display name</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Production web"
          required
        />
      </label>
      <label className="dd-field">
        <span>Host</span>
        <input
          type="text"
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="prod.example.com"
          required
        />
      </label>
      <label className="dd-field">
        <span>Port</span>
        <input
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(event) => setPort(event.target.value)}
        />
      </label>
      <label className="dd-field">
        <span>Username</span>
        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="deploy"
          required
        />
      </label>
      <label className="dd-field">
        <span>Description</span>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <fieldset>
        <legend>Authentication</legend>
        {AUTH_OPTIONS.map((opt) => (
          <label key={opt.value} className="dd-radio">
            <input
              type="radio"
              name="auth"
              value={opt.value}
              checked={authMethod === opt.value}
              onChange={() => setAuthMethod(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>
      {authMethod === 'public_key' ? (
        <label className="dd-field">
          <span>Private key path (optional)</span>
          <input
            type="text"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="Leave empty to use your SSH agent/default OpenSSH keys"
          />
        </label>
      ) : (
        <div className="dd-password-storage">
          <label className="dd-checkbox">
            <input
              type="checkbox"
              checked={savePassword}
              onChange={(event) => setSavePassword(event.target.checked)}
            />
            Save password securely on this device
          </label>
          {savePassword && (
            <label className="dd-field">
              <span>
                {initial?.hasSavedPassword ? 'Replace saved password (optional)' : 'Password'}
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  initial?.hasSavedPassword
                    ? 'Leave blank to keep the saved password'
                    : 'Required when password saving is enabled'
                }
                autoComplete="new-password"
                required={!initial?.hasSavedPassword}
              />
            </label>
          )}
          <p className="dd-form-hint">
            {savePassword
              ? 'Encrypted with your operating system keychain. MFA prompts still appear in the terminal.'
              : 'Password and MFA will be requested by the SSH server in the terminal.'}
          </p>
        </div>
      )}
      <footer className="dd-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </form>
  );
}
