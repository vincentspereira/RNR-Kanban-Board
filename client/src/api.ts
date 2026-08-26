import type { AppConfig, SessionCard, Status } from './types';

/**
 * API client. The shared token is fetched once from the (loopback-pinned)
 * /api/config endpoint and attached to mutating calls.
 */
let cachedConfig: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  const existing = cachedConfig;
  if (existing) return existing;
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`config failed: ${res.status}`);
  cachedConfig = await res.json();
  return cachedConfig as AppConfig;
}

const authHeaders = async (): Promise<Record<string, string>> => {
  const { token } = await getConfig();
  return { 'Content-Type': 'application/json', 'x-orchestrator-token': token };
};

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: await authHeaders(),
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export function fetchSessions(): Promise<{ sessions: SessionCard[] }> {
  return fetch('/api/sessions').then((r) => r.json());
}

export function setStatus(id: string, status: Status) {
  return post(`/api/sessions/${encodeURIComponent(id)}/status`, { status });
}

export function stopSession(id: string) {
  return post(`/api/sessions/${encodeURIComponent(id)}/stop`);
}

export interface TerminalHandle {
  ticket: string;
  wsUrl: string;
  mode: string;
}

/** Mint a one-time terminal websocket ticket for a session card. */
export async function openTerminal(
  id: string,
  cols: number,
  rows: number,
): Promise<TerminalHandle> {
  const result = await post<{ ok: boolean; ticket: string }>(
    `/api/sessions/${encodeURIComponent(id)}/open-terminal`,
    { cols, rows },
  );
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return {
    ticket: result.ticket,
    wsUrl: `${proto}://${location.host}/terminals/${id}?ticket=${result.ticket}`,
    mode: (await getConfig()).ptyMode,
  };
}

/**
 * Subscribe to live board state via Server-Sent Events.
 * Returns an unsubscribe function.
 */
export function subscribeToBoard(
  onSessions: (sessions: SessionCard[]) => void,
  onConnectionChange?: (connected: boolean) => void,
): () => void {
  const es = new EventSource('/api/events');

  es.addEventListener('hello', () => onConnectionChange?.(true));
  es.addEventListener('board', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data);
      onSessions(data.sessions ?? []);
    } catch {
      /* malformed frame — ignore */
    }
  });
  es.onopen = () => onConnectionChange?.(true);
  es.onerror = () => onConnectionChange?.(false);

  return () => es.close();
}

/** Format a relative "time ago" label. */
export function timeAgo(ts?: number | null): string {
  if (!ts) return '—';
  const delta = Date.now() - ts;
  if (delta < 30_000) return 'just now';
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
