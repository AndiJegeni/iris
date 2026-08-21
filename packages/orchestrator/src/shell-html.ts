/**
 * The iframe shell served at the orchestrator root (`:4747/`).
 *
 * Layout:
 *   ┌─ Top bar (38px): "iris" left; worktree actions + viewport switcher right ┐
 *   │                                                                  │
 *   │  ┌─────────────────────────────────────────────────────────┐   │
 *   │  │ <iframe src="http://localhost:300X/">  (the picked       │   │
 *   │  │  worktree's dev server — overlay lives inside)           │   │
 *   │  └─────────────────────────────────────────────────────────┘   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Dropdown options update live from WS worktree:created/updated/removed events.
 *
 * Background Tasks is NOT up here: the overlay's floating launcher (beside
 * the pill, inside the frame) is the one control, framed or not. A copy in
 * the bar was tried twice and read as a duplicate both times — the only thing
 * crossing the origin boundary is the overlay's theme report.
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
      <div class="bar-right">
        <span class="status" id="status-text"></span>
        <button id="ship-btn" class="ship-btn" type="button" style="display: none;" title="Merge this worktree's branch into your checkout and delete it">Merge locally</button>
        <button id="pr-btn" class="pr-btn" type="button" style="display: none;" title="Push this branch and open a pull request">Create PR</button>
        <button id="discard-btn" class="discard-btn" type="button" style="display: none;" title="Tear down this worktree without merging">Discard</button>
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
      </div>
    </header>
    <iframe id="viewport" src="http://localhost:${mainPort}/" referrerpolicy="no-referrer-when-downgrade"></iframe>
    <div class="empty" id="empty" style="display:none">
      <div>main dev server isn't responding on :${mainPort}</div>
      <div>Run <code>bun dev</code> (or <code>npm run dev</code>) and refresh.</div>
    </div>
    <!-- One dialog, filled in by whoever asks — see askConfirm() below. -->
    <div class="modal-scrim" id="confirm-scrim" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="modal-head">
          <h2 class="modal-title" id="confirm-title"></h2>
          <button class="modal-close" id="confirm-close" type="button" aria-label="Close">&times;</button>
        </div>
        <p class="modal-body" id="confirm-body"></p>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-secondary" id="confirm-yes" type="button"></button>
          <button class="modal-btn modal-btn-primary" id="confirm-no" type="button">Cancel</button>
        </div>
      </div>
    </div>
    <script>
      (function() {
        var daemonOrigin = window.location.origin;
        var wsUrl = daemonOrigin.replace(/^http/, 'ws') + '/tasks';
        var selectEl = document.getElementById('viewport-switcher');
        var iframeEl = document.getElementById('viewport');
        var statusEl = document.getElementById('status-text');
        var emptyEl = document.getElementById('empty');
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

        // The overlay lives in the iframe, a different origin, so it reports its
        // resolved theme up to us — the bar would otherwise follow the OS while
        // the overlay honoured its own light/dark override. One way and one
        // message: it only ever sets an attribute, and only from a localhost
        // frame, so the shell's single inbound channel stays as narrow as it
        // can be.
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

        // Our own confirm(), asked by both destructive actions — Merge and
        // Discard — which is why it takes its wording rather than owning it.
        // Resolves false for every way out that isn't the confirm button, so a
        // stray Escape or backdrop click can never be read as consent.
        var scrimEl = document.getElementById('confirm-scrim');
        var confirmTitleEl = document.getElementById('confirm-title');
        var confirmBodyEl = document.getElementById('confirm-body');
        var confirmYesEl = document.getElementById('confirm-yes');
        var confirmNoEl = document.getElementById('confirm-no');
        var settleConfirm = null;

        function closeConfirm(answer) {
          if (!settleConfirm) return;
          var settle = settleConfirm;
          settleConfirm = null;
          scrimEl.hidden = true;
          document.removeEventListener('keydown', onConfirmKey);
          settle(answer);
        }

        function onConfirmKey(ev) {
          if (ev.key === 'Escape') { ev.preventDefault(); closeConfirm(false); }
        }

        function askConfirm(opts) {
          return new Promise(function(resolve) {
            // A second question over an open one would strand the first
            // promise; answering it "no" keeps its caller unblocked.
            closeConfirm(false);
            confirmTitleEl.textContent = opts.title;
            confirmBodyEl.textContent = opts.body;
            confirmYesEl.textContent = opts.confirmLabel;
            confirmNoEl.textContent = opts.cancelLabel || 'Cancel';
            scrimEl.hidden = false;
            settleConfirm = resolve;
            document.addEventListener('keydown', onConfirmKey);
            // The safe button takes focus, so Enter on a dialog you didn't
            // read cancels rather than destroys.
            confirmNoEl.focus();
          });
        }

        confirmYesEl.addEventListener('click', function() { closeConfirm(true); });
        confirmNoEl.addEventListener('click', function() { closeConfirm(false); });
        document.getElementById('confirm-close').addEventListener('click', function() { closeConfirm(false); });
        // The scrim itself, not the dialog sitting on it.
        scrimEl.addEventListener('click', function(ev) { if (ev.target === scrimEl) closeConfirm(false); });

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
          var ok = await askConfirm({
            title: 'Merge locally?',
            body: 'Merging ' + slug + ' into your checkout replaces any uncommitted changes of yours that clash with the agent\\'s version — those are recoverable, with "git stash pop". The worktree is deleted afterwards.',
            confirmLabel: 'Merge locally',
          });
          if (!ok) return;
          var btn = document.getElementById('ship-btn');
          btn.disabled = true; btn.textContent = 'shipping…';
          try {
            var res = await fetch(daemonOrigin + '/worktrees/' + encodeURIComponent(slug) + '/ship', { method: 'POST' });
            var json = await res.json();
            if (!res.ok) throw new Error(json.error || 'merge failed');
            // Merging overwrites uncommitted files that stand in its way. They are
            // recoverable, but only if we say so — otherwise the work looks lost.
            if (json.replaced && json.replaced.length) {
              alert('Merged. Your uncommitted changes to ' + json.replaced.join(', ') +
                ' were replaced by the agent\\'s version.\\n\\nThe old contents are saved — run "git stash pop" to get them back.');
            }
            // On success the daemon broadcasts worktree:removed and the dropdown switches to main.
          } catch (e) {
            alert('Merge failed: ' + (e && e.message ? e.message : String(e)));
          } finally {
            btn.disabled = false; btn.textContent = 'Merge locally';
          }
        });

        // Asks nothing: unlike Merge and Discard this destroys nothing — the
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
          var ok = await askConfirm({
            title: 'Discard worktree?',
            body: 'Discarding ' + slug + ' kills its dev server and deletes the worktree directory. Its branch lives inside that directory, so any uncommitted or unmerged work there is lost.',
            confirmLabel: 'Discard',
          });
          if (!ok) return;
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
        });
        setTimeout(function() {
          if (!iframeLoaded) { iframeEl.style.display = 'none'; emptyEl.style.display = 'flex'; }
        }, 5000);
      })();
    </script>
  </body>
</html>`;
}
