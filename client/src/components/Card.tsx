import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { SessionCard } from '../types';
import { mergeWorktree, pruneWorktree, stopSession, timeAgo } from '../api';

interface Props {
  card: SessionCard;
  onOpenTerminal: (id: string) => void;
}

function fmtTokens(n?: number) {
  if (!n || n <= 0) return null;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export default function Card({ card, onOpenTerminal }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const isAmber = card.status === 'review';
  const tokens = fmtTokens(card.totalTokens);

  const runWorktreeAction = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      setActionError(null);
    } catch (err) {
      setActionError(`${label}: ${String((err as Error).message || err).slice(0, 160)}`);
    }
  };


  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`group cursor-grab touch-none select-none rounded-lg border p-3 transition-shadow active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      } ${
        isAmber
          ? 'border-amber-500/70 bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.25)] animate-pulse'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
      }`}
    >
      <p className="line-clamp-2 text-sm font-medium leading-snug" title={card.title}>
        {card.title}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
        <span className="max-w-[180px] truncate">{card.project}</span>
        {card.gitBranch && <span className="text-sky-500">⎇ {card.gitBranch}</span>}
        {(card.toolUseCount ?? 0) > 0 && <span>🔧 {card.toolUseCount}</span>}
        {tokens && (
          <span title="Input+output tokens (recent transcript window)">
            🎟 {tokens}
          </span>
        )}
        <span>· {timeAgo(card.fileModifiedAt)}</span>
      </div>

      {/* C1: stall heartbeat */}
      {card.stalled && card.status === 'in_progress' && (
        <p
          role="status"
          className="mt-2 rounded bg-zinc-800/80 px-2 py-1 text-[11px] font-medium text-zinc-400"
        >
          ⏸ Stalled — no activity for a while
        </p>
      )}

      {isAmber && card.needsInputReason && (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-400">
          ⚠ {card.needsInputReason}
        </p>
      )}

      {actionError && (
        <p role="alert" className="mt-2 rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-400">
          {actionError}
        </p>
      )}

      {/* Action buttons — drag listeners are disabled here via stopPropagation */}
      <div
        className="mt-3 flex flex-wrap gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onOpenTerminal(card.id)}
          className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          ▶ Terminal
        </button>
        {/* A3: Stop is only offered when we actually control the process. */}
        {card.terminalActive && card.status !== 'done' && (
          <button
            type="button"
            onClick={() => stopSession(card.id).catch(() => undefined)}
            title="Terminate this card's attached terminal process"
            className="rounded border border-red-900/60 px-2 py-1 text-xs text-red-400 hover:bg-red-950 focus:outline-none focus:ring-1 focus:ring-red-500"
          >
            ■ Stop
          </button>
        )}
        {/* B1: worktree lifecycle on finished sessions */}
        {card.status === 'done' && card.gitBranch && (
          <button
            type="button"
            onClick={() => runWorktreeAction(() => mergeWorktree(card.id), 'Merge')}
            title={`Merge ${card.gitBranch} into the main worktree`}
            className="rounded border border-emerald-900/60 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-950 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            ⇥ Merge branch
          </button>
        )}
        {card.status === 'done' && card.cwd && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Remove this session\'s git worktree from disk?')) {
                runWorktreeAction(() => pruneWorktree(card.id), 'Prune');
              }
            }}
            title="Remove this session's worktree directory"
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            🗑 Prune worktree
          </button>
        )}
      </div>
    </div>
  );
}
