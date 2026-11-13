import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MEDIA_UPLOAD_MAX_BYTES, MEDIA_UPLOAD_MAX_MB } from "../../../shared/media-limits.mjs";
import { createService } from "../../../server/main.mjs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { validateFile } from "./upload-attachment";

// #528: the note editor refused anything over 20 MB, but files over 50 MB are the ones kept on
// one computer only (#507), so a person could not add them in the app at all. The editor now holds
// files to the server's own limit for /api/media/upload: one number, checked here on both sides.

const sized = (size: number, type = "video/mp4") => ({ size, type, name: "clip.mp4" }) as File;

describe("the note editor's attachment limit", () => {
  it("is well above the 50 MB a file needs to be kept on one computer only", () => {
    expect(MEDIA_UPLOAD_MAX_BYTES).toBeGreaterThan(50 * 1024 * 1024);
    expect(validateFile(sized(60 * 1024 * 1024))).toBeNull();
  });

  it("takes a file of exactly the limit and refuses one byte more, naming the limit", () => {
    expect(validateFile(sized(MEDIA_UPLOAD_MAX_BYTES))).toBeNull();
    const refused = validateFile(sized(MEDIA_UPLOAD_MAX_BYTES + 1));
    expect(refused).toMatch(new RegExp(`Max is ${MEDIA_UPLOAD_MAX_MB} MB\\.$`));
  });
});

describe("the editor's limit and /api/media/upload's are the same number", () => {
  let root = "", service: any, base = "";
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-upload-limit-"));
    service = await createService({ root, port: 0 });
    base = "http://127.0.0.1:" + service.address.port;
  });
  afterAll(async () => { await service?.close(); fs.rmSync(root, { recursive: true, force: true }); });

  const upload = async (size: number, name: string) => {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(size)], { type: "video/mp4" }), name);
    form.set("path", "owner/" + name);
    const r = await fetch(base + "/api/media/upload", { method: "POST", body: form });
    return { status: r.status, body: await r.json() };
  };

  it("the server takes what the editor takes, and refuses what it refuses, in the same words", async () => {
    expect(validateFile(sized(MEDIA_UPLOAD_MAX_BYTES))).toBeNull();
    const taken = await upload(MEDIA_UPLOAD_MAX_BYTES, "at-the-limit.mp4");
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);

    const editor = validateFile(sized(MEDIA_UPLOAD_MAX_BYTES + 1))!;
    const refused = await upload(MEDIA_UPLOAD_MAX_BYTES + 1, "one-byte-over.mp4");
    expect(refused.status).toBe(413);
    const named = (text: string) => text.match(/Max is (\d+) MB\./)?.[1];
    expect(named(refused.body.error)).toBe(String(MEDIA_UPLOAD_MAX_MB));
    expect(named(editor)).toBe(named(refused.body.error));
  }, 60_000);
});
