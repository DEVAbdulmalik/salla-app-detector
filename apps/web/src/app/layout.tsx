import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { getMessages } from "@/lib/messages";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-arabic",
  display: "swap",
});

const messages = getMessages();

const title = `${messages.site.name} — ${messages.site.tagline}`;

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title,
  description: messages.site.description,
  openGraph: {
    type: "website",
    locale: "ar_SA",
    siteName: messages.site.name,
    title,
    description: messages.site.description,
  },
  twitter: { card: "summary_large_image", title, description: messages.site.description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={plexArabic.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
