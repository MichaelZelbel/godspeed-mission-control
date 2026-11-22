// @vitest-environment jsdom
// #764: since #671 a moment saved by hand with an AI just connected in Settings
// no longer had its facts extracted, because /api/status only reported the AI as
// usable after a chat had been opened. This drives the real notebook service and
// the real dialog: a fresh notebook, an AI connected through Settings' own route,
// no chat opened, then Timeline > Add Moment. The facts must land for review.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { supabase } from "@/integrations/supabase/client";
import AddEventDialog from "./AddEventDialog";
import { WAIT } from "@/test/wait-limits";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" }, session: { access_token: "token", user: { id: "owner" } } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;
Element.prototype.scrollIntoView ??= () => {};

const quote = "Fictional Ada said her favourite food is fictional ramen.";

// A stand-in AI service: it answers the connection test, and for a moment's
// extraction proposes one fact about the person the moment names.
async function fakeAI(contactId: () => string) {
  const kinds: string[] = [];
  const endpoint = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => raw += chunk);
    req.on("end", () => {
      const input = JSON.parse(JSON.parse(raw).messages[1].content);
      kinds.push(input.kind);
      const content = input.kind === "extract-moment-profile"
        ? JSON.stringify({ suggestions: [{ type: "add_profile_entry", title: "Favourite food", evidence_quote: quote, payload: { contact_id: contactId(), subject_type: "contact", subject_id: contactId(), label: "Favourite food", value: "Fictional ramen", category_slug: "preferences", category_name: "Preferences" } }] })
        : "Connected";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>(resolve => endpoint.listen(0, "127.0.0.1", resolve));
  return { kinds, address: `http://127.0.0.1:${(endpoint.address() as any).port}/v1`, close: () => new Promise<void>(resolve => endpoint.close(() => resolve())) };
}

function openServer(root: string) {
  return new Promise<{ base: string; close: () => Promise<void> }>((resolve, reject) => {
    const script = `import('./server/main.mjs').then(async({createService})=>{const service=await createService({root:process.argv[1],port:0,device:'pc'});console.log(service.address.port);process.on('SIGTERM',async()=>{await service.close();process.exit(0);});})`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, root], { cwd: path.resolve(process.cwd(), ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GODSPEED_ASSISTANT_CONFIG: path.join(root, "..", "no-assistant.json"), GODSPEED_ORIGINAL_RUNTIME: "", GODSPEED_MODEL_URL: "", GODSPEED_MODEL_KEY: "", GODSPEED_MODEL: "" } });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("the notebook did not start in time")); }, 30000);
    let stderr = "";
    child.stderr.on("data", data => stderr += data);
    child.once("error", reject);
    child.stdout.once("data", data => {
      clearTimeout(timer);
      const port = Number(String(data).trim());
      if (!port) return reject(new Error(stderr || "the notebook did not start"));
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise(done => { const stop = setTimeout(() => { child.kill("SIGKILL"); }, 10000); child.once("exit", () => { clearTimeout(stop); done(); }); child.kill("SIGTERM"); }) });
    });
  });
}

describe("saving a moment with an AI connected in Settings and no chat opened", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => { cleanup(); vi.unstubAllGlobals(); while (cleanups.length) await cleanups.pop()!(); });

  it("starts the extraction, and the facts it finds wait for the person's review", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-moment-ai-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    let adaId = "";
    const ai = await fakeAI(() => adaId);
    cleanups.push(ai.close);
    const notebook = await openServer(path.join(dir, "workspace"));
    cleanups.push(notebook.close);
    const nativeFetch = fetch, routes: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/")) routes.push(String(url));
      return nativeFetch(String(url).startsWith("/api/") ? notebook.base + url : url, init);
    });

    // A fresh notebook has no AI.
    expect((await (await fetch("/api/status")).json()).runtimeConfigured).toBe(false);
    // Settings, Your AI: Test and connect.
    const connected = await fetch("/api/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: ai.address, key: "fictional-key", model: "fictional-model", routines: false }) });
    expect(connected.ok).toBe(true);
    const { data: ada, error } = await supabase.from("contacts").insert({ name: "Fictional Ada" }).select("id").single();
    expect(error).toBeNull();
    adaId = (ada as any).id;

    // Timeline > Add Moment, with no chat opened since the AI was connected.
    const onCreated = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AddEventDialog people={[{ id: adaId, name: "Fictional Ada", relationship: "friend" }]} onCreated={onCreated} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add Moment" }));
    const dialog = screen.getByRole("dialog", { name: "Add Moment" });
    fireEvent.change(within(dialog).getByPlaceholderText("Short title for this moment"), { target: { value: "Fictional lunch" } });
    fireEvent.change(within(dialog).getByPlaceholderText("Describe what happened…"), { target: { value: quote } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "People" }));
    fireEvent.click(await screen.findByRole("option", { name: "Fictional Ada" }, WAIT));
    // The dialog's AI availability comes from the notebook's own status.
    await waitFor(() => expect(routes.filter(route => route === "/api/status").length).toBeGreaterThan(1), WAIT);
    await new Promise(resolve => setTimeout(resolve, 50));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Moment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce(), { timeout: 10000 });

    expect(routes.some(route => route.startsWith("/api/chat"))).toBe(false);
    await waitFor(async () => {
      const { data } = await supabase.from("review_queue").select("*").eq("status", "pending_review");
      expect((data as any[]).map(row => [row.suggestion_type, row.payload?.label, row.payload?.value])).toEqual([["add_profile_entry", "Favourite food", "Fictional ramen"]]);
    }, { timeout: 10000 });
    expect(ai.kinds).toContain("extract-moment-profile");
  }, 60000);
});
