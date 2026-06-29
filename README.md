# localagents

**Overlay-driven local coding agents.** Point at an element in your running app, type what you want, and an agent edits the code — in a git worktree, with a live preview, without leaving the browser.

> ⚠️ Local dev tool. The daemon runs an autonomous agent that **edits your files and runs shell commands**. Run it only on projects you trust, on your own machine. See [Security](#security).

<!-- TODO: add docs/demo.gif -->

## Quickstart

```bash
# 1. add the overlay to your React/Next app (dev-only, no-op in production)
npm install -D @localagents/react
```

```tsx
// app/layout.tsx (or your root component)
import { LocalAgents } from '@localagents/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <LocalAgents />
      </body>
    </html>
  );
}
```

```bash
# 2. start your dev server as usual, then in another terminal:
export ANTHROPIC_API_KEY=sk-ant-...
npx localagents --main-port 3000
```

Open the printed URL (default `http://localhost:4747`), click an element, describe the change, and the agent gets to work.

## Prerequisites

- **Node.js ≥ 18** (that's it — no Bun required to run it)
- A **running dev server** for your app (Next.js, Vite, CRA, …)
- An **API key** for at least one backend:
  - Anthropic — `ANTHROPIC_API_KEY` (the `claude` backend, default)
  - OpenAI — `OPENAI_API_KEY` + the [`codex`](https://github.com/openai/codex) CLI (the `codex` backend)
- A **git repository** (worktree isolation uses git; the basic flow works without it)

## CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | `4747` | Port for the localagents daemon |
| `--main-port <n>` | `3000` | The port your own dev server runs on |
| `--dev-cmd <cmd>` | `bun run dev --port %PORT%` | Command to start a dev server inside a worktree. `%PORT%` is substituted. e.g. `npm run dev -- --port %PORT%` |
| `--anthropic-key <key>` | — | Anthropic API key (overrides `ANTHROPIC_API_KEY`) |
| `--openai-key <key>` | — | OpenAI API key (overrides `OPENAI_API_KEY`) |
| `-h`, `--help` | — | Show help |

**Auth resolution** (first hit wins): CLI flag → environment variable → `.localagents/config.json` in your repo (gitignored). Prefer the env var or config file — keys passed as flags are visible in `ps` and shell history.

## How it works

```
your app (:3000) ── <LocalAgents/> injects the overlay ──┐
                                                          ▼
browser overlay  ──HTTP/WebSocket──►  localagents daemon (:4747)
                                          │
                                          ├─ Claude Agent SDK / Codex CLI  (runs the agent)
                                          └─ git worktrees                 (isolates edits + live preview)
```

The `<LocalAgents/>` component pings the daemon in dev and, if it's up, injects the overlay (a self-contained Preact bundle served from `/overlay.js`). When you submit a request, the daemon spawns an agent — optionally in a fresh git worktree with its own dev server — streams the transcript back over WebSocket, and lets you ship or discard the result.

## Supported frameworks

Any React 18+ app. The `<LocalAgents/>` drop-in is tested with **Next.js** and works anywhere React renders. See [`examples/next-app`](examples/next-app).

## Security

localagents is a **localhost-only** tool by design:

- The daemon binds to `127.0.0.1` only — it is **not** reachable from your network.
- Cross-origin requests from other websites are rejected (only loopback origins are allowed).

Understand the inherent risks before running it:

- The agent runs with broad permissions: it can **read, edit, and write files and run shell commands** in the target directory, with no per-action confirmation.
- Page content the overlay captures (nearby text, source hints) is fed into the agent prompt — point it only at **trusted pages** (untrusted page content is a prompt-injection vector).
- Prefer **"new worktree"** mode so the agent works in an isolated clone instead of your working tree.

See [SECURITY.md](SECURITY.md) for the full threat model and how to report vulnerabilities.

## Development

This is a [Bun](https://bun.sh) workspace monorepo.

```bash
bun install
bun run build       # build the publishable packages (localagents + @localagents/react)
bun run dev         # run the daemon from source
bun run typecheck
bun run lint        # biome
```

| Package | Published as | Role |
|---------|--------------|------|
| `packages/cli` | `localagents` | the `npx` daemon (orchestrator + overlay bundled in) |
| `packages/react` | `@localagents/react` | the `<LocalAgents/>` drop-in |
| `packages/overlay` | (bundled) | the Preact overlay UI |
| `packages/orchestrator` | (bundled) | the daemon: server, agents, worktrees |
| `packages/shared` | (bundled) | shared zod protocol |

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Andi Jegeni. Uses the Anthropic Claude Agent SDK and (optionally) the OpenAI Codex CLI, which are governed by their own licenses and require your own API keys.
