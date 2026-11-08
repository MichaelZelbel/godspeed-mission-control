// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { BackupAI, ConnectAI, PlanSignIn, RoutineAIState } from "./ConnectAI";

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
    serve({ "backup-ai": body => body ? [400, { error: "That is the service your main AI uses already. A backup steps in when the main AI fails, so it has to be another service." }] : [200, none] });
    show();
    await screen.findByText("No backup AI is connected.");
    fireEvent.change(screen.getByLabelText(/Backup model/), { target: { value: "same" } });
    fireEvent.change(screen.getByLabelText(/Backup key/), { target: { value: "same-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect as backup" }));
    expect(await screen.findByText(/That is the service your main AI uses already/)).toBeInTheDocument();
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

// The backup offers exactly the main AI's choices (follow-up to discussion #20), the ChatGPT plan
// included wherever Hermes runs the routines, through one sign-in shared by both forms.
describe("the same choices for the main AI and the backup", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const options = (select: HTMLSelectElement) => Array.from(select.options).map(o => o.textContent);
  const settings = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ConnectAI /></QueryClientProvider>);

  it("lists the same services in both forms, the ChatGPT plan among them where Hermes runs", async () => {
    serve({ "routine-ai": () => [200, { available: true, provider: "openrouter", model: "x/y", source: "settings", key: true, check: { at: new Date().toISOString(), ok: true } }], "backup-ai": () => [200, none], "ai-signin": () => [200, { available: true, state: "idle" }] });
    settings();
    await screen.findByText("No backup AI is connected.");
    const main = screen.getByLabelText("Your AI service") as HTMLSelectElement, backup = screen.getByLabelText("Backup AI service") as HTMLSelectElement;
    expect(options(main)).toEqual(["OpenRouter", "OpenAI", "ChatGPT (sign in with your ChatGPT plan)", "Another service"]);
    expect(options(backup)).toEqual(options(main));
  });

  it("offers no plan sign-in in either form where no Hermes runs the routines", async () => {
    serve({ "routine-ai": () => [200, { available: false }], "backup-ai": () => [200, { ...none, hermes: false }], "ai-signin": () => [200, { available: false, state: "idle" }] });
    settings();
    await screen.findByText("No backup AI is connected.");
    expect(options(screen.getByLabelText("Your AI service") as HTMLSelectElement)).toEqual(["OpenRouter", "OpenAI", "Another service"]);
    expect(options(screen.getByLabelText("Backup AI service") as HTMLSelectElement)).toEqual(["OpenRouter", "OpenAI", "Another service"]);
  });

  it("signs a ChatGPT plan in as the backup: address and code, then the model that answered", async () => {
    let state: any = { available: true, state: "idle" }, polls = 0;
    const calls = serve({
      "ai-signin": () => { polls++; if (state.state === "waiting" && polls > 2) state = { available: true, state: "connecting", as: "backup" }; else if (state.state === "connecting") state = { available: true, state: "connected", as: "backup", model: "gpt-fictional" }; return [200, state]; },
      "ai-signin/start": body => { state = { available: true, state: "waiting", as: body.as, url: "https://auth.openai.com/codex/device", code: "ABCD-12345" }; return [200, state]; },
    });
    const connected = vi.fn();
    render(<PlanSignIn as="backup" every={20} onConnected={connected} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }));
    expect(await screen.findByText("ABCD-12345")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://auth.openai.com/codex/device" })).toHaveAttribute("target", "_blank");
    expect(calls.find(c => c.route === "ai-signin/start")?.body).toEqual({ as: "backup" });
    await waitFor(() => expect(connected).toHaveBeenCalledTimes(1));
    expect(connected.mock.calls[0][0]).toMatchObject({ state: "connected", as: "backup", model: "gpt-fictional" });
  });

  it("says why the plan cannot be both the main AI and the backup, and lets the person try again after a failure", async () => {
    serve({ "ai-signin": () => [200, { available: true, state: "failed", as: "main", error: "The code ran out. Nothing is broken: start again for a new code." }],
      "ai-signin/start": () => [400, { error: "That is the service your backup AI uses. Remove the backup first, or choose another service for your main AI." }] });
    const connected = vi.fn();
    render(<PlanSignIn as="main" onConnected={connected} />);
    expect(await screen.findByText(/The code ran out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/That is the service your backup AI uses/)).toBeInTheDocument();
    expect(connected).not.toHaveBeenCalled();
  });

  it("does not report a sign-in that finished before this form was opened", async () => {
    serve({ "ai-signin": () => [200, { available: true, state: "connected", as: "backup", model: "gpt-old" }] });
    const connected = vi.fn();
    render(<PlanSignIn as="backup" onConnected={connected} />);
    expect(await screen.findByRole("button", { name: "Sign in with ChatGPT" })).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 30));
    expect(connected).not.toHaveBeenCalled();
  });
});
