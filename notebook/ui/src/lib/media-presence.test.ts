import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMediaPresence } from "./media-presence";

describe("media presence boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("batches libraries larger than the server limit and merges their classifications", async () => {
    const paths = Array.from({ length: 501 }, (_, index) => `notes/${index}.png`);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const batch = JSON.parse(String(init.body)).paths as string[];
      return new Response(JSON.stringify({ data: Object.fromEntries(batch.map(path => [path, path === paths[500] ? "kept_elsewhere" : "present"])) }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadMediaPresence(paths);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).paths).toHaveLength(500);
    expect(result[paths[500]]).toBe("kept_elsewhere");
  });

  it("rejects a response status outside the server contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { "notes/file.png": "elsewhere" } }))));
    await expect(loadMediaPresence(["notes/file.png"])).rejects.toThrow();
  });
});
