import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "RankPoint - Poin pemain", description: "Pencatat poin pertandingan bersama untuk banyak pemain.", manifest: "/manifest.webmanifest", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" }, appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "RankPoint" } };
export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="id" suppressHydrationWarning><body>{children}</body></html>; }
