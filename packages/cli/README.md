# useiris

**Agents that live in your tab.** Point at an element in your running app, type
what you want, and an agent edits the code — in a git worktree, with a live
preview, without leaving the browser.

> ⚠️ Local dev tool. The daemon runs an autonomous agent that **edits your files
> and runs shell commands**. Run it only on projects you trust, on your own
> machine.

```bash
npx useiris init   # wire <Iris /> into your root component
npx useiris        # start the daemon (with your dev server running)
```

Then open <http://localhost:4747>, click an element, and describe the change.

This package is the CLI/daemon. The React component ships separately as
[`@useiris/react`](https://www.npmjs.com/package/@useiris/react).

Requires Node ≥ 18, macOS or Linux. Full docs, security model, and configuration:
**https://github.com/AndiJegeni/iris**

MIT © Andi Jegeni. Drives the Anthropic Claude Agent SDK and (optionally) the
OpenAI Codex CLI, which are not open source and are governed by their own terms.
