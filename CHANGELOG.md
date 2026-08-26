# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Create PR** — push a worktree's branch to your git remote and open a pull
  request for it, from the task drawer in the overlay or the top bar at
  `localhost:4747`. With the GitHub CLI (`gh`) installed and signed in, Iris
  opens the PR; without it you get a compare link. No token is ever stored.
  Unlike Ship it, the worktree and its dev server survive, so you can keep
  iterating and push again — a second Create PR updates the same PR.
- The overlay's task drawer now has **Ship it** and **Discard** on finished
  rows. Both actions existed, but only in the shell page at `localhost:4747` —
  so anyone working in their own app tab had no way to land an agent's work.

### Changed
- A finished task row in the drawer now ranks its three actions instead of
  showing them at one weight: **Create PR** leads as the filled button, **Merge
  locally** is an outline beside it, and **Discard** is text-only and sits at
  the far right, away from the two that keep the work. The buttons are pills,
  matching the popover's controls, and "View chat" moved up onto the status line
  next to the elapsed time.
- The Background Tasks button moved out of the overlay's floating pill row and
  into the shell's top bar, immediately left of the viewport switcher. The
  drawer is unchanged. Running Iris without the shell (visiting the dev server
  directly) still gets the floating launcher beside the pill.
- The top bar's controls lost their outlines and fills: the tasks button and the
  viewport switcher are now bare label-and-glyph, hovering to full-strength ink.
  The switcher also sizes to the worktree it is showing rather than to the
  longest name in the list.

### Fixed
- The shell's "Ship it" button didn't URL-encode the worktree slug, unlike its
  "Discard" neighbour.
- Every control at `localhost:4747` — the viewport switcher, Ship it, Create PR,
  Discard, the theme sync and the daemon connection — was dead: an escape in the
  Create PR handler emitted a real newline into the page's inline script, leaving
  a string unterminated so the whole script failed to parse. The shell's script
  is now parsed by a test, since nothing else typechecks it.

## [0.1.0]

Initial public release.

### Added
- `npx useiris` — click an element in your running app, describe a change, and
  an agent edits the code, optionally in an isolated git worktree with its own
  live preview.
- `npx useiris init` — wires `<Iris />` into your root component and installs
  `@andijegeni/iris`, showing the diff and asking before it writes.
- `@andijegeni/iris` — the drop-in component, published as a dual ESM/CJS package
  with type declarations. No-op in production.
- Subscription sign-in for both backends: Iris shells out to the provider's own
  CLI login (`claude`, `codex`) and never handles a token itself. API keys work
  too, via env vars, flags, or `.iris/config.json`.
- Pure-Node distribution — the daemon runs under Node ≥ 18, with no Bun
  required to install or run it. (Bun is still used to develop Iris.)

### Security
- The daemon binds to `127.0.0.1` only and rejects cross-origin state-changing
  requests over both HTTP and WebSocket.
- `.iris/config.json` is written `0600` inside a `0700` directory, and the
  directory ships a self-ignoring `.gitignore` so a stored API key cannot be
  committed to the project it lives in.

See [SECURITY.md](SECURITY.md) for the threat model, including the risks you
accept by letting an agent edit files and run commands on your machine.
