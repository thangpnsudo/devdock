// Settings page — terminal font, clipboard + sync toggles.

import { useEffect, useState } from 'react';
import { Clipboard, MonitorCog } from 'lucide-react';

import type { SaveSettingsRequest, SettingsDto } from '@devdock/types';

import { useSaveSettings, useSettings } from '../hooks/use-settings';
import { useToast } from '../../shell/components/toast';
import { SkeletonList } from '../../shell/components/skeleton';

function toFormState(settings: SettingsDto) {
  return {
    theme: 'dark' as const,
    terminalFont: settings.terminalFont,
    terminalFontSize: settings.terminalFontSize,
    clipboardEnabled: settings.clipboardEnabled,
    clipboardMaxItems: settings.clipboardMaxItems,
    clipboardRetentionDays: settings.clipboardRetentionDays,
  };
}

export function SettingsPage(): JSX.Element {
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [form, setForm] = useState<ReturnType<typeof toFormState> | null>(null);
  const [fontSizeInput, setFontSizeInput] = useState('14');
  const [clipboardMaxInput, setClipboardMaxInput] = useState('500');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Sync form state when remote settings load.
  useEffect(() => {
    if (settings.data) {
      setForm(toFormState(settings.data));
      setFontSizeInput(String(settings.data.terminalFontSize));
      setClipboardMaxInput(String(settings.data.clipboardMaxItems));
    }
  }, [settings.data]);

  if (settings.isError) {
    return (
      <section className="dd-page dd-page--settings">
        <header className="dd-page__header">
          <div>
            <span className="dd-eyebrow">Workspace preferences</span>
            <h2>Settings need another try.</h2>
          </div>
        </header>
        <p className="dd-banner dd-banner--error">Settings could not be loaded.</p>
        <div className="dd-page__actions">
          <button
            type="button"
            onClick={() => {
              void settings.refetch();
            }}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!form) {
    return (
      <section className="dd-page dd-page--settings">
        <header className="dd-page__header">
          <div>
            <span className="dd-eyebrow">Workspace preferences</span>
            <h2>Loading your workspace.</h2>
          </div>
        </header>
        <SkeletonList count={3} />
      </section>
    );
  }

  const handleSave = async (): Promise<void> => {
    if (!form) return;
    const parsedFontSize = Number(fontSizeInput);
    const terminalFontSize =
      Number.isFinite(parsedFontSize) && parsedFontSize >= 8
        ? Math.min(32, Math.trunc(parsedFontSize))
        : 14;
    const parsedClipboardMax = Number(clipboardMaxInput);
    const clipboardMaxItems =
      Number.isFinite(parsedClipboardMax) && parsedClipboardMax >= 20
        ? Math.min(500, Math.trunc(parsedClipboardMax))
        : 500;
    const request: SaveSettingsRequest = {
      theme: form.theme,
      terminalFont: form.terminalFont,
      terminalFontSize,
      clipboardEnabled: form.clipboardEnabled,
      clipboardMaxItems,
      clipboardRetentionDays: form.clipboardRetentionDays,
    };
    try {
      const result = await save.mutateAsync(request);
      setForm({ ...form, terminalFontSize, clipboardMaxItems });
      setFontSizeInput(String(terminalFontSize));
      setClipboardMaxInput(String(clipboardMaxItems));
      setSavedAt(result.updatedAt);
      toast.push('Settings saved', { variant: 'success' });
    } catch (err) {
      toast.push(
        `Settings could not be saved: ${err instanceof Error ? err.message : String(err)}`,
        { variant: 'error' },
      );
    }
  };

  const dirty =
    settings.data &&
    (JSON.stringify(toFormState(settings.data)) !== JSON.stringify(form) ||
      fontSizeInput !== String(form.terminalFontSize) ||
      clipboardMaxInput !== String(form.clipboardMaxItems));

  return (
    <section className="dd-page dd-page--settings">
      <header className="dd-page__header">
        <div>
          <span className="dd-eyebrow">Workspace preferences</span>
          <h2>Make DevDock feel like yours.</h2>
          <p>Control clipboard capture and the essentials of your local workspace.</p>
        </div>
      </header>

      <div className="dd-settings-form">
        <fieldset>
          <legend>
            <MonitorCog size={14} /> Terminal
          </legend>
          <label className="dd-field">
            <span>Font family</span>
            <input
              type="text"
              value={form.terminalFont}
              onChange={(event) => setForm({ ...form, terminalFont: event.target.value })}
              placeholder="JetBrains Mono"
            />
          </label>
          <label className="dd-field">
            <span>Font size (points)</span>
            <input
              type="number"
              min={8}
              max={32}
              value={fontSizeInput}
              onChange={(event) => setFontSizeInput(event.target.value)}
              onBlur={() => {
                const parsed = Number(fontSizeInput);
                const value =
                  Number.isFinite(parsed) && parsed >= 8 ? Math.min(32, Math.trunc(parsed)) : 14;
                setFontSizeInput(String(value));
                setForm({ ...form, terminalFontSize: value });
              }}
            />
          </label>
          <p className="dd-form-hint">
            Font changes are applied to open terminals and future sessions.
          </p>
        </fieldset>

        <fieldset>
          <legend>
            <Clipboard size={14} /> Clipboard retention
          </legend>
          <label className="dd-checkbox">
            <input
              type="checkbox"
              checked={form.clipboardEnabled}
              onChange={(event) => setForm({ ...form, clipboardEnabled: event.target.checked })}
            />
            Capture clipboard history
          </label>
          <label className="dd-field">
            <span>Maximum clipboard records</span>
            <input
              type="number"
              min={20}
              max={500}
              step={10}
              value={clipboardMaxInput}
              disabled={!form.clipboardEnabled}
              onChange={(event) => setClipboardMaxInput(event.target.value)}
              onBlur={() => {
                const parsed = Number(clipboardMaxInput);
                const value =
                  Number.isFinite(parsed) && parsed >= 20 ? Math.min(500, Math.trunc(parsed)) : 500;
                setClipboardMaxInput(String(value));
                setForm({ ...form, clipboardMaxItems: value });
              }}
            />
          </label>
          <label className="dd-checkbox">
            <input
              type="checkbox"
              checked={form.clipboardRetentionDays === 7}
              disabled={!form.clipboardEnabled}
              onChange={(event) =>
                setForm({
                  ...form,
                  clipboardRetentionDays: event.target.checked ? 7 : 0,
                })
              }
            />
            Automatically delete clipboard entries older than 7 days
          </label>
          <p className="dd-form-hint">
            Cleanup runs after each capture and immediately when these settings are saved.
          </p>
        </fieldset>

        <footer className="dd-form-actions">
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {savedAt && (
            <span className="dd-form-saved">Saved at {new Date(savedAt).toLocaleTimeString()}</span>
          )}
        </footer>
      </div>
    </section>
  );
}
