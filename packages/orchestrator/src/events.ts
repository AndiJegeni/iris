import type { Capabilities, Task, Worktree, WsEvent } from '@iris/shared';
import type { WebSocket } from 'ws';

/**
 * Tiny pub/sub for WS clients. The orchestrator broadcasts task and worktree
 * updates to every connected overlay tab. On connect, a 'hello' event ships
 * the current state so a freshly-opened tab is consistent.
 */
export class EventBus {
  private clients = new Set<WebSocket>();

  attach(ws: WebSocket): void {
    this.clients.add(ws);
  }

  detach(ws: WebSocket): void {
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

  sendHello(
    ws: WebSocket,
    worktrees: Worktree[],
    tasks: Task[],
    capabilities: Capabilities,
    bypassPermissions: boolean,
  ): void {
    const hello: WsEvent = { type: 'hello', worktrees, tasks, capabilities, bypassPermissions };
    try {
      ws.send(JSON.stringify(hello));
    } catch {
      // ignore
    }
  }
}
