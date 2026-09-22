import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { getMessages } from "@/lib/messages";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-arabic",
  display: "swap",
});

const messages = getMessages();

export const metadata: Metadata = {
  title: `${messages.site.name} — ${messages.site.tagline}`,
  description: messages.site.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plexArabic.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
