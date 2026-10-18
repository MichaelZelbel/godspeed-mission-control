// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { AboutTab, type AboutInfo } from "./AboutTab";

// Settings, About (18 October 2026): the README and the food tracker send readers here.
const food: AboutInfo["food"] = {
  installed: true, notice: "/home/reader/godspeed-v2/.godspeed/food/bls-4.0/NOTICE.md", downloaded_at: "2026-10-18T08:00:00.000Z",
  table: "Bundeslebensmittelschlüssel (BLS) 4.0", publisher: "Max Rubner-Institut", licence: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/", citation: "Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0",
  source_url: "https://www.blsdb.de", packaged: "Packaged food looked up by barcode or brand comes from Open Food Facts (https://openfoodfacts.org), under the ODbL.",
};
const computer: AboutInfo = {
  name: "Godspeed Mission Control", version: "2.0.0-beta.1", on: "computer",
  release: { code: "69967129e488417d8d5acb42340363239427092a", date: "2026-10-18T00:49:22+02:00", installed_by: "windows" },
  folders: { workspace: "/home/reader/godspeed-v2", notes: "/home/reader/godspeed-v2/notebook", media: "/home/reader/godspeed-v2/.godspeed/integrated-runtime/media", backups: "/home/reader/godspeed-v2/.godspeed/backups" },
  food,
};
function show(about: AboutInfo) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(about), { status: 200, headers: { "Content-Type": "application/json" } })));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AboutTab /></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AboutTab", () => {
  it("names the version, the release code, the folders, the food table's licence and the guide", async () => {
    show(computer);
    expect(await screen.findByText("2.0.0-beta.1")).toBeInTheDocument();
    expect(screen.getByText("69967129e488417d8d5acb42340363239427092a")).toBeInTheDocument();
    for (const folder of Object.values(computer.folders)) expect(screen.getByText(folder)).toBeInTheDocument();
    expect(screen.getByText("Your mission control folder")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    expect(screen.getByText(food.notice!)).toBeInTheDocument();
    expect(screen.getByText(/Citation: Max Rubner-Institut \(2025\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "openfoodfacts.org" })).toHaveAttribute("href", "https://openfoodfacts.org");
    expect(screen.getByRole("link", { name: "godspeedmissioncontrol.com/guide" })).toHaveAttribute("href", "https://godspeedmissioncontrol.com/guide");
    expect(screen.getByRole("link", { name: "Known issues" })).toHaveAttribute("href", "https://godspeedmissioncontrol.com/guide/known-issues");
    expect(screen.getByRole("link", { name: /newer release/ })).toHaveAttribute("href", "https://godspeedmissioncontrol.com/guide/update#check-which-release-you-have");
  });

  it("says plainly when no release code was recorded, when the folders are on a server and when the food table is not there yet", async () => {
    show({ ...computer, on: "server", release: null, food: { ...food, installed: false, notice: null, downloaded_at: null } });
    expect(await screen.findByText(/Not recorded\. This copy was not set up by one of the installers\./)).toBeInTheDocument();
    expect(screen.getByText("These folders are on your server.")).toBeInTheDocument();
    expect(screen.getByText(/The food table is not on your server yet\./)).toBeInTheDocument();
  });
});
