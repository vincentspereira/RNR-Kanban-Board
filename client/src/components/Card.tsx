import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { SessionCard } from '../types';
import { stopSession, timeAgo } from '../api';

interface Props {
  card: SessionCard;
  onOpenTerminal: (id: string) => void;
}

export default function Card({ card, onOpenTerminal }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });

  const isAmber = card.status === 'review';

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
        <span>· {timeAgo(card.fileModifiedAt)}</span>
      </div>

      {isAmber && card.needsInputReason && (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-400">
          ⚠ {card.needsInputReason}
        </p>
      )}

      {/* Action buttons — drag listeners are disabled here via stopPropagation */}
      <div
        className="mt-3 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onOpenTerminal(card.id)}
          className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
        >
          ▶ Terminal
        </button>
        {card.status !== 'done' && (
          <button
            type="button"
            onClick={() => stopSession(card.id).catch(() => undefined)}
            className="rounded border border-red-900/60 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
          >
            ■ Stop
          </button>
        )}
      </div>
    </div>
  );
}
