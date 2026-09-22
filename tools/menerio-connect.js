#!/usr/bin/env node
/*
 * menerio-connect.js - connect your notebook ONCE, and every way you use your mission control has it:
 * Claude Code, Hermes and Codex.
 *
 * WHY THIS EXISTS. Each assistant keeps its list of connections somewhere else. Claude Code
 * reads .mcp.json in your mission control folder. Hermes keeps config.yaml and a .env of its own, outside
 * your folder. Codex keeps config.toml in its own folder. Until 2026-09-20 the kit shipped an
 * empty .mcp.json that the installer would not touch once it existed, and told you to type
 * a command per assistant and paste your key into each. Three places, three copies of one
 * key, and the day you replaced the key, two of them went on using the old one without a word.
 *
 * ONE KEY, NAMED EVERYWHERE, KEPT IN ONE PLACE. Every file this writes NAMES the key as
 * MENERIO_API_KEY and none of them holds it, with one exception: Hermes' own .env. The Hermes
 * desktop app is started from an icon and not from a terminal, so it never sees what your
 * terminal knows, and its own .env is the only place it looks. That one line is rendered from
 * the locked store in your mission control, and `--refresh` renders it again when the store changes. The
 * hourly notebook job runs `--refresh`, so a key you replace reaches Hermes within the hour.
 *
 * IT NEVER ASKS FOR THE KEY AND NEVER PRINTS IT. The installer puts the key into the locked
 * store. A key typed into a chat ends up in a chat log.
 *
 * IT LEAVES ALONE WHAT IS ALREADY THERE. A connection to the notebook that you or an older
 * page of the book made by hand keeps working, under whatever name it has, and is reported.
 * Every other line of every file is kept. Running this twice changes nothing the second time.
 *
 *   mc-menerio-connect             connect whatever is on this computer, then test it
 *   mc-menerio-connect --check     change nothing, say how things are
 *   mc-menerio-connect --refresh   quiet: only re-render Hermes' key line if the key changed
 *   mc-menerio-connect --godspeed PATH  a mission control somewhere else
 *
 * Exit code 0 unless something failed.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawnSync } = require("child_process");
const nb = require("./mc-notebook.js");

const MCP_URL = "https://mcp.menerio.com";
// The name matters. Hermes has a memory tool of its own, and a connection called `memory`
// gets confused with it (measured twice on Hermes 0.20.6, see menerio/mcp-connection.md).
const SERVER_NAME = "notebook";
const KEY_NAME = "MENERIO_API_KEY";
const KEY_REF = "${" + KEY_NAME + "}";
const OLD_HERMES_KEY_NAME = "MCP_NOTEBOOK_API_KEY";

// ---------------------------------------------------------------- arguments
let godspeedArg = "", checkOnly = false, refreshOnly = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--godspeed") { godspeedArg = argv[i + 1] || ""; i += 1; continue; }
  if (argv[i] === "--check") { checkOnly = true; continue; }
  if (argv[i] === "--refresh") { refreshOnly = true; continue; }
  if (argv[i] === "-h" || argv[i] === "--help") {
    console.log("mc-menerio-connect - connect your notebook once, for Claude Code, Hermes and Codex");
    console.log("  mc-menerio-connect [--check] [--refresh] [--godspeed PATH]");
    console.log("");
    console.log("  It reads the key from your mission control's locked store. It never asks for it.");
    process.exit(0);
  }
}

const sameUrl = (u) => String(u || "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "").toLowerCase() === MCP_URL;
const readIf = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return null; } };
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } };

// Write only when the text is different, and keep a copy of what was there first. The copy
// is one file, <name>.bak, because a pile of dated backups in somebody's settings folder is
// a mess we made.
function writeWithBackup(file, before, after) {
  if (before === after) return false;
  if (before !== null) fs.writeFileSync(file + ".bak", before);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  return true;
}

// Is a program on PATH? Looked up, not run: `codex` on Windows is a .cmd, which Node cannot
// start without a shell, and "could not start it" must not be read as "not installed".
function onPath(name) {
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").concat([""]) : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* keep looking */ }
    }
  }
  return "";
}

// ================================================================ Claude Code: .mcp.json
// The file in your mission control folder that Claude Code reads whenever it opens the folder. It names
// the key and never holds it, which is why it can sit in the folder and travel to your backup.
function connectClaudeCode(godspeed, change) {
  const file = path.join(godspeed, ".mcp.json");
  const before = readIf(file);
  let doc = {};
  if (before !== null && before.trim()) {
    try { doc = JSON.parse(before); } catch (e) {
      return { status: "failed", detail: ".mcp.json in your mission control folder is not valid JSON, so I left it alone" };
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return { status: "failed", detail: ".mcp.json in your mission control folder is not the shape I expected, so I left it alone" };
    }
  }
  const servers = (doc.mcpServers && typeof doc.mcpServers === "object") ? doc.mcpServers : {};
  for (const name of Object.keys(servers)) {
    if (servers[name] && sameUrl(servers[name].url)) {
      return { status: "already connected", detail: name === SERVER_NAME
        ? ".mcp.json in your mission control folder names the notebook"
        : ".mcp.json already reaches the notebook under the name `" + name + "`, so I added nothing" };
    }
  }
  if (servers[SERVER_NAME]) {
    return { status: "failed", detail: ".mcp.json already has a `" + SERVER_NAME + "` that points somewhere else, so I left it alone" };
  }
  if (!change) return { status: "not connected yet", detail: ".mcp.json in your mission control folder does not name the notebook" };
  servers[SERVER_NAME] = { type: "http", url: MCP_URL, headers: { Authorization: "Bearer " + KEY_REF } };
  doc.mcpServers = servers;
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  return { status: "connected", detail: "I added the notebook to .mcp.json in your mission control folder" };
}

// ================================================================ Hermes
// Where Hermes keeps its settings. HERMES_HOME when it is set, then the two places Hermes
// uses by itself, and only then Hermes' own answer, because asking it takes two seconds and
// the hourly --refresh should not spend them.
function hermesHome(hermesBin) {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  const spots = [path.join(os.homedir(), ".hermes")];
  if (process.env.LOCALAPPDATA) spots.push(path.join(process.env.LOCALAPPDATA, "hermes"));
  for (const d of spots) {
    if (fs.existsSync(path.join(d, "config.yaml")) || fs.existsSync(path.join(d, ".env"))) return d;
  }
  if (hermesBin && !/\.(cmd|bat)$/i.test(hermesBin)) {
    const r = spawnSync(hermesBin, ["config", "path"], { encoding: "utf8", timeout: 30000 });
    const line = (r.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => /config\.ya?ml$/i.test(l)).pop();
    if (line) return path.dirname(line);
  }
  return "";
}

// The part of config.yaml under `mcp_servers:`, read as text. Node has no YAML reader and
// this kit installs no packages, and the question is small: which servers are named, and
// what does each one say. `entries` maps a server name to the lines under it.
function readMcpServers(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^mcp_servers[ \t]*:/.test(l));
  if (start < 0) return { start: -1, end: -1, indent: "  ", entries: {}, inline: false };
  const inline = !/^mcp_servers[ \t]*:[ \t]*(#.*)?$/.test(lines[start]);
  let end = start + 1;
  while (end < lines.length && (/^[ \t]/.test(lines[end]) || /^[ \t]*(#.*)?$/.test(lines[end]))) end += 1;
  // Blank lines and comments at the bottom belong to whatever comes next, not to this block.
  while (end > start + 1 && /^[ \t]*(#.*)?$/.test(lines[end - 1])) end -= 1;
  const entries = {};
  let indent = "", current = "";
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^([ \t]+)([^\s#][^:]*):[ \t]*(#.*)?$/);
    if (m && (!indent || m[1] === indent)) {
      indent = m[1];
      current = m[2].trim().replace(/^["']|["']$/g, "");
      entries[current] = [];
    } else if (current) entries[current].push(lines[i]);
  }
  return { start: start, end: end, indent: indent || "  ", entries: entries, inline: inline };
}

function hermesState(yaml) {
  const block = readMcpServers(yaml);
  for (const name of Object.keys(block.entries)) {
    const text = block.entries[name].join("\n");
    const url = (text.match(/^[ \t]+url[ \t]*:[ \t]*(\S+)/m) || [])[1];
    if (!sameUrl(url)) continue;
    if (text.includes(KEY_REF) || text.includes("${env:" + KEY_NAME + "}")) return { kind: "ours", name: name, block: block };
    if (text.includes(OLD_HERMES_KEY_NAME)) return { kind: "old-hand-made", name: name, block: block };
    return { kind: "hand-made", name: name, block: block };
  }
  if (block.entries[SERVER_NAME]) return { kind: "name-taken", name: SERVER_NAME, block: block };
  if (block.inline && !/^mcp_servers[ \t]*:[ \t]*(\{\s*\}|null|~)[ \t]*(#.*)?$/.test(yaml.split(/\r?\n/)[block.start])) {
    return { kind: "unreadable", name: "", block: block };
  }
  return { kind: "absent", name: "", block: block };
}

// The careful edit, for when Hermes' own command cannot be used. It adds lines and changes
// none: a block at the end when `mcp_servers:` is missing, one entry under it when it is there.
function addHermesServerByHand(yaml, block) {
  const eol = yaml.includes("\r\n") ? "\r\n" : "\n";
  const i1 = block.indent, i2 = i1 + i1, i3 = i2 + i1;
  const entry = [i1 + SERVER_NAME + ":", i2 + "url: " + MCP_URL, i2 + "headers:",
    i3 + "Authorization: Bearer " + KEY_REF];
  const lines = yaml.split(/\r?\n/);
  if (block.start < 0) {
    const body = yaml.replace(/\s+$/, "");
    return (body ? body + eol : "") + ["mcp_servers:"].concat(entry).join(eol) + eol;
  }
  if (block.inline) lines[block.start] = "mcp_servers:";       // it said `mcp_servers: {}`
  lines.splice(block.start + 1, 0, ...entry);
  return lines.join(eol);
}

// Hermes' own .env, one line of it. Returns "same", "changed" or "added".
function renderHermesEnv(envFile, key, change) {
  const before = readIf(envFile);
  const want = KEY_NAME + "=" + key;
  const lines = before === null ? [] : before.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp("^[ \\t]*(export[ \\t]+)?" + KEY_NAME + "[ \\t]*=").test(l));
  if (at >= 0 && lines[at].trim() === want) return "same";
  const result = at >= 0 ? "changed" : "added";
  if (!change) return result;
  const eol = before !== null && before.includes("\r\n") ? "\r\n" : "\n";
  if (at >= 0) lines[at] = want;
  else {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(want);
  }
  let text = lines.join(eol);
  if (!text.endsWith(eol)) text += eol;
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  // 600 from the first byte on a new file, and again afterwards for one that already existed
  // with looser rights. Windows has no such bits and keeps the file inside your own account.
  fs.writeFileSync(envFile, text, { mode: 0o600 });
  if (process.platform !== "win32") { try { fs.chmodSync(envFile, 0o600); } catch (e) { /* not ours to change */ } }
  return result;
}

function connectHermes(key, change) {
  const bin = onPath("hermes");
  const home = hermesHome(bin);
  if (!home || (!bin && !isDir(home))) return { status: "not installed", detail: "" };
  const cfgFile = path.join(home, "config.yaml");
  const envFile = path.join(home, ".env");
  const yaml = readIf(cfgFile) || "";
  let state = hermesState(yaml);

  if (state.kind === "old-hand-made") {
    return { status: "already connected", detail: "by hand, the older way: `" + state.name + "` uses its own copy of the key (" +
      OLD_HERMES_KEY_NAME + " in Hermes' .env). It keeps working and I left it alone. It will not follow a key you replace; " +
      "to let it, run `hermes mcp remove " + state.name + "` and then this again" };
  }
  if (state.kind === "hand-made") {
    return { status: "already connected", detail: "by hand, as `" + state.name + "` in Hermes' settings. I left it alone. " +
      "It will not follow a key you replace" };
  }
  if (state.kind === "name-taken") {
    return { status: "failed", detail: "Hermes already has a `" + SERVER_NAME + "` that points somewhere else, so I left it alone" };
  }
  if (state.kind === "unreadable") {
    return { status: "failed", detail: "I could not read the mcp_servers line in " + cfgFile + ", so I left it alone" };
  }

  let added = false;
  if (state.kind === "absent") {
    if (!change) return { status: "not connected yet", detail: "its settings do not name the notebook" };
    if (yaml) fs.writeFileSync(cfgFile + ".bak", yaml);
    // Hermes' own command first: it knows its file better than this program does. It is two
    // plain calls and asks nothing. Verified on Hermes 0.21.2. It rewrites the whole file and
    // drops comments, as every `hermes config set` does, which is why the copy is made first.
    if (bin && !/\.(cmd|bat)$/i.test(bin) && !process.env.GODSPEED_CONNECT_NO_HERMES_CLI) {
      const set = (k, v) => spawnSync(bin, ["config", "set", k, v], { encoding: "utf8", timeout: 60000 });
      set("mcp_servers." + SERVER_NAME + ".url", MCP_URL);
      set("mcp_servers." + SERVER_NAME + ".headers.Authorization", "Bearer " + KEY_REF);
      state = hermesState(readIf(cfgFile) || "");
    }
    if (state.kind !== "ours") {
      const now = readIf(cfgFile) || "";
      state = hermesState(now);
      if (state.kind === "absent") fs.writeFileSync(cfgFile, addHermesServerByHand(now, state.block));
      state = hermesState(readIf(cfgFile) || "");
    }
    if (state.kind !== "ours") return { status: "failed", detail: "I could not add the notebook to " + cfgFile };
    added = true;
  }

  const env = renderHermesEnv(envFile, key, change);
  if (!change) {
    return env === "same"
      ? { status: "already connected", detail: "nothing to do" }
      : { status: "not connected yet", detail: env === "added" ? "its settings name the notebook, and its .env does not hold your key yet"
        : "its settings name the notebook, and its .env holds an older key" };
  }
  if (added) return { status: "connected", detail: "it will find your notebook the next time you open it" };
  if (env === "same") return { status: "already connected", detail: "nothing to do" };
  return { status: "connected", detail: env === "changed" ? "it was holding an older key, and now holds your current one"
    : "its settings named the notebook already, and now its .env holds your key" };
}

// --refresh. Quiet, no network, and it only ever touches the one line: a Hermes that this
// program connected, whose copy of the key is no longer the one in your store.
function refreshHermes(key) {
  const home = hermesHome("");
  if (!home) return;
  const state = hermesState(readIf(path.join(home, "config.yaml")) || "");
  if (state.kind !== "ours") return;
  renderHermesEnv(path.join(home, ".env"), key, true);
}

// ================================================================ Codex
// ~/.codex/config.toml. A streamable HTTP server is a table with `url`, and
// `bearer_token_env_var` NAMES the variable Codex reads the key from at start-up. Verified
// on codex-cli 0.144.1: `codex mcp add notebook --url ... --bearer-token-env-var ...` writes
// exactly the three lines below. They are written here directly, because the file has to be
// right on a computer where ~/.codex exists and the `codex` command is not on PATH.
function connectCodex(change) {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  if (!isDir(home) && !onPath("codex")) return { status: "not installed", detail: "" };
  const file = path.join(home, "config.toml");
  const before = readIf(file);
  const text = before || "";
  const tables = {};
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    const t = line.match(/^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*("([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))[ \t]*\][ \t]*(#.*)?$/);
    if (t) { current = t[2] || t[3] || t[4]; tables[current] = []; continue; }
    if (/^[ \t]*\[/.test(line)) { current = ""; continue; }
    if (current) tables[current].push(line);
  }
  for (const name of Object.keys(tables)) {
    const url = (tables[name].join("\n").match(/^[ \t]*url[ \t]*=[ \t]*("[^"]*"|'[^']*')/m) || [])[1];
    if (sameUrl(url)) {
      return { status: "already connected", detail: name === SERVER_NAME
        ? "its config.toml names the notebook"
        : "its config.toml already reaches the notebook under the name `" + name + "`, so I added nothing" };
    }
  }
  // Somebody wrote it in a shape this small reader does not follow (an inline table). The
  // address is in the file, so it is connected, and a second entry would be a duplicate.
  if (text.toLowerCase().includes(MCP_URL)) {
    return { status: "already connected", detail: "its config.toml already names the notebook's address, so I added nothing" };
  }
  if (tables[SERVER_NAME]) {
    return { status: "failed", detail: "Codex already has a `" + SERVER_NAME + "` that points somewhere else, so I left it alone" };
  }
  if (!change) return { status: "not connected yet", detail: "its config.toml does not name the notebook" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.replace(/\s+$/, "");
  const after = (body ? body + eol + eol : "") + ["[mcp_servers." + SERVER_NAME + "]",
    "url = \"" + MCP_URL + "\"", "bearer_token_env_var = \"" + KEY_NAME + "\""].join(eol) + eol;
  writeWithBackup(file, before, after);
  return { status: "connected", detail: "I added the notebook to " + path.join(home, "config.toml") +
    ". Codex reads the key from your terminal, which the installer already taught it" };
}

// ================================================================ the test: does it answer?
// Read-only: say hello, ask which tools there are, count them. Nothing is saved in the
// notebook and nothing is read out of it. MENERIO_MCP_URL exists for the test suite only and
// changes where this one test calls, never what is written into anybody's settings.
function post(url, key, payload, session) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;
    const data = Buffer.from(JSON.stringify(payload));
    const headers = { Authorization: "Bearer " + key, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", "Content-Length": data.length };
    if (session) headers["Mcp-Session-Id"] = session;
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(clock); resolve(v); } };
    const req = lib.request(u, { method: "POST", headers: headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => finish({ status: res.statusCode, session: res.headers["mcp-session-id"] || "",
        text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => finish({ error: "the answer broke off" }));
    });
    const clock = setTimeout(() => { finish({ error: "no answer in 20 seconds" }); req.destroy(); }, 20000);
    req.on("error", (e) => finish({ error: ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"].includes(e.code)
      ? "this computer could not reach " + u.host : "the call failed (" + (e.code || e.message) + ")" }));
    req.end(data);
  });
}

// The answer is plain JSON, or the same JSON on a `data:` line of an event stream.
function rpcBody(text) {
  try { return JSON.parse(text); } catch (e) { /* an event stream, then */ }
  for (const line of text.split(/\r?\n/).reverse()) {
    if (line.startsWith("data:")) { try { return JSON.parse(line.slice(5)); } catch (e) { /* next */ } }
  }
  return null;
}

async function testConnection(key) {
  const url = process.env.MENERIO_MCP_URL || MCP_URL;
  const refused = (r) => {
    if (r.error) return r.error;
    if (r.status === 401 || r.status === 403) {
      const said = (rpcBody(r.text) || {}).error;
      return "Menerio refused the key (" + r.status + ")" + (typeof said === "string" ? ": " + said.slice(0, 160).replace(/[.\s]+$/, "") : "");
    }
    if (r.status < 200 || r.status > 299) return "Menerio answered " + r.status;
    return "";
  };
  const hello = await post(url, key, { jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mc-menerio-connect", version: "1" } } });
  let why = refused(hello);
  if (why) return { ok: false, detail: why };
  const session = hello.session;
  await post(url, key, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
  const list = await post(url, key, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, session);
  why = refused(list);
  if (why) return { ok: false, detail: why };
  const body = rpcBody(list.text);
  if (body && body.error) return { ok: false, detail: "Menerio said: " + String(body.error.message || JSON.stringify(body.error)).slice(0, 160) };
  const tools = body && body.result && Array.isArray(body.result.tools) ? body.result.tools.length : -1;
  if (tools < 0) return { ok: false, detail: "Menerio answered, and I could not read its list of tools" };
  return { ok: true, tools: tools };
}

// ================================================================ the run
async function main() {
  const godspeed = nb.findHub(godspeedArg);
  const k = nb.menerioKey(godspeed);

  if (refreshOnly) {                      // never a word, never a failure: a schedule runs this
    if (k.key) { try { refreshHermes(k.key); } catch (e) { /* the next hour tries again */ } }
    return 0;
  }

  console.log("");
  console.log(checkOnly ? "Checking how your notebook is connected. Nothing is changed."
    : "Connecting your notebook to every way you use your mission control.");
  console.log("");
  if (!godspeed) {
    console.log("  I could not find your mission control folder. Run this inside it, or say where it is:");
    console.log("    mc-menerio-connect --godspeed /path/to/your/godspeed");
    console.log("");
    return 1;
  }
  console.log("  Your mission control folder: " + godspeed);
  console.log("");
  if (!k.key) {
    console.log("  There is no Menerio key here: " + k.why + ".");
    console.log("  That is fine if you do not want a notebook. Your mission control works without one.");
    console.log("  If you do want one: make a free account at https://menerio.com/auth?tab=signup");
    console.log("  and run the installer again. It asks for the key once and locks it into your mission control.");
    console.log("  Please do not paste the key into a chat.");
    console.log("");
    return checkOnly ? 0 : 1;
  }

  const rows = [];
  const attempt = (label, fn) => {
    try { rows.push([label, fn()]); }
    catch (e) { rows.push([label, { status: "failed", detail: String(e && e.message ? e.message : e) }]); }
  };
  attempt("Claude Code", () => connectClaudeCode(godspeed, !checkOnly));
  // .mcp.json is written whether or not Claude Code is on this computer, because the file
  // belongs to the mission control and travels with it. But "Claude Code connected" told a reader who
  // has only ever used Hermes that something they never installed had been connected.
  // Say what is true for them: nothing to do, and it is there if they ever want it.
  {
    const cc = rows[rows.length - 1][1];
    const hasClaude = onPath("claude") || fs.existsSync(path.join(os.homedir(), ".claude"));
    if (!hasClaude && (cc.status === "connected" || cc.status === "already connected")) {
      rows[rows.length - 1][1] = { status: "not installed",
        detail: "that is fine. If you ever use it, it finds your notebook too" };
    }
  }
  attempt("Hermes", () => connectHermes(k.key, !checkOnly));
  attempt("Codex", () => connectCodex(!checkOnly));

  let failed = 0;
  for (const [label, r] of rows) {
    if (r.status === "failed") failed += 1;
    const head = r.status === "failed" ? "failed: " + r.detail : r.status + (r.detail ? ". " + r.detail.charAt(0).toUpperCase() + r.detail.slice(1) : "");
    console.log("  " + (label + "              ").slice(0, 14) + head + (/[.!]$/.test(head) || !r.detail ? "" : "."));
  }

  const t = await testConnection(k.key);
  if (t.ok) console.log("  The notebook  answered. Your key works.");
  else { failed += 1; console.log("  The notebook  failed: " + t.detail + "."); }

  console.log("");
  if (!checkOnly && rows.some(([, r]) => r.status === "connected")) {
    console.log("  Close your assistant and open it again, so it picks the notebook up.");
  }
  if (checkOnly && rows.some(([, r]) => r.status === "not connected yet")) {
    console.log("  To connect what is not connected yet, run: mc-menerio-connect");
  }
  console.log("  To switch everything off at once: in Menerio, open Settings, then API Keys,");
  console.log("  and revoke the key. Every assistant above loses the notebook in that moment.");
  console.log("");
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log("mc-menerio-connect stopped: " + (e && e.message ? e.message : e));
  process.exit(1);
});
