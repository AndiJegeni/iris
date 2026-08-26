# Iris example — Next.js

A minimal Next.js app with the overlay wired in, used to develop Iris against a
real page. The whole integration is two lines in [`app/layout.tsx`](app/layout.tsx):

```tsx
import { Iris } from '@useiris/react';
// …
<Iris />
```

## Running it

See [**Running the example app**](../../CONTRIBUTING.md#running-the-example-app)
in CONTRIBUTING — Iris is two processes (this app, and the daemon), and both
need to be up.

## Notes

- `@useiris/react` resolves through the Bun workspace to `packages/react`, whose
  `exports` point at `dist/`. So `bun run build` at the repo root is required
  before this app will start, and component changes need a rebuild to show up.
- Worktree mode clones the repo, so agents run against a copy of the whole
  monorepo rather than this directory alone.
