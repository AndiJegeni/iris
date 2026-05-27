import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AuthSource = 'flag' | 'env' | 'config' | 'missing';

export type AuthState = {
  anthropic: string | null;
  openai: string | null;
  source: { anthropic: AuthSource; openai: AuthSource };
};

export type ResolveAuthOptions = {
  repoRoot: string;
  flagAnthropic?: string | undefined;
  flagOpenai?: string | undefined;
};

type ConfigShape = {
  anthropicApiKey?: string;
  openaiApiKey?: string;
};

function readConfig(repoRoot: string): ConfigShape {
  const configPath = join(repoRoot, '.localagents', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as ConfigShape;
    return parsed ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolution chain (first hit wins):
 *   1. CLI flag (--anthropic-key / --openai-key)
 *   2. Environment variable (ANTHROPIC_API_KEY / OPENAI_API_KEY)
 *   3. Repo-local config (.localagents/config.json)
 *   4. Missing — interactive prompt is handled later via WS event
 */
export function resolveAuth(opts: ResolveAuthOptions): AuthState {
  const config = readConfig(opts.repoRoot);

  const anthropic =
    opts.flagAnthropic ?? process.env.ANTHROPIC_API_KEY ?? config.anthropicApiKey ?? null;
  const openai = opts.flagOpenai ?? process.env.OPENAI_API_KEY ?? config.openaiApiKey ?? null;

  const anthropicSource: AuthSource = opts.flagAnthropic
    ? 'flag'
    : process.env.ANTHROPIC_API_KEY
      ? 'env'
      : config.anthropicApiKey
        ? 'config'
        : 'missing';

  const openaiSource: AuthSource = opts.flagOpenai
    ? 'flag'
    : process.env.OPENAI_API_KEY
      ? 'env'
      : config.openaiApiKey
        ? 'config'
        : 'missing';

  return {
    anthropic,
    openai,
    source: { anthropic: anthropicSource, openai: openaiSource },
  };
}
