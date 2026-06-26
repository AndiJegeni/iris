#!/usr/bin/env bun
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { VERSION, start } from '@localagents/orchestrator';

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
    `localagents v${VERSION} — overlay-driven coding agents for localhost

Usage:
  localagents [options]

Options:
  --port <number>           Daemon port (default: 4747)
  --main-port <number>      User's main dev server port (default: 3000)
  --dev-cmd <cmd>           Command to spawn dev server in a worktree.
                            %PORT% is substituted. Default: 'bun run dev --port %PORT%'
  --anthropic-key <key>     Anthropic API key (overrides ANTHROPIC_API_KEY env)
  --openai-key <key>        OpenAI API key (overrides OPENAI_API_KEY env)
  -h, --help                Show this message
`,
  );
}

function resolveRepoRoot(cwd: string): string {
  try {
    const out = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8' });
    return out.trim();
  } catch {
    return resolve(cwd);
  }
}

function describeAuth(label: string, method: string, source: string, envName: string): string {
  if (method === 'oauth') return `  ${label.padEnd(8)} subscription login`;
  if (method === 'api-key') return `  ${label.padEnd(8)} API key (${source})`;
  return `  ${label.padEnd(8)} \x1b[33mnot configured\x1b[0m — log in via Settings, set ${envName}, or pass --${label}-key`;
}

async function main(): Promise<void> {
  // Safety net: never let a stray rejection or exception take down the daemon.
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[localagents] unhandled rejection: ${String(reason)}\n`);
  });
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[localagents] uncaught exception: ${String(err)}\n`);
  });

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const repoRoot = resolveRepoRoot(process.cwd());
  const orchestrator = await start({
    repoRoot,
    port: args.port,
    mainPort: args.mainPort,
    devCmd: args.devCmd,
    flagAnthropic: args.anthropic,
    flagOpenai: args.openai,
  });

  process.stdout.write(
    [
      '',
      `  \x1b[1mlocalagents\x1b[0m v${VERSION}`,
      `  repo:     ${repoRoot}`,
      `  port:     ${orchestrator.port}`,
      `  main:     :${orchestrator.mainPort}  (your dev server — keep it running)`,
      describeAuth(
        'claude',
        orchestrator.auth.anthropic.method,
        orchestrator.auth.anthropic.source,
        'ANTHROPIC_API_KEY',
      ),
      describeAuth(
        'codex',
        orchestrator.auth.openai.method,
        orchestrator.auth.openai.source,
        'OPENAI_API_KEY',
      ),
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
  process.stderr.write(`Failed to start localagents: ${String(err)}\n`);
  process.exit(1);
});
