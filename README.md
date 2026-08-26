# Iris

Iris runs multiple parallel coding agents in your browser. Point at an element in your app, describe what you want, and have an agent edit the code, in a worktree with a live preview, without leaving your tab.

> ⚠️ Local dev tool. The daemon runs autonomous agents that **edit your files and run shell commands**. Run it only on projects you trust, on your own machine. See [Security](#security).

## Quickstart

```bash
npx useiris init
```

That adds `<Iris />` to your root component and installs `@useiris/react`. It shows you the diff and asks before writing anything. Then, with your dev server running:

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

In a Next.js root layout `<Iris />` must go **inside `<body>`**. Anything between `</body>` and `</html>` is invalid markup React won't render.

</details>

## Signing in

No API key required. Open the overlay's Settings and **Connect** with your Claude or ChatGPT subscription. Iris shells out to the provider's own CLI login and never sees a token. To use an API key instead, save it in Settings or pass `--anthropic-key` / `--openai-key` (flags are visible in `ps` and shell history). Iris deliberately **ignores** an ambient `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in your shell, so every credential is one you handed it explicitly and can remove in Settings.

## Landing the work

When an agent finishes in a worktree you get three choices:

| | Merge locally | Create PR | Discard |
|---|---|---|---|
| where it goes | your checkout | your git remote | nowhere |
| needs a remote | no | yes | no |
| worktree after | deleted | **kept running** | deleted |

**Merge locally** merges the agent's branch into whatever you have checked out. Nothing leaves your machine, so it works on a repo you've never pushed. **Create PR** pushes the branch and opens a pull request, and deliberately leaves the worktree alive. A PR is a checkpoint you keep iterating on, and pushing again updates the same PR.

Only the agent's edits are committed. Your uncommitted work is copied into the worktree so the agent sees the code you actually run, but it's excluded from the commit unless the agent changed those files. Your `<Iris />` line and your half-finished work don't ride along into a PR. A file the agent *did* edit is pushed as it stands, though, so glance at the branch before sending it somewhere others can read.

If you and the agent edited the same file, **Merge locally takes the agent's version**. Yours isn't lost: it's stashed first, and `git stash pop` brings it back.

### Connecting GitHub

There's no connect button, and Iris never asks for or stores a GitHub token. It borrows what your machine already has:

- **Pushing** runs `git push` through the remote's *name*, so whatever git already uses for that repo applies. That means your credential helper (macOS Keychain), an SSH key, or a `url.<base>.insteadOf` rewrite.
- **Opening the PR** shells out to the [GitHub CLI](https://cli.github.com) (`gh`), using the login from `gh auth login`.

So if you already use `gh`, it works on the first try with no setup. Starting from scratch:

```bash
brew install gh        # or see cli.github.com
gh auth login
git remote -v          # empty? git remote add origin <url>
```

| What you have | What Create PR does |
|---|---|
| remote + `gh` signed in | pushes the branch and opens the PR |
| remote, no `gh` | pushes the branch, hands you a compare link to finish in the browser |
| no remote | disabled. Use **Merge locally** |

Any git host works for the push; `gh` is what turns it into an actual pull request, so it's GitHub-only.

## What works where

| | |
|---|---|
| **Frameworks** | Any React 18+ app. That covers Next (app + pages router), Vite, and CRA. React 17 is best-effort. |
| **OS** | macOS and Linux. **Windows isn't supported.** Iris shells out to POSIX `sh`, and refuses to start rather than fail halfway. Use WSL. |
| **Runtime** | Node ≥ 18 |
| **git** | Needed for worktree mode. Without it the worktree toggle is disabled and agents edit in place. |
| **Backends** | Claude (needs the `claude` CLI for subscription login) · Codex (needs `codex`) · an API key needs neither |
| **Pull requests** | Any git remote works. Iris pushes the branch. With the GitHub CLI (`gh`) installed and signed in it opens the PR too; without it you get a compare link to finish in the browser. No token is stored. See [Connecting GitHub](#connecting-github). |

**The first run downloads ~300 MB.** Almost all of it is the Claude Agent SDK's platform executable, which npm fetches as an optional dependency whether or not you already have Claude Code installed. Subsequent runs are cached. If a matching `claude` is already on your PATH, Iris runs that one instead of the vendored copy. The startup banner's `agent:` line tells you which.

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

`<Iris/>` pings the daemon in dev and, if it's up, injects the overlay. It's a self-contained Preact bundle served from `/overlay.js`, mounted in a shadow root so it can't collide with your styles. It also hands the overlay a handle on React's internal dispatcher, which is how Iris resolves a clicked element back to `file:line` even on Next.js + SWC, where `_debugSource` has been stripped.

When you submit a request the daemon spawns an agent, optionally in a fresh git worktree with its own dev server. It streams the transcript back over WebSocket, and lets you merge the result into your
checkout, open a pull request for it, or discard it. See [Landing the work](#landing-the-work).

## Security

Iris is a **localhost-only** tool by design: the daemon binds to `127.0.0.1` and rejects cross-origin state-changing requests, over HTTP and WebSocket alike. A random website you visit can't drive the agent from your browser.

Understand the inherent risks before running it:

- The agent can **read, edit, and write files** in the target directory freely. **Running a shell command (`Bash`), and any network or subagent tool, pauses and asks you to Allow or Deny first.** "Allow for this task" stops it asking again for that tool for the rest of the run. File edits are not gated, since editing your code is the point.
- Page content the overlay captures (nearby text, source hints) is fed into the agent prompt. Point it only at **trusted pages**. Untrusted page content is a prompt-injection vector, though the shell-command prompt above is your backstop against it.
- Prefer **worktree mode** so the agent works in an isolated clone instead of your working tree. Landing that work has its own caveats. See [Landing the work](#landing-the-work).
- Worktree mode creates a sibling `../.iris-worktrees/` directory next to your repo (a local `git clone`), so Iris writes just outside the project folder, not only inside it.

See [SECURITY.md](SECURITY.md) for the full threat model and how to report vulnerabilities.

## Development

This is a [Bun](https://bun.sh) workspace monorepo. (Bun is for *developing* Iris; running it needs only Node.) `packages/cli` publishes as `useiris` and `packages/react` as `@useiris/react`. The overlay, orchestrator, and shared protocol are bundled into the CLI at build time.

The npm names are `useiris` / `@useiris/react` because `iris` and `@iris/*` were already taken. The command you type is still `iris` once installed.

Setup, commands, conventions, and the full package layout: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## License

[MIT](LICENSE) © Andi Jegeni.

Iris drives two third-party agent tools that are **not** open source and are not covered by this licence:

- **`@anthropic-ai/claude-agent-sdk`.** A runtime dependency, distributed under Anthropic's own SDK terms. It also fetches a platform executable on install (the ~300 MB above).
- **The OpenAI Codex CLI.** Optional, used only for the `codex` backend, under OpenAI's terms.

Running Iris means accepting those providers' terms and using your own subscription or API key with them. See the [NOTICE in LICENSE](LICENSE).
