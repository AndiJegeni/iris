# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/AndiJegeni/iris/security/advisories/new)
with a description and reproduction steps.

You'll get an acknowledgement within a few days.

## Threat model

Iris is a **local development tool**. It is not a hardened multi-user
service and must not be exposed to untrusted networks.

### What we protect against

- **Network exposure** — the daemon binds to `127.0.0.1` only and is not
  reachable from the LAN.
- **Cross-site requests** — state-changing requests are rejected unless they
  come from a loopback origin, so a random website you visit cannot drive the
  agent from your browser.

### Inherent risks you accept by running it

- **Code execution.** The agent reads, edits, and writes files in the target
  directory freely — that is the point of the tool, so only run it on projects
  you trust. Shell commands (`Bash`) and any network or subagent tool are not
  automatic: each one pauses and asks you to Allow or Deny (with an "Allow for
  this task" option to stop asking for that tool for the rest of the run). File
  edits are not gated. This gating applies to the Claude backend; the Codex
  backend relies on its own CLI sandbox and approval policy.
- **Prompt injection.** Text captured from the page (nearby content, source
  hints) is included in the agent prompt. If you point the overlay at a page
  rendering untrusted content, that content can influence the agent — the
  Allow/Deny prompt on shell and network tools is your backstop, but point it
  only at trusted pages.
- **`--dev-cmd` runs a shell.** The worktree dev command is executed via
  `sh -c`; only pass commands you control.
- **API keys.** Passing `--anthropic-key` / `--openai-key` puts the key in your
  process list and shell history. Prefer saving the key in Settings, which
  writes `.iris/config.json` (gitignored, `0600`). Note Iris deliberately does
  **not** read an ambient `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from your
  shell, so setting one has no effect — this keeps every credential to one you
  handed Iris explicitly and can remove in Settings.

### Hardening recommendations

- Use **"new worktree"** mode so edits land in an isolated clone, not your
  working tree.
- Keep the daemon port closed to your network (the default bind already does
  this).
- Review changes before shipping a worktree back into your main branch.

## Supported versions

Iris is pre-1.0. Security fixes are applied to the latest released
version only.
