// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUnsavedNotes, RETRY_PAUSES, type NoteText, type NoteTextSender } from "./unsaved-notes";

// The keeper of note text the notebook has not confirmed yet (#29), on its
// own: browser storage, the pauses between tries, and what makes it try at once.

class MemoryStorage implements Storage {
  items = new Map<string, string>();
  full = false;
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.full && value.length > 200) throw new DOMException("full", "QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

const KEY = "godspeed:unsaved-note:";
let storage: MemoryStorage;
const made: Array<ReturnType<typeof createUnsavedNotes>> = [];
beforeEach(() => { vi.useFakeTimers(); storage = new MemoryStorage(); });
// Each keeper listens on the window; one left running would answer the next test's events.
afterEach(() => { for (const notes of made.splice(0)) notes.shutdown(); vi.useRealTimers(); });

function notebook(answers: Array<"saved" | "away" | "refused" | "gone">) {
  const sent: NoteText[] = [];
  const sender: NoteTextSender = {
    send: vi.fn(async (_id: string, unsaved: () => NoteText | null) => {
      const text = unsaved() ?? {};
      sent.push(text);
      const answer = answers.shift() ?? "saved";
      if (answer === "away") throw { message: "Failed to fetch" };
      if (answer === "refused") throw { message: "Request too large", code: "TOO_LARGE", context: {} };
      if (answer === "gone") return { sent: text, gone: true };
      return { sent: text, version: "v" + sent.length };
    }),
    waiting: vi.fn(),
    caughtUp: vi.fn(),
    gone: vi.fn(),
    pin: vi.fn(),
    versionOf: vi.fn(() => ({ hash: "seen-version", snapshot: { content: "Seeds to buy.", title: "Garden plan", tags: [] } })),
  };
  return { sender, sent };
}
const keeper = (options: Parameters<typeof createUnsavedNotes>[0] = { storage: () => storage }) => { const notes = createUnsavedNotes(options); made.push(notes); return notes; };
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

describe("unsaved note text", () => {
  it("is kept on this device before it is sent, and let go only when that exact text is saved", () => {
    const notes = keeper();
    notes.keep("garden", { content: "Seeds to buy.\n\nTulips." });
    expect(JSON.parse(storage.getItem(KEY + "garden")!)).toMatchObject({ content: "Seeds to buy.\n\nTulips." });
    notes.keep("garden", { content: "Seeds to buy.\n\nTulips by the fence." });
    notes.confirm("garden", { content: "Seeds to buy.\n\nTulips." }, "v2");
    expect(notes.get("garden")).toEqual({ content: "Seeds to buy.\n\nTulips by the fence." });
    // A final newline is the only difference saved Markdown may have.
    notes.confirm("garden", { content: "Seeds to buy.\n\nTulips by the fence.\n" }, "v3");
    expect(notes.get("garden")).toBeNull();
    expect(storage.getItem(KEY + "garden")).toBeNull();
    expect(notes.hasUnsaved()).toBe(false);
  });

  it("remembers the version the text is typed on, and follows each save", () => {
    const notes = keeper();
    const { sender } = notebook([]);
    notes.start(sender);
    notes.keep("garden", { title: "Garden plan 2027" });
    expect(JSON.parse(storage.getItem(KEY + "garden")!)).toMatchObject({ base: "seen-version", baseline: { content: "Seeds to buy.", title: "Garden plan" } });
    notes.keep("garden", { content: "Seeds to buy. Bulbs." });
    notes.confirm("garden", { title: "Garden plan 2027" }, "after-title");
    expect(JSON.parse(storage.getItem(KEY + "garden")!)).toMatchObject({ content: "Seeds to buy. Bulbs.", base: "after-title", baseline: { title: "Garden plan 2027" } });
  });

  it("is sent again after growing pauses until the notebook takes it, also with no editor open", async () => {
    const notes = keeper();
    const { sender, sent } = notebook(["away", "away", "away", "saved"]);
    notes.start(sender);
    notes.keep("garden", { content: "Compost in spring." });
    expect(await notes.flush("garden")).toBe(false);
    expect(notes.status("garden")).toBe("retrying");
    expect(sender.waiting).toHaveBeenCalledTimes(1);
    await settle(RETRY_PAUSES[0] - 1);
    expect(sent).toHaveLength(1);
    await settle(1);
    expect(sent).toHaveLength(2);
    await settle(RETRY_PAUSES[1]);
    expect(sent).toHaveLength(3);
    await settle(RETRY_PAUSES[2]);
    expect(sent).toHaveLength(4);
    expect(notes.status("garden")).toBe("saved");
    expect(storage.getItem(KEY + "garden")).toBeNull();
    expect(sender.waiting).toHaveBeenCalledTimes(1);
    expect(sender.caughtUp).toHaveBeenCalledTimes(1);
  });

  it("sends the newest text at every try", async () => {
    const notes = keeper();
    const { sender, sent } = notebook(["away", "saved"]);
    notes.start(sender);
    notes.keep("garden", { content: "Compost" });
    await notes.flush("garden");
    notes.keep("garden", { content: "Compost in spring." });
    await settle(RETRY_PAUSES[0]);
    expect(sent.at(-1)).toEqual({ content: "Compost in spring." });
    expect(notes.get("garden")).toBeNull();
  });

  it("tries at once when the browser is back online or the notebook answers, a refusal keeps its pause", async () => {
    const notes = keeper();
    const { sender, sent } = notebook(["away", "refused", "saved", "saved"]);
    notes.start(sender);
    notes.keep("garden", { content: "Compost in spring." });
    notes.keep("reading", { content: "A book about ferns." });
    await notes.flush("garden");
    await notes.flush("reading");
    expect(sent).toHaveLength(2);
    // The notebook answered another request: only the save it never heard goes again.
    notes.nudge({ onlyUnheard: true });
    await settle();
    expect(sent).toHaveLength(3);
    expect(notes.get("garden")).toBeNull();
    expect(notes.get("reading")).not.toBeNull();
    await settle(1_000);
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(notes.get("reading")).toBeNull();
  });

  it("an open editor sends what is typed; the keeper sends what failed, as soon as any save of the note goes through", async () => {
    const notes = keeper();
    const { sender, sent } = notebook(["saved"]);
    notes.start(sender);
    const release = notes.hold("garden");
    notes.keep("garden", { content: "Compost in spring." });
    notes.failed("garden", { message: "Failed to fetch" });
    expect(sender.waiting).not.toHaveBeenCalled();
    expect(notes.status("garden")).toBe("retrying");
    // A tag saved: the notebook answers again, and the text that failed goes now.
    notes.confirm("garden", { }, "after-tag");
    await settle();
    expect(sent).toEqual([{ content: "Compost in spring." }]);
    expect(notes.status("garden")).toBe("saved");
    release();
  });

  it("text kept by an earlier visit is pinned to the version it was typed on, and sent when the page opens", async () => {
    storage.setItem(KEY + "garden", JSON.stringify({ content: "Compost in spring.", base: "typed-on", baseline: { content: "Seeds to buy." }, at: 1 }));
    const notes = keeper();
    const { sender, sent } = notebook(["saved"]);
    expect(notes.hasUnsaved()).toBe(true);
    notes.start(sender);
    expect(sender.pin).toHaveBeenCalledWith("garden", "typed-on", { content: "Seeds to buy." });
    await settle();
    expect(sent).toEqual([{ content: "Compost in spring." }]);
    expect(storage.getItem(KEY + "garden")).toBeNull();
  });

  it("asks before the tab closes while text is unsaved", () => {
    const notes = keeper();
    notes.start(notebook([]).sender);
    const ask = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(ask()).toBe(false);
    notes.keep("garden", { content: "Compost in spring." });
    expect(ask()).toBe(true);
    notes.confirm("garden", { content: "Compost in spring." }, "v2");
    expect(ask()).toBe(false);
    notes.shutdown();
  });

  it("works in memory when browser storage is missing, and keeps the text when storage is full", () => {
    const blocked = keeper({ storage: () => { throw new DOMException("denied", "SecurityError"); } });
    blocked.keep("garden", { content: "Compost in spring." });
    expect(blocked.get("garden")).toEqual({ content: "Compost in spring." });
    expect(blocked.hasUnsaved()).toBe(true);
    blocked.confirm("garden", { content: "Compost in spring." }, "v2");
    expect(blocked.get("garden")).toBeNull();

    storage.full = true;
    const notes = keeper();
    const { sender } = notebook([]);
    sender.versionOf = () => ({ hash: "seen", snapshot: { content: "x".repeat(300) } });
    notes.start(sender);
    notes.keep("garden", { content: "Compost." });
    const stored = JSON.parse(storage.getItem(KEY + "garden")!);
    expect(stored.content).toBe("Compost.");
    expect(stored.baseline).toBeUndefined();
    notes.shutdown();
  });

  it("lets text go when the note was deleted, and says so", async () => {
    const notes = keeper();
    const { sender } = notebook(["gone"]);
    notes.start(sender);
    notes.keep("garden", { content: "Compost in spring." });
    expect(await notes.flush("garden")).toBe(true);
    expect(notes.get("garden")).toBeNull();
    expect(sender.gone).toHaveBeenCalledWith("garden");
    notes.keep("reading", { content: "Ferns." });
    notes.discard("reading");
    expect(storage.getItem(KEY + "reading")).toBeNull();
    notes.shutdown();
  });

  it("follows another tab of the same notebook", () => {
    const notes = keeper();
    notes.start(notebook([]).sender);
    notes.keep("garden", { content: "Compost." });
    window.dispatchEvent(new StorageEvent("storage", { key: KEY + "garden", newValue: null }));
    expect(notes.get("garden")).toBeNull();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY + "reading", newValue: JSON.stringify({ title: "Ferns", at: 2 }) }));
    expect(notes.get("reading")).toEqual({ title: "Ferns" });
    notes.shutdown();
  });
});
