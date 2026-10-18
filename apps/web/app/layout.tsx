import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArcTrace — accountable document sharing',
  description: 'Share encrypted documents, record each authorized open, and investigate leaks with verifiable evidence.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
