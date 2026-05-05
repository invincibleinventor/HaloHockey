import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HALO HOCKEY // Camera-fed Air Hockey",
  description:
    "Two-player WebRTC air hockey controlled with your hands. Camera-fed, computer-vision powered, deeply VFX'd.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#05010d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="arcade-bg">{children}</body>
    </html>
  );
}
