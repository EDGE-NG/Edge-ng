import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edge – Follow the trading rules you set",
  description:
    "Write down your trading edge, show Edge what your rules look like on a chart, and check every setup against them before you trade.",
};

// Applies the stored theme + motion preference before first paint (no FOUC).
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem("edge-theme");
  if (t !== "light" && t !== "dark") t = "dark";
  document.documentElement.setAttribute("data-theme", t);
  var m = localStorage.getItem("edge-motion");
  document.documentElement.setAttribute("data-motion", m === "reduce" ? "reduce" : "full");
} catch (e) {
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.setAttribute("data-motion", "full");
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600&family=Archivo:wdth,wght@100..125,400..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        {children}
        <Script
          id="edge-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </body>
    </html>
  );
}
