import type React from 'react';
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/toaster';
import { ClerkProvider } from '@clerk/nextjs';

import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Readr — AI Research Assistant',
  description: 'Ask anything about your documents.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
