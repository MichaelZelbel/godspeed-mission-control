// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import Control from "./Control";
import { WAIT } from "@/test/wait-limits";

// Issue #1019: a link to a section of Settings went to ?tab=telegram, which Settings ignores, so
// it opened the top of the page. Settings follows only #section addresses. Every link to Settings
// in the source must name a section by # and that section must exist on the page.
vi.mock("@/components/settings/ApiKeysManager", () => ({ ApiKeysManager: () => <p>Keys</p> }));
vi.mock("@/components/settings/AISuggestionPreferences", () => ({ AISuggestionPreferences: () => null }));
vi.mock("@/components/settings/AiVisibilitySettings", () => ({ AiVisibilitySettings: () => null }));
vi.mock("@/components/settings/NotificationPreferences", () => ({ NotificationPreferences: () => null }));
vi.mock("./Notifications", () => ({ Notifications: () => null }));
vi.mock("@/components/settings/AboutTab", () => ({ AboutTab: () => null }));
vi.mock("./PersonalControl", () => ({ PersonalControl: () => null }));
vi.mock("./MeaningSearch", () => ({ MeaningSearch: () => null }));
vi.mock("./ConnectTelegram", () => ({ TelegramConnect: () => null, telegramStatus: async () => ({ available: false }), telegramUnavailable: "unavailable", telegramSwitchedOff: "off" }));
vi.mock("./RecordSync", () => ({ RecordSyncForm: () => null }));

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return /\.(tsx?|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

const links = sourceFiles(SRC).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/["'`](\/dashboard\/settings|\/settings)([?#][^"'`\s]*)["'`]/g)].map((m) => ({ file: file.slice(SRC.length + 1), suffix: m[2] })),
);

describe("Every link to a section of Settings", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("names the section with #, never with ?", () => {
    expect(links.filter((l) => l.suffix.startsWith("?")).map((l) => `${l.file}: ${l.suffix}`)).toEqual([]);
  });

  const anchors = [...new Set(links.filter((l) => l.suffix.startsWith("#")).map((l) => l.suffix.slice(1)))];

  it("finds the links it is meant to check", () => {
    expect(anchors.length).toBeGreaterThanOrEqual(3);
  });

  it("points at a section that Settings renders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [], schedules: [], kinds: [], problems: [], conflicts: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/dashboard/settings"]}>
          <Routes><Route path="/dashboard/settings" element={<Control />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const id of anchors) await waitFor(() => expect(container.querySelector("#" + CSS.escape(id)), id).not.toBeNull(), WAIT);
  });
});
