// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import Identity from "./Identity";
import { InstructionsMoved } from "@/components/profile/InstructionsMoved";
import { BRAIN_PAGE } from "@/lib/brain-page";
import { paragraphs, places, reflow, sizeLine, sizeState, versionLine, versionWords, type RuleTile } from "@/lib/identity";

vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// The chat docked on the page belongs to a signed-in owner.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }) }));
Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) });
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

// Godspeed's brain against a fictional server: what it shows, and what it sends.
const who = "You are Orbit, my assistant.\nPlain and kind.\n\nYou answer in short sentences.";
const rule = (n: number, slug: string, title: string, line: string, group: "must" | "never" | "how", always = true, place?: { key: string; label: string }) =>
  ({ target: "rule:" + slug, slug, n, title, line, group, always, where: always ? "always" : place?.key ?? "when-it-matters", ...(place ? { place } : {}) });
const overview = (over: Record<string, unknown> = {}) => ({
  manual: { exists: true, chars: 18900, limit: 20000, warn: 19000, rules_list: "ok" },
  who: { state: "ok", text: who, hash: "h-who" },
  extra: { state: "missing", text: "", hash: "h-extra" },
  soul: { kind: "ours", chars: 1500, limit: 20000, warn: 19000 },
  rules: [
    rule(1, "when-in-doubt-ask", "When in doubt, ask", "Ask me when you are unsure.", "must"),
    rule(2, "never-spend", "Never spend my money", "Buy anything for me.", "never"),
    rule(3, "founder-only", "Founder only", "Only the founder posts in company channels.", "how", false, { key: "company", label: "For the companies" }),
    rule(4, "brief-numbers", "Brief numbers", "Number every brief line.", "must", false, { key: "skill:daily-brief", label: "For the skill daily brief" }),
  ],
  profile: [{ n: 1, target: "profile:about-me", name: "about-me", title: "About me", preview: "I grow tomatoes." }],
  skills: [{ n: 1, target: "skill:keep-a-note", name: "keep-a-note", title: "Keep a note", description: "File a note.", origin: "shipped" }],
  ...over,
});
const versions = [
  { id: "c2", at: "2026-10-15T08:00:00Z", current: true, removed: false, by: "you, on this page", message: "changed who it is", text: who },
  { id: "c1", at: "2026-10-14T08:00:00Z", current: false, removed: false, by: "kept by your notebook", message: "kept the version from before the next change", text: "You are Godspeed." },
];
// A rule as Michael's files hold it: its name from the file, a long summary nobody sees.
const ruleItem = { target: "rule:never-spend", kind: "rule", file: "rules/never-spend.md", label: "the rule", state: "ok", hash: "h-rule", fields: { slug: "never-spend", title: "Never spend my money", line: "Buy anything for me.", group: "never", always: true, where: "always", story: "Story." } };
let calls: { route: string; body?: any }[] = [];
let state: ReturnType<typeof overview>;
let chatAnswer: Record<string, unknown> = { reply: "Done.", identity_changed: true };
function serve() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const route = String(url), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ route, body });
    const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, clone: () => ({}) });
    if (route === "/api/identity") return json(state);
    if (route.startsWith("/api/identity/item")) {
      const target = decodeURIComponent(route.split("target=")[1]);
      if (target.startsWith("rule:")) return json(ruleItem);
      if (target === "extra") return json({ target: "extra", kind: "extra", file: "assistant/extra-instructions.md", label: "the extra instructions", state: "missing", text: "", hash: "h-extra", soul: state.soul });
      return json({ target: "who", kind: "who", file: "AGENTS.md", label: "who it is", state: "ok", text: who, hash: "h-who", manual: state.manual, soul: state.soul });
    }
    if (route.startsWith("/api/identity/history")) return json({ data: versions });
    if (route === "/api/identity/instructions") return json({ data: [{ id: "i1", instruction: "Always address me as Sam.", applies_to: "all", is_active: true, removed: false, hash: "h-i1", updated_at: null }] });
    if (route === "/api/identity/notebook") return json({ notes: 4210, people: 312, facts: 1534, events: 88, things: 41, collections: 6 });
    if (route.startsWith("/api/identity/")) return json({ saved: true, now: { text: "x", hash: "h2" } });
    if (route === "/api/functions/conversation-chat") return json({ data: chatAnswer, error: null });
    return json({ error: "unknown" }, 404);
  }));
}
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Identity /></MemoryRouter></QueryClientProvider>);
}

describe("Godspeed's brain", () => {
  beforeEach(() => { state = overview(); chatAnswer = { reply: "Done.", identity_changed: true }; serve(); window.localStorage.clear(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows its parts in plain words under its own name, with no word for the machinery", async () => {
    open();
    expect(await screen.findByRole("heading", { level: 1, name: "Godspeed's brain" })).toBeVisible();
    for (const name of ["Who it is", "Extra instructions", "Rules", "What it knows about you", "Skills"]) expect(await screen.findByRole("heading", { level: 2, name })).toBeVisible();
    // "Who it is" in a readable column, one paragraph each.
    const whoSection = document.getElementById("who")!;
    expect(within(whoSection).getByText("You are Orbit, my assistant. Plain and kind.").tagName).toBe("P");
    expect(within(whoSection).getByText("You answer in short sentences.").tagName).toBe("P");
    expect(screen.getByText("Kept up to date by updates")).toBeVisible();
    expect(await screen.findByText("Always address me as Sam.")).toBeVisible();
    // The size of AGENTS.md is not shown under a text it does not describe.
    expect(document.body.textContent).not.toMatch(/of 20,000 characters/);
    for (const word of [/manual/i, /recipe/i, /markdown/i, /commit/i, /repository/i, /persona/i, /Identity/, /—/]) expect(document.body.textContent).not.toMatch(word);
  });

  it("numbers the rules as the server does, the kind as a tag, and keeps the one-job rules closed until asked", async () => {
    open();
    const first = await screen.findByRole("button", { name: /When in doubt, ask/ });
    expect(within(first).getByText("1")).toBeVisible();expect(within(first).getByText("Must")).toBeVisible();
    const second = screen.getByRole("button", { name: /Never spend my money/ });
    expect(within(second).getByText("2")).toBeVisible();expect(within(second).getByText("Never")).toBeVisible();
    expect(screen.getByText(/reads rules 1 to 2 before every job/)).toBeVisible();
    const closed = screen.getByRole("button", { name: "Read only when their subject comes up (2)" });
    expect(closed).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Founder only")).toBeNull();
    fireEvent.click(closed);
    expect(await screen.findByRole("heading", { name: "For the companies (1)" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "For the skill daily brief (1)" })).toBeVisible();
    expect(within(screen.getByRole("button", { name: /Founder only/ })).getByText("3")).toBeVisible();
    // Profile pages and skills are numbered too.
    expect(within(screen.getByRole("button", { name: /About me/ })).getByText("1")).toBeVisible();
    expect(within(screen.getByRole("button", { name: /Keep a note/ })).getByText("1")).toBeVisible();
  });

  it("saves a rule with only \"Read before every job\" switched, and holds only a changed name to a few words", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Never spend my money/ }));
    const name = await screen.findByLabelText("Its name");
    expect(name).toHaveValue("Never spend my money");
    expect(screen.getByText("A few words, so you can find it.")).toBeVisible();
    fireEvent.click(screen.getByRole("switch", { name: /Read before every job/ }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.route === "/api/identity/save")?.body).toMatchObject({ target: "rule:never-spend", expected_hash: "h-rule", fields: { title: "Never spend my money", always: false } }));
    // A changed name longer than a few words cannot be saved, and says why.
    fireEvent.click(await screen.findByRole("button", { name: /Never spend my money/ }));
    fireEvent.change(await screen.findByLabelText("Its name"), { target: { value: "Never spend any of my money on anything at all, not even a coffee or a stamp" } });
    expect(screen.getByText(/at most 60 characters/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it('saves "who it is" with the version it was opened from, and speaks of the size only near the limit', async () => {
    open();
    await screen.findByRole("heading", { level: 2, name: "Who it is" });
    fireEvent.click(within(document.getElementById("who")!).getByRole("button", { name: "Edit" }));
    const box = await screen.findByLabelText("Its name and character, in your words");
    expect(box).toHaveValue("You are Orbit, my assistant. Plain and kind.\n\nYou answer in short sentences.");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(box, { target: { value: "You are Speedy. " + "Very long. ".repeat(20) } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Close to the limit: your assistant's main instructions \(AGENTS\.md\) would be 19,\d{3} of 20,000 characters\. Your assistant reads that file in full before every job/);
    fireEvent.change(box, { target: { value: "You are Speedy. " + "Very long. ".repeat(120) } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Too long to save/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "You are Speedy." } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.route === "/api/identity/save")?.body).toEqual({ target: "who", text: "You are Speedy.", expected_hash: "h-who" }));
  });

  it("lists the earlier versions with their dates, undoes the last change and restores any version", async () => {
    open();
    await screen.findByRole("heading", { level: 2, name: "Who it is" });
    fireEvent.click(within(document.getElementById("who")!).getByRole("button", { name: "Edit" }));
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

  it("adds extra instructions, which the assistant reads right after \"who it is\"", async () => {
    open();
    await screen.findByRole("heading", { level: 2, name: "Extra instructions" });
    const extra = document.getElementById("extra")!;
    expect(await within(extra).findByText(/reads these right after "Who it is": in Telegram, in this notebook's chat and in its routines/)).toBeVisible();
    expect(within(extra).getByText(/None yet/)).toBeVisible();
    fireEvent.click(within(extra).getByRole("button", { name: "Add" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Extra instructions" }), { target: { value: "Answer in German when I write German." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.route === "/api/identity/save")?.body).toEqual({ target: "extra", text: "Answer in German when I write German.", expected_hash: "h-extra" }));
  });

  it("shows a text the assistant's program reads that this page does not hold, whole, and brings it here when asked", async () => {
    state = overview({ soul: { kind: "own", text: "You are Jeeves.\nAlways bow.", chars: 0, limit: 20000, warn: 19000 } });
    open();
    expect(await screen.findByText("Hermes, the program your assistant runs on, also reads a text this page does not hold yet.")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/someone else wrote|left as it is|may say something else/);
    fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    const shown = await screen.findByRole("dialog", { name: "The text Hermes also reads" });
    expect(within(shown).getByText(/You are Jeeves\.\s+Always bow\./)).toBeVisible();
    fireEvent.click(within(shown).getByRole("button", { name: "Bring it here" }));
    await waitFor(() => expect(calls.some((c) => c.route === "/api/identity/bring-soul-here")).toBe(true));
  });

  it('offers to mark "who it is" in main instructions without the marks, instead of failing', async () => {
    state = overview({ who: { state: "no-markers", proposal: "You are Orbit." } });
    open();
    expect(await screen.findByText(/do not mark which paragraph says who your assistant is/)).toBeVisible();
    expect(screen.getByText("You are Orbit.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark it" }));
    await waitFor(() => expect(calls.some((c) => c.route === "/api/identity/mark-who")).toBe(true));
  });

  it("leaves a list of rules kept by the owner's own program to that program, with no button that would rewrite it", async () => {
    state = overview({ manual: { exists: true, chars: 18900, limit: 20000, warn: 19000, kept_under: 19000, rules_list: "kept-elsewhere", rules_program: "dev/godspeed-engine/scripts/compile-rules.py" } });
    open();
    const notice = await screen.findByText(/is not the list this page would write from your rules/);
    expect(notice).toBeVisible();
    expect(within(notice).getByText("dev/godspeed-engine/scripts/compile-rules.py")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Bring the list up to date" })).toBeNull();
  });

  it("names everything else the assistant can look up in the notebook, with real counts and links", async () => {
    open();
    const notes = await screen.findByRole("link", { name: /4,210\s*Notes/ });
    expect(notes).toHaveAttribute("href", "/dashboard/notes");
    expect(screen.getByRole("link", { name: /312\s*People/ })).toHaveAttribute("href", "/dashboard/people");
    expect(screen.getByRole("link", { name: /1,534\s*Facts/ })).toBeVisible();
    expect(screen.getByText(/searches these when a question needs them\. It does not read them all every time\./)).toBeVisible();
  });

  it("docks its own chat beside the page: the page's name goes with each message, and a change the assistant made shows", async () => {
    open();
    await screen.findByRole("heading", { level: 1, name: "Godspeed's brain" });
    expect(screen.queryByRole("button", { name: "Chat with Godspeed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat with Godspeed about this page" }));
    expect(await screen.findByText("Godspeed / Godspeed's brain")).toBeVisible();
    const before = calls.filter((c) => c.route === "/api/identity").length;
    const message = screen.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "Please change rule 2 so that it also covers bookings." } });
    fireEvent.keyDown(message, { key: "Enter" });
    await waitFor(() => expect(calls.find((c) => c.route === "/api/functions/conversation-chat")?.body).toMatchObject({ message: "Please change rule 2 so that it also covers bookings.", page: "identity", page_label: "Godspeed's brain", conversation_id: "notebook:page:identity" }));
    expect(await screen.findByText("Done.")).toBeVisible();
    await waitFor(() => expect(calls.filter((c) => c.route === "/api/identity").length).toBeGreaterThan(before));
    // The switch at the top left closes it again.
    fireEvent.click(screen.getByRole("button", { name: "Close the chat" }));
    await waitFor(() => expect(screen.queryByText("Godspeed / Godspeed's brain")).toBeNull());
  });
});

describe("My Profile's instructions tab", () => {
  it("leads to the instructions on Godspeed's brain", () => {
    render(<MemoryRouter><InstructionsMoved count={2} /></MemoryRouter>);
    expect(screen.getByText(/All 2 of yours are there, unchanged/)).toBeVisible();
    expect(screen.getByText("Instructions moved to Godspeed's brain")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open your instructions" })).toHaveAttribute("href", BRAIN_PAGE.path + "#instructions");
    cleanup();
  });
});

describe("identity helpers", () => {
  const size = { chars: 18000, limit: 20000, warn: 19000 };
  it("speaks of a file's size only when a change makes it near or over its limit", () => {
    expect(sizeState(18000, size)).toBe("fine");
    expect(sizeState(19500, size)).toBe("near");
    expect(sizeState(20000, size)).toBe("over");
    expect(sizeLine(18500, size)).toBeNull();
    expect(sizeLine(19500, size)).toMatch(/^Close to the limit: your assistant's main instructions \(AGENTS\.md\) would be 19,500 of 20,000 characters/);
    expect(sizeLine(19500, { ...size, chars: 19800 })).toBeNull();
    // Kept by the owner's own program: that program's limit is the one that holds.
    expect(sizeLine(19100, { ...size, kept_under: 19000 })).toMatch(/your own rules program keeps that file under 19,000/);
    expect(sizeLine(20500, { chars: 19000, limit: 20000, warn: 19000 }, "soul")).toMatch(/^Too long to save: "Who it is" and your extra instructions would be 20,500 characters together/);
  });
  it("reflows a paragraph the file wraps, keeping blank lines, and splits paragraphs at them", () => {
    expect(reflow("One\ntwo\n\nThree")).toBe("One two\n\nThree");
    expect(paragraphs("One\ntwo\r\n\r\nThree\n")).toEqual(["One two", "Three"]);
  });
  it("groups the rules read only when their subject comes up by where they are read, in the server's order", () => {
    const r = (n: number, place?: { key: string; label: string }) => ({ n, target: "rule:r" + n, slug: "r" + n, title: "R" + n, line: "", group: "how", always: !place, where: place?.key ?? "always", place }) as RuleTile;
    const company = { key: "company", label: "For the companies" }, subject = { key: "when-it-matters", label: "When its subject comes up" };
    expect(places([r(1), r(2, company), r(3, company), r(4, subject)]).map((g) => [g.label, g.rules.map((x) => x.n)])).toEqual([["For the companies", [2, 3]], ["When its subject comes up", [4]]]);
  });
  it("words a version without its machinery", () => {
    expect(versionLine({ id: "x", at: "", current: false, removed: false, by: "", message: "changed who it is (asked in chat)" })).toBe("Changed who it is");
    expect(versionWords({ id: "c1", at: "", current: false, removed: false, by: "you, on this page", message: "changed who it is" })).toBe("Changed who it is, you, on this page");
    // A version not kept yet says so once, not twice (a fresh installation showed it on every part).
    expect(versionWords({ id: "now", at: "", current: true, removed: false, by: "not kept as a version yet", message: null, unrecorded: true })).toBe("Changed outside this page, not kept as a version yet");
  });
});
