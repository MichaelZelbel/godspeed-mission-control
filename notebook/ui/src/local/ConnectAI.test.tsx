// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { BackupAI, RoutineAIState, BACKUP_GUIDE } from "./ConnectAI";

// A backup AI (22 October 2026, discussion #20): a second AI the person connects themselves, used
// only when the main one fails. Settings shows it, what it did, a form like the main one, and Remove.
const none = { hermes: true, configured: false, backup: null, more: 0, usage: { answers: 0, last_answer_at: null, main_failing_since: null, last_main_error: null } };
const connected = { ...none, configured: true, backup: { provider: "openrouter", model: "fictional/backup-model", base_url: "https://openrouter.ai/api/v1", via: "settings", at: "2026-10-22T08:00:00Z" } };

function serve(routes: Record<string, (body?: any) => [number, unknown]>) {
  const calls: { route: string; body?: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const route = String(url).replace(/^\/api\//, ""), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ route, body });
    const [status, data] = (routes[route] || (() => [404, { error: "unknown" }]))(body);
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BackupAI /></QueryClientProvider>);

describe("Backup AI in Settings", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("says plainly that none is connected and what one would do", async () => {
    serve({ "backup-ai": () => [200, none] });
    show();
    expect(await screen.findByText("No backup AI is connected.")).toBeInTheDocument();
    expect(screen.getByText(/steps in only when your main AI fails/)).toBeInTheDocument();
    expect(screen.getByText(/Godspeed never adds one by itself/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect a backup AI" })).toHaveAttribute("href", BACKUP_GUIDE);
    expect(screen.queryByRole("button", { name: "Remove the backup" })).toBeNull();
  });

  it("tests and connects one, and never keeps the key in the form", async () => {
    const calls = serve({ "backup-ai": body => [200, body ? { connected: true, ...connected } : none] });
    show();
    await screen.findByText("No backup AI is connected.");
    fireEvent.change(screen.getByLabelText(/Backup model/), { target: { value: "fictional/backup-model" } });
    fireEvent.change(screen.getByLabelText(/Backup key/), { target: { value: "sk-or-fictional" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect as backup" }));
    expect(await screen.findByText(/Connected as your backup\. It answered a test just now/)).toBeInTheDocument();
    expect(calls.find(c => c.body)?.body).toEqual({ url: "https://openrouter.ai/api/v1/chat/completions", key: "sk-or-fictional", model: "fictional/backup-model" });
    expect(screen.getByText(/Your backup AI is/)).toHaveTextContent("Your backup AI is fictional/backup-model through OpenRouter. You connected it here.");
    expect((screen.getByLabelText(/Backup key/) as HTMLInputElement).value).toBe("");
  });

  it("shows what the backup did and that the main AI is failing, and removes it", async () => {
    const working = { ...connected, backup: { ...connected.backup, via: "telegram" }, more: 1, usage: { answers: 3, last_answer_at: "2026-10-22T09:00:00Z", main_failing_since: "2026-10-22T07:00:00Z", last_main_error: "The AI account reached a usage limit." } };
    const calls = serve({ "backup-ai": () => [200, working], "backup-ai/remove": () => [200, { removed: true, ...none }] });
    show();
    expect(await screen.findByText(/You connected it in Telegram\. Hermes has 1 more after it\./)).toBeInTheDocument();
    expect(screen.getByText(/It answered 3 times while your main AI was failing/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Your main AI has been failing since .*The AI account reached a usage limit\./);
    fireEvent.click(screen.getByRole("button", { name: "Remove the backup" }));
    expect(await screen.findByText("No backup AI is connected.")).toBeInTheDocument();
    expect(screen.getByText(/The backup is removed/)).toBeInTheDocument();
    expect(calls.some(c => c.route === "backup-ai/remove")).toBe(true);
  });

  it("shows the server's refusal, such as the main AI given again", async () => {
    serve({ "backup-ai": body => body ? [400, { error: "This is your main AI already. A backup is a different service or model, used when the main one fails." }] : [200, none] });
    show();
    await screen.findByText("No backup AI is connected.");
    fireEvent.change(screen.getByLabelText(/Backup model/), { target: { value: "same" } });
    fireEvent.change(screen.getByLabelText(/Backup key/), { target: { value: "same-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect as backup" }));
    expect(await screen.findByText(/This is your main AI already/)).toBeInTheDocument();
  });
});

describe("the routines' check with a backup", () => {
  afterEach(() => cleanup());
  const status = { available: true, provider: "openai-codex", model: "gpt-fictional", source: "hermes" as const, key: null };
  it("says the backup carries the work when the main AI did not answer", () => {
    render(<RoutineAIState status={{ ...status, check: { at: "2026-10-22T10:00:00Z", ok: false, error: "The AI account reached a usage limit.", backup: { ok: true, model: "fictional/backup-model" } } }} checking={false} onCheck={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your backup AI answered instead, so the daily work goes on until the main one is back.");
  });
  it("says when both are fine, and when the backup did not answer", () => {
    const { rerender } = render(<RoutineAIState status={{ ...status, check: { at: "2026-10-22T10:00:00Z", ok: true, backup: { ok: true, model: "fictional/backup-model" } } }} checking={false} onCheck={() => {}} />);
    expect(screen.getByText(/answered too/)).toHaveTextContent("Your backup AI (fictional/backup-model) answered too.");
    rerender(<RoutineAIState status={{ ...status, check: { at: "2026-10-22T10:00:00Z", ok: true, backup: { ok: false, error: "Its key was refused.", model: "fictional/backup-model" } } }} checking={false} onCheck={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your backup AI (fictional/backup-model) did not answer. Its key was refused.");
  });
});
