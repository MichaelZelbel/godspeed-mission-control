// @vitest-environment jsdom
// The sentence under the Create with AI box (#851): the description goes to the
// AI service the person connected in Settings, Your AI, named when one is
// connected, and the dialog never promises training or an AI provider of the
// notebook's own.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { WAIT } from "@/test/wait-limits";
import { AICollectionDialog } from "./AICollectionDialog";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderDialog = () => render(<MemoryRouter><AICollectionDialog open onOpenChange={vi.fn()} /></MemoryRouter>);

it("names the connected AI service and makes no training promise", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(
    url.endsWith("/api/routine-ai")
      ? { available: true, provider: "openrouter", model: "vendor/model", base_url: "https://openrouter.ai/api/v1", source: "settings" }
      : { configured: false, key: false }
  )));
  renderDialog();
  expect(await screen.findByText("Your description is sent to OpenRouter only to design the schema, under that service's own terms.", undefined, WAIT)).toBeVisible();
  expect(screen.queryByText(/train/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/our AI provider/i)).not.toBeInTheDocument();
});

it("points at Settings, Your AI when no AI is connected", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(
    url.endsWith("/api/routine-ai") ? { available: false } : { configured: false, key: false }
  )));
  renderDialog();
  expect(await screen.findByText("Your description is sent to the AI service connected in Settings, Your AI, only to design the schema, under that service's own terms.", undefined, WAIT)).toBeVisible();
  expect(screen.queryByText(/train/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/our AI provider/i)).not.toBeInTheDocument();
});
