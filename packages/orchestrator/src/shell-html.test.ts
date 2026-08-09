import { describe, expect, test } from 'bun:test';
import { shellHtml } from './shell-html';

/**
 * The shell is one big template literal wrapping an inline `<script>`, which
 * means the browser's JavaScript is a *string* here — nothing typechecks it, and
 * a stray escape is enough to break it. A single `\n` written inside the
 * template is consumed on the way out and emits a real newline into the emitted
 * source: the string it sat in is then unterminated, the whole script fails to
 * parse, and every control in the top bar goes dead. That shipped once.
 *
 * `new Function` parses without running, which is exactly the check we want —
 * the script's body needs a browser, but its syntax does not.
 */
function inlineScript(html: string): string {
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return html.slice(open + '<script>'.length, close);
}

describe('shellHtml', () => {
  test('the inline script is syntactically valid JavaScript', () => {
    expect(() => new Function(inlineScript(shellHtml(3000)))).not.toThrow();
  });

  test('interpolates the dev server port into the frame and the probe', () => {
    const html = shellHtml(4321);
    expect(html).toContain('src="http://localhost:4321/"');
    expect(html).toContain('port: 4321');
  });
});
