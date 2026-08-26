import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import type { SessionCard, Status } from '../types';
import { setStatus } from '../api';
import Column from './Column';

interface Props {
  byStatus: Record<Status, SessionCard[]>;
  onOpenTerminal: (id: string) => void;
}

const COLUMNS: { key: Status; label: string; accent: string }[] = [
  { key: 'todo', label: 'To Do', accent: 'bg-zinc-500' },
  { key: 'in_progress', label: 'In Progress', accent: 'bg-sky-500' },
  { key: 'review', label: 'In Review', accent: 'bg-amber-400' },
  { key: 'done', label: 'Done', accent: 'bg-emerald-600' },
];

export default function Board({ byStatus, onOpenTerminal }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const id = event.active.id as string;
    const overId = event.over?.id as Status | undefined;
    if (!overId) return;
    const card = Object.values(byStatus)
      .flat()
      .find((c) => c.id === id);
    if (!card || card.status === overId) return;

    // Optimistic move; SSE reconciliation corrects us if the server disagrees.
    setStatus(id, overId).catch(() => undefined);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid h-full min-w-[900px] grid-cols-4 gap-4">
        {COLUMNS.map(({ key, label, accent }) => (
          <Column
            key={key}
            status={key}
            label={label}
            accent={accent}
            cards={byStatus[key]}
            onOpenTerminal={onOpenTerminal}
          />
        ))}
      </div>
    </DndContext>
  );
}
