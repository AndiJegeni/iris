import './globals.css';
import { Iris } from '@useiris/react';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'iris example',
  description: 'Click an element, queue a task.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Iris />
      </body>
    </html>
  );
}
