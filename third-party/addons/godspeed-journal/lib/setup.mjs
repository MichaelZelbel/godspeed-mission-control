// Installs godspeed-journal into a mission control folder. Each step is safe to run again, says one line, and never
// overwrites something the person made: their settings, or a recipe they wrote under the
// same name.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as P from "./paths.mjs";
import { loadSettings, saveSettings, settingsFile, setSetting, validateSettings, DEFAULTS } from "./settings.mjs";
import { readEntries } from "./store.mjs";
import { recordNeeds, readRecord } from "./evidence.mjs";
import { now } from "./clock.mjs";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const isWin = process.platform === "win32";
const ok = (m) => console.log(`✓ ${m}`);
const warn = (m) => console.log(`! ${m}`);
const say = (m) => console.log(`\n${m}`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: isWin, windowsHide: true, ...opts });
// git is a real executable everywhere (never a .cmd shim), so it never needs the shell wrapper;
// running it through one breaks quoting for any multi-word argument, such as a commit message.
const git = (mcDir, args) => run("git", ["-C", mcDir, ...args], { shell: false });

// The bare form only ever appears in the manual-fix message now; a bare hook still counts as
// "already there" so setup never doubles up on a hook a reader added by hand or an older
// version wrote.
const HOOK_CMD = "godspeed-journal context --hook claude";
const HOOK_MATCH = "context --hook claude";

export function claudeHookMerge(text, command = HOOK_CMD) {
  const cfg = text && text.trim() ? JSON.parse(text) : {};
  if (JSON.stringify(cfg).includes(HOOK_MATCH)) return null;
  cfg.hooks ||= {};
  cfg.hooks.UserPromptSubmit ||= [];
  cfg.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command, timeout: 10 }] });
  return JSON.stringify(cfg, null, 2) + "\n";
}

export const tickScript = (bin, mcDir) => `#!/bin/sh\n# Written by godspeed-journal setup. Empty output means nothing is due and Hermes sends nothing.\nexec "${bin.replace(/\\/g, "/")}" tick --godspeed "${mcDir.replace(/\\/g, "/")}"\n`;
export const hermesArgs = (profile) => (profile ? ["-p", profile] : []);
export function wantTick(settings, host) {
  if (!settings.tick_host) return "register";
  return settings.tick_host === host ? "already-here" : "other-host";
}
// Hermes keeps the Telegram token in the profile's env file, not in config.yaml, so the
// config value alone says nothing. Either answer counts.
export function telegramConfigured(configValue, envText) {
  const v = String(configValue || "").trim();
  if (v && !/^(null|none|\{\}|\[\])$/i.test(v)) return true;
  return /^\s*TELEGRAM_BOT_TOKEN=\S+/m.test(String(envText || ""));
}

async function ask(q, dflt, yes) {
  if (yes || !process.stdin.isTTY) return dflt;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${q} `)).trim();
  rl.close();
  return a || dflt;
}

function stepRecipe(mcDir, extra) {
  say("The recipe your assistant follows");
  const rooms = [P.skillsRoom(mcDir), ...(extra ? [path.resolve(extra)] : [])];
  const written = [];
  for (const room of rooms) {
    const dst = path.join(room, P.RECIPE);
    if (!P.mayReplace(dst)) { warn(`Left alone: ${dst} holds a recipe you wrote with the same name.`); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    P.copyDir(path.join(PKG, "skill", P.RECIPE), dst);
    fs.writeFileSync(path.join(dst, P.MARKER), `godspeed-journal ${VERSION}\n`);
    ok(`${dst}`); written.push(dst);
  }
  return written;
}

async function stepSettings(mcDir, f) {
  say("Your settings");
  const file = settingsFile(mcDir);
  const written = [];
  if (fs.existsSync(file)) ok(`kept: ${file}`);
  else {
    const s = JSON.parse(JSON.stringify(DEFAULTS));
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    s.timezone = f.timezone || (await ask(`Your time zone [${guess}]:`, guess, f.yes));
    s.language = f.language || (await ask("Check-in language, en or de [en]:", "en", f.yes));
    const n = f.nudges || (await ask("Should your mission control check in once when a task runs long? y/N:", "n", f.yes));
    s.nudge.enabled = /^(y|yes|on|j|ja)$/i.test(String(n));
    const ev = f.evening || (await ask("Should your mission control send an evening list of what is still open? y/N:", "n", f.yes));
    s.evening.enabled = /^(y|yes|on|j|ja)$/i.test(String(ev));
    const problems = validateSettings(s);
    if (problems.length) { warn(problems.join(" ")); return { written, failed: true }; }
    saveSettings(mcDir, s); ok(`written: ${file}`); written.push(file);
  }
  const readme = path.join(mcDir, "routines", "journal", "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, "# journal\n\nYour interstitial journal. Every file under entries/ is one entry, filed by date and time, in your own words.\nThe settings are in settings.json; `godspeed-journal config show` lists them and your assistant changes them when you ask.\n");
    written.push(readme);
  }
  return { written, failed: false };
}

function stepCommand() {
  say("The godspeed-journal command");
  const app = path.join(P.appHome(), "app");
  if (path.resolve(PKG) !== path.resolve(app)) {
    fs.rmSync(app, { recursive: true, force: true });
    P.copyDir(PKG, app, { skip: (n) => [".git", "node_modules", "test"].includes(n) });
  }
  const dir = P.binDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const l of P.launchers(app)) { const f = path.join(dir, l.name); fs.rmSync(f, { force: true }); fs.writeFileSync(f, l.body, { mode: l.mode }); }
  if (P.onPath(dir)) ok(`godspeed-journal is ready to type (${dir})`);
  else warn(`${dir} is not on this terminal's PATH. Open a new terminal; if godspeed-journal is still unknown, use ${path.join(dir, isWin ? "godspeed-journal.cmd" : "godspeed-journal")}`);
  return path.join(dir, "godspeed-journal");
}

async function stepHermes(mcDir, f, bin) {
  const hv = run("hermes", ["--version"]);
  if (f["no-hermes"] || (hv.status !== 0 && !f["hermes-profile"])) return { skipped: true };
  say("Hermes: the open tasks before every turn, and the check-ins");
  const hp = hermesArgs(f["hermes-profile"]);
  const cfgPath = run("hermes", [...hp, "config", "path"]).stdout.trim().split("\n").pop();
  if (!cfgPath) { warn("Hermes did not say where its settings are; skipped. Run `hermes config path` to see why."); return { failed: true }; }
  const home = path.dirname(cfgPath);
  const plug = path.join(home, "plugins", "godspeed-journal");
  const wasThere = fs.existsSync(plug);
  P.copyDir(path.join(PKG, "hermes", "plugin", "godspeed-journal"), plug);
  fs.writeFileSync(path.join(plug, "mission-control.txt"), mcDir + "\n");
  const en = run("hermes", [...hp, "plugins", "enable", "godspeed-journal"]);
  if (en.status === 0) ok("plugin godspeed-journal enabled"); else warn(`could not enable the plugin: ${en.stderr.trim() || en.stdout.trim()}`);

  const s = loadSettings(mcDir);
  const tick = wantTick(s, os.hostname());
  const tgRun = run("hermes", [...hp, "config", "get", "platforms.telegram"]);
  const tgConfig = tgRun.status === 0 ? tgRun.stdout : "";
  const envPath = run("hermes", [...hp, "config", "env-path"]).stdout.trim().split("\n").pop();
  const envText = envPath && fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (tick === "other-host") ok(`Check-ins and the evening list already come from ${s.tick_host}; this computer only saves entries.`);
  else if (!telegramConfigured(tgConfig, envText)) warn("Check-ins need your assistant on a messenger, such as Telegram. Entries still work.");
  else {
    fs.mkdirSync(path.join(home, "scripts"), { recursive: true });
    const script = path.join(home, "scripts", "godspeed-journal-tick.sh");
    fs.writeFileSync(script, tickScript(bin, mcDir), { mode: 0o755 });
    if (!run("hermes", [...hp, "cron", "list"]).stdout.includes("godspeed-journal-tick")) {
      const c = run("hermes", [...hp, "cron", "create", "*/15 * * * *", "--no-agent", "--script", "godspeed-journal-tick.sh", "--deliver", "telegram", "--failure-deliver", "local", "--name", "godspeed-journal-tick"]);
      if (c.status === 0) ok("check-ins and the evening list: every 15 minutes, silent when nothing is due");
      else warn(`could not schedule the check-ins: ${c.stderr.trim() || c.stdout.trim()}`);
    } else ok("check-in schedule already there");
    setSetting(mcDir, "tick_host", os.hostname());
  }

  const lang = loadSettings(mcDir).language;
  const stt = run("hermes", [...hp, "config", "get", "stt.language"]).stdout.trim();
  if (lang !== "en" && stt === "en") {
    const a = await ask(`Voice messages are transcribed as English. Switch to ${lang}? Y/n:`, "y", f.yes);
    if (/^y/i.test(a)) run("hermes", [...hp, "config", "set", "stt.language", lang]);
  }
  if (!wasThere) {
    const a = await ask("Restart the Hermes gateway now so the plugin loads? Y/n:", "y", f.yes);
    if (/^y/i.test(a)) run("hermes", [...hp, "gateway", "restart"]);
  }
  return { failed: false };
}

function stepClaude(mcDir, f) {
  if (f["no-claude"] || !fs.existsSync(path.join(mcDir, ".claude"))) return [];
  say("Claude Code: the open tasks before every prompt");
  const file = path.join(mcDir, ".claude", "settings.json");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // A bare command only works when the launcher's folder is on PATH, which is not guaranteed
  // on a fresh terminal (Claude Code hooks run without a login shell). The absolute launcher
  // path always works; stepCommand() has already written both launchers into binDir().
  // Always the sh launcher: Claude Code runs hooks through Git Bash on Windows too, and a .cmd
  // hook starts cmd.exe, which flashes a console window on every prompt.
  const launcher = path.join(P.binDir(), "godspeed-journal");
  const command = `"${launcher.replace(/\\/g, "/")}" context --hook claude`;
  let merged;
  try { merged = claudeHookMerge(text, command); } catch { warn(`${file} is not valid JSON; add this hook by hand: {"type":"command","command":"${command}"} under hooks.UserPromptSubmit`); return []; }
  if (merged === null) { ok("hook already there"); return []; }
  const isRepo = fs.existsSync(path.join(mcDir, ".git"));
  const dirty = isRepo && git(mcDir, ["status", "--porcelain", "--", ".claude/settings.json"]).stdout.trim() !== "";
  fs.writeFileSync(file, merged);
  if (dirty) { ok(`hook added to ${file}; it had your own uncommitted changes, so it is left for you to commit`); return []; }
  ok(`hook added to ${file}`); return [file];
}

function stepGit(mcDir, paths) {
  if (!paths.length || !fs.existsSync(path.join(mcDir, ".git"))) return;
  const rel = paths.map((p) => path.relative(mcDir, p)).filter((p) => !p.startsWith(".."));
  git(mcDir, ["add", "--", ...rel]);
  if (git(mcDir, ["diff", "--cached", "--quiet", "--", ...rel]).status === 1) {
    git(mcDir, ["commit", "-m", `Install godspeed-journal ${VERSION}`, "--", ...rel]);
    ok("saved in mission control's history");
  }
}

export async function setup(f) {
  const mcDir = P.findMissionControl({ arg: f.godspeed });
  if (!mcDir) { console.error("Could not find your mission control folder. Run this again from inside it, or add --godspeed <folder>."); return 1; }
  console.log(`godspeed-journal ${VERSION} into ${mcDir}`);
  const recipes = stepRecipe(mcDir, f["extra-skills-dir"]);
  const st = await stepSettings(mcDir, f);
  if (st.failed) return 1;
  const bin = stepCommand();
  await stepHermes(mcDir, f, bin);
  const claude = stepClaude(mcDir, f);
  stepGit(mcDir, [...recipes, ...st.written, ...claude]);
  return check(mcDir, f);
}

export async function check(mcDir, f = {}) {
  say("Check");
  let essential = true;
  const line = (good, m, fix, must = false) => { console.log(`${good ? "✓" : "✗"} ${m}${good || !fix ? "" : `: ${fix}`}`); if (!good && must) essential = false; };
  const s = loadSettings(mcDir);
  line(fs.existsSync(path.join(P.binDir(), isWin ? "godspeed-journal.cmd" : "godspeed-journal")), "godspeed-journal command", "run godspeed-journal setup again", true);
  line(P.onPath(P.binDir()), "command folder on PATH", "open a new terminal, or add " + P.binDir() + " to your PATH", false);
  const problems = validateSettings(s);
  line(problems.length === 0, "settings", problems.join(" "), true);
  // The record is read only for tasks that name a platform, so it is checked the same way: a
  // copy kept for this machine only has to cover what open tasks name.
  if (s.evidence && s.evidence.script) {
    const needs = recordNeeds(readEntries(mcDir, s, { days: 8 }), now());
    if (!needs) line(true, `the record (${s.evidence.script}): nothing to look up, no open task names a platform`);
    else {
      const r = readRecord(mcDir, s, { ...needs, timeoutMs: 20000 });
      line(Boolean(r.posts && r.posts.ok), `the record (${s.evidence.script}) for ${needs.platforms.join(", ")}`, r.posts && r.posts.error ? `${r.posts.error}; until it answers, check-ins about those tasks wait` : "");
    }
  }
  line(fs.existsSync(path.join(P.skillsRoom(mcDir), P.RECIPE, "SKILL.md")), "recipe", "run godspeed-journal setup again", true);
  const probe = path.join(mcDir, "routines", "journal", ".write-probe");
  try {
    fs.mkdirSync(path.join(mcDir, "routines", "journal"), { recursive: true });
    fs.writeFileSync(probe, "x"); fs.rmSync(probe); line(true, "journal folder writable");
  } catch (e) { line(false, "journal folder writable", e.message, true); }
  if (!f["no-hermes"] && run("hermes", ["--version"]).status === 0) {
    const hp = hermesArgs(f["hermes-profile"]);
    line(/godspeed-journal/.test(run("hermes", [...hp, "plugins", "list", "--plain"]).stdout), "Hermes plugin", "hermes plugins enable godspeed-journal");
    if (s.tick_host === os.hostname()) line(run("hermes", [...hp, "cron", "list"]).stdout.includes("godspeed-journal-tick"), "check-in schedule", "run godspeed-journal setup again");
    line(!/false/i.test(run("hermes", [...hp, "config", "get", "stt.enabled"]).stdout), "voice messages transcribed", "hermes config set stt.enabled true");
  }
  if (fs.existsSync(path.join(mcDir, ".claude"))) {
    const t = fs.existsSync(path.join(mcDir, ".claude", "settings.json")) ? fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8") : "";
    line(t.includes(HOOK_MATCH), "Claude Code hook", "run godspeed-journal setup again");
  }
  return essential ? 0 : 1;
}
