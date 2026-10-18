// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { NoteCommentsPanel, commentAuthor, commentDate } from "./NoteCommentsPanel";

// The Comments panel under a note (18 October 2026): it lists the note's comments with a readable
// date, adds one and deletes one through the notebook's /api/query, as notebook/test/note-comments
// .test.mjs checks the notebook itself does.
type Row = { id: string; note_id: string; content: string; author: string; created_at: string; _hash: string };
function notebook(initial: Row[]) {
  let rows = [...initial];
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    const forNote = (r: Row) => request.filters.every(([op, key, value]: [string, string, string]) => op === "eq" && (r as any)[key] === value);
    let data: Row[] = [];
    if (!request.operation || request.operation === "select") data = rows.filter(forNote);
    if (request.operation === "insert") { const row = { id: "comments-" + (rows.length + 1), _hash: "h" + rows.length, created_at: "2026-10-18T12:05:00.000Z", ...request.values }; rows.push(row); data = [row]; }
    if (request.operation === "delete") { data = rows.filter(forNote); rows = rows.filter((r) => !forNote(r)); }
    return new Response(JSON.stringify({ data, error: null }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NoteCommentsPanel noteId="garden-plan-1" /></QueryClientProvider>);
  return requests;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("NoteCommentsPanel", () => {
  it("shows the count while folded, then the comments with who wrote them and when", async () => {
    notebook([{ id: "comments-a", note_id: "garden-plan-1", content: "Ask the neighbour about the hose.", author: "owner", created_at: "2026-10-17T09:30:00.000Z", _hash: "a" }]);
    const header = await screen.findByRole("button", { name: /Comments \(1\)/ });
    expect(screen.queryByText("Ask the neighbour about the hose.")).toBeNull();
    fireEvent.click(header);
    expect(await screen.findByText("Ask the neighbour about the hose.")).toBeInTheDocument();
    expect(screen.getByText("You, " + commentDate("2026-10-17T09:30:00.000Z"))).toBeInTheDocument();
  });

  it("adds a comment for this note and shows it", async () => {
    const requests = notebook([]);
    fireEvent.click(await screen.findByRole("button", { name: /Comments \(0\)/ }));
    fireEvent.change(screen.getByLabelText("Write a comment"), { target: { value: "  Seeds ordered.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    expect(await screen.findByText("Seeds ordered.")).toBeInTheDocument();
    expect(requests.find((r) => r.operation === "insert")).toMatchObject({ table: "comments", values: { note_id: "garden-plan-1", content: "Seeds ordered.", author: "owner" } });
    expect(screen.getByLabelText("Write a comment")).toHaveValue("");
  });

  it("deletes a comment after asking", async () => {
    const requests = notebook([{ id: "comments-a", note_id: "garden-plan-1", content: "Old remark", author: "owner", created_at: "2026-10-17T09:30:00.000Z", _hash: "a" }]);
    fireEvent.click(await screen.findByRole("button", { name: /Comments \(1\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete this comment" }));
    expect(await screen.findByText("Delete this comment?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Old remark")).toBeNull());
    expect(requests.find((r) => r.operation === "delete")).toMatchObject({ table: "comments", filters: [["eq", "id", "comments-a"]], expected: { "comments-a": "a" } });
    expect(await screen.findByRole("button", { name: /Comments \(0\)/ })).toBeInTheDocument();
  });

  it("names the owner as You, another writer by its name, and never shows a broken date", () => {
    expect(commentAuthor("owner")).toBe("You");
    expect(commentAuthor("Godspeed")).toBe("Godspeed");
    expect(commentAuthor(undefined)).toBe("");
    expect(commentDate("not a date")).toBe("");
    expect(commentDate("2026-10-18T12:05:00.000Z")).toMatch(/2026/);
  });
});
