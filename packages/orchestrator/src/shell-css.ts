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
        --soft: rgba(244, 244, 245, 0.4);
        --faint: #71717a;
        --control-border: #3f3f46;
        --code-bg: #18181b;
        --code-text: #e4e4e7;
        --accent: #3b82f6;
        --danger: #f87171;
        --scrim: rgba(0, 0, 0, 0.6);
        --dialog-primary-bg: #f4f4f5;
        --dialog-primary-fg: #18181b;
        --dialog-secondary-bg: #3f3f46;
        --dialog-secondary-fg: #f4f4f5;
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
          --soft: rgba(24, 24, 27, 0.5);
          --faint: #71717a;
          --control-border: #d4d4d8;
          --code-bg: #e4e4e7;
          --code-text: #27272a;
          --danger: #dc2626;
          --scrim: rgba(0, 0, 0, 0.35);
          --dialog-primary-bg: #18181b;
          --dialog-primary-fg: #ffffff;
          --dialog-secondary-bg: #e4e4e7;
          --dialog-secondary-fg: #27272a;
        }
      }
      :root[data-theme="dark"] {
        --bg: #0a0a0a;
        --header-bg: #18181b;
        --header-border: #27272a;
        --text: #f4f4f5;
        --logo: rgba(255, 255, 255, 0.4);
        --muted: #a1a1aa;
        --soft: rgba(244, 244, 245, 0.4);
        --faint: #71717a;
        --control-border: #3f3f46;
        --code-bg: #18181b;
        --code-text: #e4e4e7;
        --danger: #f87171;
        --scrim: rgba(0, 0, 0, 0.6);
        --dialog-primary-bg: #f4f4f5;
        --dialog-primary-fg: #18181b;
        --dialog-secondary-bg: #3f3f46;
        --dialog-secondary-fg: #f4f4f5;
      }
      :root[data-theme="light"] {
        --bg: #f4f4f5;
        --header-bg: #ffffff;
        --header-border: #e4e4e7;
        --text: #18181b;
        --logo: rgba(0, 0, 0, 0.4);
        --muted: #52525b;
        --soft: rgba(24, 24, 27, 0.5);
        --faint: #71717a;
        --control-border: #d4d4d8;
        --code-bg: #e4e4e7;
        --code-text: #27272a;
        --danger: #dc2626;
        --scrim: rgba(0, 0, 0, 0.35);
        --dialog-primary-bg: #18181b;
        --dialog-primary-fg: #ffffff;
        --dialog-secondary-bg: #e4e4e7;
        --dialog-secondary-fg: #27272a;
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
       * Everything but the wordmark, held together so the margin-left:auto can
       * live on the group rather than on any one member. It used to sit on
       * .status, which worked only because that span is always present — now
       * that the worktree buttons ride along on the right, and all three of
       * them are display:none off an agent worktree, no single member is
       * reliably there to carry it.
       */
      .bar-right { display: flex; align-items: center; gap: 12px; margin-left: auto; }
      /* Silent while the daemon is reachable — it only ever speaks up to report
         that it isn't. Out of flow entirely when it has nothing to say, or the
         group would still spend a 12px gap on an empty span. */
      .status { color: var(--danger); font-size: 11px; }
      .status:empty { display: none; }
      iframe { flex: 1; border: none; background: white; }
      .empty {
        flex: 1; display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 12px; color: var(--faint); font-size: 13px;
      }
      .empty code {
        background: var(--code-bg); padding: 2px 6px; border-radius: 4px;
        font-family: ui-monospace, monospace; color: var(--code-text);
      }
      /* The task rows' quiet idiom, up here too: text-only, regular weight,
         soft ink lifting to full under the cursor. The old green Merge pill
         made the bar's copy of these controls louder than the drawer's — the
         same action wearing two costumes. One filled chip and one outline
         chip went with it; hover ink is now the whole affordance, exactly as
         it is on the rows. 12px rather than the rows' 13 because everything
         in this bar sits on the 12px line.

         Ink is --soft, not --muted: the rows' soft is the ink thinned to 40/50%,
         and --muted is a flat step-down that lands visibly heavier over this
         bar. Written the same way, they still didn't look the same weight. */
      .ship-btn, .pr-btn, .discard-btn {
        background: transparent; color: var(--soft); border: none;
        border-radius: 6px; padding: 4px 6px; font-size: 12px; font-weight: 400;
        cursor: pointer; font-family: inherit; transition: color 90ms ease;
      }
      .ship-btn:hover:not(:disabled), .pr-btn:hover:not(:disabled),
      .discard-btn:hover:not(:disabled) { color: var(--text); }
      .ship-btn:disabled, .pr-btn:disabled { opacity: 0.6; cursor: default; }

      /*
       * The confirmation dialog, standing in for confirm(). The native one
       * can't be themed and names the page in its title, which reads as the
       * browser asking rather than iris — a bad look on the one control that
       * throws work away. Driven by askConfirm() in shell-html.ts.
       */
      .modal-scrim {
        position: fixed; inset: 0; z-index: 10;
        display: flex; align-items: center; justify-content: center;
        padding: 16px; background: var(--scrim);
      }
      /* display:flex would otherwise outrank the hidden attribute. */
      .modal-scrim[hidden] { display: none; }
      .modal {
        width: min(430px, 100%);
        background: var(--header-bg);
        border: 1px solid var(--header-border);
        border-radius: 28px;
        padding: 24px 28px 28px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      }
      .modal-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding-bottom: 16px;
        border-bottom: 1px solid var(--header-border);
      }
      .modal-title {
        margin: 0; font-size: 20px; font-weight: 700;
        letter-spacing: -0.01em; color: var(--text);
      }
      /* Negative margin buys the × a real hit target without pushing the glyph
         off the title's baseline or the card's gutter. */
      .modal-close {
        background: transparent; border: none; padding: 6px; margin: -6px;
        line-height: 1; font-size: 24px; color: var(--soft); cursor: pointer;
        font-family: inherit; transition: color 90ms ease;
      }
      .modal-close:hover { color: var(--text); }
      .modal-body { margin: 16px 0 0; font-size: 15px; line-height: 1.6; color: var(--muted); }
      /* The row that makes it read as the reference: two equal pills filling
         the card's width, not small text buttons tucked in a corner. */
      .modal-actions { display: flex; gap: 12px; margin-top: 24px; }
      .modal-btn {
        flex: 1; min-width: 0; height: 48px; border: none; border-radius: 999px;
        padding: 0 16px; font-size: 15px; font-weight: 700; font-family: inherit;
        cursor: pointer; transition: opacity 90ms ease;
      }
      .modal-btn:hover { opacity: 0.85; }
      /*
       * Inverted from where the eye expects them: the safe choice wears the
       * filled primary and the destructive one the muted secondary, so the
       * button that destroys work is never the inviting one. Primary flips
       * against the surface per theme, like the overlay's own submit button.
       */
      .modal-btn-primary { background: var(--dialog-primary-bg); color: var(--dialog-primary-fg); }
      .modal-btn-secondary { background: var(--dialog-secondary-bg); color: var(--dialog-secondary-fg); }
`;
