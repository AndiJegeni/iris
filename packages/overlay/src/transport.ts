import type { Annotation, Task, Worktree, WsEvent } from '@localagents/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type TransportState = {
  status: ConnectionStatus;
  tasks: Task[];
  worktrees: Worktree[];
  /** Per-task rolling log lines (most recent last, capped). */
  logs: Record<string, string[]>;
};

const LOG_CAP_PER_TASK = 40;
const RECONNECT_DELAY_MS = 1500;

type Listener = (state: TransportState) => void;

/**
 * Singleton WebSocket connection to the orchestrator's /tasks endpoint, plus
 * a tiny in-memory store. Components subscribe via `subscribe()` and call
 * `sendAnnotation()` to enqueue work.
 */
class Transport {
  private state: TransportState = {
    status: 'connecting',
    tasks: [],
    worktrees: [],
    logs: {},
  };
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;

  constructor(private readonly daemonUrl: string) {}

  connect(): void {
    const wsUrl = `${this.daemonUrl.replace(/^http/, 'ws')}/tasks`;
    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => this.setState({ status: 'connected' }));
    this.ws.addEventListener('close', () => {
      this.setState({ status: 'disconnected' });
      this.scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {
      // close will fire; nothing extra to do.
    });
    this.ws.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as WsEvent;
        this.handleEvent(parsed);
      } catch {
        // ignore malformed frames
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.setState({ status: 'connecting' });
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private handleEvent(event: WsEvent): void {
    switch (event.type) {
      case 'hello':
        this.setState({ tasks: event.tasks, worktrees: event.worktrees });
        return;
      case 'task:created':
        this.setState({ tasks: [...this.state.tasks, event.task] });
        return;
      case 'task:updated': {
        const exists = this.state.tasks.some((t) => t.id === event.task.id);
        const tasks = exists
          ? this.state.tasks.map((t) => (t.id === event.task.id ? event.task : t))
          : [...this.state.tasks, event.task];
        this.setState({ tasks });
        return;
      }
      case 'task:log': {
        const cur = this.state.logs[event.id] ?? [];
        const next = [...cur, event.line].slice(-LOG_CAP_PER_TASK);
        this.setState({ logs: { ...this.state.logs, [event.id]: next } });
        return;
      }
      case 'worktree:created':
      case 'worktree:updated': {
        const wt = event.worktree;
        const others = this.state.worktrees.filter((w) => w.slug !== wt.slug);
        this.setState({ worktrees: [...others, wt] });
        return;
      }
      case 'worktree:removed':
        this.setState({
          worktrees: this.state.worktrees.filter((w) => w.slug !== event.slug),
        });
        return;
      case 'needs-auth':
        // Surfaced by the popover when sending hits the same backend.
        return;
    }
  }

  private setState(partial: Partial<TransportState>): void {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): TransportState {
    return this.state;
  }

  async sendAnnotation(annotation: Annotation): Promise<Task> {
    const res = await fetch(`${this.daemonUrl}/annotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(annotation),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`/annotate ${res.status}: ${body || res.statusText}`);
    }
    const json = (await res.json()) as { task: Task };
    return json.task;
  }

  async cancelTask(id: string): Promise<void> {
    await fetch(`${this.daemonUrl}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

let _transport: Transport | null = null;

/**
 * Daemon URL inference. The overlay is loaded via `<script src="http://localhost:4747/overlay.js">`
 * by the `<LocalAgents />` React component, so `import.meta.url` is the daemon URL.
 */
function inferDaemonUrl(): string {
  try {
    const u = new URL(import.meta.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    if (typeof window !== 'undefined') return window.location.origin;
    return 'http://localhost:4747';
  }
}

export function getTransport(): Transport {
  if (!_transport) {
    _transport = new Transport(inferDaemonUrl());
    _transport.connect();
  }
  return _transport;
}
