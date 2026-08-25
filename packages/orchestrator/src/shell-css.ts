/**
 * Every rule the orchestrator shell paints with, lifted out of shell-html.ts so
 * that file stays readable as a document: markup and behaviour there,
 * presentation here.
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
       */
      :root {
        /* One black. #0f0f0f is the overlay's own dark surface (rgb(15,15,15)
           in its SURFACE_PALETTE) — the page ground and the chrome share it so
           no two fills read as slightly different darks, and the neutral
           R=G=B replaces the old zinc values, which read blue next to it. */
        --bg: #0f0f0f;
        --chrome-bg: #0f0f0f;
        --chrome-border: #272727;
        --text: #f4f4f5;
        --muted: #a1a1aa;
        --soft: rgba(244, 244, 245, 0.4);
        --faint: #71717a;
        /* The inset chip a step up from the shared black — white @ 6% over
           #0f0f0f, matching the overlay's own fill tint. */
        --code-bg: #1d1d1d;
        --code-text: #e4e4e7;
        --accent: #3b82f6;
        --danger: #f87171;
        --scrim: rgba(0, 0, 0, 0.6);
        --chip-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
        --dialog-primary-bg: #f4f4f5;
        --dialog-primary-fg: #18181b;
        --dialog-secondary-bg: #3f3f3f;
        --dialog-secondary-fg: #f4f4f5;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f4f4f5;
          --chrome-bg: #ffffff;
          --chrome-border: #e4e4e7;
          --text: #18181b;
          --muted: #52525b;
          --soft: rgba(24, 24, 27, 0.5);
          --faint: #71717a;
          --code-bg: #e4e4e7;
          --code-text: #27272a;
          --danger: #dc2626;
          --scrim: rgba(0, 0, 0, 0.35);
          --chip-shadow: 0 2px 16px rgba(0, 0, 0, 0.12);
          --dialog-primary-bg: #18181b;
          --dialog-primary-fg: #ffffff;
          --dialog-secondary-bg: #e4e4e7;
          --dialog-secondary-fg: #27272a;
        }
      }
      :root[data-theme="dark"] {
        --bg: #0f0f0f;
        --chrome-bg: #0f0f0f;
        --chrome-border: #272727;
        --text: #f4f4f5;
        --muted: #a1a1aa;
        --soft: rgba(244, 244, 245, 0.4);
        --faint: #71717a;
        --code-bg: #1d1d1d;
        --code-text: #e4e4e7;
        --danger: #f87171;
        --scrim: rgba(0, 0, 0, 0.6);
        --chip-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
        --dialog-primary-bg: #f4f4f5;
        --dialog-primary-fg: #18181b;
        --dialog-secondary-bg: #3f3f3f;
        --dialog-secondary-fg: #f4f4f5;
      }
      :root[data-theme="light"] {
        --bg: #f4f4f5;
        --chrome-bg: #ffffff;
        --chrome-border: #e4e4e7;
        --text: #18181b;
        --muted: #52525b;
        --soft: rgba(24, 24, 27, 0.5);
        --faint: #71717a;
        --code-bg: #e4e4e7;
        --code-text: #27272a;
        --danger: #dc2626;
        --scrim: rgba(0, 0, 0, 0.35);
        --chip-shadow: 0 2px 16px rgba(0, 0, 0, 0.12);
        --dialog-primary-bg: #18181b;
        --dialog-primary-fg: #ffffff;
        --dialog-secondary-bg: #e4e4e7;
        --dialog-secondary-fg: #27272a;
      }

      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
      body { display: flex; flex-direction: column; }

      /*
       * The one piece of shell chrome: worktree actions + viewport switcher,
       * floating over the app's top-right corner. Dressed as the overlay's own
       * chip material (rounded, bordered, soft shadow) so it reads as the same
       * toolkit even though it lives a frame above. Hidden entirely until a
       * second worktree exists — see render() in shell-html.ts.
       */
      .viewport-chip {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 5;
        display: flex;
        align-items: center;
        gap: 10px;
        height: 32px;
        padding: 0 6px 0 12px;
        background: var(--chrome-bg);
        border: 1px solid var(--chrome-border);
        border-radius: 999px;
        box-shadow: var(--chip-shadow);
        font-size: 12px;
        /* Matches the overlay's own dark/light crossfade rather than snapping. */
        transition: background 120ms ease, border-color 120ms ease;
      }
      /* The task rows' quiet idiom: text-only, regular weight, soft ink
         lifting to full under the cursor — same reasoning as the drawer's own
         copies of these actions, which these buttons mirror.

         Ink is --soft, not --muted: the rows' soft is the ink thinned to
         40/50%, and --muted is a flat step-down that lands visibly heavier
         on this surface. */
      .chip-btn {
        background: transparent; color: var(--soft); border: none;
        border-radius: 6px; padding: 4px 2px; font-size: 12px; font-weight: 400;
        cursor: pointer; font-family: inherit; transition: color 90ms ease;
      }
      .chip-btn:hover:not(:disabled) { color: var(--text); }
      .chip-btn:disabled { opacity: 0.6; cursor: default; }
      /* Separates the destructive verbs from the switcher they act on behalf
         of; hidden with them (see updateShipButtons in shell-html.ts). */
      .chip-divider { width: 1px; height: 14px; background: var(--chrome-border); flex-shrink: 0; }

      /*
       * The chevron is ours, not the native one: a platform <select> gives no
       * control over where its arrow sits. appearance:none drops the native
       * control, the SVG sibling is positioned over it, and asymmetric padding
       * tucks the chevron close to the label with a wider gutter to its right.
       */
      .select-wrap { position: relative; display: inline-flex; align-items: center; }
      /* Off-screen twin of the selected label, in the select's own type — see
         sizeSelect() in shell-html.ts for why the width has to be measured. */
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
        height: 24px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        outline: none;
      }
      /* The border used to carry focus; with none to tint, the ring goes outside
         the box. :focus-visible rather than :focus so a plain click doesn't leave
         a blue ring sitting on the chip afterwards. */
      select:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
      /*
       * The platform paints the open dropdown from the select's own colors, and
       * a transparent select leaves that list unreadable — so the options carry
       * the chip's surface explicitly.
       */
      option { background: var(--chrome-bg); color: var(--text); }

      /* Silent while the daemon is reachable — it only ever speaks up to report
         that it isn't. */
      .status-toast {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 6;
        background: var(--chrome-bg);
        border: 1px solid var(--chrome-border);
        border-radius: 999px;
        box-shadow: var(--chip-shadow);
        color: var(--danger);
        font-size: 11px;
        padding: 6px 12px;
      }
      .status-toast:empty { display: none; }

      iframe { flex: 1; border: none; background: white; }
      .empty {
        flex: 1; display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 12px; color: var(--faint); font-size: 13px;
      }
      .empty code {
        background: var(--code-bg); padding: 2px 6px; border-radius: 4px;
        font-family: ui-monospace, monospace; color: var(--code-text);
      }

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
        width: min(340px, 100%);
        background: var(--chrome-bg);
        border: 1px solid var(--chrome-border);
        border-radius: 18px;
        padding: 18px 20px 20px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      }
      .modal-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding-bottom: 12px;
        border-bottom: 1px solid var(--chrome-border);
      }
      .modal-title {
        margin: 0; font-size: 15px; font-weight: 500;
        letter-spacing: -0.01em; color: var(--text);
      }
      /* Negative margin buys the × a real hit target without pushing the glyph
         off the title's baseline or the card's gutter. */
      /* A fixed square with both axes centred: "×" does not sit centred inside
         its own em box, so padding alone left it off the title's centre. */
      .modal-close {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; flex-shrink: 0;
        background: transparent; border: none; padding: 0; margin: -2px -4px -2px 0;
        line-height: 1; font-size: 18px; color: var(--soft); cursor: pointer;
        font-family: inherit; transition: color 90ms ease;
      }
      .modal-close:hover { color: var(--text); }
      .modal-body { margin: 12px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
      /* The row that makes it read as the reference: two equal pills filling
         the card's width, not small text buttons tucked in a corner. */
      .modal-actions { display: flex; gap: 8px; margin-top: 18px; }
      .modal-btn {
        flex: 1; min-width: 0; height: 36px; border: none; border-radius: 999px;
        padding: 0 14px; font-size: 13px; font-weight: 400; font-family: inherit;
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
