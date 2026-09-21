/*
 * hub-mail-wire.js - tell every assistant on this computer that the hub has a mail tool.
 * `hub-mail setup` runs this; the installer runs it on every install and every re-run.
 *
 * It connects NO mailbox and asks nothing. It only adds one entry, called hub-mail, to the
 * list of tools each assistant starts: .mcp.json in your hub folder (Claude Code), Codex's
 * config.toml, Hermes' config.yaml. With no mailbox connected the tool answers "not connected"
 * and the assistant carries on, so adding it can never break anything.
 *
 * THE ENTRY HOLDS NO KEY. The tool reads your hub's locked store itself, so there is nothing
 * secret in any of these files, and the one Gmail connection reaches every assistant.
 *
 * THE SAME ENTRY ON EVERY COMPUTER. .mcp.json travels with your hub from computer to computer,
 * so the entry cannot name a path that only exists on one of them. It asks Node to load the
 * tool from ~/.local/bin, which is where the installer puts it on Windows, Mac and Linux alike.
 *
 * It leaves alone what is there: an existing hub-mail entry (yours, or an older one) is kept as
 * it is, and every other line of every file is untouched. Running it twice changes nothing.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const NAME = "hub-mail";
const LAUNCH = "require(require('path').join(require('os').homedir(),'.local','bin','hub-mail.js')).main(process.argv.slice(1))";
const ENTRY = { command: "node", args: ["-e", LAUNCH, "mcp"] };

const readIf = f => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return null; } };
function write(file, before, after) {
  if (before === after) return false;
  if (before !== null) fs.writeFileSync(file + ".bak", before);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  return true;
}

function claudeCode(hub, check) {
  if (!hub) return "Claude Code: no hub folder found, so nothing was added";
  const file = path.join(hub, ".mcp.json");
  const before = readIf(file);
  let doc = {};
  if (before && before.trim()) {
    try { doc = JSON.parse(before); } catch (e) { return "Claude Code: .mcp.json in your hub is not valid JSON, so I left it alone (failed)"; }
  }
  doc.mcpServers = doc.mcpServers || {};
  if (doc.mcpServers[NAME]) return "Claude Code: already has the mail tool";
  if (check) return "Claude Code: the mail tool is not added yet";
  doc.mcpServers[NAME] = ENTRY;
  write(file, before, JSON.stringify(doc, null, 2) + "\n");
  return "Claude Code: added the mail tool (.mcp.json in your hub)";
}

function codex(check) {
  const dir = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  if (!fs.existsSync(dir)) return "";
  const file = path.join(dir, "config.toml");
  const before = readIf(file) || "";
  if (/^\s*\[mcp_servers\.(?:"hub-mail"|hub-mail)\]/m.test(before)) return "Codex: already has the mail tool";
  if (check) return "Codex: the mail tool is not added yet";
  const q = s => JSON.stringify(s);
  const block = `\n[mcp_servers.${q(NAME)}]\ncommand = ${q(ENTRY.command)}\nargs = [${ENTRY.args.map(q).join(", ")}]\n`;
  write(file, readIf(file), before.replace(/\s*$/, "\n") + block);
  return "Codex: added the mail tool (config.toml)";
}

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
  if (/^\s{2}hub-mail:\s*$/m.test(before)) return "Hermes: already has the mail tool";
  if (check) return "Hermes: the mail tool is not added yet";
  const eol = /\r\n/.test(before) ? "\r\n" : "\n";
  const lines = [`  ${NAME}:`, `    command: ${ENTRY.command}`, "    args:", ...ENTRY.args.map(a => "      - " + JSON.stringify(a))];
  let after;
  const m = before.match(/^mcp_servers:[ \t]*(\{\})?[ \t]*\r?$/m);
  if (m && m[1]) after = before.replace(m[0], "mcp_servers:" + eol + lines.join(eol));
  else if (m) after = before.replace(m[0], m[0] + eol + lines.join(eol));
  else after = before.replace(/\s*$/, eol) + "mcp_servers:" + eol + lines.join(eol) + eol;
  write(file, readIf(file), after);
  return "Hermes: added the mail tool (config.yaml; it is used from the next conversation)";
}

function wire({ check = false, hub = "" } = {}) {
  const lines = [];
  let failed = false;
  for (const line of [claudeCode(hub, check), codex(check), hermes(check)]) {
    if (!line) continue;
    if (/\(failed\)/.test(line)) failed = true;
    lines.push(line);
  }
  if (!check) lines.push("Email itself stays off until you connect it: the Gmail step of the hub installer (Chapter 30) for your mailbox, hub-mail connect agentmail (Chapter 29) for the hub's own address.");
  return { lines, failed };
}

module.exports = { wire, ENTRY, LAUNCH };
