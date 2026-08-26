import { useEffect, useState } from 'react';
import { getHooksSnippet } from '../api';

interface Props {
  onClose: () => void;
}

/**
 * C6: shows the exact Claude Code hook configuration for THIS server instance
 * — real port and token already embedded — so wiring up webhooks is a copy-
 * paste instead of a manual assembly exercise.
 */
export default function HooksModal({ onClose }: Props) {
  const [json, setJson] = useState<string>('Loading…');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getHooksSnippet()
      .then(({ snippet }) => setJson(JSON.stringify(snippet, null, 2)))
      .catch((err) => setJson(`Failed to load: ${String(err.message || err)}`));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Claude Code hooks setup</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Esc ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-zinc-400">
          <p>
            Merge this into your <code className="text-sky-400">~/.claude/settings.json</code>{' '}
            so permission prompts push live Amber Alerts to the board. The token
            below is unique to this installation.
          </p>
          <pre
            role="figure"
            aria-label="Hook configuration JSON"
            className="mt-3 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-[11px] text-zinc-300"
          >
            {json}
          </pre>
          <p className="mt-3 text-[11px] text-zinc-600">
            Tip: even with no hooks configured, the board keeps working via
            transcript scanning alone.
          </p>
        </div>

        <div className="border-t border-zinc-800 p-3 text-right">
          <button
            type="button"
            onClick={copy}
            className="rounded-md bg-sky-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {copied ? '✓ Copied' : 'Copy JSON'}
          </button>
        </div>
      </div>
    </div>
  );
}
