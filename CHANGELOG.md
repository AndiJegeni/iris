# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `npx localagents` — pure-Node distribution. The daemon now runs under Node
  (no Bun required at install/run time).
- `@localagents/react` published as a dual ESM/CJS package with type
  declarations.

### Changed
- Ported the orchestrator off Bun: `@hono/node-server` + `ws` replace
  `Bun.serve`; the overlay is prebuilt with esbuild and served statically; the
  agent worker spawns as a Node child process.

### Security
- The daemon now binds to `127.0.0.1` only and rejects cross-origin
  state-changing requests (previously bound to all interfaces with wildcard
  CORS).

## [0.1.0]

- Initial public release.
