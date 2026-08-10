/**
 * Every rule the orchestrator shell paints with, lifted out of shell-html.ts so
 * that file stays readable as a document: markup and behaviour there,
 * presentation here. Pure motion: every rule came across untouched, and the
 * served page is byte-for-byte what it was apart from one comment whose "below"
 * now points at the other file.
 *
 * Interpolated into the shell's <style> verbatim, so the indentation written
 * here is the indentation served.
 */
export const shellCss = `
      /*
       * Theming. Dark is the base; the media query flips to light with the OS.
       * The [data-theme] rules come last so they win: the overlay posts its own
       * resolved theme up (see the message listener in shell-html.ts), which is the
       * only way to follow its manual sun/moon override — that's a choice made
       * inside the iframe, invisible to prefers-color-scheme out here.
       *
       * Status hues (green/yellow/red dot, the Ship green) are intentionally
       * shared across themes, mirroring the overlay's own tokens.
       */
      :root {
        --bg: #0a0a0a;
        --header-bg: #18181b;
        --header-border: #27272a;
        --text: #f4f4f5;
        --logo: rgba(255, 255, 255, 0.4);
        --muted: #a1a1aa;
        --faint: #71717a;
        --control-border: #3f3f46;
        --code-bg: #18181b;
        --code-text: #e4e4e7;
        --accent: #3b82f6;
        --danger: #f87171;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f4f4f5;
          --header-bg: #ffffff;
          --header-border: #e4e4e7;
          --text: #18181b;
          /* The dark-mode wordmark is white at 40%; on a white bar that would be
             invisible, so light mode mirrors it as the foreground at 40%. */
          --logo: rgba(0, 0, 0, 0.4);
          --muted: #52525b;
          --faint: #71717a;
          --control-border: #d4d4d8;
          --code-bg: #e4e4e7;
          --code-text: #27272a;
          --danger: #dc2626;
        }
      }
      :root[data-theme="dark"] {
        --bg: #0a0a0a;
        --header-bg: #18181b;
        --header-border: #27272a;
        --text: #f4f4f5;
        --logo: rgba(255, 255, 255, 0.4);
        --muted: #a1a1aa;
        --faint: #71717a;
        --control-border: #3f3f46;
        --code-bg: #18181b;
        --code-text: #e4e4e7;
        --danger: #f87171;
      }
      :root[data-theme="light"] {
        --bg: #f4f4f5;
        --header-bg: #ffffff;
        --header-border: #e4e4e7;
        --text: #18181b;
        --logo: rgba(0, 0, 0, 0.4);
        --muted: #52525b;
        --faint: #71717a;
        --control-border: #d4d4d8;
        --code-bg: #e4e4e7;
        --code-text: #27272a;
        --danger: #dc2626;
      }

      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
      body { display: flex; flex-direction: column; }
      header {
        height: 38px;
        background: var(--header-bg);
        border-bottom: 1px solid var(--header-border);
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 12px;
        font-size: 12px;
        /* Matches the overlay's own dark/light crossfade rather than snapping. */
        transition: background 120ms ease, border-color 120ms ease;
      }
      .logo { font-weight: 300; letter-spacing: -0.01em; color: var(--logo); }
      .viewport-label { display: flex; align-items: center; gap: 6px; color: var(--logo); }
      /*
       * The chevron is ours, not the native one: a platform <select> gives no
       * control over where its arrow sits. appearance:none drops the native
       * control, the SVG sibling is positioned over it, and asymmetric padding
       * tucks the chevron close to the label with a wider gutter to its right.
       */
      .select-wrap { position: relative; display: inline-flex; align-items: center; }
      /* Off-screen twin of the selected label, in the select's own type — see
         sizeSelect() below for why the width has to be measured. */
      .select-measure {
        position: absolute;
        visibility: hidden;
        white-space: pre;
        font-size: 12px;
        font-family: inherit;
        pointer-events: none;
      }
      .select-chevron {
        position: absolute;
        right: 4px;
        color: var(--text);
        /* Clicks belong to the <select> underneath. */
        pointer-events: none;
      }
      select {
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        color: var(--text);
        border: none;
        border-radius: 6px;
        /* right = 4 (gutter) + 10 (chevron) + 6 (gap to the text) */
        padding: 0 20px 0 4px;
        /* Stated rather than intrinsic so the Background Tasks button beside it
           can land on the same height — two controls sharing a row read as
           misaligned at a 1px difference. */
        height: 24px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        outline: none;
      }
      /* The border used to carry focus; with none to tint, the ring goes outside
         the box. :focus-visible rather than :focus so a plain click doesn't leave
         a blue ring sitting on the bar afterwards. */
      select:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
      /*
       * The platform paints the open dropdown from the select's own colors, and
       * a transparent select leaves that list unreadable — so the options carry
       * the bar's surface explicitly.
       */
      option { background: var(--header-bg); color: var(--text); }
      /*
       * Background Tasks: the drawer itself lives in the overlay (inside the
       * iframe), but its button is chrome for the whole viewport, so it sits up
       * here beside the viewport switcher. Hidden until the overlay reports work
       * to show — mirroring the launcher it replaces, and keeping the bar clear
       * of a button that would do nothing when the framed page has no overlay.
       */
      .tasks-btn {
        display: none;
        align-items: center;
        gap: 5px;
        /* Still the select's height, so the hover fill lines up with the control
           beside it even though nothing is drawn around the glyph at rest. */
        height: 24px;
        padding: 0 6px;
        background: transparent;
        /* Muted at rest, like the wordmark and the "viewport" label: with no chip
           around it, full-strength ink would make this the loudest thing in a bar
           that is otherwise all quiet text. Hover brings it up to full. */
        color: var(--muted);
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        outline: none;
        transition: color 90ms ease;
      }
      /* Nothing is drawn around the glyph, hovered or not — the ink coming up to
         full is the whole affordance. */
      .tasks-btn:hover { color: var(--text); }
      /* No border to tint, so the keyboard ring is drawn outside the box —
         same shape the overlay's own pill buttons use. */
      .tasks-btn:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
      /* Open drawer — the accent the select wears when focused, on the ink. */
      .tasks-btn[data-open="true"] { color: var(--accent); }
      /* Running count, the glyph's peer rather than a badge on it: same ink,
         same size as the bar's text, tabular so it doesn't jitter at 9→10. */
      .tasks-count { font-variant-numeric: tabular-nums; line-height: 1; }
      /* Silent while the daemon is reachable — it only ever speaks up to report
         that it isn't. The margin-left:auto lives here rather than on the
         switcher so the switcher still sits hard right when this span is empty. */
      .status { color: var(--danger); font-size: 11px; margin-left: auto; }
      iframe { flex: 1; border: none; background: white; }
      .empty {
        flex: 1; display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 12px; color: var(--faint); font-size: 13px;
      }
      .empty code {
        background: var(--code-bg); padding: 2px 6px; border-radius: 4px;
        font-family: ui-monospace, monospace; color: var(--code-text);
      }
      .ship-btn {
        background: #16a34a; color: #ffffff; border: none; border-radius: 6px;
        padding: 4px 12px; font-size: 11px; font-weight: 600; cursor: pointer;
        font-family: inherit;
      }
      .discard-btn {
        background: transparent; color: var(--muted);
        border: 1px solid var(--control-border); border-radius: 6px;
        padding: 3px 10px; font-size: 11px; cursor: pointer; font-family: inherit;
      }
      /* Outlined, not a second green: merging into your checkout and opening a
         PR are alternatives, and only one of them should read as THE action. */
      .pr-btn {
        background: transparent; color: var(--text);
        border: 1px solid var(--control-border); border-radius: 6px;
        padding: 3px 10px; font-size: 11px; font-weight: 500; cursor: pointer;
        font-family: inherit;
      }
      .ship-btn:disabled, .pr-btn:disabled { opacity: 0.6; cursor: default; }
`;
