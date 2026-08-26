export type Status = 'todo' | 'in_progress' | 'review' | 'done';

export interface SessionCard {
  id: string;
  title: string;
  project: string;
  cwd?: string | null;
  gitBranch?: string | null;
  status: Status;
  needsInputReason?: string | null;
  toolUseCount?: number;
  startedAt?: number;
  fileModifiedAt?: number;
  lastActivityAt?: number;
  lastEventType?: string | null;
  source?: string;
}

export interface AppConfig {
  token: string;
  ptyMode: 'node-pty' | 'pipe';
  pollIntervalMs: number;
  flushIntervalMs: number;
}
