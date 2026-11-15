import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test/fake-supabase";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current; } }));

describe("inline attachment presence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("explains local-only pictures and PDFs without creating file URLs", async () => {
    const rows = [
      { filename: "large.png", storage_path: "notes/large.png", mime_type: "image/png" },
      { filename: "large.pdf", storage_path: "notes/large.pdf", mime_type: "application/pdf" },
    ];
    const supa = createFakeSupabase(q => q.table === "note_attachments" ? { data: rows } : undefined);
    const createSignedUrl = vi.fn();
    fake.current = { ...supa.client, storage: { from: () => ({ createSignedUrl }) } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {
      "notes/large.png": "kept_elsewhere",
      "notes/large.pdf": "kept_elsewhere",
    } }))));

    const { resolveAttachmentImagesInHtml } = await import("./upload-attachment");
    const output = await resolveAttachmentImagesInHtml(
      '<img src="" data-attachment-name="large.png"><iframe data-type="pdf" src="about:blank" data-attachment-name="large.pdf"></iframe>',
      "owner",
    );

    expect(output).not.toContain("<img");
    expect(output).not.toContain("<iframe");
    expect(output.match(/Open it on the computer where it was added/g)).toHaveLength(2);
    expect(output).toContain('data-attachment-name="large.png"');
    expect(output).toContain('data-attachment-name="large.pdf"');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
