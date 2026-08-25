import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  VERSION,
  describeClaudeBinary,
  isGitRepo,
  resolveRemoteName,
  start,
} from '@iris/orchestrator';
import { isWired, runInit } from './init';

/** Kept in sync with the orchestrator's default; used for pre-start messages. */
const DEFAULT_PORT = 4747;

type CliArgs = {
  port?: number;
  mainPort?: number;
  devCmd?: string;
  anthropic?: string;
  openai?: string;
  help: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--port' && next) {
      out.port = Number(next);
      i++;
    } else if (a === '--main-port' && next) {
      out.mainPort = Number(next);
      i++;
    } else if (a === '--dev-cmd' && next) {
      out.devCmd = next;
      i++;
    } else if (a === '--anthropic-key' && next) {
      out.anthropic = next;
      i++;
    } else if (a === '--openai-key' && next) {
      out.openai = next;
      i++;
    } else if (a === '-h' || a === '--help') {
      out.help = true;
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    `iris v${VERSION} — agents that live in your tab

Usage:
  iris                      Start the daemon beside your dev server
  iris init [-y]            Add <Iris /> to your root component and install
                            @useiris/react. -y skips the confirmation.

Options:
  --port <number>           Daemon port (default: 4747)
  --main-port <number>      User's main dev server port (default: 3000)
  --dev-cmd <cmd>           Command to spawn dev server in a worktree.
                            %PORT% is substituted. Default: inferred from your
                            lockfile (npm / pnpm / yarn / bun).
  --anthropic-key <key>     Anthropic API key (overrides one saved in Settings)
  --openai-key <key>        OpenAI API key (overrides one saved in Settings)
  -h, --help                Show this message
`,
  );
}

function resolveRepoRoot(cwd: string): string {
  try {
    // stderr ignored: outside a git repo this prints a "fatal:" line we handle.
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return resolve(cwd);
  }
}

function describeAuth(label: string, method: string, source: string): string {
  if (method === 'oauth') return `  ${label.padEnd(8)} subscription login`;
  if (method === 'api-key') return `  ${label.padEnd(8)} API key (${source})`;
  // Ambient env vars are deliberately not read (see resolveApiKey), so the
  // only remedies to offer are the explicit ones.
  return `  ${label.padEnd(8)} \x1b[33mnot connected\x1b[0m — open Settings → Accounts to log in or add a key`;
}

/**
 * Iris shells out to `sh -c` for dev servers and quotes paths POSIX-style, so
 * Windows would fail partway through a git operation rather than up front.
 * Refuse clearly instead. Tracked for a future port.
 */
function assertSupportedPlatform(): void {
  if (process.platform !== 'win32') return;
  process.stderr.write(
    'iris does not support Windows yet (it shells out to POSIX `sh`).\n' +
      'Run it under WSL: https://learn.microsoft.com/windows/wsl/install\n',
  );
  process.exit(1);
}

/**
 * A port collision is the most likely first-run failure, since 4747 is a
 * common default for tools in this space. Say what to do, including the part
 * people miss: the React component hardcodes 4747, so moving the daemon means
 * telling it too.
 */
function explainStartFailure(err: unknown, port: number): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'EADDRINUSE') {
    const alt = port + 1;
    return [
      `Port ${port} is already in use — something else is listening there.`,
      '',
      `  • use another port:  iris --port ${alt}`,
      `  • and point the component at it:  <Iris daemonUrl="http://localhost:${alt}" />`,
      '',
      `To see what's on it:  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    ].join('\n');
  }
  if (code === 'EACCES') {
    return `Not allowed to bind port ${port}. Ports below 1024 need elevated privileges — pick a higher one with --port.`;
  }
  return `Failed to start iris: ${String(err)}`;
}

async function main(): Promise<void> {
  // Safety net: never let a stray rejection or exception take down the daemon.
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[iris] unhandled rejection: ${String(reason)}\n`);
  });
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[iris] uncaught exception: ${String(err)}\n`);
  });

  assertSupportedPlatform();

  const argv = process.argv.slice(2);

  // Positional subcommand, checked before the flag loop so `iris init` doesn't
  // fall through to starting a daemon.
  if (argv[0] === 'init') {
    // -y is what makes this usable from an agent or a script: without a TTY the
    // confirmation prompt can't be answered, so it declines by default.
    const assumeYes = argv.includes('-y') || argv.includes('--yes');
    const result = await runInit(resolveRepoRoot(process.cwd()), assumeYes);
    process.stdout.write(`${result.message}\n\n`);
    process.exit(result.ok ? 0 : 1);
  }

  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const port = args.port ?? DEFAULT_PORT;
  const repoRoot = resolveRepoRoot(process.cwd());

  let orchestrator: Awaited<ReturnType<typeof start>>;
  try {
    orchestrator = await start({
      repoRoot,
      port: args.port,
      mainPort: args.mainPort,
      devCmd: args.devCmd,
      flagAnthropic: args.anthropic,
      flagOpenai: args.openai,
    });
  } catch (err) {
    process.stderr.write(`\n${explainStartFailure(err, port)}\n\n`);
    process.exit(1);
  }

  const git = isGitRepo(repoRoot);
  const remote = git ? resolveRemoteName(repoRoot) !== null : false;

  process.stdout.write(
    [
      '',
      `  \x1b[1miris\x1b[0m v${VERSION}`,
      `  repo:     ${repoRoot}`,
      `  port:     ${orchestrator.port}`,
      `  main:     :${orchestrator.mainPort}  (your dev server — keep it running)`,
      // Surfaced up front because it's the setting most likely to be wrong for
      // a project whose dev script isn't at the repo root — better to see it
      // now than when the first worktree task fails to boot.
      `  dev cmd:  ${orchestrator.worktrees.devCmd}`,
      `  agent:    ${describeClaudeBinary(orchestrator.claudeBinary)}`,
      ...(git
        ? []
        : ['  \x1b[33mnot a git repo\x1b[0m — worktree mode is off; agents edit in place']),
      // Without this, "Create PR" is simply absent from both UIs with no stated
      // reason — and a missing remote is a one-command fix.
      ...(git && !remote
        ? ['  \x1b[33mno git remote\x1b[0m — worktree tasks can ship, but not open PRs']
        : []),
      describeAuth(
        'claude',
        orchestrator.auth.anthropic.method,
        orchestrator.auth.anthropic.source,
      ),
      describeAuth('codex', orchestrator.auth.openai.method, orchestrator.auth.openai.source),
      ...(isWired(repoRoot)
        ? []
        : [
            '',
            '  \x1b[33mno <Iris /> found\x1b[0m in your root component — run \x1b[1miris init\x1b[0m',
          ]),
      '',
      `  → open \x1b[36mhttp://localhost:${orchestrator.port}\x1b[0m`,
      '',
      '',
    ].join('\n'),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n${signal} received, shutting down…\n`);
    // Deadline, not a wait: if some socket or child refuses to die, exiting
    // with dev servers already stopped beats a daemon that ignores its signal.
    const deadline = setTimeout(() => process.exit(0), 3000);
    deadline.unref?.();
    await orchestrator.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  process.stderr.write(`Failed to start iris: ${String(err)}\n`);
  process.exit(1);
});
