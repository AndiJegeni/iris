import './globals.css';
import { LocalAgents } from '@localagents/react';
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
      </body>
    </html>
  );
}
