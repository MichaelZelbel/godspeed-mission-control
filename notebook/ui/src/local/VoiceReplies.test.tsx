// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { VoiceReplies } from "./VoiceReplies";

// Voice replies (25 October 2026, discussion #41): which voice answers voice notes, what the chat is
// set to, and an ElevenLabs voice kept only after its sample worked. Every id and key is made up.
const free = { available: true, voice: { service: "edge", voice_id: "en-US-AvaMultilingualNeural" }, elevenlabs: { model: "eleven_multilingual_v2", stability: 0.5, similarity_boost: 0.75, style: 0 }, key: false, chats: { voice_only: 1, all: 0, off: 0 }, auto_tts: null, failing: null };
const eleven = { ...free, voice: { service: "elevenlabs", voice_id: "FictionalVoice00001", model: "eleven_v3", stability: 0.3, similarity_boost: 1, style: 0.3 }, elevenlabs: { voice_id: "FictionalVoice00001", model: "eleven_v3", stability: 0.3, similarity_boost: 1, style: 0.3 }, key: true };

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
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><VoiceReplies /></QueryClientProvider>);

describe("Voice replies in Settings", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("says what happens to a voice note, which voice speaks, and how the chat changes it", async () => {
    serve({ voice: () => [200, free] });
    show();
    expect(await screen.findByText(/Your assistant speaks with the free voice from Microsoft Edge/)).toHaveTextContent("(en-US-AvaMultilingualNeural)");
    expect(screen.getByText(/it answers with a voice note and the same text/)).toBeInTheDocument();
    expect(screen.getByText(/stops voice replies there/)).toHaveTextContent("/voice off stops voice replies there, /voice tts makes every answer spoken, and /voice on goes back");
    expect(screen.queryByRole("button", { name: "Use the free voice instead" })).toBeNull();
  });

  it("makes a sample with the ElevenLabs voice and its settings, plays it, and never keeps the key in the form", async () => {
    const calls = serve({ voice: body => body ? [200, { ...eleven, sample: "data:audio/ogg;base64,T2dnUw==" }] : [200, free] });
    show();
    await screen.findByText(/free voice from Microsoft Edge/);
    fireEvent.change(screen.getByLabelText(/^ElevenLabs key/), { target: { value: "sk_fictional000000000000000000000000" } });
    fireEvent.change(screen.getByLabelText(/^Voice ID/), { target: { value: "FictionalVoice00001" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "eleven_v3" } });
    fireEvent.change(screen.getByLabelText(/^Stability/), { target: { value: "0.3" } });
    fireEvent.change(screen.getByLabelText(/^Similarity/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/^Style/), { target: { value: "0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a sample and save" }));
    expect(await screen.findByText(/Saved\. This is how your assistant sounds now/)).toBeInTheDocument();
    expect(calls.find(c => c.body)?.body).toMatchObject({ service: "elevenlabs", key: "sk_fictional000000000000000000000000", voice_id: "FictionalVoice00001", model: "eleven_v3", stability: "0.3", similarity_boost: "1", style: "0.3" });
    expect(screen.getByLabelText("The sample of your assistant's voice")).toHaveAttribute("src", "data:audio/ogg;base64,T2dnUw==");
    expect(screen.getByText(/Your assistant speaks with your ElevenLabs voice/)).toHaveTextContent("FictionalVoice00001 (model eleven_v3; stability 0.3, similarity 1, style 0.3)");
    expect((screen.getByLabelText(/^ElevenLabs key/) as HTMLInputElement).value).toBe("");
  });

  it("shows ElevenLabs' refusal, the last failure, a chat set to off, and goes back to the free voice", async () => {
    const failing = { ...eleven, chats: { voice_only: 0, all: 0, off: 1 }, failing: { since: "2026-10-25T08:00:00Z", at: "2026-10-25T09:00:00Z", error: "Your ElevenLabs account has no credits left for this." } };
    const calls = serve({ voice: body => !body ? [200, failing] : body.service === "edge" ? [200, free] : [400, { error: "ElevenLabs did not accept the key. Copy it again from your ElevenLabs account." }] });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(/The last voice note could not be made on .*Your ElevenLabs account has no credits left for this\. Your answers still arrive as text\./);
    expect(screen.getByText(/voice replies are switched off/)).toHaveTextContent("Send /voice on there to switch them on again.");
    expect((screen.getByLabelText(/^Voice ID/) as HTMLInputElement).value).toBe("FictionalVoice00001");
    expect(screen.getByLabelText(/^ElevenLabs key \(leave it empty to keep the saved one\)/)).not.toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "Make a sample and save" }));
    expect(await screen.findByText(/ElevenLabs did not accept the key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use the free voice instead" }));
    expect(await screen.findByText(/speaks with the free voice again/)).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ service: "edge" });
  });

  it("is not shown where no Hermes runs the assistant", async () => {
    serve({ voice: () => [200, { available: false }] });
    const { container } = show();
    await new Promise(r => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
