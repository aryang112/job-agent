import type { Metadata } from "next";
export const metadata: Metadata = { title: "Job Agent — Aryan Gupta", description: "Daily job pipeline" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, background: "#080c18", fontFamily: "'IBM Plex Mono', monospace" }}>{children}</body>
    </html>
  );
}
