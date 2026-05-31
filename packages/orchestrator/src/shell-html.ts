/**
 * The iframe shell served at the orchestrator root (`:4747/`).
 *
 * Layout:
 *   ┌─ Top bar (32px): logo, viewport switcher dropdown, status pill ─┐
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
    <title>localagents</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; height: 100%; background: #0a0a0a; color: #f4f4f5; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
      body { display: flex; flex-direction: column; }
      header {
        height: 38px;
        background: #18181b;
        border-bottom: 1px solid #27272a;
        display: flex;
        align-items: center;
        padding: 0 12px;
        gap: 12px;
        font-size: 12px;
      }
      .logo { font-weight: 600; letter-spacing: -0.01em; color: #e4e4e7; }
      .dot { display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: #22c55e; margin-right: 6px; vertical-align: 1px; }
      .dot.connecting { background: #eab308; animation: pulse 1.2s ease-in-out infinite; }
      .dot.disconnected { background: #ef4444; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      select {
        background: #27272a;
        color: #f4f4f5;
        border: 1px solid #3f3f46;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        outline: none;
      }
      select:focus { border-color: #3b82f6; }
      .status { color: #71717a; font-size: 11px; margin-left: auto; }
      iframe { flex: 1; border: none; background: white; }
      .empty {
        flex: 1; display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 12px; color: #71717a; font-size: 13px;
      }
      .empty code {
        background: #18181b; padding: 2px 6px; border-radius: 4px;
        font-family: ui-monospace, monospace; color: #e4e4e7;
      }
    </style>
  </head>
  <body>
    <header>
      <span class="logo">localagents</span>
      <span><span class="dot connecting" id="conn-dot"></span></span>
      <label style="display:flex; align-items:center; gap:6px; color:#a1a1aa;">
        viewport
        <select id="viewport-switcher">
          <option value="main" data-port="${mainPort}">main · :${mainPort}</option>
        </select>
      </label>
      <button id="ship-btn" type="button" style="background: #16a34a; color: white; border: none; border-radius: 6px; padding: 4px 12px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; display: none;" title="Merge this worktree's branch into main">Ship it</button>
      <button id="discard-btn" type="button" style="background: transparent; color: #a1a1aa; border: 1px solid #3f3f46; border-radius: 6px; padding: 3px 10px; font-size: 11px; cursor: pointer; font-family: inherit; display: none;" title="Tear down this worktree without merging">Discard</button>
      <span class="status" id="status-text">connecting to daemon…</span>
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
        var dotEl = document.getElementById('conn-dot');
        var statusEl = document.getElementById('status-text');
        var emptyEl = document.getElementById('empty');

        var worktrees = new Map();
        worktrees.set('main', { slug: 'main', port: ${mainPort}, devServerStatus: 'ready' });

        function setConn(state) {
          dotEl.className = 'dot ' + state;
          statusEl.textContent = state === 'connected' ? 'connected'
            : state === 'connecting' ? 'connecting to daemon…'
            : 'daemon disconnected — retrying';
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
        }

        selectEl.addEventListener('change', function() {
          switchTo(selectEl.value);
          updateShipButtons();
        });

        document.getElementById('ship-btn').addEventListener('click', async function() {
          var slug = selectEl.value;
          if (slug === 'main') return;
          if (!confirm('Merge ' + slug + ' into main? This commits any pending changes in the worktree and runs git merge --no-ff.')) return;
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
          if (!confirm('Discard worktree ' + slug + '? This kills its dev server and removes the worktree directory. Branch ' + slug + ' is kept.')) return;
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
        iframeEl.addEventListener('load', function() { iframeLoaded = true; emptyEl.style.display = 'none'; iframeEl.style.display = ''; });
        setTimeout(function() {
          if (!iframeLoaded) { iframeEl.style.display = 'none'; emptyEl.style.display = 'flex'; }
        }, 5000);
      })();
    </script>
  </body>
</html>`;
}
