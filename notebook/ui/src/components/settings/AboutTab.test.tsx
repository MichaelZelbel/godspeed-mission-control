// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { AboutTab, type AboutInfo, type AutomaticInfo, type UpdateInfo } from "./AboutTab";

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
const notes = "https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/candidate/2.0.0-beta.30";
const upToDate: UpdateInfo = {
  installed: "2.0.0-beta.30", newest: { tag: "candidate/2.0.0-beta.30", version: "2.0.0-beta.30", notes },
  newer: false, way: "handover", command: null, busy: false, status: null, error: null,
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function show(about: AboutInfo, update: UpdateInfo = upToDate) {
  vi.stubGlobal("fetch", vi.fn(async (address: string, init?: RequestInit) => {
    if (address !== "/api/update") return json(about);
    return init?.method === "POST" ? json({ started: true, status: { state: "checking", from: update.installed, to: "2.0.0-beta.30", message: "Getting 2.0.0-beta.30 ready.", at: "2026-11-11T11:00:00.000Z" } }, 202) : json(update);
  }));
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

  it("says when the newest version is installed", async () => {
    show(computer);
    expect(await screen.findByText("You have the newest version.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "What changed" })).toHaveAttribute("href", notes);
    expect(screen.queryByRole("button", { name: "Update now" })).not.toBeInTheDocument();
  });

  it("offers Update now when a newer version exists, and starts the update", async () => {
    show(computer, { ...upToDate, installed: "2.0.0-beta.20", newer: true });
    expect(await screen.findByText(/Newest version: 2\.0\.0-beta\.30/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/update", { method: "POST" }));
  });

  it("after Update now, an earlier update's failure does not bring the button back before this one reports", async () => {
    show(computer, { ...upToDate, installed: "2.0.0-beta.20", newer: true, status: { state: "failed", from: "2.0.0-beta.20", to: "2.0.0-beta.30", message: "The update to 2.0.0-beta.30 did not finish. The version you have is still running.", at: "2026-11-11T10:00:00.000Z" } });
    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    expect(await screen.findByText("Starting the update…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update now" })).not.toBeInTheDocument();
  });

  it("on a Docker server shows the line to run on the server instead of a button", async () => {
    show({ ...computer, on: "server" }, { ...upToDate, installed: "2.0.0-beta.20", newer: true, way: "server", command: "sudo godspeed-update" });
    expect(await screen.findByText("sudo godspeed-update")).toBeInTheDocument();
    expect(screen.getByText(/one click is updated in that company's panel/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update now" })).not.toBeInTheDocument();
  });

  it("says plainly when an update failed", async () => {
    show(computer, { ...upToDate, installed: "2.0.0-beta.20", newer: true, status: { state: "failed", from: "2.0.0-beta.20", to: "2.0.0-beta.30", message: "The download of 2.0.0-beta.30 does not match the checksum its release publishes, so nothing was installed. The version you have keeps running.", at: "2026-11-11T10:00:00.000Z" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not match the checksum.*The version you have keeps running\./);
  });

  it("on a Docker server says in one line why it cannot update itself automatically, and offers no choice", async () => {
    const reason = "On a Docker server Godspeed is updated on the server itself (sudo godspeed-update), so it cannot update itself automatically.";
    show({ ...computer, on: "server" }, { ...upToDate, way: "server", automatic: { offered: false, reason, choice: "myself", time: "04:00", paused: null, last: null } });
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Update automatically" })).not.toBeInTheDocument();
  });

  it("reads Update myself until the person chooses Update automatically, which then shows the time", async () => {
    let automatic: AutomaticInfo = { offered: true, reason: null, choice: "myself", time: "04:00", paused: null, last: null };
    const asked: { body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (address: string, init?: RequestInit) => {
      if (address === "/api/update/automatic") { const change = JSON.parse(String(init?.body)); asked.push({ body: change }); automatic = { ...automatic, ...change }; return json(automatic); }
      if (address === "/api/update") return json({ ...upToDate, automatic });
      return json(computer);
    }));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AboutTab /></QueryClientProvider>);
    expect(await screen.findByRole("radio", { name: "Update myself" })).toBeChecked();
    expect(screen.queryByLabelText("Install at")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Update automatically" }));
    await waitFor(() => expect(asked).toEqual([{ body: { choice: "automatic" } }]));
    expect(await screen.findByLabelText("Install at")).toHaveValue("04:00");
    expect(screen.getByRole("radio", { name: "Update automatically" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Pause until I turn it back on" }));
    await waitFor(() => expect(asked.at(-1)).toEqual({ body: { paused: { until: null } } }));
  });
});
