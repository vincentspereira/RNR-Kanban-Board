import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { openTerminal } from '../api';

interface Props {
  sessionId: string;
  onClose: () => void;
}

/**
 * Inline terminal attachment (spec §"Inline Terminal Rendering").
 *
 * Handles two known pitfalls from the design docs:
 *  1. Focus loss when switching cards — we re-force focus on any click
 *     inside the terminal container (the hidden xterm textarea loses focus
 *     when React re-renders around it).
 *  2. GPU/CPU load — output arrives already batched at 16ms by the server;
 *     we additionally throttle local writes through xterm's own buffer.
 */
export default function TerminalModal({ sessionId, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('');

  const refocus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        selectionBackground: '#27272a',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    termRef.current = term;
    term.focus();

    let disposed = false;
    let ws: WebSocket | null = null;

    openTerminal(sessionId, term.cols, term.rows)
      .then((handle) => {
        if (disposed) return;
        setMode(handle.mode);
        ws = new WebSocket(handle.wsUrl);
        wsRef.current = ws;

        ws.binaryType = 'arraybuffer';
        ws.onmessage = (ev) => {
          term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
        };
        ws.onclose = (ev) => {
          if (!disposed && ev.code !== 1000) {
            term.writeln(`\r\n\x1b[31m[connection closed: ${ev.code}]\x1b[0m`);
          }
        };
        ws.onerror = () => setError('WebSocket connection failed');

        term.onData((data) => ws?.send(data));

        const doFit = () => {
          fit.fit();
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
          }
        };
        doFit();

        const observer = new ResizeObserver(() => doFit());
        observer.observe(containerRef.current!);
        return () => observer.disconnect();
      })
      .catch((err) => setError(String(err.message || err)));

    // Escape closes the modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKey);
      wsRef.current?.close(1000);
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span className="font-mono text-xs">{sessionId.slice(0, 8)}…</span>
            {mode && <span className="text-[10px] uppercase text-zinc-600">({mode})</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Esc ✕
          </button>
        </div>

        {error ? (
          <div className="flex flex-1 items-center justify-center text-sm text-red-400">
            {error}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="min-h-0 flex-1 p-2"
            /* Spec-mandated focus management: recapture keystrokes after
               any re-render or click steals them from xterm's textarea. */
            onMouseDown={refocus}
            onClick={refocus}
          />
        )}
      </div>
    </div>
  );
}
