import type { Metadata } from 'next';
import './globals.css';
import { ToastHost } from '@/components/ui/toast';

export const metadata: Metadata = {
  title: 'HumaNest Platform Admin',
  description: 'HumaNest platform administration — customers, licences, modules and revenue.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
