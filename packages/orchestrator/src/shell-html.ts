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
 *
 * Presentation lives in shell-css.ts, interpolated into the <style> below.
 */
import { shellCss } from './shell-css';

export function shellHtml(mainPort: number): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>iris</title>
    <style>${shellCss}    </style>
  </head>
  <body>
    <header>
      <span class="logo">iris</span>
      <button id="ship-btn" class="ship-btn" type="button" style="display: none;" title="Merge this worktree's branch into main">Ship it</button>
      <button id="pr-btn" class="pr-btn" type="button" style="display: none;" title="Push this branch and open a pull request">Create PR</button>
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
        // What the daemon can do on this machine, from the hello frame. Null
        // until it arrives, which is why Create PR starts hidden.
        var caps = null;
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
          // Stays hidden without a remote — there'd be nowhere to push.
          document.getElementById('pr-btn').style.display =
            isAgent && caps && caps.remote ? '' : 'none';
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
            // The escape is doubled on purpose. This file is one big template
            // literal, so a single one is consumed right here and emits a real
            // newline into the browser's source, leaving the string unterminated
            // and killing the whole inline script. Same reason the origin-check
            // regex above doubles its slashes.
            if (json.url && !opened) alert('Pushed ' + json.branch + '. Open:\\n' + json.url);
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
