import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionCard, Status } from './types';
import { fetchSessions, subscribeToBoard } from './api';
import Board from './components/Board';
import TerminalModal from './components/TerminalModal';

export default function App() {
  const [sessions, setSessions] = useState<SessionCard[]>([]);
  const [connected, setConnected] = useState(false);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSessions().then((r) => alive && setSessions(r.sessions ?? []));
    const unsubscribe = subscribeToBoard((s) => setSessions(s), setConnected);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const byStatus = useMemo(() => {
    const groups: Record<Status, SessionCard[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const s of sessions) groups[s.status]?.push(s);
    // Amber alerts float to the top of their column.
    for (const key of Object.keys(groups) as Status[]) {
      groups[key].sort(
        (a, b) => (b.needsInputReason ? 1 : 0) - (a.needsInputReason ? 1 : 0),
      );
    }
    return groups;
  }, [sessions]);

  const amberCount = byStatus.review.length;

  const closeTerminal = useCallback(() => setTerminalSessionId(null), []);
  const openTerminalFor = useCallback(
    (id: string) => setTerminalSessionId(id),
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">
            RNR Kanban Orchestrator
          </h1>
          <span
            title={connected ? 'Live via SSE' : 'Disconnected — retrying…'}
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              connected ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'
            }`}
          />
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          {amberCount > 0 && (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 font-medium text-amber-400">
              ⚠ {amberCount} agent{amberCount === 1 ? '' : 's'} need{amberCount === 1 ? 's' : ''} input
            </span>
          )}
          <span>{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-x-auto p-6">
        <Board byStatus={byStatus} onOpenTerminal={openTerminalFor} />
      </main>

      {terminalSessionId && (
        <TerminalModal sessionId={terminalSessionId} onClose={closeTerminal} />
      )}
    </div>
  );
}
