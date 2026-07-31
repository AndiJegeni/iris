import { spawnSync } from 'node:child_process';

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether `cmd` resolves on PATH.
 *
 * `command -v` is a shell builtin, so this needs a shell — but the name is
 * passed as an argument (`$1`) rather than interpolated into the script, so a
 * command name can never be read as shell syntax.
 */
export function commandExists(cmd: string): boolean {
  const res = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', cmd], {
    stdio: 'ignore',
  });
  return res.status === 0;
}
