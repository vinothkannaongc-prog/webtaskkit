import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const description = "Free browser tools for QR codes, barcodes, TXT-to-PDF, SVG and text editing, and tone generation. No signup; your files stay on your device.";
const siteUrl = "https://webtaskkit.com";
const socialImage = `${siteUrl}/webtaskkit-og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "WebTaskKit - Fast, Private Online Tools", template: "%s | WebTaskKit" },
  description,
  applicationName: "WebTaskKit",
  keywords: ["online tools", "browser tools", "QR code generator", "barcode generator", "TXT to PDF"],
  authors: [{ name: "WebTaskKit" }],
  creator: "WebTaskKit",
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "WebTaskKit",
    title: "WebTaskKit - Everyday web tasks, handled.",
    description,
    images: [{ url: socialImage, width: 1729, height: 910, alt: "WebTaskKit - Everyday web tasks, handled." }],
  },
  twitter: { card: "summary_large_image", title: "WebTaskKit - Everyday web tasks, handled.", description, images: [socialImage] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f8fa",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <SiteHeader />
        <div id="main-content">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
