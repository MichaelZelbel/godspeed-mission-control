// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import Identity from "./Identity";
import { InstructionsMoved } from "@/components/profile/InstructionsMoved";
import { reflow, sizeLine, sizeState, versionLine } from "@/lib/identity";

vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

// The Identity page against a fictional server: what it shows, and what it sends.
const who = "You are Orbit, my assistant.\nPlain and kind.";
const overview = (over: Record<string, unknown> = {}) => ({
  manual: { exists: true, chars: 18900, limit: 20000, warn: 19000, rules_list: "ok" },
  who: { state: "ok", text: who, hash: "h-who" },
  soul: { kind: "ours" },
  rules: [{ target: "rule:never-spend", slug: "never-spend", title: "Never spend my money", line: "Buy anything for me.", group: "never", always: true }],
  profile: [{ target: "profile:about-me", name: "about-me", title: "About me", preview: "I grow tomatoes." }],
  skills: [{ target: "skill:keep-a-note", name: "keep-a-note", description: "File a note.", origin: "shipped" }],
  ...over,
});
const versions = [
  { id: "c2", at: "2026-10-15T08:00:00Z", current: true, removed: false, by: "you, on this page", message: "changed who it is", text: who },
  { id: "c1", at: "2026-10-14T08:00:00Z", current: false, removed: false, by: "kept by your notebook", message: "kept the version from before the next change", text: "You are Godspeed." },
];
let calls: { route: string; body?: any }[] = [];
let state: ReturnType<typeof overview>;
function serve() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const route = String(url), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ route, body });
    const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (route === "/api/identity") return json(state);
    if (route.startsWith("/api/identity/item")) return json({ target: "who", kind: "who", file: "AGENTS.md", label: "who it is", state: "ok", text: who, hash: "h-who", manual: state.manual });
    if (route.startsWith("/api/identity/history")) return json({ data: versions });
    if (route === "/api/identity/instructions") return json({ data: [{ id: "i1", instruction: "Always address me as Sam.", applies_to: "all", is_active: true, removed: false, hash: "h-i1", updated_at: null }] });
    if (route.startsWith("/api/identity/")) return json({ saved: true, now: { text: "x", hash: "h2" } });
    return json({ error: "unknown" }, 404);
  }));
}
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Identity /></MemoryRouter></QueryClientProvider>);
}

describe("Identity page", () => {
  beforeEach(() => { state = overview(); serve(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the four parts in plain words, with the instructions beside the rules", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Who it is" })).toBeVisible();
    for (const name of ["What it may and may not do", "What it knows about you", "How it does its jobs"]) expect(screen.getByRole("heading", { name })).toBeVisible();
    expect(screen.getByText("You are Orbit, my assistant. Plain and kind.")).toBeVisible();
    expect(screen.getByText("Never spend my money")).toBeVisible();
    expect(screen.getByText("Kept up to date by updates")).toBeVisible();
    expect(await screen.findByText("Always address me as Sam.")).toBeVisible();
    expect(screen.getByText(/Your manual: 18,900 of 20,000 characters\. Short enough for you to read all of it\./)).toBeVisible();
    for (const word of [/markdown/i, /commit/i, /repository/i, /persona/i]) expect(document.body.textContent).not.toMatch(word);
  });

  it('saves "who it is" with the version it was opened from, and warns before the manual grows too long', async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const box = await screen.findByLabelText("Its name and character, in your words");
    expect(box).toHaveValue("You are Orbit, my assistant. Plain and kind.");
    fireEvent.change(box, { target: { value: "You are Speedy. " + "Very long. ".repeat(20) } });
    expect(screen.getByRole("alert")).toHaveTextContent(/of 20,000 characters\. Is it short enough for you to read all of it\?/);
    fireEvent.change(box, { target: { value: "You are Speedy. " + "Very long. ".repeat(120) } });
    expect(screen.getByRole("alert")).toHaveTextContent(/drops the middle/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "You are Speedy." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.route === "/api/identity/save")?.body).toEqual({ target: "who", text: "You are Speedy.", expected_hash: "h-who" }));
  });

  it("lists the earlier versions with their dates, undoes the last change and restores any version", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Earlier versions" }));
    expect(await screen.findByText("2 versions, newest first.")).toBeVisible();
    expect(screen.getByText(/As it was before the next change, kept by your notebook/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Undo last change" }));
    await waitFor(() => expect(calls.find((c) => c.route === "/api/identity/undo")?.body).toEqual({ target: "who", expected_hash: "h-who" }));
    const older = screen.getAllByRole("listitem").find((li) => within(li).queryByRole("button", { name: "Restore this version" }))!;
    fireEvent.click(within(older).getByRole("button", { name: "Show" }));
    expect(within(older).getByText("You are Godspeed.")).toBeVisible();
    fireEvent.click(within(older).getByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(calls.find((c) => c.route === "/api/identity/restore")?.body).toEqual({ target: "who", version: "c1", expected_hash: "h-who" }));
  });

  it('offers to mark "who it is" in a manual without the marks, instead of failing', async () => {
    state = overview({ who: { state: "no-markers", proposal: "You are Orbit." } });
    open();
    expect(await screen.findByText(/does not mark which paragraph says who your assistant is/)).toBeVisible();
    expect(screen.getByText("You are Orbit.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark it" }));
    await waitFor(() => expect(calls.some((c) => c.route === "/api/identity/mark-who")).toBe(true));
  });

  it("names an identity file of the assistant's program that its owner wrote, and replaces it only when asked", async () => {
    state = overview({ soul: { kind: "own", text: "You are Jeeves." } });
    open();
    expect(await screen.findByText("You are Jeeves.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Use \"who it is\" there too" }));
    await waitFor(() => expect(calls.some((c) => c.route === "/api/identity/assistant-identity")).toBe(true));
  });
});

describe("My Profile's instructions tab", () => {
  it("leads to the instructions on the Identity page", () => {
    render(<MemoryRouter><InstructionsMoved count={2} /></MemoryRouter>);
    expect(screen.getByText(/All 2 of yours are there, unchanged/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open your instructions" })).toHaveAttribute("href", "/dashboard/identity#instructions");
    cleanup();
  });
});

describe("identity helpers", () => {
  const size = { chars: 0, limit: 20000, warn: 19000 };
  it("says how big the manual is in the book's words", () => {
    expect(sizeState(18000, size)).toBe("fine");
    expect(sizeState(19500, size)).toBe("near");
    expect(sizeState(20000, size)).toBe("over");
    expect(sizeLine(19500, size)).toMatch(/Is it short enough for you to read all of it\?/);
  });
  it("reflows a paragraph the file wraps, keeping blank lines", () => {
    expect(reflow("One\ntwo\n\nThree")).toBe("One two\n\nThree");
  });
  it("words a version without its machinery", () => {
    expect(versionLine({ id: "x", at: "", current: false, removed: false, by: "", message: "changed who it is (asked in chat)" })).toBe("Changed who it is");
  });
});
