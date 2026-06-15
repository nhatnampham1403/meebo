import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MeeBo — Task Capture',
  description: 'AI-assisted Trello task capture and hygiene automation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
