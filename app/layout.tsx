import './globals.css';
import type { Metadata } from 'next';
import { Inter, Nunito, Noto_Sans, Roboto, Open_Sans } from 'next/font/google';

const inter = Inter({ 
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  fallback: ['system-ui', 'arial'],
  preload: true,
  adjustFontFallback: true,
  variable: '--font-inter'
});

const nunito = Nunito({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-nunito'
});

const notoSans = Noto_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-noto-sans'
});

const roboto = Roboto({
  subsets: ['latin', 'latin-ext'],
  weight: ['300', '400', '500', '700'],
  display: 'swap',
  variable: '--font-roboto'
});

const openSans = Open_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-open-sans'
});

export const metadata: Metadata = {
  title: 'Some Player - OneSub™',
  description: 'Gelişmiş video oynatıcı ve akıllı altyazı sistemi',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className={`${inter.variable} ${nunito.variable} ${notoSans.variable} ${roboto.variable} ${openSans.variable} font-sans`}>{children}</body>
    </html>
  );
}
