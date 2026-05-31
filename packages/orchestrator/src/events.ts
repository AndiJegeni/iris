import type { Task, Worktree, WsEvent } from '@localagents/shared';
import type { ServerWebSocket } from 'bun';

export type WsClientData = { id: string };

/**
 * Tiny pub/sub for WS clients. The orchestrator broadcasts task and worktree
 * updates to every connected overlay tab. On connect, a 'hello' event ships
 * the current state so a freshly-opened tab is consistent.
 */
export class EventBus {
  private clients = new Set<ServerWebSocket<WsClientData>>();

  attach(ws: ServerWebSocket<WsClientData>): void {
    this.clients.add(ws);
  }

  detach(ws: ServerWebSocket<WsClientData>): void {
    this.clients.delete(ws);
  }

  broadcast(event: WsEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      try {
        ws.send(payload);
      } catch {
        // socket already closed; ignore
      }
    }
  }

  sendHello(ws: ServerWebSocket<WsClientData>, worktrees: Worktree[], tasks: Task[]): void {
    const hello: WsEvent = { type: 'hello', worktrees, tasks };
    try {
      ws.send(JSON.stringify(hello));
    } catch {
      // ignore
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
