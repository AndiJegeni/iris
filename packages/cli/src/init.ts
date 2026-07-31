import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { addDevDepCmd, detectPackageManager } from '@iris/orchestrator';

const PKG = '@useiris/react';

/**
 * Root components we know how to wire, most specific first. `<Iris />` goes
 * inside the outermost element that wraps the app's children, so the overlay
 * mounts once for every route.
 */
const ROOT_CANDIDATES = [
  'app/layout.tsx',
  'app/layout.jsx',
  'src/app/layout.tsx',
  'src/app/layout.jsx',
  'pages/_app.tsx',
  'pages/_app.jsx',
  'src/pages/_app.tsx',
  'src/pages/_app.jsx',
  'src/main.tsx',
  'src/main.jsx',
  'src/index.tsx',
  'src/index.jsx',
];

const MANUAL_SNIPPET = `  import { Iris } from '${PKG}';

  // …then render it once, inside your root component:
  <Iris />`;

export type InitResult = { ok: boolean; message: string };

function findRoot(repoRoot: string): string | null {
  for (const rel of ROOT_CANDIDATES) {
    if (existsSync(join(repoRoot, rel))) return rel;
  }
  return null;
}

/**
 * Whether the project's root component already renders `<Iris />`. Used to
 * point an unwired project at `iris init` instead of leaving the user with a
 * running daemon and an overlay that never appears.
 *
 * Only inspects the root component: someone rendering `<Iris />` from a nested
 * component is off the happy path, and a false "not wired" hint is cheaper than
 * scanning the tree on every start.
 */
export function isWired(repoRoot: string): boolean {
  const rel = findRoot(repoRoot);
  if (!rel) return true; // unknown layout — don't nag about something we can't verify
  try {
    return /<Iris\b/.test(readFileSync(join(repoRoot, rel), 'utf8'));
  } catch {
    return true;
  }
}

/**
 * Insert `<Iris />` as the last child of the outermost JSX element returned by
 * the file's default export.
 *
 * Deliberately textual rather than AST-based: pulling in a parser for one
 * insertion is a poor trade, and anything this can't confidently place falls
 * back to printing the snippet. A wrong guess here edits someone's layout file.
 */
function wire(src: string): { next: string; note: string } | null {
  if (/<Iris\b/.test(src)) return null; // already wired

  // Prefer inside <body>: in a Next.js root layout the outermost element is
  // <html>, and anything placed between </body> and </html> is invalid markup
  // that React refuses to render. Otherwise use the outermost returned element
  // (Vite's <React.StrictMode>, a pages-router wrapper, …).
  let tag: string;
  let closeIdx = src.lastIndexOf('</body>');
  if (closeIdx >= 0) {
    tag = 'body';
  } else {
    const match = src.match(/<\/([A-Za-z][\w.]*)>\s*\)?;?\s*}?\s*$/);
    if (!match?.[1]) return null;
    tag = match[1];
    closeIdx = src.lastIndexOf(`</${tag}>`);
    if (closeIdx < 0) return null;
  }

  // Indent to match the closing tag's line, one level deeper. When that line
  // also holds the opening tag (`<body>{children}</body>`), break it up rather
  // than appending inline.
  const lineStart = src.lastIndexOf('\n', closeIdx) + 1;
  const beforeClose = src.slice(lineStart, closeIdx);
  const indent = beforeClose.match(/^\s*/)?.[0] ?? '';
  const inline = beforeClose.trim() !== '';

  let next = inline
    ? `${src.slice(0, closeIdx)}\n${indent}  <Iris />\n${indent}${src.slice(closeIdx)}`
    : `${src.slice(0, lineStart)}${indent}  <Iris />\n${indent}${src.slice(closeIdx)}`;

  // Import goes right after the last existing one. The pattern deliberately
  // stops at the statement's end — matching trailing whitespace too would push
  // the insertion past the blank line that separates imports from code.
  const imports = [...next.matchAll(/^import .*$/gm)];
  const importLine = `import { Iris } from '${PKG}';`;
  const last = imports.at(-1);
  if (last) {
    const at = (last.index ?? 0) + last[0].length;
    next = `${next.slice(0, at)}\n${importLine}${next.slice(at)}`;
  } else {
    next = `${importLine}\n${next}`;
  }

  return { next, note: `<${tag}>` };
}

function confirm(question: string): Promise<boolean> {
  // Non-interactive (CI, piped stdin): don't hang waiting on a human.
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(`${question} [Y/n] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolveAnswer(a === '' || a === 'y' || a === 'yes');
    });
  });
}

type DiffLine = { kind: ' ' | '+' | '-'; text: string };

/**
 * Longest-common-subsequence diff. Worth the O(n·m) table over a greedy
 * line-by-line walk: the codemod reflows a line (`<body>{children}</body>` into
 * three), and a greedy diff loses sync there and reports untouched lines as
 * additions. This preview is what the user approves, so it has to be accurate.
 * Root components are small; the cost is irrelevant.
 */
function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  // Flat (n+1)×(m+1) table: `lcs[i][j]` as a single indexed buffer.
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  const at = (i: number, j: number): number => lcs[i * w + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: ' ', text: before[i] as string });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ kind: '-', text: before[i] as string });
      i++;
    } else {
      out.push({ kind: '+', text: after[j] as string });
      j++;
    }
  }
  while (i < n) out.push({ kind: '-', text: before[i++] as string });
  while (j < m) out.push({ kind: '+', text: after[j++] as string });
  return out;
}

const DIFF_CONTEXT = 2;

function diffPreview(rel: string, before: string, after: string): string {
  const lines = diffLines(before.split('\n'), after.split('\n'));

  // Keep only changed lines and DIFF_CONTEXT unchanged lines around them.
  const keep = new Set<number>();
  lines.forEach((l, idx) => {
    if (l.kind === ' ') return;
    for (let k = idx - DIFF_CONTEXT; k <= idx + DIFF_CONTEXT; k++) {
      if (k >= 0 && k < lines.length) keep.add(k);
    }
  });

  const out: string[] = [`\n  \x1b[1m${rel}\x1b[0m`];
  let skipped = false;
  lines.forEach((l, idx) => {
    if (!keep.has(idx)) {
      if (!skipped) out.push('  \x1b[2m…\x1b[0m');
      skipped = true;
      return;
    }
    skipped = false;
    if (l.kind === '+') out.push(`  \x1b[32m+ ${l.text}\x1b[0m`);
    else if (l.kind === '-') out.push(`  \x1b[31m- ${l.text}\x1b[0m`);
    else out.push(`    ${l.text}`);
  });
  return out.join('\n');
}

/**
 * Wire `<Iris />` into the project's root component and install the package.
 * Idempotent: re-running on a wired project reports that and changes nothing.
 */
export async function runInit(repoRoot: string, assumeYes = false): Promise<InitResult> {
  const rel = findRoot(repoRoot);
  if (!rel) {
    return {
      ok: false,
      message: [
        "Couldn't find a root component to wire (looked for app/layout.tsx,",
        'pages/_app.tsx, src/main.tsx, src/index.tsx).',
        '',
        `Install it yourself with:  npm i -D ${PKG}`,
        '',
        MANUAL_SNIPPET,
      ].join('\n'),
    };
  }

  const abs = join(repoRoot, rel);
  const src = readFileSync(abs, 'utf8');
  const wired = wire(src);

  if (!wired) {
    if (/<Iris\b/.test(src)) {
      return { ok: true, message: `Already wired — <Iris /> is in ${rel}. Run \`iris\` to start.` };
    }
    return {
      ok: false,
      message: [
        `Found ${rel}, but couldn't place <Iris /> confidently, so nothing was changed.`,
        '',
        `Install it yourself with:  npm i -D ${PKG}`,
        '',
        MANUAL_SNIPPET,
      ].join('\n'),
    };
  }

  process.stdout.write(`\n  Add \x1b[1m<Iris />\x1b[0m to ${rel} and install ${PKG}.\n`);
  process.stdout.write(diffPreview(rel, src, wired.next));
  process.stdout.write('\n\n');

  if (!assumeYes && !(await confirm('  Apply?'))) {
    return {
      ok: false,
      message: [
        'Nothing changed.',
        '',
        `To do it by hand:  npm i -D ${PKG}`,
        '',
        MANUAL_SNIPPET,
      ].join('\n'),
    };
  }

  writeFileSync(abs, wired.next);

  const pm = detectPackageManager(repoRoot);
  const [cmd, args] = addDevDepCmd(pm, PKG);
  process.stdout.write(`\n  ${cmd} ${args.join(' ')}\n`);
  const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' });

  if (res.status !== 0) {
    return {
      ok: false,
      message: [
        `Wired ${relative(process.cwd(), abs) || rel}, but \`${cmd} ${args.join(' ')}\` failed.`,
        'Install it yourself, then run `iris`.',
      ].join('\n'),
    };
  }

  return { ok: true, message: '\n  Done. Start your dev server, then run `iris`.' };
}
