import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans, Unbounded } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const display = Unbounded({
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "BackdropAds",
  description: "Open-source AI ad generator: turn a prompt, a photo or a link into ready-to-run image and video ads.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${sans.variable} ${mono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
