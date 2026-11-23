// @vitest-environment jsdom
// #1040: a year-long chat export, in each of WhatsApp's four shapes, goes to a stand-in AI on 127.0.0.1
// one month per request, only after Start, and the chosen file never lands on disk.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatHistoryDialog } from "./ChatHistoryDialog";
import { TEST_MS, WAIT } from "@/test/wait-limits";
import { NO_AI_CONNECT } from "../../../../core/no-ai.mjs";

const standIn = vi.hoisted(() => ({ url: "", aiConnected: true, requests: [] as { month: string; lines: unknown }[] }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy({}, { get: (_t, property) => property === "then" ? (resolve: any) => resolve({ data: [], error: null }) : () => chain });
  const invoke = async (_name: string, options: { body: unknown }) => {
    const response = await fetch(standIn.url, { method: "POST", body: JSON.stringify(options.body) });
    return { data: await response.json(), error: null };
  };
  return { supabase: { from: () => chain, functions: { invoke } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/hooks/useAICreditsGate", () => ({ useAICreditsGate: () => ({ providerConfigured: standIn.aiConnected }) }));

let server: Server;
beforeAll(async () => {
  server = createServer((request, response) => {
    let text = "";
    request.on("data", (part) => { text += part; });
    request.on("end", () => {
      const body = JSON.parse(text);
      standIn.requests.push({ month: body.month, lines: body.lines });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ moments: [{ title: `Moment ${body.month}`, happened_at: `${body.month}-02`, quote: "q", status: "past_fact", impact_level: 2, participants: [] }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  standIn.url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
afterEach(() => { cleanup(); standIn.aiConnected = true; });
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const pad = (n: number) => String(n).padStart(2, "0");
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const shapes: Record<string, (month: number) => string> = {
  "iPhone, German": (m) => `[02.${pad(m)}.25, 18:04:11] Mia Muster: Nachricht im Monat ${m}`,
  "iPhone, English": (m) => `[${m}/15/25, 6:04:11 PM] Mia Muster: Message in month ${m}`,
  "Android, German": (m) => `02.${pad(m)}.2025, 18:04 - Mia Muster: Nachricht im Monat ${m}`,
  "Android, English": (m) => `${m}/15/25, 6:04 PM - Mia Muster: Message in month ${m}`,
};

const filesOnDisk = () => [process.cwd(), tmpdir()].flatMap((dir) => readdirSync(dir).map((name) => join(dir, name)));
const holds = (path: string, marker: string) => { try { return statSync(path).isFile() && statSync(path).size < 1e6 && readFileSync(path, "utf8").includes(marker); } catch { return false; } };

describe("a year-long chat export against a 127.0.0.1 stand-in AI", () => {
  for (const [shape, line] of Object.entries(shapes)) {
    it(`sends one request per month, only after Start, for ${shape}`, async () => {
      standIn.requests.length = 0;
      const marker = `unique-marker-${shape.replace(/\W/g, "")}`;
      const text = months.map((m) => `${line(m)} ${marker}`).join("\n");
      const before = new Set(filesOnDisk());
      render(<ChatHistoryDialog open onOpenChange={() => {}} personId="mia" personName="Mia Muster" people={[]} onSaved={() => {}} />);
      fireEvent.change(screen.getByLabelText(/WhatsApp export file/), { target: { files: [new File([text], "_chat.txt")] } });
      expect(await screen.findByText("Starting sends this chat, month by month, to your connected AI, and the chat covers 12 months, January 2025 to December 2025.", {}, WAIT)).toBeInTheDocument();
      expect(standIn.requests).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      expect(await screen.findByText(/Done: all 12 months read/, {}, WAIT)).toBeInTheDocument();
      expect(standIn.requests.map((r) => r.month)).toEqual(months.map((m) => `2025-${pad(m)}`));
      expect(filesOnDisk().filter((path) => !before.has(path) && holds(path, marker))).toEqual([]);
    }, TEST_MS);
  }

  it("sends nothing, and Start stays off, when no AI is connected", async () => {
    standIn.aiConnected = false;
    standIn.requests.length = 0;
    render(<ChatHistoryDialog open onOpenChange={() => {}} personId="mia" personName="Mia Muster" people={[]} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText(/WhatsApp export file/), { target: { files: [new File([months.map(shapes["iPhone, English"]).join("\n")], "_chat.txt")] } });
    expect(await screen.findByText(NO_AI_CONNECT, {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(standIn.requests).toHaveLength(0);
  }, TEST_MS);
});
