# Iris example — Next.js

A minimal Next.js app with the overlay wired in, used to develop Iris against a
real page. The whole integration is two lines in [`app/layout.tsx`](app/layout.tsx):

```tsx
import { Iris } from '@andijegeni/iris';
// …
<Iris />
```

## Running it

Iris is **two processes**: your app, and the daemon that runs the agents. Both
need to be up. From the repo root:

```bash
bun install
```

Then, in one terminal, start the example app on port 3200:

```bash
bun run --cwd examples/next-app dev --port 3200
```

And in another, start the daemon from source, pointed at that port:

```bash
bun packages/cli/src/index.ts --port 4747 --main-port 3200
```

Open <http://localhost:4747>. Hold **Alt** and click any element (or click the
pill to keep select mode on), describe a change, and the agent edits the source.

Both commands are also defined in [`.claude/launch.json`](../../.claude/launch.json)
if your editor can run them for you.

## Notes

- This example resolves `@andijegeni/iris` through the workspace, not npm, so it
  always exercises the local packages — see `transpilePackages` in
  [`next.config.ts`](next.config.ts).
- Worktree mode clones the repo, so agents run against a copy of the whole
  monorepo rather than this directory alone.
