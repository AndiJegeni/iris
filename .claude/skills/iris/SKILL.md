---
name: iris
description: Set up Iris in this project — agents you drive by clicking elements in your running app. Use when the user asks to install, add, set up, or try Iris.
---

# Set up Iris

Iris is a localhost daemon that runs coding agents you steer from your own app:
click an element in the browser, describe the change, and an agent edits the
code — optionally in an isolated git worktree with its own preview.

Getting it working takes two things: a `<Iris />` component in the app's root,
and the daemon running beside the dev server.

## Steps

1. **Confirm this is a React project.** Iris needs React 18+ (17 works, less
   reliably). If `package.json` has no `react` dependency, stop and say so —
   there's no non-React path yet.

2. **Run the installer** from the project root:

   ```bash
   npx useiris init -y
   ```

   This finds the root component, adds `<Iris />` as the last child of `<body>`
   (or the outermost returned element), and installs `@andijegeni/iris` with
   whichever package manager the lockfile implies. `-y` skips the confirmation
   prompt, which can't be answered without a terminal.

   It is idempotent — running it on an already-wired project changes nothing.

3. **If it couldn't find a root component**, it exits 1 and prints the manual
   snippet. That happens when the entry isn't one of `app/layout.tsx`,
   `pages/_app.tsx`, `src/main.tsx`, `src/index.tsx`. Find the real root
   yourself, then add:

   ```tsx
   import { Iris } from '@andijegeni/iris';
   ```

   and render `<Iris />` once, as the last child of the outermost element. In a
   Next.js root layout it must go **inside `<body>`** — between `</body>` and
   `</html>` is invalid markup that React won't render. Then install the
   package with the project's package manager.

4. **Tell the user how to start it.** Two terminals:

   ```bash
   npm run dev
   ```

   ```bash
   npx useiris
   ```

   Then open the URL Iris prints (default <http://localhost:4747>).

   Don't start these yourself unless asked — they're long-running, and the
   user's dev server may already be up.

## Notes worth passing on

- **Auth**: no API key needed. In the overlay's Settings, "Connect" signs in
  with a Claude or ChatGPT subscription. An `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` env var also works.
- **Port 4747 may be taken** — it's a common default. `npx useiris --port 4748`
  moves the daemon, but the component must be told as well:
  `<Iris daemonUrl="http://localhost:4748" />`.
- **Worktree mode needs git.** Outside a git repo the toggle is disabled and
  agents edit in place; the startup banner says so.
- **macOS and Linux only** right now. On Windows, Iris refuses to start and
  points at WSL.
- **First run is a big install** — roughly 300 MB, almost all of it the Claude
  Agent SDK's platform executable, which npm fetches whether or not the user
  already has Claude Code. Warn them before they run it on a slow connection.
  The banner's `agent:` line names the binary actually in use.
