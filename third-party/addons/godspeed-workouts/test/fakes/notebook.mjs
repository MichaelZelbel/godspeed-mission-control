// A pretend Godspeed notebook for the fast tests: its local door's record requests (POST
// /api/query) for collections, collection items and the installation settings, and the MCP tool
// get_notebook_link, over real HTTP on 127.0.0.1. Where the add-on depends on it, it behaves the
// way the real notebook does (read from the product's notebook/core/query.mjs):
// - an insert or update merges the values over the row; every row answers with its _hash;
// - an update or delete with `expected` whose hash is not the row's is refused (409 CONFLICT);
// - a delete sets removed_at, and the row is gone from every read;
// - an item's title is its collection's primary field; a number column refuses a non-number.
// `down = true` drops every connection, as a stopped notebook would.
import http from "node:http";
import crypto from "node:crypto";

const hashOf = (row) => crypto.createHash("sha256").update(JSON.stringify({ ...row, _hash: undefined })).digest("hex");
const slugOf = (s) => String(s || "record").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "record";

export async function startFakeNotebook({ web = "https://notebook.example", timezone = "Europe/Berlin" } = {}) {
  const tables = { collections: new Map(), collection_items: new Map(), settings: new Map([["installation", { id: "installation", timezone }]]) };
  const writes = [];
  let n = 1;
  const fb = { down: false, refuse: null };
  const live = (t) => [...tables[t].values()].filter((r) => !r.removed_at);
  const matches = (row, filters = []) => filters.every(([op, k, v]) => op === "eq" && row[k] === v);
  const out = (row) => ({ ...row, _hash: hashOf(row) });

  function execute(b) {
    const t = tables[b.table];
    if (!t) throw Object.assign(new Error(`unknown table ${b.table}`), { status: 400 });
    if (b.operation === "select") return live(b.table).filter((r) => matches(r, b.filters)).map(out);
    if (fb.refuse && b.table === "collection_items" && b.operation !== "select") throw Object.assign(new Error(fb.refuse), { status: 400 });
    if (b.operation === "insert") {
      return [].concat(b.values).map((v) => {
        const id = v.id || `${b.table === "collections" ? slugOf(v.name) : "collection-items"}-${String(n++).padStart(8, "0")}`;
        if (t.has(id)) throw Object.assign(new Error("Record already exists"), { status: 400 });
        const at = new Date().toISOString();
        const row = { ...v, id, created_at: at, updated_at: at };
        if (b.table === "collections") row.slug = slugOf(v.name);
        if (b.table === "collection_items") check(row);
        t.set(id, row);
        writes.push({ table: b.table, op: "insert", id });
        return out(row);
      });
    }
    if (b.operation === "update" || b.operation === "delete") {
      if (!b.filters?.length) throw Object.assign(new Error("an update needs a filter"), { status: 400 });
      return live(b.table).filter((r) => matches(r, b.filters)).map((r) => {
        const want = b.expected?.[r.id];
        if (want && want !== hashOf(r)) throw Object.assign(new Error("This record changed since it was read"), { status: 409, code: "CONFLICT" });
        const next = b.operation === "delete" ? { ...r, removed_at: new Date().toISOString() } : { ...r, ...b.values, updated_at: new Date().toISOString() };
        if (b.table === "collection_items" && b.operation === "update") check(next);
        t.set(r.id, next);
        writes.push({ table: b.table, op: b.operation, id: r.id });
        return out(next);
      });
    }
    throw Object.assign(new Error(`unknown operation ${b.operation}`), { status: 400 });
  }
  function check(item) {
    const coll = tables.collections.get(item.collection_id);
    if (!coll) throw Object.assign(new Error("Collection missing"), { status: 400 });
    const primary = coll.field_schema?.find((f) => f.primary);
    item.title = primary ? String(item.data?.[primary.key] ?? "Untitled") : item.title || "Untitled";
    for (const f of coll.field_schema || []) {
      const v = item.data?.[f.key];
      if (v == null || v === "") continue;
      if (f.type === "number" && !Number.isFinite(Number(v))) throw Object.assign(new Error(`Expected a number for ${f.label}`), { status: 400 });
    }
  }

  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    if (fb.down) { req.socket.destroy(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status, j) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    try {
      const b = JSON.parse(body || "{}");
      if (req.url === "/api/query") return send(200, { data: execute(b), error: null });
      if (req.url === "/mcp" && b.params?.name === "get_notebook_link") return send(200, { jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: JSON.stringify({ link: `${web}/dashboard` }) }] } });
      return send(404, { error: "Unknown operation" });
    } catch (e) { return send(e.status || 500, { error: e.message, code: e.code }); }
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;

  const api = {
    url, web, fb, tables, writes,
    tracker: () => live("collections").find((c) => c.tracker),
    rows: () => { const c = api.tracker(); return c ? live("collection_items").filter((i) => i.collection_id === c.id) : []; },
    row: (sourceId) => api.rows().find((i) => i.source_id === sourceId),
    // The person, in the notebook's table: only the cells they changed, onto the stored data.
    edit(id, cells) { const r = tables.collection_items.get(id); tables.collection_items.set(id, { ...r, data: { ...r.data, ...cells }, updated_at: new Date().toISOString() }); },
    remove(id) { const r = tables.collection_items.get(id); tables.collection_items.set(id, { ...r, removed_at: new Date().toISOString() }); },
    close: () => { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(r)); },
  };
  return api;
}
