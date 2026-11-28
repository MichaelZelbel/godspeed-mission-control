// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import AddonPage from "./AddonPage";

// #1182: each part kind drawn with the notebook's own components; a field that changed meanwhile keeps the typing.
const page = {
  id: "profile", title: "Profile", parts: [
    { kind: "text", id: "about", title: "About", value: "Old words." },
    { kind: "list", id: "likes", title: "Likes", items: ["tea", "jam"] },
    { kind: "steps", id: "s", title: "Steps", steps: [{ title: "One", state: "done" }, { title: "Two", state: "current" }] },
    { kind: "people", id: "p", title: "Dates", people: [{ id: "c1", name: "Alex" }] },
    { kind: "note", id: "n", title: "Open the note", noteId: "n1" },
    { kind: "action", id: "go", title: "Go", label: "Go now", inputs: [] },
    { kind: "choice", id: "c", title: "Pick", text: "Which?", choices: [{ id: "a", title: "Apple" }] },
    { kind: "blink", html: "<b>x</b>" },
  ],
};
type Call = { url: string; body?: any };
function stub(handler: (call: Call) => { status?: number; data: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call = { url, body: init?.body ? JSON.parse(String(init.body)) : undefined }; calls.push(call);
    const r = handler(call); const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.data };
  });
  return calls;
}
const show = () => render(<MemoryRouter initialEntries={["/dashboard/addons/wingman/profile"]}><Routes><Route path="/dashboard/addons/:id/:page?" element={<AddonPage />} /></Routes></MemoryRouter>);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("An add-on's page", () => {
  it("draws every part kind, and an unknown kind as one plain line", async () => {
    stub((c) => ({ data: c.url.includes("/pages/") ? page : {} }));
    show();
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("About")).toHaveValue("Old words.");
    expect(screen.getByLabelText("Likes 2")).toHaveValue("jam");
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alex" })).toHaveAttribute("href", "/dashboard/people/c1");
    expect(screen.getByRole("link", { name: "Open the note" })).toHaveAttribute("href", "/dashboard/notes/n1");
    expect(screen.getByRole("button", { name: "Go now" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Apple" })).toBeInTheDocument();
    expect(screen.getByText(/not available in this version/)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("saves typing after a pause with the text it started from, and list items can be added and removed", async () => {
    const calls = stub((c) => (c.url.endsWith("/field") ? { data: { state: "saved", value: c.body.value } } : { data: page }));
    show();
    fireEvent.change(await screen.findByLabelText("About"), { target: { value: "New words." } });
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/field"))?.body).toMatchObject({ part: "about", value: "New words.", base: "Old words." }), { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText("Add one"), { target: { value: "wine" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove tea" }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/field")).some((c) => JSON.stringify(c.body.value) === JSON.stringify(["jam", "wine"]))).toBe(true), { timeout: 3000 });
  });

  it("keeps the person's typing beside the newer text when the section changed meanwhile", async () => {
    const calls = stub((c) => (c.url.endsWith("/field") && c.body.base === "Old words." ? { status: 409, data: { state: "conflict", current: "Someone else." } } : c.url.endsWith("/field") ? { data: { state: "saved", value: c.body.value } } : { data: page }));
    show();
    const box = await screen.findByLabelText("About");
    fireEvent.change(box, { target: { value: "Mine." } });
    fireEvent.blur(box);
    expect(await screen.findByText("Someone else.")).toBeInTheDocument();
    expect(box).toHaveValue("Mine.");
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/field")).at(-1)?.body).toMatchObject({ value: "Mine.", base: "Someone else." }));
  });
});
