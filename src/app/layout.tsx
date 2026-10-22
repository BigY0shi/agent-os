import type { Metadata } from "next";
import { Geist, Geist_Mono, Unbounded } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";
import { HydrateFleet } from "@/components/layout/HydrateFleet";
import JarvisOmnipresence from "@/components/v2/jarvis/JarvisOmnipresence";
import RunsTray from "@/components/RunsTray";
import { AuroraBackground } from "@/components/layout/AuroraBackground";
import { ParticleField } from "@/components/layout/ParticleField";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Display face (2026-09-28 type redesign, _design/jarvis-v3-plan.md): wide geometric,
// deliberately unlike NEXORA's high-contrast serif. Self-hosted by next/font.
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agentic OS — Mission Control",
  description: "Your command center for Claude, OpenClaw, Hermes",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${unbounded.variable} h-full antialiased`}>
      <head>
        {/*
          Type system (redesigned 2026-09-28): Unbounded (display) · Geist (UI and
          body) · Geist Mono (data and code), all self-hosted by next/font above.
          Caveat (hand-script numerals) is the one face still loaded from Google.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen overflow-hidden font-sans antialiased bg-black text-white">
        <HydrateFleet />
        <AuroraBackground />
        <ParticleField />
        <div className="relative z-10">
          <Shell>{children}</Shell>
        </div>
        {/* SPEC-C C1: Jarvis on every route — orb + hotkey SSE + C2b overlay */}
        <JarvisOmnipresence />
        <RunsTray />
      </body>
    </html>
  );
}
