// Script create form — modal-like form for new scripts.

import { useState } from 'react';
import type { CreateScriptRequest, LibraryItemDto, ScriptShell } from '@devdock/types';
import { UiSelect } from '../../shell/components/ui-select';

interface ScriptFormProps {
  onSubmit: (request: CreateScriptRequest) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
  initial?: LibraryItemDto;
}

const SHELLS: ReadonlyArray<{ value: ScriptShell; label: string }> = [
  { value: 'bash', label: 'Bash' },
  { value: 'sh', label: 'Sh' },
  { value: 'zsh', label: 'Zsh' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Cmd' },
];

export function ScriptForm({ onSubmit, onCancel, busy, initial }: ScriptFormProps): JSX.Element {
  const initialBody = initial?.body?.type === 'script' ? initial.body : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initialBody?.content ?? '');
  const [shell, setShell] = useState<ScriptShell>(initialBody?.shell ?? 'bash');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [workingDirectory, setWorkingDirectory] = useState(initialBody?.workingDirectory ?? '');

  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  const isValid =
    trimmedTitle.length > 0 && trimmedTitle.length <= 256 && trimmedContent.length > 0;

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!isValid) return;
    const request: CreateScriptRequest = {
      title: trimmedTitle,
      content,
      shell,
      ...(description ? { description } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      tags: [],
    };
    await onSubmit(request);
  };

  return (
    <form className="dd-form" onSubmit={handleSubmit}>
      <label className="dd-field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={256}
          autoFocus
        />
      </label>
      <label className="dd-field">
        <span>Description</span>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="dd-field">
        <span>Shell</span>
        <UiSelect
          value={shell}
          onValueChange={setShell}
          options={SHELLS}
          ariaLabel="Script shell"
        />
      </div>
      <label className="dd-field">
        <span>Working directory</span>
        <input
          type="text"
          value={workingDirectory}
          onChange={(event) => setWorkingDirectory(event.target.value)}
          placeholder="(optional)"
        />
      </label>
      <label className="dd-field">
        <span>Content</span>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={8}
          required
          spellCheck={false}
        />
      </label>
      <div className="dd-form__actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" disabled={!isValid || busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Create'}
        </button>
      </div>
    </form>
  );
}
