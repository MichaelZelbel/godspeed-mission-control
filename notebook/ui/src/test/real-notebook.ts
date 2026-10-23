import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A real notebook with an empty workspace, for screen tests that need its
// actual answers (versions, refused saves, the conflict pile). It runs in a
// process of its own (notebook-server.mjs). `away` makes every request the
// screen sends fail as a browser's does while the notebook restarts.
export interface RealNotebook {
  base: string;
  root: string;
  /** While true, the screen's requests fail the way a browser's do when nothing answers. */
  away: boolean;
  /** Every /api/query request the screen sent, as sent. */
  sent: any[];
  /** A request straight to the notebook, as another device would send it. */
  query: (body: Record<string, unknown>) => Promise<any>;
  /** fetch for the screen: relative /api addresses go to this notebook. */
  fetch: typeof fetch;
  conflicts: () => any[];
  stop: () => Promise<void>;
}

const helper = fileURLToPath(new globalThis.URL("./notebook-server.mjs", import.meta.url).href);

export async function startNotebook(): Promise<RealNotebook> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-screen-"));
  const child: ChildProcess = spawn(process.execPath, [helper, root], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    let err = "";
    child.stdout!.on("data", (chunk) => {
      out += chunk;
      const match = out.match(/listening (\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.stderr!.on("data", (chunk) => { err += chunk; });
    child.on("exit", (code) => reject(new Error(`The test notebook stopped (${code}): ${err.slice(-500)}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const realFetch = globalThis.fetch.bind(globalThis);
  const query = async (body: Record<string, unknown>) => {
    const response = await realFetch(base + "/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || "Request failed"), { code: result.code });
    return result.data;
  };
  const notebook: RealNotebook = {
    base,
    root,
    away: false,
    sent: [],
    query,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/query") && init?.body) notebook.sent.push(JSON.parse(String(init.body)));
      if (notebook.away) throw new TypeError("Failed to fetch");
      return realFetch(url.startsWith("/") ? base + url : url, init);
    }) as typeof fetch,
    conflicts: () => {
      const folder = path.join(root, "conflicts");
      if (!fs.existsSync(folder)) return [];
      return fs.readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(folder, name), "utf8")));
    },
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
      }
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a file still held open on Windows */ }
    },
  };
  return notebook;
}
