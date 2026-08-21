/** @jsxImportSource preact */
import type { JSX } from 'preact';

/**
 * Shared SVG glyphs for the overlay UI, extracted from the inline icon
 * components that used to live in pill.tsx / picked-popover.tsx / task-chat.tsx /
 * task-panel.tsx / settings-panel.tsx. Inlined as components (stroke =
 * currentColor so they take the host element's ink color) rather than imported
 * assets, to stay bundler-agnostic across the daemon's Bun build and the
 * example's Next/SWC build.
 *
 * Each export accepts an optional `size` (defaulting to the glyph's original
 * size) and spreads the rest onto the <svg>. SVG attributes are kebab-case
 * (stroke-width, stroke-linecap) — Preact accepts both; this normalizes the mix
 * the originals had.
 */

type IconProps = Omit<JSX.SVGAttributes<SVGSVGElement>, 'width' | 'height'> & {
  size?: number;
};

// ---------- check ----------

/** Small check (vb 10×10, sw 1.33333) — worktree toggle + reasoning menu rows. */
export function CheckIcon({ size = 9, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8.33366 2.5L3.75033 7.08333L1.66699 5"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Check for the settings checkbox (vb 10×10, sw 1.5). */
export function CheckboxCheckIcon({ size = 10, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8.33366 2.5L3.75033 7.08333L1.66699 5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Result-row check (vb 16×16, sw 1.6) — the chat transcript "done" row. */
export function ResultCheckIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3.5 8.5 L6.5 11.5 L12.5 5"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// ---------- chevrons ----------

/** Right chevron (vb 16×16, sw 1.33333) — model submenu + settings rows. */
export function ChevronRightIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/**
 * Down chevron (vb 16×16, sw 1.33333) — the model/reasoning picker's drill row.
 *
 * A right chevron there used to mean "a submenu opens beside this". The menu
 * swaps its own contents in place now, so pointing sideways at a panel that
 * never appears was a promise the UI stopped keeping.
 */
export function ChevronDownIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Left chevron (vb 16×16, sw 1.33333) — settings back button. */
export function ChevronLeftIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 4L6 8L10 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Thin right chevron (vb 16×16, sw 1.5) — chat thinking/tool disclosure. */
export function ThinChevronRightIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 3 L11 8 L6 13"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Thin left chevron (vb 16×16, sw 1.5) — chat tab-bar back button. */
export function ThinChevronLeftIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 3 L5 8 L10 13"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// ---------- plus ----------

/** Plus (vb 16×16, sw 1.33333) — picked-popover attach button. */
export function PlusIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.99967 3.3335V12.6668M3.33301 8.00016H12.6663"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Thin plus (vb 16×16, sw 1.4) — chat composer + tab-bar add buttons. */
export function PlusThinIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" {...props}>
      <path d="M8 3 V13 M3 8 H13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

// ---------- arrow / send / stop ----------

/** Up arrow (vb 24×24, sw 2) — picked-popover send button.
 *  viewBox 24 + stroke 2 → glyph spans 58% of the box at a 0.083 stroke ratio,
 *  identical to the Plus (9.33/16 span, 1.333/16 stroke), so they render the same size. */
export function ArrowUpIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 19V5M19 12L12 5L5 12"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Send arrow (vb 16×16, sw 1.7) — chat composer send button. */
export function SendIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 13 V3.5 M3.8 7.7 L8 3.5 L12.2 7.7"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Stop square (vb 16×16, filled) — chat composer cancel button. */
export function StopIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// ---------- task actions ----------

/**
 * Retry — a counter-clockwise arrow returning to its start (vb 24×24, sw 2).
 *
 * Same viewBox/stroke ratio as ArrowUpIcon, so it renders at the same visual
 * weight as the popover's send arrow at a given `size`.
 */
export function RetryIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" {...props}>
      <path
        d="M2 10C2 10 4.00498 7.26822 5.63384 5.63824C7.26269 4.00827 9.5136 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.89691 21 4.43511 18.2543 3.35177 14.5M8 10H2V4"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// ---------- close ----------

/** Close X (vb 16×16, sw 1.33333) — pill toolbar close button. */
export function CloseIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 4L4 12M4 4L12 12"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Close X (vb 16×16, sw 1.4) — chat tab close button. */
export function CloseSmallIcon({ size = 12, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" {...props}>
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** Close X (vb 16×16, sw 1.5) — task-panel header close button. */
export function CloseThinIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" {...props}>
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  );
}

// ---------- pill glyphs ----------

/** Cursor-click star (vb 24×24, sw 2) — the collapsed pill launcher glyph. */
export function CursorIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 3.5V2M5.06066 5.06066L4 4M5.06066 13L4 14.0607M13 5.06066L14.0607 4M3.5 9H2M8.5 8.5L12.6111 21.2778L15.5 18.3889L19.1111 22L22 19.1111L18.3889 15.5L21.2778 12.6111L8.5 8.5Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Message-circle (vb 16×16, sw 1.33333) — the pill chat button. */
export function ChatIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.0001 7.66667C14.0001 10.7963 11.463 13.3333 8.33341 13.3333C7.61556 13.3333 6.92888 13.1999 6.29685 12.9564C6.18129 12.9118 6.12351 12.8896 6.07756 12.879C6.03237 12.8686 5.99966 12.8642 5.95332 12.8624C5.9062 12.8606 5.85451 12.866 5.75112 12.8767L2.3371 13.2296C2.01161 13.2632 1.84886 13.2801 1.75286 13.2215C1.66924 13.1705 1.61229 13.0853 1.59713 12.9885C1.57972 12.8774 1.65749 12.7335 1.81303 12.4456L2.90347 10.4272C2.99327 10.261 3.03817 10.1779 3.05851 10.098C3.0786 10.019 3.08345 9.96213 3.07703 9.88095C3.07052 9.79875 3.03446 9.69175 2.96232 9.47774C2.77064 8.90906 2.66674 8.3 2.66674 7.66667C2.66674 4.53705 5.2038 2 8.33341 2C11.463 2 14.0001 4.53705 14.0001 7.66667Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Settings gear (vb 16×16, sw 1.33333) — the pill settings button. */
export function SettingsIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.26369 12.9142L6.65332 13.7905C6.76914 14.0514 6.95817 14.273 7.19747 14.4286C7.43677 14.5841 7.71606 14.6669 8.00147 14.6668C8.28687 14.6669 8.56616 14.5841 8.80546 14.4286C9.04476 14.273 9.23379 14.0514 9.34961 13.7905L9.73924 12.9142C9.87794 12.6033 10.1112 12.3441 10.4059 12.1735C10.7024 12.0025 11.0455 11.9296 11.3859 11.9653L12.3392 12.0668C12.623 12.0968 12.9094 12.0439 13.1637 11.9144C13.418 11.7849 13.6292 11.5844 13.7718 11.3372C13.9146 11.0902 13.9826 10.807 13.9677 10.5221C13.9527 10.2372 13.8553 9.9627 13.6874 9.73202L13.1229 8.95646C12.922 8.67825 12.8146 8.34337 12.8163 8.00016C12.8162 7.65789 12.9246 7.3244 13.1259 7.04757L13.6904 6.27201C13.8583 6.04133 13.9556 5.76688 13.9706 5.48195C13.9856 5.19701 13.9176 4.91386 13.7748 4.66683C13.6322 4.41965 13.4209 4.21916 13.1667 4.08965C12.9124 3.96014 12.626 3.90718 12.3422 3.9372L11.3889 4.03868C11.0484 4.07444 10.7054 4.00158 10.4089 3.83053C10.1136 3.659 9.88025 3.3984 9.74221 3.08609L9.34961 2.20979C9.23379 1.94894 9.04476 1.72731 8.80546 1.57176C8.56616 1.41622 8.28687 1.33345 8.00147 1.3335C7.71606 1.33345 7.43677 1.41622 7.19747 1.57176C6.95817 1.72731 6.76914 1.94894 6.65332 2.20979L6.26369 3.08609C6.12564 3.3984 5.89227 3.659 5.59702 3.83053C5.3005 4.00158 4.95747 4.07444 4.61702 4.03868L3.66072 3.9372C3.37694 3.90718 3.09055 3.96014 2.83627 4.08965C2.58198 4.21916 2.37073 4.41965 2.22813 4.66683C2.08535 4.91386 2.01732 5.19701 2.03231 5.48195C2.0473 5.76688 2.14466 6.04133 2.31258 6.27201L2.87702 7.04757C3.07831 7.3244 3.18671 7.65789 3.18665 8.00016C3.18671 8.34244 3.07831 8.67593 2.87702 8.95276L2.31258 9.72831C2.14466 9.95899 2.0473 10.2335 2.03231 10.5184C2.01732 10.8033 2.08535 11.0865 2.22813 11.3335C2.37088 11.5805 2.58215 11.7809 2.8364 11.9104C3.09064 12.0399 3.37697 12.093 3.66072 12.0631L4.61406 11.9616C4.9545 11.9259 5.29753 11.9987 5.59406 12.1698C5.89041 12.3408 6.12486 12.6015 6.26369 12.9142Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8.00027 10.0002C9.10484 10.0002 10.0003 9.10473 10.0003 8.00016C10.0003 6.89559 9.10484 6.00016 8.00027 6.00016C6.8957 6.00016 6.00027 6.89559 6.00027 8.00016C6.00027 9.10473 6.8957 10.0002 8.00027 10.0002Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// ---------- theme toggle ----------

/** Sun (vb 16×16, sw 1.33333) — settings light-mode toggle. */
export function SunIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 1.3335V2.66683M8 13.3335V14.6668M2.66667 8.00016H1.33333M4.22876 4.22892L3.28595 3.28612M11.7712 4.22892L12.714 3.28612M4.22876 11.7721L3.28595 12.7149M11.7712 11.7721L12.714 12.7149M14.6667 8.00016H13.3333M11.3333 8.00016C11.3333 9.84111 9.84095 11.3335 8 11.3335C6.15905 11.3335 4.66667 9.84111 4.66667 8.00016C4.66667 6.15921 6.15905 4.66683 8 4.66683C9.84095 4.66683 11.3333 6.15921 11.3333 8.00016Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Moon (vb 16×16, sw 1.33333) — settings dark-mode toggle. */
export function MoonIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14 8.52732C13.8959 9.65327 13.4727 10.7261 12.7793 11.6195C12.0858 12.5129 11.1517 13.1888 10.0866 13.5688C9.02147 13.9488 7.86987 14.0172 6.76709 13.766C5.66431 13.5147 4.65649 12.9544 3.86225 12.1502C3.06801 11.3459 2.51974 10.3315 2.28133 9.22636C2.04293 8.12122 2.12431 6.97095 2.51593 5.91029C2.90755 4.84962 3.59302 3.92295 4.49321 3.23938C5.3934 2.5558 6.47165 2.14431 7.6 2.0533C6.94946 2.93351 6.63647 4.01851 6.71765 5.11055C6.79883 6.20259 7.26886 7.22941 8.04269 8.0033C8.81652 8.77719 9.84334 9.24729 10.9354 9.32847C12.0274 9.40965 13.1124 9.09666 13.9926 8.44612L14 8.52732Z"
        stroke="currentColor"
        stroke-width="1.33333"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// ---------- background tasks ----------

/** Stacked layers (vb 24×24, sw 1.8). Inherits `currentColor` by default so the
 *  task launcher can drive it from CSS — ink at rest, accent on hover. */
export function BackgroundTasksIcon({
  color = 'currentColor',
  size = 18,
}: { color?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      {/* kebab-case attrs — Preact doesn't map camelCase SVG props, so strokeWidth
          was being dropped. 1.8 in a 24 viewBox ≈ the modal icons' visual weight. */}
      <g
        stroke={color}
        stroke-width="1.8"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {/* Stacked layers — one sheet per queued task. Drawn back-to-front so the
            top sheet's fill-free outline reads clearly over the two beneath. */}
        <path d="M7 9.49958L2 11.9996L11.6422 16.8207C11.7734 16.8863 11.839 16.9191 11.9078 16.932C11.9687 16.9434 12.0313 16.9434 12.0922 16.932C12.161 16.9191 12.2266 16.8863 12.3578 16.8207L22 11.9996L17 9.49958" />
        <path d="M7 14.4996L2 16.9996L11.6422 21.8207C11.7734 21.8863 11.839 21.9191 11.9078 21.932C11.9687 21.9434 12.0313 21.9434 12.0922 21.932C12.161 21.9191 12.2266 21.8863 12.3578 21.8207L22 16.9996L17 14.4996" />
        <path d="M2 6.99958L11.6422 2.17846C11.7734 2.11287 11.839 2.08008 11.9078 2.06717C11.9687 2.05574 12.0313 2.05574 12.0922 2.06717C12.161 2.08008 12.2266 2.11287 12.3578 2.17846L22 6.99958L12.3578 11.8207C12.2266 11.8863 12.161 11.9191 12.0922 11.932C12.0313 11.9434 11.9687 11.9434 11.9078 11.932C11.839 11.9191 11.7734 11.8863 11.6422 11.8207L2 6.99958Z" />
      </g>
    </svg>
  );
}

// ---------- file ----------

/** Document outline with a folded corner (vb 24×24) — the transcript's edit cards. */
export function FileIcon({ size = 14, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M14 3v5h5" />
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    </svg>
  );
}
