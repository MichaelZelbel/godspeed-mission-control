import { describe, expect, it, vi } from "vitest";
import { MEDIA_UPLOAD_MAX_BYTES, MEDIA_UPLOAD_MAX_MB } from "../../../shared/media-limits.mjs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { validateFile } from "./upload-attachment";

// #528: the note editor refused anything over 20 MB, but files over 50 MB are the ones kept on
// one computer only (#507), so a person could not add them in the app at all. The editor now holds
// files to the server's own limit for /api/media/upload: one number,
// notebook/shared/media-limits.mjs. This checks the editor against it; the notebook's
// test/media-upload-limit.test.mjs checks the server against the same number.

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
