import './globals.css';
import { LocalAgents } from '@localagents/react';
// Third-party: Benji Taylor's Agentation (visual feedback for agents) — added
// to A/B against our own overlay. devDependency only; PolyForm-Shield licensed.
import { Agentation } from 'agentation';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'localagents example',
  description: 'Click an element, queue a task.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <LocalAgents />
        <Agentation />
      </body>
    </html>
  );
}
