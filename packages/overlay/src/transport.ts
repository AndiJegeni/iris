import {
  type Annotation,
  type AuthStatus,
  type Capabilities,
  type Task,
  type TranscriptEntry,
  type Worktree,
  type WsEvent,
  mergeTranscriptEntry,
} from '@iris/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type TransportState = {
  status: ConnectionStatus;
  tasks: Task[];
  worktrees: Worktree[];
  /** Per-task rolling log lines (most recent last, capped). */
  logs: Record<string, string[]>;
  /** Per-task structured transcript for the chat UI (full history). */
  transcripts: Record<string, TranscriptEntry[]>;
  /** Provider auth status from the daemon, or null until first fetched. */
  auth: AuthStatus | null;
  /**
   * What the daemon can do on this machine. Null until the first 'hello';
   * treat unknown as capable so the UI doesn't flicker into a disabled state
   * during the initial connect.
   */
  capabilities: Capabilities | null;
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
    transcripts: {},
    auth: null,
    capabilities: null,
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
    this.ws.addEventListener('open', () => {
      this.setState({ status: 'connected' });
      void this.fetchAuthStatus();
    });
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
        this.setState({
          tasks: event.tasks,
          worktrees: event.worktrees,
          capabilities: event.capabilities,
        });
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
      case 'task:entry': {
        this.setState({
          transcripts: {
            ...this.state.transcripts,
            [event.id]: mergeTranscriptEntry(this.state.transcripts[event.id] ?? [], event.entry)
              .entries,
          },
        });
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
        // A run was rejected by the provider's credential. Pull the refreshed
        // status so the Accounts panel stops claiming the session is connected.
        void this.fetchAuthStatus();
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

  /**
   * Re-run a failed task by re-submitting its original prompt as a fresh task.
   * The stored Task only carries prompt/source/backend/model (not the full
   * annotation), so the other annotation fields fall back to their defaults —
   * a fresh worktree, default reasoning effort. This goes through the same
   * `/annotate` flow as a normal submit, so it creates a brand-new task.
   */
  async retryTask(id: string): Promise<Task | null> {
    const orig = this.state.tasks.find((t) => t.id === id);
    if (!orig) return null;
    const annotation: Annotation = {
      prompt: orig.prompt,
      source: orig.source,
      selector: null,
      componentPath: [],
      nearbyText: null,
      confidence: 'low',
      worktreeMode: 'new',
      backend: orig.backend,
      model: orig.model ?? '',
      reasoningEffort: 'medium',
      images: [],
    };
    return this.sendAnnotation(annotation);
  }

  /** Send a follow-up message to an existing task (resumes its session). */
  async sendMessage(id: string, text: string): Promise<void> {
    const res = await fetch(`${this.daemonUrl}/tasks/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`message ${res.status}: ${body || res.statusText}`);
    }
  }

  /** Fetch the daemon's current provider auth status into state. */
  async fetchAuthStatus(): Promise<void> {
    try {
      const res = await fetch(`${this.daemonUrl}/auth/status`);
      if (!res.ok) return;
      const auth = (await res.json()) as AuthStatus;
      this.setState({ auth });
    } catch {
      // best-effort; UI shows "unknown" until a later fetch succeeds
    }
  }

  /**
   * Start a subscription login for a provider. The daemon opens the user's
   * browser for the OAuth flow and resolves once complete (or errors).
   */
  async loginProvider(provider: 'anthropic' | 'openai'): Promise<void> {
    const res = await fetch(`${this.daemonUrl}/auth/login/${provider}`, { method: 'POST' });
    const json = (await res.json().catch(() => null)) as {
      ok: boolean;
      error?: string;
      status?: AuthStatus;
    } | null;
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `login failed (${res.status})`);
    }
    if (json.status) this.setState({ auth: json.status });
  }

  /** Log out of a provider's subscription (or clear its API key). */
  async logoutProvider(provider: 'anthropic' | 'openai'): Promise<void> {
    const res = await fetch(`${this.daemonUrl}/auth/logout/${provider}`, { method: 'POST' });
    const json = (await res.json().catch(() => null)) as { status?: AuthStatus } | null;
    if (json?.status) this.setState({ auth: json.status });
    else await this.fetchAuthStatus();
  }

  /** Save (or clear, when empty) a provider's API key and switch to key auth. */
  async saveApiKey(provider: 'anthropic' | 'openai', key: string): Promise<void> {
    const res = await fetch(`${this.daemonUrl}/auth/key/${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const json = (await res.json().catch(() => null)) as {
      ok: boolean;
      error?: string;
      status?: AuthStatus;
    } | null;
    if (!res.ok || !json?.ok) throw new Error(json?.error || `save failed (${res.status})`);
    if (json.status) this.setState({ auth: json.status });
  }

  /** Load a task's full transcript (e.g. when opening its chat) and seed state. */
  async fetchTranscript(id: string): Promise<void> {
    try {
      const res = await fetch(`${this.daemonUrl}/tasks/${encodeURIComponent(id)}/transcript`);
      if (!res.ok) return;
      const json = (await res.json()) as { entries: TranscriptEntry[] };
      if (Array.isArray(json.entries) && json.entries.length > 0) {
        this.setState({
          transcripts: { ...this.state.transcripts, [id]: json.entries },
        });
      }
    } catch {
      // best-effort; live `task:entry` events will still populate the chat
    }
  }
}

let _transport: Transport | null = null;

/**
 * Daemon URL inference. The overlay is loaded via `<script src="http://localhost:4747/overlay.js">`
 * by the `<Iris />` React component, so `import.meta.url` is the daemon URL.
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
