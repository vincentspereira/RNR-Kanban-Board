import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { SessionCard, Status } from '../types';
import Card from './Card';

interface Props {
  status: Status;
  label: string;
  accent: string;
  cards: SessionCard[];
  onOpenTerminal: (id: string) => void;
}

export default function Column({ status, label, accent, cards, onOpenTerminal }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col rounded-xl border bg-zinc-900/60 ${
        isOver ? 'border-sky-600' : 'border-zinc-800'
      }`}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <span className={`h-2.5 w-2.5 rounded-full ${accent}`} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
          {label}
        </h2>
        <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          {cards.length}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <Card key={card.id} card={card} onOpenTerminal={onOpenTerminal} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-zinc-600">No sessions</p>
        )}
      </div>
    </div>
  );
}
