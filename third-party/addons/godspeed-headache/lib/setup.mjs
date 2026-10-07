// Installs godspeed-headache into a mission control folder. Each step is safe to run again, says one
// line, and never overwrites something the person made: their settings, or a recipe they wrote
// under the same name. Built the same way as godspeed-journal's installer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as P from "./paths.mjs";
import { loadSettings, saveSettings, settingsFile, validateSettings, DEFAULTS } from "./settings.mjs";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const isWin = process.platform === "win32";
const ok = (m) => console.log(`✓ ${m}`);
const warn = (m) => console.log(`! ${m}`);
const say = (m) => console.log(`\n${m}`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: isWin, windowsHide: true, ...opts });
const git = (mcDir, args) => run("git", ["-C", mcDir, ...args], { shell: false });

const HOOK_MATCH = "godspeed-headache";

export function claudeHookMerge(text, command) {
  const cfg = text && text.trim() ? JSON.parse(text) : {};
  if (JSON.stringify(cfg).includes(HOOK_MATCH)) return null;
  cfg.hooks ||= {};
  cfg.hooks.UserPromptSubmit ||= [];
  cfg.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command, timeout: 10 }] });
  return JSON.stringify(cfg, null, 2) + "\n";
}
export const hermesArgs = (profile) => (profile ? ["-p", profile] : []);

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
    for (const old of P.FORMER_RECIPES) {
      const was = path.join(room, old);
      if (fs.existsSync(was) && fs.existsSync(path.join(was, P.MARKER))) {
        fs.rmSync(was, { recursive: true, force: true });
        ok(`removed the old name: ${was}`); written.push(was);
      }
    }
    const dst = path.join(room, P.RECIPE);
    if (!P.mayReplace(dst)) { warn(`Left alone: ${dst} holds a recipe you wrote with the same name.`); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    P.copyDir(path.join(PKG, "skill", P.RECIPE), dst);
    fs.writeFileSync(path.join(dst, P.MARKER), `godspeed-headache ${VERSION}\n`);
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
    const s = { ...DEFAULTS };
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    s.timezone = f.timezone || (await ask(`Your time zone [${guess}]:`, guess, f.yes));
    s.language = f.language || (await ask("Answer language, en or de [en]:", "en", f.yes));
    const problems = validateSettings(s);
    if (problems.length) { warn(problems.join(" ")); return { written, failed: true }; }
    saveSettings(mcDir, s); ok(`written: ${file}`); written.push(file);
  }
  const readme = path.join(mcDir, "routines", "headache", "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, "# headache\n\nYour headache diary. Every file under entries/ is one thing you said: a headache starting, a detail, a pill, an end. Nothing is ever edited; a headache is computed from the entries that name it.\n`godspeed-headache list` shows the headaches, `godspeed-headache patterns` what they have in common. The settings are in settings.json.\n");
    written.push(readme);
  }
  return { written, failed: false };
}

function stepCommand() {
  say("The godspeed-headache command");
  const app = path.join(P.appHome(), "app");
  if (path.resolve(PKG) !== path.resolve(app)) {
    fs.rmSync(app, { recursive: true, force: true });
    P.copyDir(PKG, app, { skip: (n) => [".git", "node_modules", "test"].includes(n) });
  }
  const dir = P.binDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const l of P.launchers(app)) { const f = path.join(dir, l.name); fs.rmSync(f, { force: true }); fs.writeFileSync(f, l.body, { mode: l.mode }); }
  if (P.onPath(dir)) ok(`godspeed-headache is ready to type (${dir})`);
  else warn(`${dir} is not on this terminal's PATH. Open a new terminal; if godspeed-headache is still unknown, use ${path.join(dir, isWin ? "godspeed-headache.cmd" : "godspeed-headache")}`);
  return path.join(dir, "godspeed-headache");
}

async function stepHermes(mcDir, f) {
  const hv = run("hermes", ["--version"]);
  if (f["no-hermes"] || (hv.status !== 0 && !f["hermes-profile"])) return { skipped: true };
  say("Hermes: the open headache before every turn");
  const hp = hermesArgs(f["hermes-profile"]);
  const cfgPath = run("hermes", [...hp, "config", "path"]).stdout.trim().split("\n").pop();
  if (!cfgPath) { warn("Hermes did not say where its settings are; skipped. Run `hermes config path` to see why."); return { failed: true }; }
  const home = path.dirname(cfgPath);
  const plug = path.join(home, "plugins", "godspeed-headache");
  const wasThere = fs.existsSync(plug);
  P.copyDir(path.join(PKG, "hermes", "plugin", "godspeed-headache"), plug);
  fs.writeFileSync(path.join(plug, "mission-control.txt"), mcDir + "\n");
  const en = run("hermes", [...hp, "plugins", "enable", "godspeed-headache"]);
  if (en.status === 0) ok("plugin godspeed-headache enabled"); else warn(`could not enable the plugin: ${en.stderr.trim() || en.stdout.trim()}`);
  if (!wasThere) {
    const a = await ask("Restart the Hermes gateway now so the plugin loads? Y/n:", "y", f.yes);
    if (/^y/i.test(a)) run("hermes", [...hp, "gateway", "restart"]);
  }
  return { failed: false };
}

function stepClaude(mcDir, f) {
  if (f["no-claude"] || !fs.existsSync(path.join(mcDir, ".claude"))) return [];
  say("Claude Code: the open headache before every prompt");
  const file = path.join(mcDir, ".claude", "settings.json");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // Always the sh launcher: Claude Code runs hooks through Git Bash on Windows too, and a .cmd
  // hook starts cmd.exe, which flashes a console window on every prompt.
  const launcher = path.join(P.binDir(), "godspeed-headache");
  const command = `"${launcher.replace(/\\/g, "/")}" context --hook claude`;
  let merged;
  try { merged = claudeHookMerge(text, command); } catch { warn(`${file} is not valid JSON; add this hook by hand: {"type":"command","command":"${command}"} under hooks.UserPromptSubmit`); return []; }
  if (merged === null) { ok("hook already there"); return []; }
  const dirty = fs.existsSync(path.join(mcDir, ".git")) && git(mcDir, ["status", "--porcelain", "--", ".claude/settings.json"]).stdout.trim() !== "";
  fs.writeFileSync(file, merged);
  if (dirty) { ok(`hook added to ${file}; it had your own uncommitted changes, so it is left for you to commit`); return []; }
  ok(`hook added to ${file}`); return [file];
}

function stepGit(mcDir, paths) {
  if (!paths.length || !fs.existsSync(path.join(mcDir, ".git"))) return;
  const rel = paths.map((p) => path.relative(mcDir, p)).filter((p) => !p.startsWith(".."));
  git(mcDir, ["add", "--", ...rel]);
  if (git(mcDir, ["diff", "--cached", "--quiet", "--", ...rel]).status === 1) {
    git(mcDir, ["commit", "-m", `Install godspeed-headache ${VERSION}`, "--", ...rel]);
    ok("saved in mission control's history");
  }
}

export async function setup(f) {
  const mcDir = P.findMissionControl({ arg: f.godspeed });
  if (!mcDir) { console.error("Could not find your mission control folder. Run this again from inside it, or add --godspeed <folder>."); return 1; }
  console.log(`godspeed-headache ${VERSION} into ${mcDir}`);
  const recipes = stepRecipe(mcDir, f["extra-skills-dir"]);
  const st = await stepSettings(mcDir, f);
  if (st.failed) return 1;
  stepCommand();
  await stepHermes(mcDir, f);
  const claude = stepClaude(mcDir, f);
  stepGit(mcDir, [...recipes, ...st.written, ...claude]);
  return check(mcDir, f);
}

export async function check(mcDir, f = {}) {
  say("Check");
  let essential = true;
  const line = (good, m, fix, must = false) => { console.log(`${good ? "✓" : "✗"} ${m}${good || !fix ? "" : `: ${fix}`}`); if (!good && must) essential = false; };
  const s = loadSettings(mcDir);
  line(fs.existsSync(path.join(P.binDir(), isWin ? "godspeed-headache.cmd" : "godspeed-headache")), "godspeed-headache command", "run godspeed-headache setup again", true);
  line(P.onPath(P.binDir()), "command folder on PATH", "open a new terminal, or add " + P.binDir() + " to your PATH");
  const problems = validateSettings(s);
  line(problems.length === 0, "settings", problems.join(" "), true);
  line(fs.existsSync(path.join(P.skillsRoom(mcDir), P.RECIPE, "SKILL.md")), "recipe", "run godspeed-headache setup again", true);
  if (s.daily_table) line(fs.existsSync(s.daily_table), "daily health table", `${s.daily_table} not found; the pattern report skips the comparison`);
  const probe = path.join(mcDir, "routines", "headache", ".write-probe");
  try {
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "x"); fs.rmSync(probe); line(true, "headache folder writable");
  } catch (e) { line(false, "headache folder writable", e.message, true); }
  if (!f["no-hermes"] && run("hermes", ["--version"]).status === 0) {
    const hp = hermesArgs(f["hermes-profile"]);
    line(/godspeed-headache/.test(run("hermes", [...hp, "plugins", "list", "--plain"]).stdout), "Hermes plugin", "hermes plugins enable godspeed-headache");
    line(!/false/i.test(run("hermes", [...hp, "config", "get", "stt.enabled"]).stdout), "voice messages transcribed", "hermes config set stt.enabled true");
  }
  if (fs.existsSync(path.join(mcDir, ".claude"))) {
    const t = fs.existsSync(path.join(mcDir, ".claude", "settings.json")) ? fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8") : "";
    line(t.includes(HOOK_MATCH), "Claude Code hook", "run godspeed-headache setup again");
  }
  return essential ? 0 : 1;
}
