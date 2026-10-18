// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { TelegramConnect } from "./ConnectTelegram";

// The Telegram step of the one-click server's setup page (16 October 2026). A bot its owner has
// chatted with before shows no Start button, so the page also shows the message to send instead;
// and the connect call carries the browser's time zone and address for the setup chat.
const waiting = { available: true, managed: "web", connected: true, phase: "waiting", bot: { username: "fictional_bot", name: "Fictional" },
  link: "https://t.me/fictional_bot?start=fictionalCode0123456789abcdefgh", start_message: "/start fictionalCode0123456789abcdefgh" };
const none = { available: true, managed: "web", connected: false, phase: "none" };
function show(answers: Record<string, unknown>) {
  const calls: { route: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const route = String(url).replace(/^\/api\//, "");
    calls.push({ route, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answers[route]), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TelegramConnect /></QueryClientProvider>);
  return calls;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TelegramConnect", () => {
  it("names the Start button, and shows the start message to copy for a bot used before", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    show({ telegram: waiting });
    expect(await screen.findByText(/Open it in Telegram with the button below and press/)).toBeInTheDocument();
    expect(screen.getByText("Used this bot before and see no Start button? Then send it this message:")).toBeInTheDocument();
    expect(screen.getByText("/start fictionalCode0123456789abcdefgh").tagName).toBe("CODE");
    expect(screen.getByRole("img", { name: "QR code that opens @fictional_bot in Telegram" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/start fictionalCode0123456789abcdefgh"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByText(/The code works once and makes you the bot's owner\. Then setup goes on in the chat: you connect an AI, about five minutes\. Getting to know you comes afterwards, whenever you like\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/GitHub|briefing/);
  });
  it("sends the browser's time zone and address with the key", async () => {
    const calls = show({ telegram: none, "telegram/connect": waiting });
    fireEvent.change(await screen.findByLabelText("Your bot's key"), { target: { value: "123456789:AAHfictionalKeyForTestsOnly_0123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and connect" }));
    await screen.findByText("/start fictionalCode0123456789abcdefgh");
    const sent = calls.find(c => c.route === "telegram/connect")?.body;
    expect(sent).toEqual({ token: "123456789:AAHfictionalKeyForTestsOnly_0123456789", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, address: window.location.origin });
  });
});
