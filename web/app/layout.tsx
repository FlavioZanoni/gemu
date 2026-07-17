import type { Metadata } from "next";
import Script from "next/script";
import { Alfa_Slab_One, Space_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const alfaSlabOne = Alfa_Slab_One({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["400"],
});

const spaceMono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const description =
  "Free Jackbox-style party games in your browser: draw & guess, Scattergories, telephone drawing, trivia, bluffing and card games. Create a room, share the code, play with friends — no accounts, no installs.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Gemu — party games with friends, right in the browser",
    template: "%s · Gemu",
  },
  description,
  keywords: [
    "party games",
    "browser games",
    "jackbox alternative",
    "draw and guess",
    "gartic",
    "scattergories",
    "stop game",
    "trivia with friends",
    "cards against humanity online",
    "multiplayer games free",
  ],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Gemu",
    title: "Gemu — party games with friends, right in the browser",
    description,
    locale: "en_US",
    alternateLocale: "pt_BR",
  },
  twitter: {
    card: "summary",
    title: "Gemu — party games with friends",
    description,
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#1C1230",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${alfaSlabOne.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider>{children}</I18nProvider>
        <Script
          defer
          src="https://analytics.frav.in/script.js"
          data-website-id="55f9f18f-d598-44ef-9df7-a211b9a48cbe"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
