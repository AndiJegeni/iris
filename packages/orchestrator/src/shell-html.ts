/**
 * The iframe shell served at the orchestrator root (`:4747/`).
 *
 * Layout:
 *   ┌─ Top bar (38px): "iris" wordmark left, viewport switcher hard right ─┐
 *   │                                                                  │
 *   │  ┌─────────────────────────────────────────────────────────┐   │
 *   │  │ <iframe src="http://localhost:300X/">  (the picked       │   │
 *   │  │  worktree's dev server — overlay lives inside)           │   │
 *   │  └─────────────────────────────────────────────────────────┘   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Dropdown options update live from WS worktree:created/updated/removed events.
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
        --control-bg: #27272a;
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
          --control-bg: #ffffff;
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
        --control-bg: #27272a;
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
        --control-bg: #ffffff;
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
      .select-chevron {
        position: absolute;
        right: 12px;
        color: var(--text);
        /* Clicks belong to the <select> underneath. */
        pointer-events: none;
      }
      select {
        appearance: none;
        -webkit-appearance: none;
        background: var(--control-bg);
        color: var(--text);
        border: 1px solid var(--control-border);
        border-radius: 6px;
        /* right = 12 (gutter) + 10 (chevron) + 6 (gap to the text) */
        padding: 3px 28px 3px 8px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        outline: none;
      }
      select:focus { border-color: var(--accent); }
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
      /* Outlined, not a second green: shipping into your checkout and opening a
         PR are alternatives, and only one of them should read as THE action. */
      .pr-btn {
        background: transparent; color: var(--text);
        border: 1px solid var(--control-border); border-radius: 6px;
        padding: 3px 10px; font-size: 11px; font-weight: 500; cursor: pointer;
        font-family: inherit;
      }
      .ship-btn:disabled, .pr-btn:disabled { opacity: 0.6; cursor: default; }
    </style>
  </head>
  <body>
    <header>
      <span class="logo">iris</span>
      <button id="ship-btn" class="ship-btn" type="button" style="display: none;" title="Merge this worktree's branch into main">Ship it</button>
      <button id="pr-btn" class="pr-btn" type="button" style="display: none;" title="Push this branch and open a pull request">Create PR</button>
      <button id="discard-btn" class="discard-btn" type="button" style="display: none;" title="Tear down this worktree without merging">Discard</button>
      <span class="status" id="status-text"></span>
      <label class="viewport-label">
        viewport
        <span class="select-wrap">
          <select id="viewport-switcher">
            <option value="main" data-port="${mainPort}">main · :${mainPort}</option>
          </select>
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

        var worktrees = new Map();
        // What the daemon can do on this machine, from the hello frame. Null
        // until it arrives, which is why Create PR starts hidden.
        var caps = null;
        worktrees.set('main', { slug: 'main', port: ${mainPort}, devServerStatus: 'ready' });

        // The overlay lives in the iframe, a different origin, so it reports its
        // resolved theme up to us. Without this the top bar follows the OS but
        // not the overlay's own light/dark override. Only ever sets an
        // attribute, and only from a localhost frame — this is the one message
        // channel into the shell, so it stays narrow on purpose.
        window.addEventListener('message', function(ev) {
          if (!/^https?:\\/\\/localhost(:\\d+)?$/.test(ev.origin)) return;
          var d = ev.data;
          if (!d || d.source !== 'iris' || d.type !== 'theme') return;
          if (d.theme !== 'light' && d.theme !== 'dark') return;
          document.documentElement.setAttribute('data-theme', d.theme);
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
          // Stays hidden without a remote — there'd be nowhere to push.
          document.getElementById('pr-btn').style.display =
            isAgent && caps && caps.remote ? '' : 'none';
        }

        selectEl.addEventListener('change', function() {
          switchTo(selectEl.value);
          updateShipButtons();
        });

        document.getElementById('ship-btn').addEventListener('click', async function() {
          var slug = selectEl.value;
          if (slug === 'main') return;
          if (!confirm('Merge ' + slug + ' into main? This commits any pending changes in the worktree, merges them into main, and then deletes the worktree.')) return;
          var btn = document.getElementById('ship-btn');
          btn.disabled = true; btn.textContent = 'shipping…';
          try {
            var res = await fetch(daemonOrigin + '/worktrees/' + encodeURIComponent(slug) + '/ship', { method: 'POST' });
            var json = await res.json();
            if (!res.ok) throw new Error(json.error || 'ship failed');
            // On success the daemon broadcasts worktree:removed and the dropdown switches to main.
          } catch (e) {
            alert('Ship failed: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false; btn.textContent = 'Ship it';
          }
        });

        // No confirm(): unlike Ship and Discard this destroys nothing — the
        // worktree and its dev server survive so you can keep iterating.
        document.getElementById('pr-btn').addEventListener('click', async function() {
          var slug = selectEl.value;
          if (slug === 'main') return;
          var btn = document.getElementById('pr-btn');
          btn.disabled = true; btn.textContent = 'opening…';
          try {
            var res = await fetch(daemonOrigin + '/worktrees/' + encodeURIComponent(slug) + '/pr', { method: 'POST' });
            var json = await res.json();
            if (!res.ok) throw new Error(json.error || 'create PR failed');
            // A popup opened after an await can be blocked, so the URL is also
            // spelled out — never leave the user without a way to reach it.
            var opened = json.url ? window.open(json.url, '_blank', 'noopener') : null;
            if (json.url && !opened) alert('Pushed ' + json.branch + '. Open:\n' + json.url);
            else if (!json.url) alert(json.note || ('Pushed ' + json.branch + '.'));
          } catch (e) {
            alert('Create PR failed: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false; btn.textContent = 'Create PR';
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
              caps = msg.capabilities || null;
              worktrees.clear();
              (msg.worktrees || []).forEach(function(w) { worktrees.set(w.slug, w); });
              if (!worktrees.has('main')) worktrees.set('main', { slug: 'main', port: ${mainPort}, devServerStatus: 'ready' });
              render();
              updateShipButtons();
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
        iframeEl.addEventListener('load', function() { iframeLoaded = true; emptyEl.style.display = 'none'; iframeEl.style.display = ''; });
        setTimeout(function() {
          if (!iframeLoaded) { iframeEl.style.display = 'none'; emptyEl.style.display = 'flex'; }
        }, 5000);
      })();
    </script>
  </body>
</html>`;
}
