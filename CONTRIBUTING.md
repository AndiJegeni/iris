# Contributing to Iris

Thanks for your interest! This is an early-stage project — issues, ideas, and
PRs are all welcome.

## Setup

Iris is a [Bun](https://bun.sh) workspace monorepo.

```bash
git clone https://github.com/AndiJegeni/iris.git
cd iris
bun install
```

## Common tasks

```bash
bun run dev         # run the daemon from source (packages/cli/src/index.ts)
bun run build       # build the publishable packages (useiris + @useiris/react)
bun run typecheck   # tsc, no emit
bun run lint        # biome check
bun run ci          # biome ci (non-mutating, for CI)
bun run format      # biome format --write
```

## Running the example app

Iris is **two processes** — your app, and the daemon that runs the agents — so
both need to be up. First build, because the example resolves `@useiris/react`
through the workspace to its built `dist`:

```bash
bun run build
```

Then, in one terminal, start [`examples/next-app`](examples/next-app) on 3200:

```bash
bun run --cwd examples/next-app dev --port 3200
```

And in another, the daemon pointed at that port:

```bash
bun run dev -- --port 4747 --main-port 3200
```

Open <http://localhost:4747>. Hold **Alt** and click any element (or click the
pill to keep select mode on), describe a change, and the agent edits the source.

Both processes are also defined in [`.claude/launch.json`](.claude/launch.json)
if your editor can run them for you.

## Conventions

- **No source file over 450 lines.** Split large files into focused modules
  (extract subcomponents, hooks, styles, and pure helpers).
- **Biome** for formatting and linting: single quotes, 2-space indent, 100-col
  width, trailing commas, semicolons. Run `bun run format` before committing and
  make sure `bun run lint` and `bun run typecheck` are clean.
- The overlay is **Preact** (`preact` / `preact/hooks`). The daemon and CLI are
  **pure Node** — no Bun runtime APIs in source (`Bun.serve`/`Bun.build`/
  `Bun.spawn` etc.). Bun is only the dev runner and the build orchestrator.

## Architecture

| Package | Published as | Role |
|---------|--------------|------|
| `packages/cli` | `useiris` | the `npx` daemon entry; bundles the rest in at build time |
| `packages/react` | `@useiris/react` | the `<Iris/>` drop-in (tsup → ESM/CJS/d.ts) |
| `packages/overlay` | bundled | the Preact overlay UI (esbuild → `dist/overlay.js`) |
| `packages/orchestrator` | bundled | server (`@hono/node-server` + `ws`), agents, worktrees, auth |
| `packages/shared` | bundled | shared zod protocol |

The CLI build (`packages/cli/build.mjs`) uses esbuild to produce three bundles:
the daemon (`dist/index.js`), the agent worker (`dist/claude-worker.js`), and
the browser overlay (`dist/overlay.js`).

## Gotcha: git worktrees resolve to the main checkout

If you work inside a git worktree, `@iris/*` and the daemon may resolve
to the **main** checkout's `node_modules` rather than the worktree's, which
produces confusing phantom typecheck errors. Run `bun install` inside the
worktree to give it its own `node_modules`.

## Pull requests

- Keep PRs focused and describe the change.
- Make sure `bun run typecheck`, `bun run lint`, and `bun run build` pass.
- By contributing you agree your contributions are licensed under the
  [MIT License](LICENSE).
