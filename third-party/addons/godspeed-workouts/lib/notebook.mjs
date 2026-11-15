// The Godspeed notebook, as this add-on writes to it: the same record requests the notebook's own
// screens make (POST /api/query), on the door that answers only on this machine (127.0.0.1:47831),
// as The Clerk and the Wingman write theirs. The address comes from the environment
// (GODSPEED_WORKOUTS_NOTEBOOK), never from the settings file.
//
// Every update and delete names its row (["eq","id",id]): one without a filter would change every
// row of the table. It carries the version just read (`expected`), so a change the person saved in
// between is refused (409) and kept, never written over.
export const DEFAULT_NOTEBOOK = "http://127.0.0.1:47831";

export class NotebookError extends Error {
  constructor(status, body) {
    super(`the notebook answered ${status}: ${String(body?.error || body?.message || "").slice(0, 200)}`);
    this.name = "NotebookError";
    this.status = status;
    this.code = body?.code || null;
    this.conflict = status === 409 || body?.code === "CONFLICT";
  }
}

// The notebook did not answer at all: stopped, unreachable, too slow.
export class NotebookDown extends Error {
  constructor(message) { super(message); this.name = "NotebookDown"; }
}

export class Notebook {
  constructor({ base = DEFAULT_NOTEBOOK, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
    this.base = String(base).replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #post(route, body, timeoutMs) {
    let r;
    try {
      r = await this.fetch(`${this.base}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || this.timeoutMs) });
    } catch (e) { throw new NotebookDown(`the notebook did not answer: ${e.cause?.code || e.name || e.message}`); }
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { r, json };
  }

  async query(body, { timeoutMs } = {}) {
    const { r, json } = await this.#post("/api/query", body, timeoutMs);
    if (!r.ok || json?.error) throw new NotebookError(r.status, json || {});
    return Array.isArray(json?.data) ? json.data : [];
  }

  // Whether the notebook answers: one small read, a short wait. Never throws.
  async answers({ timeoutMs = 5000 } = {}) {
    try { await this.query({ table: "collections", operation: "select", filters: [["eq", "source_app", "godspeed-workouts"]] }, { timeoutMs }); return true; }
    catch { return false; }
  }

  // The time zone the notebook's installation keeps ("Europe/Berlin"), or null.
  async timezone() {
    try {
      const row = (await this.query({ table: "settings", operation: "select", filters: [["eq", "id", "installation"]] }))[0];
      return typeof row?.timezone === "string" && row.timezone ? row.timezone : null;
    } catch { return null; }
  }

  // Where the person opens this notebook in a browser ("https://host"), as the notebook answers
  // get_notebook_link on its MCP door. null when it answered without one.
  async address({ timeoutMs = 10000 } = {}) {
    try {
      const { r, json } = await this.#post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_notebook_link", arguments: {} } }, timeoutMs);
      if (!r.ok || !json || json.error || json.result?.isError) return null;
      const link = JSON.parse(json.result?.content?.[0]?.text || "null")?.link;
      const u = new URL(String(link || ""));
      return ["https:", "http:"].includes(u.protocol) && u.hostname ? u.origin : null;
    } catch { return null; }
  }

  async collection(id) { return (await this.query({ table: "collections", operation: "select", filters: [["eq", "id", id]] }))[0] || null; }
  async collections() { return this.query({ table: "collections", operation: "select" }); }
  async createCollection(values) { return (await this.query({ table: "collections", operation: "insert", values }))[0]; }
  async updateCollection(id, values, hash) {
    return (await this.query({ table: "collections", operation: "update", values, filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }
  async items(collectionId) { return this.query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", collectionId]] }); }
  async itemById(id) { return (await this.query({ table: "collection_items", operation: "select", filters: [["eq", "id", id]] }))[0] || null; }
  async item(collectionId, sourceId) {
    return (await this.query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", collectionId], ["eq", "source_id", sourceId]] }))[0] || null;
  }
  async insertItem(values) { return (await this.query({ table: "collection_items", operation: "insert", values }))[0]; }
  async updateItem(id, data, hash) {
    return (await this.query({ table: "collection_items", operation: "update", values: { data }, filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }
  async deleteItem(id, hash) {
    return (await this.query({ table: "collection_items", operation: "delete", filters: [["eq", "id", id]], expected: hash ? { [id]: hash } : {} }))[0];
  }
}

export const collectionLink = (web, slug) => (web && slug ? `${web}/collections/${encodeURIComponent(slug)}` : "");
