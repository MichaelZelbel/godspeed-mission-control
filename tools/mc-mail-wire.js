/*
 * mc-mail-wire.js - tell every assistant on this computer that the mission control has a mail tool.
 * `mc-mail setup` runs this; the installer runs it on every install and every re-run.
 *
 * It connects NO mailbox and asks nothing. It only adds one entry, called mc-mail, to the
 * list of tools each assistant starts: .mcp.json in your mission control folder (Claude Code), Codex's
 * config.toml, Hermes' config.yaml. With no mailbox connected the tool answers "not connected"
 * and the assistant carries on, so adding it can never break anything.
 *
 * THE ENTRY HOLDS NO KEY. The tool reads its own credentials on this computer, so there is
 * nothing secret in any of these files.
 *
 * THE SAME ENTRY ON EVERY COMPUTER. .mcp.json travels with your mission control from computer to computer,
 * so the entry cannot name a path that only exists on one of them. It asks Node to load the
 * tool from ~/.local/bin, which is where the installer puts it on Windows, Mac and Linux alike.
 *
 * CLAUDE DESKTOP IS ITS OWN APP (2026-09-22). Claude Code's .mcp.json is not Claude Desktop's
 * list, and Desktop starts tools without a terminal's PATH. So when Gmail is connected
 * (`desktop: true`, which `mc-mail connect gmail-imap` passes) and Desktop is installed here,
 * its own settings file gets an entry with this computer's absolute paths. That file never
 * travels, so absolute paths are right there.
 *
 * AN ENTRY THAT IS THERE IS CHECKED, NOT ASSUMED (2026-09-22). It used to answer "already has
 * the mail tool" for any entry of that name. Now an entry that names a program that is not on
 * this computer is reported, and `check: true` starts each entry the way its assistant would
 * and asks it for its tools, so "works" means a real answer came back.
 *
 * It leaves alone what is there: an existing mc-mail entry that works (yours, or an older one)
 * is kept as it is, and every other line of every file is untouched. Running it twice changes
 * nothing.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const NAME = "mc-mail";
const LAUNCH = "require(require('path').join(require('os').homedir(),'.local','bin','mc-mail.js')).main(process.argv.slice(1))";
const ENTRY = { command: "node", args: ["-e", LAUNCH, "mcp"] };
const installed = () => path.join(os.homedir(), ".local", "bin", "mc-mail.js");

const readIf = f => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return null; } };
function write(file, before, after) {
  if (before === after) return false;
  if (before !== null) fs.writeFileSync(file + ".bak", before);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  return true;
}

// Starts an entry the way an assistant would and asks for its tools. Returns "" when a real
// answer listing mail_status came back, else what went wrong in a few words.
function handshake(command, args, cwd, env) {
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mc-mail-setup", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ].map(x => JSON.stringify(x)).join("\n") + "\n";
  const r = spawnSync(command, args, { cwd: cwd || process.cwd(), env: Object.assign({}, process.env, env || {}), input, encoding: "utf8", timeout: 20000, windowsHide: true });
  if (r.error) return r.error.code === "ENOENT" ? `${command} is not on this computer` : r.error.message;
  if (/"mail_status"/.test(r.stdout || "")) return "";
  return ((r.stderr || "").trim().split(/\r?\n/).pop() || "no answer").slice(0, 160);
}
// ${VAR:-default} and ${VAR} as Claude Code expands them, enough to start the entry here.
const expand = s => String(s).replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (m, v, d) => process.env[v] || d || "");
// An entry that points at a file which is not on this computer cannot work. Everything else is
// judged by the handshake, when asked.
function brokenPath(entry, cwd) {
  if (!entry || typeof entry !== "object" || !entry.command) return "it has no command";
  const args = [].concat(entry.args || []).map(expand);
  if (args.includes("-e")) return /\.local.*mc-mail\.js/.test(args.join(" ")) && !fs.existsSync(installed()) ? "the mail tool is not installed in ~/.local/bin" : "";
  const js = args.find(a => /mc-mail(\.js)?$/.test(a));
  if (js && !fs.existsSync(path.resolve(cwd || process.cwd(), js))) return `${js} is not on this computer`;
  return "";
}
function report(app, entry, cwd, check) {
  const broken = brokenPath(entry, cwd);
  if (broken) return `${app}: has a mail tool entry that cannot start here (${broken}) (failed)`;
  if (!check) return `${app}: already has the mail tool`;
  const why = handshake(entry.command === "node" ? process.execPath : expand(entry.command), [].concat(entry.args || []).map(expand), cwd, entry.env);
  return why ? `${app}: the mail tool entry did not answer (${why}) (failed)` : `${app}: the mail tool answers`;
}

function claudeCode(godspeed, check) {
  if (!godspeed) return "Claude Code: no mission control folder found, so nothing was added";
  const file = path.join(godspeed, ".mcp.json");
  const before = readIf(file);
  let doc = {};
  if (before && before.trim()) {
    try { doc = JSON.parse(before); } catch (e) { return "Claude Code: .mcp.json in your mission control is not valid JSON, so I left it alone (failed)"; }
  }
  doc.mcpServers = doc.mcpServers || {};
  if (doc.mcpServers[NAME]) return report("Claude Code", doc.mcpServers[NAME], godspeed, check);
  if (check) return "Claude Code: the mail tool is not added yet";
  doc.mcpServers[NAME] = ENTRY;
  write(file, before, JSON.stringify(doc, null, 2) + "\n");
  return "Claude Code: added the mail tool (.mcp.json in your mission control)";
}

function codex(check) {
  const dir = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  if (!fs.existsSync(dir)) return "";
  const file = path.join(dir, "config.toml");
  const before = readIf(file) || "";
  const m = before.match(/^\s*\[mcp_servers\.(?:"mc-mail"|mc-mail)\]\s*\r?\n([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m);
  if (m) {
    const cmd = (m[1].match(/^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/m) || [])[1];
    let args = [];
    try { args = JSON.parse((m[1].match(/^\s*args\s*=\s*(\[.*\])\s*$/m) || [])[1] || "[]"); } catch (e) { /* not JSON-shaped TOML */ }
    return report("Codex", { command: cmd ? JSON.parse('"' + cmd + '"') : "", args }, os.homedir(), check);
  }
  if (check) return "Codex: the mail tool is not added yet";
  const q = s => JSON.stringify(s);
  const block = `\n[mcp_servers.${q(NAME)}]\ncommand = ${q(ENTRY.command)}\nargs = [${ENTRY.args.map(q).join(", ")}]\n`;
  write(file, readIf(file), before.replace(/\s*$/, "\n") + block);
  return "Codex: added the mail tool (config.toml)";
}

// Hermes keeps its settings in HERMES_HOME, which is ~/.hermes, or %LOCALAPPDATA%\hermes on
// Windows. The default profile is the one this computer's Hermes uses unless it was told
// otherwise; a named profile is chosen with HERMES_HOME (hermes-profile: that folder).
function hermesHome() {
  const spots = process.env.HERMES_HOME ? [process.env.HERMES_HOME] : [path.join(os.homedir(), ".hermes")];
  if (process.env.LOCALAPPDATA && !process.env.HERMES_HOME) spots.push(path.join(process.env.LOCALAPPDATA, "hermes"));
  // Only a Hermes that is really here: its settings file exists. No Hermes, no entry.
  for (const d of spots) if (fs.existsSync(path.join(d, "config.yaml"))) return d;
  return "";
}
function hermes(check) {
  const dir = hermesHome();
  if (!dir) return "";
  const file = path.join(dir, "config.yaml");
  const before = readIf(file) || "";
  const m = before.match(/^\s{2}mc-mail:\s*\r?\n((?:\s{4}.*\r?\n?)*)/m);
  if (m) {
    const cmd = ((m[1].match(/^\s{4}command:\s*(.+)$/m) || [])[1] || "").trim().replace(/^["']|["']$/g, "");
    const args = [...m[1].matchAll(/^\s{6}-\s*(.+)$/mg)].map(x => { const v = x[1].trim(); try { return JSON.parse(v); } catch (e) { return v.replace(/^'|'$/g, ""); } });
    return report("Hermes", { command: cmd, args }, os.homedir(), check);
  }
  if (check) return "Hermes: the mail tool is not added yet";
  const eol = /\r\n/.test(before) ? "\r\n" : "\n";
  const lines = [`  ${NAME}:`, `    command: ${ENTRY.command}`, "    args:", ...ENTRY.args.map(a => "      - " + JSON.stringify(a))];
  let after;
  const mm = before.match(/^mcp_servers:[ \t]*(\{\})?[ \t]*\r?$/m);
  if (mm && mm[1]) after = before.replace(mm[0], "mcp_servers:" + eol + lines.join(eol));
  else if (mm) after = before.replace(mm[0], mm[0] + eol + lines.join(eol));
  else after = before.replace(/\s*$/, eol) + "mcp_servers:" + eol + lines.join(eol) + eol;
  write(file, readIf(file), after);
  return "Hermes: added the mail tool (config.yaml; it is used from the next conversation)";
}

// Claude Desktop's own list. Installed from claude.ai it lives in %APPDATA%\Claude; installed
// from the Microsoft Store, Windows keeps the same file inside the app's package folder.
function claudeDesktopFiles() {
  const out = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, "Claude"));
    const pk = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Packages");
    try { for (const d of fs.readdirSync(pk)) if (/^Claude_/.test(d)) out.push(path.join(pk, d, "LocalCache", "Roaming", "Claude")); } catch (e) { /* no packages */ }
  } else if (process.platform === "darwin") out.push(path.join(os.homedir(), "Library", "Application Support", "Claude"));
  return out.filter(d => fs.existsSync(d)).map(d => path.join(d, "claude_desktop_config.json"));
}
function claudeDesktop(check, tool) {
  const files = claudeDesktopFiles();
  if (!files.length) return "";
  const entry = { command: process.execPath, args: [tool, "mcp"] };
  const lines = [];
  for (const file of files) {
    const before = readIf(file);
    let doc = {};
    if (before && before.trim()) { try { doc = JSON.parse(before); } catch (e) { lines.push("Claude Desktop: its settings file is not valid JSON, so I left it alone (failed)"); continue; } }
    doc.mcpServers = doc.mcpServers || {};
    const cur = doc.mcpServers[NAME];
    if (cur && !brokenPath(cur) && fs.existsSync(cur.command)) { lines.push(report("Claude Desktop", cur, os.homedir(), check)); continue; }
    if (check) { lines.push("Claude Desktop: the mail tool is not added yet"); continue; }
    doc.mcpServers[NAME] = entry;
    write(file, before, JSON.stringify(doc, null, 2) + "\n");
    lines.push("Claude Desktop: added the mail tool (quit Claude Desktop completely and open it again once, then allow the tool if it asks)");
  }
  return lines.join("\n");
}

function wire({ check = false, godspeed = "", desktop = false } = {}) {
  const lines = [];
  let failed = false;
  const tool = fs.existsSync(installed()) ? installed() : path.join(__dirname, "mc-mail.js");
  const parts = [claudeCode(godspeed, check), codex(check), hermes(check)];
  if (desktop || check) parts.push(claudeDesktop(check, tool));
  for (const line of parts.join("\n").split("\n")) {
    if (!line) continue;
    if (/\(failed\)/.test(line)) failed = true;
    lines.push(line);
  }
  if (!check) lines.push("Email itself stays off until you connect it: ask your assistant \"Connect Gmail for me\" (Chapter 30) for your mailbox, mc-mail connect agentmail (Chapter 29) for the mission control's own address.");
  return { lines, failed };
}

module.exports = { wire, ENTRY, LAUNCH, handshake, claudeDesktopFiles };
