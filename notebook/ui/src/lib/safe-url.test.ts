import { describe, it, expect } from "vitest";
import { safeEmbedSrc, safeExternalUrl } from "./safe-url";

// jsdom gives location.origin = http://localhost:3000 by default.
describe("safeEmbedSrc", () => {
  it("allows the app's own relative media URL (note PDFs, video, audio)", () => {
    expect(safeEmbedSrc("/api/media/file/abc.pdf")).toBe("/api/media/file/abc.pdf");
    expect(safeEmbedSrc("/api/media/file/" + encodeURIComponent("Ärztebrief.pdf"))).toBe(
      "/api/media/file/" + encodeURIComponent("Ärztebrief.pdf"),
    );
  });
  it("still allows an absolute http(s) URL written in full", () => {
    expect(safeEmbedSrc("https://example.com/clip.mp4")).toBe("https://example.com/clip.mp4");
  });
  it("refuses a protocol-relative off-site URL and non-http schemes", () => {
    expect(safeEmbedSrc("//evil.example/x")).toBe("about:blank");
    expect(safeEmbedSrc("javascript:alert(1)")).toBe("about:blank");
    expect(safeEmbedSrc("data:text/html,<script>")).toBe("about:blank");
    expect(safeEmbedSrc("file:///etc/passwd")).toBe("about:blank");
    expect(safeEmbedSrc(null)).toBe("about:blank");
  });
});

describe("safeExternalUrl", () => {
  it("passes http(s) and app schemes, rejects javascript:", () => {
    expect(safeExternalUrl("https://example.com")).toBe("https://example.com");
    expect(safeExternalUrl("obsidian://open?vault=x")).toBe("obsidian://open?vault=x");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("  ")).toBeNull();
  });
});
