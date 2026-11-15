// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { ChatAttachmentLink } from "./ChatAttachmentLink";

describe("chat attachment presence", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("explains a local-only attachment instead of linking its bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { "notes/large.pdf": "kept_elsewhere" } }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChatAttachmentLink file={{ path: "notes/large.pdf", name: "large.pdf" }} /></QueryClientProvider>);

    expect(await screen.findByText(/Open it on the computer where it was added/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
