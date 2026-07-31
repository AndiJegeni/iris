/** @jsxImportSource preact */
import { render } from 'preact';
import { Overlay } from './overlay';

export const OVERLAY_HOST_ID = '__iris_overlay__';

const SHADOW_RESET = `
  :host {
    all: initial;
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
  }
  * {
    box-sizing: border-box;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
`;

function mount(): void {
  if (typeof window === 'undefined') return;
  if (document.getElementById(OVERLAY_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = OVERLAY_HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = SHADOW_RESET;
  shadow.appendChild(style);

  const rootEl = document.createElement('div');
  shadow.appendChild(rootEl);

  render(<Overlay />, rootEl);
}

// Run on import. Defer until DOM is ready.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
