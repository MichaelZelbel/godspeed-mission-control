// Installs godspeed-charm into a mission control folder. Each step is safe to run again, says one
// line, and never overwrites something the person made: their settings, or a recipe they wrote
// under the same name. Built like the headache add-on's installer, without the diary and git-sync
// steps: the Charm Challenge keeps its record in the notebook and needs nothing else.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as P from "./paths.mjs";
import { loadSettings, saveSettings, settingsFile, validateSettings, DEFAULTS } from "./settings.mjs";
import { hasNotebook } from "./notebook.mjs";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const isWin = process.platform === "win32";
const ok = (m) => console.log(`✓ ${m}`);
const warn = (m) => console.log(`! ${m}`);
const say = (m) => console.log(`\n${m}`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: isWin, windowsHide: true, ...opts });
const git = (mcDir, args) => run("git", ["-C", mcDir, ...args], { shell: false });

const HOOK_MATCH = "godspeed-charm";

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
    const dst = path.join(room, P.RECIPE);
    if (!P.mayReplace(dst)) { warn(`Left alone: ${dst} holds a recipe you wrote with the same name.`); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    P.copyDir(path.join(PKG, "skill", P.RECIPE), dst);
    fs.writeFileSync(path.join(dst, P.MARKER), `godspeed-charm ${VERSION}\n`);
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
  const readme = path.join(mcDir, "routines", "charm", "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, "# charm\n\nThe Charm Challenge: its start, questions, resets, finish and stop are rows of the notebook's \"Charm Challenge\" collection, so the record lives there. settings.json holds your time zone, which decides where a day ends, and the language the replies come in.\n");
    written.push(readme);
  }
  return { written, failed: false };
}

// PowerShell picks a .ps1 over a .cmd of the same name in the same folder, and under the
// Restricted or AllSigned policy it refuses the .ps1 instead of falling back to the .cmd. So the
// PowerShell launcher is written only where every PowerShell on this computer would run it.
const RUNS_LOCAL_SCRIPTS = new Set(["unrestricted", "remotesigned", "bypass"]);
export function ps1Allowed(policies) {
  return policies.length > 0 && policies.every((p) => RUNS_LOCAL_SCRIPTS.has(String(p.policy).trim().toLowerCase()));
}

// The policy a new PowerShell window gets, so the one this process may have been started with
// (PSExecutionPolicyPreference, which Claude Code sets to Bypass for its own shells) is left out.
export function powershellPolicies() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "psexecutionpolicypreference"));
  const found = [];
  for (const exe of ["powershell.exe", "pwsh.exe"]) {
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "Get-ExecutionPolicy"], { encoding: "utf8", env, timeout: 30000, windowsHide: true });
    if (r.error && r.error.code === "ENOENT") continue;
    found.push({ exe, policy: r.status === 0 ? r.stdout.trim() : "unknown" });
  }
  return found;
}

function stepCommand() {
  say("The godspeed-charm command");
  const app = path.join(P.appHome(), "app");
  if (path.resolve(PKG) !== path.resolve(app)) {
    fs.rmSync(app, { recursive: true, force: true });
    P.copyDir(PKG, app, { skip: (n) => [".git", "node_modules", "test"].includes(n) });
  }
  const dir = P.binDir();
  fs.mkdirSync(dir, { recursive: true });
  const policies = isWin ? powershellPolicies() : [];
  const ps1 = isWin && ps1Allowed(policies);
  const ps1File = path.join(dir, "godspeed-charm.ps1");
  // Only a .ps1 this installer wrote is ever removed; one the person wrote is theirs.
  if (isWin && !ps1 && fs.existsSync(ps1File) && fs.readFileSync(ps1File, "utf8").includes(P.LAUNCHER_STAMP)) fs.rmSync(ps1File, { force: true });
  for (const l of P.launchers(app, process.platform, { ps1 })) { const f = path.join(dir, l.name); fs.rmSync(f, { force: true }); fs.writeFileSync(f, l.body, { mode: l.mode }); }
  if (ps1) ok("PowerShell gets its own launcher, so words with line breaks arrive whole");
  else if (isWin && policies.length) warn(`PowerShell runs no scripts on this computer (${policies.map((p) => `${p.exe}: ${p.policy}`).join(", ")}), so from PowerShell the command goes through cmd.exe, which cannot carry a line break. Words with line breaks then need --words-file <file>. Set-ExecutionPolicy -Scope CurrentUser RemoteSigned, then this setup again, lifts that.`);
  if (P.onPath(dir)) ok(`godspeed-charm is ready to type (${dir})`);
  else warn(`${dir} is not on this terminal's PATH. Open a new terminal; if godspeed-charm is still unknown, use ${path.join(dir, isWin ? "godspeed-charm.cmd" : "godspeed-charm")}`);
  return path.join(dir, "godspeed-charm");
}

async function stepHermes(mcDir, f) {
  // --no-hermes means Hermes is not even asked for its version.
  if (f["no-hermes"]) return { skipped: true };
  const hv = run("hermes", ["--version"]);
  if (hv.status !== 0 && !f["hermes-profile"]) return { skipped: true };
  say("Hermes: the Charm Challenge before every turn");
  const hp = hermesArgs(f["hermes-profile"]);
  const cfgPath = run("hermes", [...hp, "config", "path"]).stdout.trim().split("\n").pop();
  if (!cfgPath) { warn("Hermes did not say where its settings are; skipped. Run `hermes config path` to see why."); return { failed: true }; }
  const home = path.dirname(cfgPath);
  const plug = path.join(home, "plugins", "godspeed-charm");
  const wasThere = fs.existsSync(plug);
  P.copyDir(path.join(PKG, "hermes", "plugin", "godspeed-charm"), plug);
  fs.writeFileSync(path.join(plug, "mission-control.txt"), mcDir + "\n");
  const en = run("hermes", [...hp, "plugins", "enable", "godspeed-charm"]);
  if (en.status === 0) ok("plugin godspeed-charm enabled"); else warn(`could not enable the plugin: ${en.stderr.trim() || en.stdout.trim()}`);
  if (!wasThere) {
    const a = await ask("Restart the Hermes gateway now so the plugin loads? Y/n:", "y", f.yes);
    if (/^y/i.test(a)) run("hermes", [...hp, "gateway", "restart"]);
  }
  return { failed: false };
}

function stepClaude(mcDir, f) {
  if (f["no-claude"] || !fs.existsSync(path.join(mcDir, ".claude"))) return [];
  say("Claude Code: the Charm Challenge before every prompt");
  const file = path.join(mcDir, ".claude", "settings.json");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // Always the sh launcher: Claude Code runs hooks through Git Bash on Windows too, and a .cmd
  // hook starts cmd.exe, which flashes a console window on every prompt.
  const launcher = path.join(P.binDir(), "godspeed-charm");
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
    git(mcDir, ["commit", "-m", `Install godspeed-charm ${VERSION}`, "--", ...rel]);
    ok("saved in mission control's history");
  }
}

export async function setup(f) {
  const mcDir = P.findMissionControl({ arg: f.godspeed });
  if (!mcDir) { console.error("Could not find your mission control folder. Run this again from inside it, or add --godspeed <folder>."); return 1; }
  if (!hasNotebook(mcDir)) { console.error("The Charm Challenge keeps its record in the Godspeed notebook, and this mission control has none, so nothing was installed."); return 1; }
  console.log(`godspeed-charm ${VERSION} into ${mcDir}`);
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
  line(fs.existsSync(path.join(P.binDir(), isWin ? "godspeed-charm.cmd" : "godspeed-charm")), "godspeed-charm command", "run godspeed-charm setup again", true);
  line(P.onPath(P.binDir()), "command folder on PATH", "open a new terminal, or add " + P.binDir() + " to your PATH");
  if (isWin) line(fs.existsSync(path.join(P.binDir(), "godspeed-charm.ps1")), "PowerShell launcher (words with line breaks arrive whole)", "PowerShell runs no scripts here, so from PowerShell pass words with line breaks with --words-file <file>");
  let problems;
  try { problems = validateSettings(loadSettings(mcDir)); } catch (e) { problems = [e.message]; }
  line(problems.length === 0, "settings", problems.join(" "), true);
  line(fs.existsSync(path.join(P.skillsRoom(mcDir), P.RECIPE, "SKILL.md")), "recipe", "run godspeed-charm setup again", true);
  line(hasNotebook(mcDir), "notebook (the record lives in its Charm Challenge collection)", "the Charm Challenge works only with the Godspeed notebook", true);
  if (!f["no-hermes"] && run("hermes", ["--version"]).status === 0) {
    const hp = hermesArgs(f["hermes-profile"]);
    line(/godspeed-charm/.test(run("hermes", [...hp, "plugins", "list", "--plain"]).stdout), "Hermes plugin", "hermes plugins enable godspeed-charm");
  }
  if (fs.existsSync(path.join(mcDir, ".claude"))) {
    const t = fs.existsSync(path.join(mcDir, ".claude", "settings.json")) ? fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8") : "";
    line(t.includes(HOOK_MATCH), "Claude Code hook", "run godspeed-charm setup again");
  }
  return essential ? 0 : 1;
}
