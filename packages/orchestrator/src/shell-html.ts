/**
 * The iframe shell served at the orchestrator root (`:4747/`).
 *
 * Layout:
 *   ┌─ Top bar (38px): "iris" left; tasks button + viewport switcher right ┐
 *   │                                                                  │
 *   │  ┌─────────────────────────────────────────────────────────┐   │
 *   │  │ <iframe src="http://localhost:300X/">  (the picked       │   │
 *   │  │  worktree's dev server — overlay lives inside)           │   │
 *   │  └─────────────────────────────────────────────────────────┘   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Dropdown options update live from WS worktree:created/updated/removed events.
 *
 * The Background Tasks button is the overlay's launcher lifted up here: the
 * drawer belongs to the overlay, but the button is chrome for the whole
 * viewport rather than for the page inside it. Since the two sit on different
 * origins, they talk by postMessage — counts up, toggle down (see the handshake
 * in the script below and its other half in packages/overlay/src/overlay.tsx).
 */
export function shellHtml(mainPort: number): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>iris</title>
    <style>
      /*
       * Theming. Dark is the base; the media query flips to light with the OS.
       * The [data-theme] rules come last so they win: the overlay posts its own
       * resolved theme up to us (see the message listener below), which is the
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
    </style>
  </head>
  <body>
    <header>
      <span class="logo">iris</span>
      <button id="ship-btn" class="ship-btn" type="button" style="display: none;" title="Merge this worktree's branch into main">Ship it</button>
      <button id="discard-btn" class="discard-btn" type="button" style="display: none;" title="Tear down this worktree without merging">Discard</button>
      <span class="status" id="status-text"></span>
      <button id="tasks-btn" class="tasks-btn" type="button" title="Background tasks" aria-pressed="false">
        <!-- Stacked sheets, one per queued task — the overlay's BackgroundTasksIcon
             at the bar's scale (see packages/overlay/src/ui/icons.tsx). -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <g stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 9.49958L2 11.9996L11.6422 16.8207C11.7734 16.8863 11.839 16.9191 11.9078 16.932C11.9687 16.9434 12.0313 16.9434 12.0922 16.932C12.161 16.9191 12.2266 16.8863 12.3578 16.8207L22 11.9996L17 9.49958" />
            <path d="M7 14.4996L2 16.9996L11.6422 21.8207C11.7734 21.8863 11.839 21.9191 11.9078 21.932C11.9687 21.9434 12.0313 21.9434 12.0922 21.932C12.161 21.9191 12.2266 21.8863 12.3578 21.8207L22 16.9996L17 14.4996" />
            <path d="M2 6.99958L11.6422 2.17846C11.7734 2.11287 11.839 2.08008 11.9078 2.06717C11.9687 2.05574 12.0313 2.05574 12.0922 2.06717C12.161 2.08008 12.2266 2.11287 12.3578 2.17846L22 6.99958L12.3578 11.8207C12.2266 11.8863 12.161 11.9191 12.0922 11.932C12.0313 11.9434 11.9687 11.9434 11.9078 11.932C11.839 11.9191 11.7734 11.8863 11.6422 11.8207L2 6.99958Z" />
          </g>
        </svg>
        <span class="tasks-count" id="tasks-count"></span>
      </button>
      <label class="viewport-label">
        viewport
        <span class="select-wrap">
          <select id="viewport-switcher">
            <option value="main" data-port="${mainPort}">main · :${mainPort}</option>
          </select>
          <span class="select-measure" id="select-measure" aria-hidden="true"></span>
          <svg class="select-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </label>
    </header>
    <iframe id="viewport" src="http://localhost:${mainPort}/" referrerpolicy="no-referrer-when-downgrade"></iframe>
    <div class="empty" id="empty" style="display:none">
      <div>main dev server isn't responding on :${mainPort}</div>
      <div>Run <code>bun dev</code> (or <code>npm run dev</code>) and refresh.</div>
    </div>
    <script>
      (function() {
        var daemonOrigin = window.location.origin;
        var wsUrl = daemonOrigin.replace(/^http/, 'ws') + '/tasks';
        var selectEl = document.getElementById('viewport-switcher');
        var iframeEl = document.getElementById('viewport');
        var statusEl = document.getElementById('status-text');
        var emptyEl = document.getElementById('empty');
        var tasksBtn = document.getElementById('tasks-btn');
        var tasksCountEl = document.getElementById('tasks-count');
        var measureEl = document.getElementById('select-measure');

        // A <select> is as wide as its widest option, not its current one. The
        // chip used to absorb that slack; bare, it strands the chevron a worktree
        // name's distance from the value it belongs to. So the width is measured
        // off the selected label and pinned — 24 = the select's own 4 + 20 of
        // horizontal padding.
        function sizeSelect() {
          var opt = selectEl.options[selectEl.selectedIndex];
          measureEl.textContent = opt ? opt.textContent : '';
          selectEl.style.width = (measureEl.offsetWidth + 24) + 'px';
        }

        var worktrees = new Map();
        worktrees.set('main', { slug: 'main', port: ${mainPort}, devServerStatus: 'ready' });

        // Post down into the overlay. Addressed at the frame's own origin rather
        // than '*' so a page that has navigated elsewhere never receives it.
        function postToOverlay(msg) {
          var win = iframeEl.contentWindow;
          if (!win) return;
          try { win.postMessage(msg, new URL(iframeEl.src).origin); } catch (e) {}
        }

        // Whether the framed page has answered with an overlay. Cleared on every
        // navigation: the next page gets its own handshake, and until it speaks
        // the tasks button stays hidden rather than showing the old page's count.
        var overlayLinked = false;

        // The overlay lives in the iframe, a different origin, so it reports up
        // to us: its resolved theme (the top bar would otherwise follow the OS
        // but not the overlay's own light/dark override) and its task counts
        // (which drive the Background Tasks button above). Only ever sets an
        // attribute or paints that button, and only from a localhost frame —
        // this is the one message channel into the shell, so it stays narrow on
        // purpose.
        window.addEventListener('message', function(ev) {
          if (!/^https?:\\/\\/localhost(:\\d+)?$/.test(ev.origin)) return;
          var d = ev.data;
          if (!d || d.source !== 'iris') return;
          if (d.type === 'theme') {
            if (d.theme !== 'light' && d.theme !== 'dark') return;
            document.documentElement.setAttribute('data-theme', d.theme);
          } else if (d.type === 'tasks') {
            renderTasks(d);
          } else {
            return;
          }
          // Either side may come up first, so the overlay's first message is also
          // our cue to introduce ourselves — that's what tells it to drop its own
          // floating launcher in favour of the button up here.
          if (!overlayLinked) {
            overlayLinked = true;
            postToOverlay({ source: 'iris-shell', type: 'shell:hello' });
          }
        });

        // Same rule the overlay's launcher followed: the button exists only once
        // there's work to show. The count is running tasks; the accent border
        // mirrors the drawer being open, since the drawer itself is out of sight
        // below the bar.
        function renderTasks(d) {
          var total = typeof d.total === 'number' ? d.total : 0;
          var running = typeof d.running === 'number' ? d.running : 0;
          tasksBtn.style.display = total > 0 ? 'inline-flex' : 'none';
          tasksCountEl.textContent = running > 0 ? String(running) : '';
          tasksBtn.setAttribute('data-open', d.open ? 'true' : 'false');
          tasksBtn.setAttribute('aria-pressed', d.open ? 'true' : 'false');
        }

        tasksBtn.addEventListener('click', function() {
          postToOverlay({ source: 'iris-shell', type: 'tasks:toggle' });
        });

        // Healthy and still-connecting are both silent — a bar that permanently
        // says "connected" is noise. Losing the daemon is the only state worth
        // interrupting for, since nothing in the UI works without it.
        function setConn(state) {
          statusEl.textContent = state === 'disconnected' ? 'daemon disconnected — retrying' : '';
        }

        function render() {
          var prev = selectEl.value;
          selectEl.innerHTML = '';
          worktrees.forEach(function(wt) {
            var opt = document.createElement('option');
            opt.value = wt.slug;
            opt.dataset.port = String(wt.port);
            var statusBadge = wt.devServerStatus === 'ready' ? '' : ' · ' + wt.devServerStatus;
            opt.textContent = wt.slug + ' · :' + wt.port + statusBadge;
            if (wt.devServerStatus !== 'ready') opt.disabled = wt.devServerStatus !== 'ready' && wt.slug !== prev;
            selectEl.appendChild(opt);
          });
          if (worktrees.has(prev)) selectEl.value = prev;
          sizeSelect();
        }

        function switchTo(slug) {
          var wt = worktrees.get(slug);
          if (!wt) return;
          var url = 'http://localhost:' + wt.port + '/';
          if (iframeEl.src !== url) iframeEl.src = url;
        }

        function updateShipButtons() {
          var isAgent = selectEl.value !== 'main';
          document.getElementById('ship-btn').style.display = isAgent ? '' : 'none';
          document.getElementById('discard-btn').style.display = isAgent ? '' : 'none';
        }

        selectEl.addEventListener('change', function() {
          switchTo(selectEl.value);
          updateShipButtons();
          sizeSelect();
        });

        document.getElementById('ship-btn').addEventListener('click', async function() {
          var slug = selectEl.value;
          if (slug === 'main') return;
          if (!confirm('Merge ' + slug + ' into main? This commits any pending changes in the worktree, merges them into main, and then deletes the worktree.')) return;
          var btn = document.getElementById('ship-btn');
          btn.disabled = true; btn.textContent = 'shipping…';
          try {
            var res = await fetch(daemonOrigin + '/worktrees/' + slug + '/ship', { method: 'POST' });
            var json = await res.json();
            if (!res.ok) throw new Error(json.error || 'ship failed');
            // On success the daemon broadcasts worktree:removed and the dropdown switches to main.
          } catch (e) {
            alert('Ship failed: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false; btn.textContent = 'Ship it';
          }
        });

        document.getElementById('discard-btn').addEventListener('click', async function() {
          var slug = selectEl.value;
          if (slug === 'main') return;
          if (!confirm('Discard worktree ' + slug + '? This kills its dev server and deletes the worktree directory. Its branch lives inside that directory, so any uncommitted or unmerged work there is lost.')) return;
          try {
            await fetch(daemonOrigin + '/worktrees/' + encodeURIComponent(slug), { method: 'DELETE' });
          } catch (e) {
            alert('Discard failed: ' + String(e));
          }
        });

        function connect() {
          setConn('connecting');
          var ws;
          try { ws = new WebSocket(wsUrl); } catch (e) { setTimeout(connect, 1500); return; }
          ws.addEventListener('open', function() { setConn('connected'); });
          ws.addEventListener('close', function() { setConn('disconnected'); setTimeout(connect, 1500); });
          ws.addEventListener('message', function(ev) {
            try { var msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.type === 'hello') {
              worktrees.clear();
              (msg.worktrees || []).forEach(function(w) { worktrees.set(w.slug, w); });
              if (!worktrees.has('main')) worktrees.set('main', { slug: 'main', port: ${mainPort}, devServerStatus: 'ready' });
              render();
            } else if (msg.type === 'worktree:created' || msg.type === 'worktree:updated') {
              worktrees.set(msg.worktree.slug, msg.worktree);
              render();
            } else if (msg.type === 'worktree:removed') {
              worktrees.delete(msg.slug);
              if (selectEl.value === msg.slug) {
                selectEl.value = 'main';
                switchTo('main');
                updateShipButtons();
              }
              render();
            }
          });
        }

        connect();
        render();
        updateShipButtons();

        // Detect missing main dev server with a soft probe.
        fetch('http://localhost:${mainPort}/', { method: 'HEAD', mode: 'no-cors' }).catch(function() {
          // can't tell from no-cors HEAD reliably; only show banner if iframe never loads
        });
        var iframeLoaded = false;
        iframeEl.addEventListener('load', function() {
          iframeLoaded = true; emptyEl.style.display = 'none'; iframeEl.style.display = '';
          // Fresh page: forget the last one's overlay and re-open the handshake.
          // The button stays hidden until this page reports tasks of its own.
          overlayLinked = false;
          renderTasks({ total: 0, running: 0, open: false });
          postToOverlay({ source: 'iris-shell', type: 'shell:hello' });
        });
        setTimeout(function() {
          if (!iframeLoaded) { iframeEl.style.display = 'none'; emptyEl.style.display = 'flex'; }
        }, 5000);
      })();
    </script>
  </body>
</html>`;
}
