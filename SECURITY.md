# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Use GitHub's [private vulnerability reporting](https://github.com/AndiJegeni/localagents/security/advisories/new), or
- email **andi.jegeni@gmail.com** with a description and reproduction steps.

You'll get an acknowledgement within a few days.

## Threat model

localagents is a **local development tool**. It is not a hardened multi-user
service and must not be exposed to untrusted networks.

### What we protect against

- **Network exposure** — the daemon binds to `127.0.0.1` only and is not
  reachable from the LAN.
- **Cross-site requests** — state-changing requests are rejected unless they
  come from a loopback origin, so a random website you visit cannot drive the
  agent from your browser.

### Inherent risks you accept by running it

- **Autonomous code execution.** The agent can read, edit, and write files and
  run shell commands in the target directory, with no per-action confirmation.
  This is the point of the tool — only run it on projects you trust.
- **Prompt injection.** Text captured from the page (nearby content, source
  hints) is included in the agent prompt. If you point the overlay at a page
  rendering untrusted content, that content can influence the agent. Point it
  only at trusted pages.
- **`--dev-cmd` runs a shell.** The worktree dev command is executed via
  `sh -c`; only pass commands you control.
- **API keys.** Passing `--anthropic-key` / `--openai-key` puts the key in your
  process list and shell history. Prefer environment variables or
  `.localagents/config.json` (which is gitignored).

### Hardening recommendations

- Use **"new worktree"** mode so edits land in an isolated clone, not your
  working tree.
- Keep the daemon port closed to your network (the default bind already does
  this).
- Review changes before shipping a worktree back into your main branch.

## Supported versions

localagents is pre-1.0. Security fixes are applied to the latest released
version only.
