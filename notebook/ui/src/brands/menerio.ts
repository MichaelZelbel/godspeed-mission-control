import type { BrandConfig } from "./types";

// The default brand. Values here must mirror what the app shipped with
// before brand support existed - a build without VITE_BRAND set must be
// indistinguishable from the pre-brand app.
export const MENERIO: BrandConfig = {
  id: "menerio",
  name: "Godspeed Mission Control",
  domain: "menerio.com",
  url: "https://menerio.com",
  tagline: "One brain. Every AI. Capture, search, and connect your thoughts.",
  metaDescription:
    "Godspeed Mission Control turns your notes into a shared knowledge system for AI. Everything you write becomes structured, searchable, and usable across AI tools.",
  htmlTitle: "Godspeed Mission Control - AI-Powered Knowledge System",
  titleSuffix: " - Godspeed Mission Control",
  supportEmail: "support@menerio.com",
  ogImage: "https://menerio.com/og-image.png",
  personaName: "Mira",
  themeClass: null,
  defaultTheme: "dark",
  htmlThemeColor: "#0e121b",
  pwa: {
    name: "Godspeed Mission Control - AI-Powered Knowledge System",
    shortName: "Godspeed Mission Control",
    description: "Godspeed Mission Control turns your notes into a shared knowledge system for AI.",
    themeColor: "#0e121b",
    backgroundColor: "#0e121b",
  },
  navGroupOrder: ["notes", "people", "collections", "review"],
  dashboardVariant: "notes-first",
  dashboardSubline: "Your personal knowledge system at a glance.",
  marketingNav: [
    { label: "Home", to: "/" },
    { label: "Features", to: "/features" },
    { label: "Docs", to: "/docs" },
  ],
  showDocs: true,
  internalHosts: [
    "menerio.com",
    "www.menerio.com",
    "menerio.lovable.app",
    "cherishly.ai",
    "www.cherishly.ai",
  ],
  legal: { websiteUrl: "https://menerio.com" },
};
