// @vitest-environment jsdom
// #774: Suggest and "Suggest entries from my notes" on My Profile, and Create collection with AI,
// showed the provider's raw words for a refused key ("Model provider failed with HTTP 401..."). Each
// button is pressed here against a real notebook whose AI is a stand-in on 127.0.0.1, and the toast a
// person reads must say the key was refused and name Settings, Your AI, or say the chats' outage
// wording; never "HTTP", a status number, the provider's words or the key.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { Toaster } from "sonner";
import { ProfileSuggestions } from "./profile/ProfileSuggestions";
import { AICollectionDialog } from "./collections/AICollectionDialog";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

const KEY = "sk-fictional-refused-key-774";
const REFUSED = "Your AI key or sign-in was refused. Check it in Settings, Your AI, then try again.";
const UNREACHABLE = "Your AI could not be reached. Check its connection in Settings, Your AI, then try again.";
const RAW = /HTTP|\b[45]\d\d\b|Model provider|Incorrect API key|Internal server error|provider wording|127\.0\.0\.1/;

const standIn = { status: 200 };
const endpoint = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (standIn.status === 200) return res.end(JSON.stringify({ choices: [{ message: { content: "Connected" } }] }));
    res.statusCode = standIn.status;
    res.end(JSON.stringify({ error: { message: standIn.status >= 500 ? "Internal server error (provider wording)" : "Incorrect API key provided: " + KEY + " (provider wording)" } }));
  });
});
let root = "", server: { base: string; close: () => Promise<void> } | null = null, endpointOpen = false;
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-analysis-ai-ui-"));
  await new Promise<void>(resolve => endpoint.listen(0, "127.0.0.1", resolve));
  endpointOpen = true;
  server = await new Promise((resolve, reject) => {
    const script = `import('./server/main.mjs').then(async({createService})=>{const service=await createService({root:process.argv[1],port:0,device:'pc'});console.log(service.address.port);process.on('SIGTERM',async()=>{await service.close();process.exit(0);});})`;
    const env = { ...process.env, GODSPEED_ASSISTANT_CONFIG: path.join(root, "no-assistant.json") };
    for (const name of ["GODSPEED_ORIGINAL_RUNTIME", "GODSPEED_MODEL_URL", "GODSPEED_MODEL_KEY", "GODSPEED_MODEL"]) delete env[name];
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, path.join(root, "workspace")], { cwd: path.resolve(process.cwd(), ".."), env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", data => stderr += data);
    child.once("error", reject);
    child.stdout.once("data", data => {
      const port = Number(String(data).trim());
      if (!port) return reject(new Error(stderr || "server did not start"));
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise(done => { child.once("exit", () => done()); child.kill("SIGTERM"); }) });
    });
  });
  const address = `http://127.0.0.1:${(endpoint.address() as { port: number }).port}/v1`;
  const saved = await nativeFetch(server!.base + "/api/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: address, key: KEY, model: "fictional-model", routines: false }) });
  expect(saved.ok).toBe(true);
}, 60000);

afterAll(async () => {
  await server?.close();
  if (endpointOpen) await new Promise<void>(resolve => endpoint.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

function toTheNotebook() {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => nativeFetch(String(url).startsWith("/api/") ? server!.base + url : url, init));
}

const actions: { name: string; press: () => void }[] = [
  {
    name: "Suggest",
    press: () => {
      render(<><Toaster /><ProfileSuggestions categories={[]} factCount={0} noteCount={20} onAccept={async () => {}} /></>);
      fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
    },
  },
  {
    name: "Suggest entries from my notes",
    press: () => {
      render(<><Toaster /><ProfileSuggestions categories={[]} factCount={5} noteCount={2} onAccept={async () => {}} /></>);
      fireEvent.click(screen.getByRole("button", { name: "Suggest entries from my notes" }));
    },
  },
  {
    name: "Create collection with AI",
    press: () => {
      render(<MemoryRouter><Toaster /><AICollectionDialog open onOpenChange={() => {}} /></MemoryRouter>);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make a reading list for my books" } });
      fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    },
  },
];

async function said(expected: string) {
  const message = await screen.findByText(expected, {}, { timeout: 10000 });
  const toast = message.closest("[data-sonner-toast]") ?? message;
  expect(toast.textContent).not.toMatch(RAW);
  expect(document.body.textContent).not.toContain(KEY);
}

// The outage with a closed port comes last: it closes the stand-in for good.
describe.each([
  { case: "a key refused with HTTP 401", status: 401, expected: REFUSED },
  { case: "a key refused with HTTP 403", status: 403, expected: REFUSED },
  { case: "an AI answering HTTP 500", status: 500, expected: UNREACHABLE },
])("$case", ({ status, expected }) => {
  it.each(actions)("$name says it plainly", async ({ press }) => {
    standIn.status = status;
    toTheNotebook();
    press();
    await said(expected);
  }, 20000);
});

describe("an AI whose port is closed", () => {
  it.each(actions)("$name says the chats' outage wording", async ({ press }) => {
    if (endpointOpen) { endpointOpen = false; endpoint.closeAllConnections(); await new Promise<void>(resolve => endpoint.close(() => resolve())); }
    toTheNotebook();
    press();
    await said(UNREACHABLE);
  }, 20000);
});
