import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JARVIS", template: "%s | JARVIS" },
  description: "Operations command center for Shopify brands.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
