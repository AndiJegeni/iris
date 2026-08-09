# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The Background Tasks button moved out of the overlay's floating pill row and
  into the shell's top bar, immediately left of the viewport switcher. The
  drawer is unchanged. Running Iris without the shell (visiting the dev server
  directly) still gets the floating launcher beside the pill.

## [0.1.0]

Initial public release.

### Added
- `npx useiris` — click an element in your running app, describe a change, and
  an agent edits the code, optionally in an isolated git worktree with its own
  live preview.
- `npx useiris init` — wires `<Iris />` into your root component and installs
  `@useiris/react`, showing the diff and asking before it writes.
- `@useiris/react` — the drop-in component, published as a dual ESM/CJS package
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
