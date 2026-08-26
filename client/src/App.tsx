import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionCard, Status } from './types';
import { fetchSessions, resolveGrid, subscribeToBoard } from './api';
import Board from './components/Board';
import TerminalModal from './components/TerminalModal';
import HooksModal from './components/HooksModal';

/** Shorten a project path for tab display. */
function shortProject(p: string) {
  const parts = p.split('/').filter(Boolean);
  return parts.length > 2 ? parts[parts.length - 1] : p;
}

export default function App() {
  const [sessions, setSessions] = useState<SessionCard[]>([]);
  const [connected, setConnected] = useState(false);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [showHooks, setShowHooks] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string>('__all__');
  const [search, setSearch] = useState('');
  const [gridMessage, setGridMessage] = useState<string | null>(null);

  // --- Live state + A1 reconnect resync -------------------------------------
  useEffect(() => {
    let alive = true;
    fetchSessions().then((r) => alive && setSessions(r.sessions ?? []));
    const unsubscribe = subscribeToBoard((s) => alive && setSessions(s), setConnected);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // --- B3: desktop notifications for newly amber agents ----------------------
  const prevReviewIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
    if (Notification.permission !== 'granted') return;

    const current = new Set(
      sessions.filter((s) => s.status === 'review').map((s) => s.id),
    );
    for (const id of current) {
      if (!prevReviewIds.current.has(id)) {
        const card = sessions.find((s) => s.id === id);
        try {
          new Notification('⚠ Agent needs your input', {
            body: card?.title?.slice(0, 120) ?? 'A session moved to In Review',
            tag: id, // dedupe per session
          });
        } catch {
          /* notification failures are never fatal */
        }
      }
    }
    prevReviewIds.current = current;

    // Title-bar badge.
    document.title =
      current.size > 0 ? `(${current.size}) RNR Kanban Orchestrator` : 'RNR Kanban Orchestrator';
  }, [sessions]);

  // --- B4: project tabs -------------------------------------------------------
  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.project, (counts.get(s.project) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p]) => p);
  }, [sessions]);

  // --- C5: search filter --------------------------------------------------------
  const visible = useMemo(() => {
    let list = sessions;
    if (projectFilter !== '__all__') {
      list = list.filter((s) => s.project === projectFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.project.toLowerCase().includes(q) ||
          (s.gitBranch ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [sessions, projectFilter, search]);

  const byStatus = useMemo(() => {
    const groups: Record<Status, SessionCard[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const s of visible) groups[s.status]?.push(s);
    // Amber alerts float to the top of their column.
    for (const key of Object.keys(groups) as Status[]) {
      groups[key].sort(
        (a, b) => (b.needsInputReason ? 1 : 0) - (a.needsInputReason ? 1 : 0),
      );
    }
    return groups;
  }, [visible]);

  const amberCount = byStatus.review.length;

  const closeTerminal = useCallback(() => setTerminalSessionId(null), []);
  const openTerminalFor = useCallback((id: string) => setTerminalSessionId(id), []);

  const handleResolveGrid = useCallback(async () => {
    try {
      const r = await resolveGrid();
      setGridMessage(r.summary ?? 'Grid opened');
    } catch (err) {
      setGridMessage(String((err as Error).message || err));
    }
  }, []);


  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight">
              RNR Kanban Orchestrator
            </h1>
            <span
              title={connected ? 'Live via SSE' : 'Disconnected — retrying…'}
              role="status"
              aria-label={connected ? 'Connected' : 'Disconnected'}
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                connected ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'
              }`}
            />
          </div>

          <div className="flex items-center gap-3 text-sm text-zinc-400">
            {/* C5: search */}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title / branch / project…"
              aria-label="Search sessions"
              className="w-56 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none"
            />

            {amberCount > 0 && (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 font-medium text-amber-400">
                ⚠ {amberCount} need{amberCount === 1 ? 's' : ''} input
              </span>
            )}
            {amberCount > 0 && (
              <button
                type="button"
                onClick={handleResolveGrid}
                title="Open all attention-needing sessions in a Windows Terminal grid"
                className="rounded border border-amber-700/50 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950"
              >
                ⿴ Resolve Grid
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowHooks(true)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
            >
              🔗 Hooks setup
            </button>
            <span>
              {visible.length}/{sessions.length} sessions
            </span>
          </div>
        </div>

        {/* B4: project tabs */}
        {projects.length > 0 && (
          <nav aria-label="Project filter" className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setProjectFilter('__all__')}
              className={`rounded-full px-3 py-0.5 text-[11px] ${
                projectFilter === '__all__'
                  ? 'bg-sky-600/30 text-sky-300'
                  : 'text-zinc-500 hover:bg-zinc-800'
              }`}
            >
              All projects
            </button>
            {projects.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProjectFilter(projectFilter === p ? '__all__' : p)}
                title={p}
                className={`max-w-[220px] truncate rounded-full px-3 py-0.5 text-[11px] ${
                  projectFilter === p
                    ? 'bg-sky-600/30 text-sky-300'
                    : 'text-zinc-500 hover:bg-zinc-800'
                }`}
              >
                {shortProject(p)}
              </button>
            ))}
          </nav>
        )}
      </header>

      {gridMessage && (
        <div
          role="alert"
          className="flex items-center justify-between border-b border-amber-900/40 bg-amber-950/30 px-6 py-1.5 text-xs text-amber-300"
        >
          <span>{gridMessage}</span>
          <button type="button" onClick={() => setGridMessage(null)} className="ml-4">
            ✕
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-x-auto p-6">
        <Board byStatus={byStatus} onOpenTerminal={openTerminalFor} />
      </main>

      {terminalSessionId && (
        <TerminalModal sessionId={terminalSessionId} onClose={closeTerminal} />
      )}
      {showHooks && <HooksModal onClose={() => setShowHooks(false)} />}
    </div>
  );
}
