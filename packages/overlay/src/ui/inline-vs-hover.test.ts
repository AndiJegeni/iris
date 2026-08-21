import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The overlay renders into a shadow root and writes almost all of its styling as
 * inline `style` objects, keeping only state changes — `:hover`, `:disabled` — in
 * `<style>` rules. Those two are not equals: an inline declaration outranks every
 * stylesheet rule short of `!important`, so the moment an element names a
 * property inline that its own class also drives, the rule is dead. It still
 * parses, it still shows up in `document.styleSheets`, `matches(':hover')` still
 * returns true — it simply never paints.
 *
 * That has been shipped and silently broken six times: the tab bar's icons, the
 * task launcher, the drawer's Clear button, the composer's Stop, the settings
 * rows, and twice as a `transition` that quietly dropped the fade off a hover
 * that was otherwise working. Nothing about the symptom points at the cause, so
 * this is a check rather than a convention.
 *
 * The rule enforced here is one step broader than "a :hover that can't win":
 * once a class carries any state rule, that class owns every property it
 * declares — base and state alike — and an element wearing it may not name those
 * properties inline. The broader form is what catches the `transition` variant,
 * where the hover fires but has no timing left.
 *
 * WHAT IT DOES NOT CATCH, honestly:
 *  - Conditional inline declarations (`...(selected ? { background } : null)`).
 *    Those are the codebase's deliberate way of pinning a state over a class —
 *    see MenuRow in model-picker — so they are skipped, and a genuine bug hiding
 *    behind a ternary is skipped with them. Precision over recall: a check that
 *    cries wolf gets deleted.
 *  - Style objects assembled at runtime (`Object.assign`, a value read from
 *    state) rather than written as an object literal or a factory call.
 *  - Classes or styles reaching an element through anything but a literal
 *    `className` / `style` attribute in the same JSX tag.
 *  - The shell's `el.style.display = …` assignments in its inline script; only
 *    its static `style="…"` attributes are read.
 * Style *values* are never compared — the check asks who declares a property,
 * not what they set it to.
 */

// ---------- source text ----------

/** Every file the overlay paints from, plus the orchestrator shell's two. */
function sourceFiles(): { path: string; name: string; text: string }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(join(import.meta.dir, '..'));
  const shell = join(import.meta.dir, '..', '..', '..', 'orchestrator', 'src');
  files.push(join(shell, 'shell-css.ts'), join(shell, 'shell-html.ts'));
  return files.map((path) => ({
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    text: readFileSync(path, 'utf8'),
  }));
}

// ---------- a very small source scanner ----------

/**
 * Past a string, template literal or comment starting at `i` — or `i` itself if
 * nothing starts there. Everything below walks source with this so a brace or a
 * comma inside a string can't be mistaken for structure.
 *
 * Regex literals are not recognised (they read as division); none of the style
 * expressions or JSX tags this walks contain one.
 */
function skipAtomic(src: string, i: number): number {
  const c = src[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') j += 2;
      else if (src[j] === c) return j + 1;
      else j++;
    }
    return j;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') j += 2;
      else if (src[j] === '`') return j + 1;
      else if (src[j] === '$' && src[j + 1] === '{') j = matchBracket(src, j + 1) + 1;
      else j++;
    }
    return j;
  }
  if (c === '/' && src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? src.length : nl;
  }
  if (c === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  return i;
}

const CLOSERS: Record<string, string> = { '{': '}', '(': ')', '[': ']' };

/** Index of the bracket closing the one at `open`. */
function matchBracket(src: string, open: number): number {
  const opener = src[open] as string;
  const closer = CLOSERS[opener] as string;
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const next = skipAtomic(src, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (src[i] === opener) depth++;
    else if (src[i] === closer && --depth === 0) return i;
    i++;
  }
  return src.length - 1;
}

/** Split on `sep`, ignoring separators nested in brackets or strings. */
function splitTopLevel(body: string, sep: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const next = skipAtomic(body, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = body[i] as string;
    if (c in CLOSERS) {
      i = matchBracket(body, i) + 1;
      continue;
    }
    if (c === sep) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** First unnested occurrence of a single character, or -1. */
function indexOfTopLevel(body: string, ch: string): number {
  let i = 0;
  while (i < body.length) {
    const next = skipAtomic(body, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = body[i] as string;
    if (c in CLOSERS) {
      i = matchBracket(body, i) + 1;
      continue;
    }
    if (c === ch) return i;
    i++;
  }
  return -1;
}

/**
 * Whether the expression's *outermost* level is a choice — `a ? b : c`, `a && b`,
 * `a ?? b`. A conditional declaration is a deliberate override of a class rather
 * than an accident, so the scan stops here (see the header).
 */
function isConditional(expr: string): boolean {
  let i = 0;
  while (i < expr.length) {
    const next = skipAtomic(expr, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = expr[i] as string;
    if (c in CLOSERS) {
      i = matchBracket(expr, i) + 1;
      continue;
    }
    if (c === '?' && expr[i + 1] !== '.') return true;
    if ((c === '&' || c === '|') && expr[i + 1] === c) return true;
    i++;
  }
  return false;
}

// ---------- CSS rules ----------

/** Pseudo-classes that describe a *state* — the ones an inline style kills. */
const STATE_PSEUDOS = new Set([
  'hover',
  'focus',
  'focus-visible',
  'focus-within',
  'active',
  'disabled',
  'checked',
]);

/** `.name`, then any number of `:pseudo` / `:pseudo(...)` / `::element`. */
const SELECTOR = String.raw`\.[A-Za-z][\w-]*(?::{1,2}[\w-]+(?:\([^)]*\))?)*`;
const RULE_RE = new RegExp(`(${SELECTOR}(?:\\s*,\\s*${SELECTOR})*)\\s*\\{([^{}]*)\\}`, 'g');

/**
 * Everything a class declares, and whether any of its rules is a state rule.
 *
 * The CSS lives inside template literals with `${…}` holes in it, so the holes
 * are punched out first: only selectors and property names matter here, never
 * values, and a hole could otherwise carry a stray `;`.
 */
type ClassRules = { props: Set<string>; stateful: boolean };

function cssClasses(src: string): Map<string, ClassRules> {
  const text = stripInterpolations(src);
  const found = new Map<string, ClassRules>();
  for (const m of text.matchAll(RULE_RE)) {
    const props = declaredProps(m[2] as string);
    if (props.size === 0) continue;
    for (const selector of (m[1] as string).split(',')) {
      const parts = selector.trim().match(/^\.([\w-]+)((?::{1,2}[\w-]+(?:\([^)]*\))?)*)$/);
      if (!parts) continue;
      const name = parts[1] as string;
      const stateful = [...(parts[2] as string).matchAll(/(?<!:):([\w-]+)/g)].some((p) =>
        STATE_PSEUDOS.has(p[1] as string),
      );
      const entry = found.get(name) ?? { props: new Set<string>(), stateful: false };
      for (const p of props) entry.props.add(p);
      entry.stateful ||= stateful;
      found.set(name, entry);
    }
  }
  return found;
}

/** Replace every `${…}` with a placeholder so holes can't break the CSS parse. */
function stripInterpolations(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '$' && src[i + 1] === '{') {
      i = matchBracket(src, i + 1);
      out += 'V';
    } else out += src[i];
  }
  return out;
}

/** Property names declared in a rule body. Anything unparseable is ignored. */
function declaredProps(block: string): Set<string> {
  const props = new Set<string>();
  for (const decl of block.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim();
    if (/^(?:--)?[a-z][\w-]*$/.test(name)) props.add(name);
  }
  return props;
}

// ---------- inline style objects ----------

/**
 * Shorthands, mapped to the longhands they also set. `border` is here because
 * the worktree pill's hover is a `border-color` rule and an inline `border`
 * would silently outrank it; `transition` because a rule's timing loses to any
 * inline one, which is how two hovers ended up firing with no fade at all.
 */
const LONGHANDS: Record<string, string[]> = {
  background: ['background-color', 'background-image'],
  border: ['border-color', 'border-width', 'border-style'],
  outline: ['outline-color', 'outline-width', 'outline-style'],
  font: ['font-family', 'font-size', 'font-weight', 'line-height'],
  transition: ['transition-property', 'transition-duration'],
  animation: ['animation-name', 'animation-duration'],
};

function conflicts(a: string, b: string): boolean {
  if (a === b) return true;
  return (LONGHANDS[a] ?? []).includes(b) || (LONGHANDS[b] ?? []).includes(a);
}

/** `marginLeft` → `margin-left`; custom properties pass through untouched. */
function kebab(prop: string): string {
  return prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

type Ctx = { file: { path: string; name: string; text: string }; all: typeof FILES };

/**
 * Every property a style expression declares unconditionally.
 *
 * Resolves object literals, spreads, and identifiers — a `const` in the same
 * file, one imported from a sibling module, or a value handed in as a JSX prop.
 * That last hop is what reaches `launcherStyle`, which is written in overlay.tsx
 * and worn by a button in task-panel.tsx. Anything it can't follow contributes
 * nothing, which is the safe direction: this check reports only what it is sure
 * of.
 */
function inlineProps(expr: string, ctx: Ctx, seen: Set<string> = new Set()): Set<string> {
  const props = new Set<string>();
  const text = stripCast(expr.trim());
  if (text === '' || seen.size > 8 || isConditional(text)) return props;

  if (text.startsWith('(') && matchBracket(text, 0) === text.length - 1) {
    return inlineProps(text.slice(1, -1), ctx, seen);
  }

  if (text.startsWith('{')) {
    for (const entry of splitTopLevel(text.slice(1, matchBracket(text, 0)), ',')) {
      if (entry.startsWith('...')) {
        for (const p of inlineProps(entry.slice(3), ctx, seen)) props.add(p);
        continue;
      }
      const colon = indexOfTopLevel(entry, ':');
      const key = (colon < 0 ? entry : entry.slice(0, colon)).trim().replace(/^['"]|['"]$/g, '');
      if (/^(?:--)?[A-Za-z_$][\w$-]*$/.test(key)) props.add(kebab(key));
    }
    return props;
  }

  const name = text.match(/^([A-Za-z_$][\w$]*)/)?.[1];
  if (!name) return props;
  for (const [file, init] of definitionsOf(name, ctx)) {
    const key = `${file.path}#${name}`;
    if (seen.has(key)) continue;
    for (const p of inlineProps(arrowBody(init), { ...ctx, file }, new Set([...seen, key]))) {
      props.add(p);
    }
  }
  return props;
}

/** Drop a trailing `as const` / `as SomeType`. */
function stripCast(expr: string): string {
  return expr.replace(/\s+as\s+[\w.<>[\]| ]+$/, '').trim();
}

/** An arrow function's expression body, or the expression itself. */
function arrowBody(init: string): string {
  let i = 0;
  while (i < init.length) {
    const next = skipAtomic(init, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = init[i] as string;
    if (c in CLOSERS) {
      i = matchBracket(init, i) + 1;
      continue;
    }
    if (c === '=' && init[i + 1] === '>') return init.slice(i + 2);
    i++;
  }
  return init;
}

/** Where `name` might come from: a local const, an import, or a JSX prop. */
function definitionsOf(name: string, ctx: Ctx): [Ctx['file'], string][] {
  const local = constInitializer(ctx.file.text, name);
  if (local != null) return [[ctx.file, local]];

  const from = ctx.file.text.match(
    new RegExp(String.raw`import\s*\{[^}]*\b${name}\b[^}]*\}\s*from\s*'(\.[^']+)'`),
  )?.[1];
  if (from != null) {
    const dir = ctx.file.path.slice(0, ctx.file.path.lastIndexOf('/'));
    const base = join(dir, from);
    const target = ctx.all.find((f) => f.path === `${base}.ts` || f.path === `${base}.tsx`);
    const init = target && constInitializer(target.text, name);
    if (target && init != null) return [[target, init]];
  }

  // Handed in as a prop: find everywhere `name={…}` is passed and take all of them.
  const out: [Ctx['file'], string][] = [];
  for (const file of ctx.all) {
    for (const m of file.text.matchAll(new RegExp(String.raw`(?<![\w.])${name}=\{`, 'g'))) {
      const open = (m.index as number) + m[0].length - 1;
      out.push([file, file.text.slice(open + 1, matchBracket(file.text, open))]);
    }
  }
  return out;
}

/** The initializer text of `const <name> = …`, up to its statement's end. */
function constInitializer(text: string, name: string): string | null {
  const m = new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?const\s+${name}\s*(?::[^=]*?)?=`).exec(
    text,
  );
  if (!m) return null;
  const start = m.index + m[0].length;
  let i = start;
  while (i < text.length) {
    const next = skipAtomic(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = text[i] as string;
    if (c in CLOSERS) {
      i = matchBracket(text, i) + 1;
      continue;
    }
    if (c === ';') break;
    i++;
  }
  return text.slice(start, i);
}

// ---------- elements ----------

/** One styled element: the classes it wears and the style expression it carries. */
type Element = { classes: string[]; style: string };

/**
 * Every JSX tag with both a `className` and a `style`, plus the shell's static
 * HTML tags with both a `class` and a `style` attribute.
 */
function styledElements(src: string): Element[] {
  const out: Element[] = [];
  for (const m of src.matchAll(/<[A-Za-z][\w.]*/g)) {
    const attrs = tagAttributes(src, m.index as number);
    if (attrs == null) continue;
    const classes = classNames(attrs);
    const style = styleExpression(attrs);
    if (classes.length > 0 && style != null) out.push({ classes, style });
  }
  return out;
}

/** Text of one opening tag's attribute list, or null if it doesn't close cleanly. */
function tagAttributes(src: string, start: number): string | null {
  let i = start + 1;
  while (i < src.length) {
    const next = skipAtomic(src, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = src[i] as string;
    if (c in CLOSERS) {
      i = matchBracket(src, i) + 1;
      continue;
    }
    // A bare `<` at this level means we were never inside a tag (JS comparison
    // in the shell's inline script, say) — bail rather than run away.
    if (c === '<' && i > start) return null;
    if (c === '>') return src.slice(start, i);
    i++;
  }
  return null;
}

/**
 * Class names in a tag. An expression form (`className={a ? 'x' : 'y'}`) yields
 * every literal it mentions — over-broad by design, since the properties it is
 * matched against are only ever unconditional ones.
 */
function classNames(attrs: string): string[] {
  const literal = attrs.match(/\bclass(?:Name)?\s*=\s*"([^"]*)"/);
  if (literal) return (literal[1] as string).split(/\s+/).filter(Boolean);
  const expr = attributeExpression(attrs, 'className');
  if (expr == null) return [];
  return [...expr.matchAll(/'([^']*)'|"([^"]*)"/g)]
    .flatMap((m) => (m[1] ?? m[2] ?? '').split(/\s+/))
    .filter(Boolean);
}

function styleExpression(attrs: string): string | null {
  const literal = attrs.match(/\bstyle\s*=\s*"([^"]*)"/);
  if (literal) {
    // An HTML `style="a: 1; b: 2"` attribute — same shape as a rule body.
    return `{${[...declaredProps(literal[1] as string)].map((p) => `'${p}': 0`).join(',')}}`;
  }
  return attributeExpression(attrs, 'style');
}

function attributeExpression(attrs: string, name: string): string | null {
  const m = new RegExp(String.raw`\b${name}\s*=\s*\{`).exec(attrs);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  return attrs.slice(open + 1, matchBracket(attrs, open));
}

// ---------- the check ----------

const FILES = sourceFiles();

type Finding = { file: string; cls: string; prop: string };

function findings(files: typeof FILES): Finding[] {
  const classes = new Map<string, ClassRules>();
  for (const file of files) {
    for (const [name, rules] of cssClasses(file.text)) {
      const entry = classes.get(name) ?? { props: new Set<string>(), stateful: false };
      for (const p of rules.props) entry.props.add(p);
      entry.stateful ||= rules.stateful;
      classes.set(name, entry);
    }
  }
  const out: Finding[] = [];
  for (const file of files) {
    for (const el of styledElements(file.text)) {
      const owned = el.classes.flatMap((c) => {
        const rules = classes.get(c);
        return rules?.stateful ? [...rules.props].map((p) => [c, p] as const) : [];
      });
      if (owned.length === 0) continue;
      for (const inline of inlineProps(el.style, { file, all: files })) {
        for (const [cls, prop] of owned) {
          if (conflicts(inline, prop)) out.push({ file: file.name, cls, prop: inline });
        }
      }
    }
  }
  return out;
}

function report(found: Finding[]): string[] {
  return [...new Set(found.map((f) => `${f.file}: .${f.cls} owns "${f.prop}", set inline`))].sort();
}

describe('inline styles vs. class rules', () => {
  test('no element sets a property inline that its own stateful class declares', () => {
    expect(report(findings(FILES))).toEqual([]);
  });

  // Without these the check above passes just as happily on a scanner that has
  // stopped seeing anything at all.
  test('the scan reaches the source it is meant to guard', () => {
    const classes = new Map<string, ClassRules>();
    for (const f of FILES) for (const [n, r] of cssClasses(f.text)) classes.set(n, r);
    expect([...classes].filter(([, r]) => r.stateful).length).toBeGreaterThan(10);
    expect(FILES.flatMap((f) => styledElements(f.text)).length).toBeGreaterThan(10);
  });

  test('catches a property named inline through a style factory', () => {
    const file = {
      path: '/x/a.tsx',
      name: 'a.tsx',
      text: [
        'const css = `.btn{color:red;transition:color 80ms}.btn:hover{color:blue}`;',
        'const btn = () => ({ background: "transparent", color: "red" });',
        '<button className="btn" style={{ ...btn(), order: 1 }} />;',
      ].join('\n'),
    };
    expect(report(findings([file]))).toEqual(['a.tsx: .btn owns "color", set inline']);
  });

  test('leaves a conditional override alone', () => {
    const file = {
      path: '/x/b.tsx',
      name: 'b.tsx',
      text: [
        'const css = `.row{background:transparent}.row:hover{background:grey}`;',
        '<button className="row" style={{ ...(on ? { background: "grey" } : null) }} />;',
      ].join('\n'),
    };
    expect(report(findings([file]))).toEqual([]);
  });

  test('leaves a class with no state rule alone', () => {
    const file = {
      path: '/x/c.tsx',
      name: 'c.tsx',
      text: [
        'const css = `.plain{color:red}`;',
        '<span className="plain" style={{ color: "red" }} />;',
      ].join('\n'),
    };
    expect(report(findings([file]))).toEqual([]);
  });
});
