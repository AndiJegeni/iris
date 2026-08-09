# Iris

**Agents that live in your tab.** Point at an element in your running app, type what you want, and an agent edits the code — in a git worktree, with a live preview, without leaving the browser.

> ⚠️ Local dev tool. The daemon runs an autonomous agent that **edits your files and runs shell commands**. Run it only on projects you trust, on your own machine. See [Security](#security).

## Quickstart

```bash
npx useiris init
```

That adds `<Iris />` to your root component and installs `@useiris/react` — it shows you the diff and asks before writing anything. Then, with your dev server running:

```bash
npx useiris
```

Open the printed URL (default `http://localhost:4747`), click an element, describe the change, and the agent gets to work.

Using Claude Code or Codex? `npx skills add AndiJegeni/iris`, then `/iris`.

<details>
<summary>Doing it by hand</summary>

```bash
npm i -D @useiris/react
```

```tsx
// app/layout.tsx (or your root component)
import { Iris } from '@useiris/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Iris />
      </body>
    </html>
  );
}
```

In a Next.js root layout `<Iris />` must go **inside `<body>`** — anything between `</body>` and `</html>` is invalid markup React won't render.

</details>

## Signing in

No API key required. Open the overlay's Settings and **Connect** with your Claude or ChatGPT subscription — Iris shells out to the provider's own CLI login and never sees a token. Setting `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` works too, as does `--anthropic-key` / `--openai-key`, though flags are visible in `ps` and shell history.

## What works where

| | |
|---|---|
| **Frameworks** | Any React 18+ app — Next (app + pages router), Vite, CRA. React 17 is best-effort. |
| **OS** | macOS and Linux. **Windows isn't supported** — Iris shells out to POSIX `sh`, and refuses to start rather than fail halfway. Use WSL. |
| **Runtime** | Node ≥ 18 |
| **git** | Needed for worktree mode. Without it the worktree toggle is disabled and agents edit in place. |
| **Backends** | Claude (needs the `claude` CLI for subscription login) · Codex (needs `codex`) · an API key needs neither |
| **Pull requests** | Any git remote works — Iris pushes the branch. With the GitHub CLI (`gh`) installed and signed in it opens the PR too; without it you get a compare link to finish in the browser. No token is stored. |

**The first run downloads ~300 MB.** Almost all of it is the Claude Agent SDK's platform executable, which npm fetches as an optional dependency whether or not you already have Claude Code installed. Subsequent runs are cached. If a matching `claude` is already on your PATH, Iris runs that one instead of the vendored copy — the startup banner's `agent:` line tells you which.

## CLI

| Flag | Default | Description |
|------|---------|-------------|
| `init [-y]` | — | Wire `<Iris />` into your root component and install `@useiris/react`. `-y` skips the prompt (for scripts and agents). |
| `--port <n>` | `4747` | Port for the Iris daemon |
| `--main-port <n>` | `3000` | The port your own dev server runs on |
| `--dev-cmd <cmd>` | inferred | Command to start a dev server inside a worktree. `%PORT%` is substituted. Defaults to your lockfile's package manager. |
| `--anthropic-key <key>` | — | Anthropic API key (overrides `ANTHROPIC_API_KEY`) |
| `--openai-key <key>` | — | OpenAI API key (overrides `OPENAI_API_KEY`) |
| `-h`, `--help` | — | Show help |

**Port 4747 already taken?** Move the daemon *and* tell the component, or they won't find each other:

```bash
npx useiris --port 4748
```
```tsx
<Iris daemonUrl="http://localhost:4748" />
```

## How it works

```
your app (:3000) ── <Iris/> injects the overlay ──┐
                                                   ▼
browser overlay  ──HTTP/WebSocket──►  iris daemon (:4747)
                                          │
                                          ├─ Claude Agent SDK / Codex CLI  (runs the agent)
                                          └─ git worktrees                 (isolates edits + live preview)
```

`<Iris/>` pings the daemon in dev and, if it's up, injects the overlay — a self-contained Preact bundle served from `/overlay.js`, mounted in a shadow root so it can't collide with your styles. It also hands the overlay a handle on React's internal dispatcher, which is how Iris resolves a clicked element back to `file:line` even on Next.js + SWC, where `_debugSource` has been stripped.

When you submit a request the daemon spawns an agent — optionally in a fresh git worktree with its own dev server — streams the transcript back over WebSocket, and lets you ship the result into your
checkout, open a pull request for it, or discard it.

## Security

Iris is a **localhost-only** tool by design:

- The daemon binds to `127.0.0.1` only — it is **not** reachable from your network.
- Cross-origin requests are rejected; only loopback origins may make state-changing calls, over HTTP and WebSocket alike.

Understand the inherent risks before running it:

- The agent runs with broad permissions: it can **read, edit, and write files and run shell commands** in the target directory, with no per-action confirmation.
- Page content the overlay captures (nearby text, source hints) is fed into the agent prompt — point it only at **trusted pages**. Untrusted page content is a prompt-injection vector.
- Prefer **worktree mode** so the agent works in an isolated clone instead of your working tree.
- **"Create PR" publishes whatever the worktree contains.** A worktree is seeded with your
  *uncommitted* changes so the agent sees your work in progress — and opening a PR commits and
  pushes all of it, not just the agent's edits. Check the branch before you push it anywhere
  others can read. "Ship it" is unaffected: it merges locally and never leaves your machine.

See [SECURITY.md](SECURITY.md) for the full threat model and how to report vulnerabilities.

## Development

This is a [Bun](https://bun.sh) workspace monorepo. (Bun is for *developing* Iris; running it needs only Node.)

```bash
bun install
bun run build       # build the publishable packages
bun run dev         # run the daemon from source
bun run typecheck
bun run lint        # biome
```

| Package | Published as | Role |
|---------|--------------|------|
| `packages/cli` | `useiris` | the `npx` daemon (orchestrator + overlay bundled in) |
| `packages/react` | `@useiris/react` | the `<Iris/>` drop-in |
| `packages/overlay` | (bundled) | the Preact overlay UI |
| `packages/orchestrator` | (bundled) | the daemon: server, agents, worktrees |
| `packages/shared` | (bundled) | shared zod protocol |

The npm names are `useiris` / `@useiris/react` because `iris` and `@iris/*` were already taken — the command you type is still `iris` once installed.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Andi Jegeni.

Iris drives two third-party agent tools that are **not** open source and are not covered by this licence:

- **`@anthropic-ai/claude-agent-sdk`** — a runtime dependency, distributed under Anthropic's own SDK terms. It also fetches a platform executable on install (the ~300 MB above).
- **The OpenAI Codex CLI** — optional, used only for the `codex` backend, under OpenAI's terms.

Running Iris means accepting those providers' terms and using your own subscription or API key with them. See the [NOTICE in LICENSE](LICENSE).
