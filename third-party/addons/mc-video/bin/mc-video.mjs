#!/usr/bin/env node
// mc-video: let your mission control finish your videos. An add-on for "Teach It Once", Chapter 35.
//
//   mc-video setup [--godspeed <folder>] [--yes]   install or update, then prove it works
//   mc-video captions <clip>                  burn captions in your one look
//   mc-video vertical <clip> [--captions]     a 9:16 cut from the middle of the picture
//   mc-video hyperframes <command>            the pinned HyperFrames, without npx
//   mc-video check                            say what is installed and what is missing
//
// Run it again any time. It keeps your caption style and anything you wrote yourself, and
// it deletes nothing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")).version;
const isWin = process.platform === "win32";

const say = (t) => console.log(`\n== ${t}`);
const ok = (t) => console.log(`ok: ${t}`);
const warn = (t) => console.log(`not yet: ${t}`);
const fail = (t) => {
  console.error(`error: ${t}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: false, windowsHide: true, ...opts });
}

function which(cmd) {
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : null;
  const r = isWin ? run("where", [cmd]) : run("sh", ["-c", `command -v "${cmd}"`]);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(Boolean);
  return first ? first.trim() : null;
}

async function askYes(question, { yes }) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--godspeed") flags.godspeed = argv[++i];
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--skip-proof") flags.skipProof = true;
    else flags._.push(a);
  }
  return flags;
}

// ---------------------------------------------------------------------------------------
function findFfmpeg(cfg) {
  const tried = [];
  for (const c of [cfg.ffmpeg, ...L.ffmpegCandidates()].filter(Boolean)) {
    const exe = which(c);
    if (!exe || tried.includes(exe)) continue;
    tried.push(exe);
    const enc = run(exe, ["-hide_banner", "-encoders"]);
    const fil = run(exe, ["-hide_banner", "-filters"]);
    const verdict = L.ffmpegIsUsable(enc.stdout, fil.stdout);
    if (verdict.ok) return { exe, tried };
  }
  return { exe: null, tried };
}

async function stepFfmpeg(cfg, flags) {
  say("ffmpeg, the program that writes video files");
  let { exe, tried } = findFfmpeg(cfg);
  const needUnzip = process.platform === "linux" && !which("unzip");
  if (exe) ok(`using ${exe}`);
  else if (tried.length) {
    console.log(`   Found ${tried.join(", ")}, but it cannot write H.264 video or draw captions.`);
    if (isWin) console.log("   On Windows that is usually the empty placeholder from the Microsoft Store.");
  }
  if (needUnzip) console.log("   unzip is missing too. HyperFrames needs it to unpack the browser it draws with.");
  if (exe && !needUnzip) return exe;

  const install = L.installCommand(process.platform, (c) => !!which(c), { ffmpeg: !exe, unzip: needUnzip });
  if (!install) {
    warn(process.platform === "darwin"
      ? "install Homebrew from https://brew.sh, then run `brew install ffmpeg` and this setup again."
      : `install ${[!exe && "ffmpeg", needUnzip && "unzip"].filter(Boolean).join(" and ")} with your system's package manager, then run this setup again.`);
    return exe;
  }
  const line = `${install.cmd} ${install.args.join(" ")}`;
  if (!(await askYes(`Install now with: ${line} ?`, flags))) {
    warn(`run \`${line}\` yourself, then run this setup again.`);
    return exe;
  }
  const r = spawnSync(install.cmd, install.args, { stdio: "inherit", shell: isWin });
  if (r.status !== 0) {
    warn(`\`${line}\` did not finish cleanly. Run it yourself and read what it says, then run this setup again.`);
    return exe;
  }
  ({ exe } = findFfmpeg(cfg));
  if (exe) {
    ok(`installed; using ${exe}`);
    return exe;
  }
  warn("ffmpeg was installed but this terminal cannot see it yet. Open a new terminal and run this setup again.");
  return null;
}

async function stepPython(cfg, flags) {
  say("The speech model that hears the words (Python, installed apart from everything else)");
  const venv = path.join(L.home(), "venv");
  const py = L.venvPython(venv);
  const works = () => fs.existsSync(py) && run(py, ["-c", "import faster_whisper, PIL"]).status === 0;
  if (works()) {
    ok(`ready in ${venv}`);
    return py;
  }
  let uv = L.uvCandidates().map(which).find(Boolean);
  if (!uv) {
    console.log("   This uses uv, a small tool that installs its own Python so nothing on your computer changes.");
    const line = isWin
      ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
      : "curl -LsSf https://astral.sh/uv/install.sh | sh";
    if (!(await askYes(`Install uv now with: ${line} ?`, flags))) {
      warn(`run \`${line}\` yourself, then run this setup again.`);
      return null;
    }
    const r = isWin
      ? spawnSync("powershell", ["-ExecutionPolicy", "ByPass", "-c", "irm https://astral.sh/uv/install.ps1 | iex"], { stdio: "inherit" })
      : spawnSync("sh", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"], { stdio: "inherit" });
    uv = L.uvCandidates().map(which).find(Boolean);
    if (r.status !== 0 || !uv) {
      warn("uv did not install. Open a new terminal and run this setup again.");
      return null;
    }
  }
  console.log(`   Making a private Python in ${venv} and installing the speech model's code (a few minutes)...`);
  let r = run(uv, ["venv", venv, "--python", "3.12", "--allow-existing"], { stdio: "inherit" });
  if (r.status !== 0) {
    warn("could not create the Python environment (see above).");
    return null;
  }
  r = run(uv, ["pip", "install", "--python", py, "faster-whisper", "pillow"], { stdio: "inherit" });
  if (r.status !== 0 || !works()) {
    warn("the speech model's code did not install (see above). Run this setup again; a dropped download is the usual cause.");
    return null;
  }
  ok(`ready in ${venv}`);
  return py;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// HyperFrames' recipe folder, adapted for a mission control: every Markdown page calls the pinned copy
// through mc-video instead of npx, and the entry page of each recipe says so first.
function adaptRecipe(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) adaptRecipe(f);
    else if (e.name.endsWith(".md")) {
      const before = fs.readFileSync(f, "utf8");
      let after = L.rewriteNpx(before);
      if (e.name === "SKILL.md") after = L.addGodspeedNote(after);
      if (after !== before) fs.writeFileSync(f, after);
    }
  }
}

function hyperframesBin() {
  return path.join(L.home(), "hyperframes", "node_modules", "hyperframes", "bin", "hyperframes.mjs");
}

function hyperframesInstalled() {
  try {
    const p = path.join(L.home(), "hyperframes", "node_modules", "hyperframes", "package.json");
    return JSON.parse(fs.readFileSync(p, "utf8")).version === L.HYPERFRAMES_VERSION && fs.existsSync(hyperframesBin());
  } catch {
    return false;
  }
}

function stepHyperframes() {
  say(`HyperFrames ${L.HYPERFRAMES_VERSION} itself, the program that turns animated pages into video`);
  const dir = path.join(L.home(), "hyperframes");
  if (hyperframesInstalled()) {
    ok(`ready in ${dir}`);
    return true;
  }
  fs.mkdirSync(dir, { recursive: true });
  console.log("   Installing it once, here, so your assistant never has to download a program while it works (about 370 MB)...");
  const npm = path.join(path.dirname(process.execPath), isWin ? "npm.cmd" : "npm");
  const r = spawnSync(fs.existsSync(npm) ? `"${npm}"` : "npm",
    ["install", "--prefix", ".", `hyperframes@${L.HYPERFRAMES_VERSION}`, "--no-audit", "--no-fund", "--loglevel", "error"],
    { cwd: dir, stdio: "inherit", shell: true });
  if (r.status === 0 && hyperframesInstalled()) {
    ok(`ready in ${dir}`);
    return true;
  }
  warn("HyperFrames did not install (see above). Run this setup again; a dropped download is the usual cause.");
  return false;
}

function hyperframesEnv(cfg) {
  // HyperFrames runs on the Node that runs mc-video, which is known to be new enough. The folder
  // ffmpeg lives in goes LAST: on Linux that is /usr/bin, which can also hold an old system Node
  // that would otherwise be found first (it was, on the reader test machine). The two switches
  // keep HyperFrames from updating skill folders outside the mission control and from sending usage reports.
  const env = { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_TELEMETRY: "1" };
  const parts = [path.dirname(process.execPath), env.PATH || ""];
  if (cfg.ffmpeg && path.isAbsolute(cfg.ffmpeg)) parts.push(path.dirname(cfg.ffmpeg));
  env.PATH = parts.filter(Boolean).join(path.delimiter);
  return env;
}

function runHyperframes(cfg, args) {
  const cmd = args[0];
  if (cmd && L.HF_REFUSED.has(cmd)) {
    console.error(`mc-video does not run \`hyperframes ${cmd}\`: it reaches outside this computer or changes what is installed.`);
    console.error(`If the person wants it anyway, they run it themselves: npx hyperframes@${L.HYPERFRAMES_VERSION} ${args.join(" ")}`);
    return 2;
  }
  if (!hyperframesInstalled()) fail("HyperFrames is not installed. Run `mc-video setup` first.");
  return spawnSync(process.execPath, [hyperframesBin(), ...args], { stdio: "inherit", env: hyperframesEnv(cfg) }).status ?? 1;
}

async function stepSkills(godspeed) {
  say(`The recipes in your mission control (HyperFrames ${L.HYPERFRAMES_TAG}, pinned, plus ${L.RECIPE})`);
  const room = L.skillsRoom(godspeed);
  fs.mkdirSync(room, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-video-"));
  const written = [];
  const kept = [];
  try {
    const tgz = path.join(tmp, "hyperframes.tar.gz");
    await download(`https://codeload.github.com/heygen-com/hyperframes/tar.gz/refs/tags/${L.HYPERFRAMES_TAG}`, tgz);
    const r = run("tar", ["-xzf", "hyperframes.tar.gz"], { cwd: tmp });
    if (r.status !== 0) throw new Error(`tar could not unpack the download: ${r.stderr}`);
    const root = fs.readdirSync(tmp, { withFileTypes: true }).find((e) => e.isDirectory());
    const src = path.join(tmp, root.name);
    const install = (name, from, adapt) => {
      const dst = path.join(room, name);
      if (!L.mayReplace(dst)) {
        kept.push(name);
        return;
      }
      fs.rmSync(dst, { recursive: true, force: true });
      L.copyDir(from, dst);
      if (adapt) adaptRecipe(dst);
      fs.writeFileSync(path.join(dst, L.MARKER),
        `mc-video ${VERSION}, HyperFrames ${L.HYPERFRAMES_TAG}` +
        (adapt ? ". Changed from the original: `npx hyperframes` reads `mc-video hyperframes`, and SKILL.md starts with a note for this mission control.\n" : "\n"));
      written.push(name);
    };
    for (const name of L.hyperframesSkills(src)) install(name, path.join(src, "skills", name), true);
    install(L.RECIPE, path.join(PKG_ROOT, "skill", L.RECIPE), false);
  } catch (e) {
    warn(`could not fetch HyperFrames' recipes: ${e.message}. Check the internet connection and run this setup again.`);
    return { room, written, kept, failed: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok(`${written.length} recipes in ${room} (your assistant reads that folder)`);
  if (kept.length) console.log(`   Left alone because you already have a recipe with the same name: ${kept.join(", ")}`);

  // Your caption look lives in the mission control, beside your other settings, and is never overwritten.
  const styleDir = path.join(godspeed, "video");
  const style = path.join(styleDir, "caption-style.json");
  if (fs.existsSync(style)) ok(`your caption look is kept: ${style}`);
  else {
    fs.mkdirSync(styleDir, { recursive: true });
    fs.copyFileSync(path.join(PKG_ROOT, "tools", "caption-style.json"), style);
    ok(`your caption look starts here: ${style}`);
  }

  if (fs.existsSync(path.join(godspeed, ".git"))) {
    // HyperFrames' recipes are about 19 MB in close to a thousand files, and the setup fetches
    // them again on every computer. They stay out of the mission control's history; only what is yours
    // (the recipe that says how you work, and your caption look) goes in.
    const upstream = written.filter((n) => n !== L.RECIPE).map((n) => path.relative(godspeed, path.join(room, n)));
    const gi = path.join(godspeed, ".gitignore");
    const before = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
    const block = L.gitignoreBlock(before, upstream);
    if (block !== before) fs.writeFileSync(gi, block);
    const mine = [path.relative(godspeed, path.join(room, L.RECIPE)), path.relative(godspeed, styleDir), ".gitignore"];
    run("git", ["-C", godspeed, "add", "--", ...mine]);
    const staged = run("git", ["-C", godspeed, "diff", "--cached", "--quiet", "--", ...mine]);
    if (staged.status === 1) {
      const c = run("git", ["-C", godspeed, "-c", "user.name=mc-video", "-c", "user.email=mc-video@localhost",
        "commit", "-q", "-m", `Add the video recipe and caption look (mc-video ${VERSION})`, "--", ...mine]);
      if (c.status === 0) ok("saved in your mission control's history, so you can undo it like any other change");
    }
  }
  return { room, written, kept, failed: false };
}

function stepCommand() {
  say("The mc-video command");
  const app = path.join(L.home(), "app");
  if (path.resolve(PKG_ROOT) !== path.resolve(app)) {
    fs.rmSync(app, { recursive: true, force: true });
    L.copyDir(PKG_ROOT, app, { skip: (n) => [".git", "node_modules", "test", ".github"].includes(n) });
  }
  const dir = L.binDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const l of L.launchers(app)) {
    const f = path.join(dir, l.name);
    fs.rmSync(f, { force: true });
    fs.writeFileSync(f, l.body, { mode: l.mode });
  }
  if (L.onPath(dir)) ok(`mc-video is ready to type (${dir})`);
  else {
    const where = path.join(dir, isWin ? "mc-video.cmd" : "mc-video");
    warn(`${dir} is not on this terminal's PATH. Open a new terminal; if \`mc-video\` is still unknown, type the full path: ${where}`);
  }
  return app;
}

function runTool(cfg, sub, rest) {
  if (!cfg.python || !fs.existsSync(cfg.python)) fail("the speech model is not installed. Run `mc-video setup` first.");
  if (!cfg.ffmpeg) fail("no usable ffmpeg is recorded. Run `mc-video setup` first.");
  const style = cfg.godspeed ? path.join(cfg.godspeed, "video", "caption-style.json") : "";
  const env = { ...process.env, GODSPEED_VIDEO_FFMPEG: cfg.ffmpeg, PYTHONIOENCODING: "utf-8" };
  if (style && fs.existsSync(style)) env.GODSPEED_VIDEO_STYLE = style;
  const burn = path.join(PKG_ROOT, "tools", "burn.py");
  return spawnSync(cfg.python, [burn, sub, ...rest], { stdio: "inherit", env }).status ?? 1;
}

function stepProof(cfg) {
  say("Proof: captions on the sample clip, then an animated title card");
  const dir = path.join(L.home(), "proof");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const clip = path.join(dir, "sample-vertical.mp4");
  fs.copyFileSync(path.join(PKG_ROOT, "sample", "sample-vertical.mp4"), clip);
  const capStatus = cfg.python && cfg.ffmpeg ? runTool(cfg, "captions", [clip, "--language", "en"]) : null;
  if (capStatus === 0) ok(`captions: open ${path.join(dir, "sample-vertical.captioned.mp4")} and watch 8 seconds`);
  else if (capStatus === null) warn("captions need ffmpeg and the speech model (see above), so they were not tried.");
  else warn("captions did not finish (see above).");

  if (!cfg.ffmpeg) {
    warn("the animated title card needs ffmpeg as well, so it was not tried.");
    return { captions: capStatus === 0, render: false };
  }
  if (process.platform === "linux" && !which("unzip")) {
    warn("the animated title card needs unzip on Linux (see the ffmpeg step above), so it was not tried.");
    return { captions: capStatus === 0, render: false };
  }
  const card = path.join(dir, "title-card");
  L.copyDir(path.join(PKG_ROOT, "sample", "title-card"), card);
  const out = path.join(dir, "title-card.mp4");
  if (!hyperframesInstalled()) {
    warn("the animated title card needs HyperFrames (see above), so it was not tried.");
    return { captions: capStatus === 0, render: false };
  }
  console.log(`   Rendering with HyperFrames ${L.HYPERFRAMES_VERSION}; the first render downloads the browser it draws with (114 MB)...`);
  const r = spawnSync(process.execPath, [hyperframesBin(), "render", "-o", "title-card.mp4", "--quality", "draft", "--quiet"],
    { cwd: card, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: hyperframesEnv(cfg) });
  const made = path.join(card, "title-card.mp4");
  if (fs.existsSync(made)) fs.renameSync(made, out);
  const rendered = r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 10000;
  if (rendered) ok(`animated slides: open ${out} and watch 3 seconds`);
  else {
    const tail = `${r.stdout || ""}\n${r.stderr || ""}`.trim().split(/\r?\n/).slice(-8).join("\n     ");
    warn(`the HyperFrames render did not finish. It said:\n     ${tail}\n   Run \`mc-video hyperframes doctor\` to see what this computer is missing.`);
  }
  return { captions: capStatus === 0, render: rendered };
}

async function setup(flags) {
  console.log(`mc-video ${VERSION}: let your mission control finish your videos`);
  if (L.nodeMajor() < 22) fail(`this needs Node.js 22 or newer, and this computer has ${process.versions.node}. Update Node, then run this again.`);
  const godspeed = L.findGodspeed({ arg: flags.godspeed });
  if (!godspeed) fail(flags.godspeed
    ? `${flags.godspeed} does not look like a mission control (there is no AGENTS.md in it).`
    : "could not find your mission control. Run this again from inside your mission control folder, or add --godspeed <folder>.");
  const cfg = { ...L.readConfig(), godspeed };
  say("Your mission control");
  ok(godspeed);

  const skills = await stepSkills(godspeed);
  cfg.app = stepCommand();
  cfg.ffmpeg = await stepFfmpeg(cfg, flags);
  cfg.python = await stepPython(cfg, flags);
  const hf = stepHyperframes();
  cfg.hyperframes = L.HYPERFRAMES_TAG;
  cfg.version = VERSION;
  L.writeConfig(cfg);

  let proof = { captions: false, render: false };
  if (!flags.skipProof) proof = stepProof(cfg);

  const ready = !skills.failed && cfg.ffmpeg && cfg.python && hf && (flags.skipProof || (proof.captions && proof.render));
  console.log("");
  if (ready) {
    console.log("Done. Tell your assistant, for example:");
    console.log('   "Caption ~/Videos/my-clip.mp4 and make a vertical version for Reels."');
    console.log('   "Make a five-second animated title card that says: Three things I learned this week."');
  } else {
    console.log("Not finished: the lines marked `not yet` above say what is missing. Fix those and run `mc-video setup` again; it picks up where it stopped.");
    process.exitCode = 1;
  }
}

function check() {
  const cfg = L.readConfig();
  console.log(`mc-video ${VERSION}`);
  const line = (good, what) => console.log(`${good ? "ok" : "missing"}: ${what}`);
  line(L.nodeMajor() >= 22, `Node.js ${process.versions.node} (22 or newer)`);
  line(!!cfg.godspeed && fs.existsSync(path.join(cfg.godspeed, "AGENTS.md")), `godspeed ${cfg.godspeed || "(none recorded)"}`);
  const room = cfg.godspeed ? L.skillsRoom(cfg.godspeed) : "";
  line(!!room && fs.existsSync(path.join(room, L.RECIPE, "SKILL.md")), `the ${L.RECIPE} recipe`);
  line(!!room && fs.existsSync(path.join(room, "hyperframes", "SKILL.md")), `HyperFrames recipes (${cfg.hyperframes || "?"})`);
  line(hyperframesInstalled(), `HyperFrames ${L.HYPERFRAMES_VERSION} itself (mc-video hyperframes <command>)`);
  line(!!cfg.ffmpeg && !!findFfmpeg(cfg).exe, `ffmpeg ${cfg.ffmpeg || ""}`);
  line(!!cfg.python && fs.existsSync(cfg.python) && run(cfg.python, ["-c", "import faster_whisper, PIL"]).status === 0, "the speech model's code");
  if (cfg.godspeed) line(fs.existsSync(path.join(cfg.godspeed, "video", "caption-style.json")), `caption look ${path.join(cfg.godspeed, "video", "caption-style.json")}`);
}

const [sub, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
switch (sub) {
  case "setup":
    await setup(flags);
    break;
  case "captions":
  case "vertical":
    process.exitCode = runTool(L.readConfig(), sub, rest);
    break;
  case "hyperframes":
    process.exitCode = runHyperframes(L.readConfig(), rest);
    break;
  case "check":
    check();
    break;
  case "--version":
  case "version":
    console.log(VERSION);
    break;
  default:
    console.log(`mc-video ${VERSION}

  mc-video setup [--godspeed <folder>] [--yes]   install or update, then prove it works
  mc-video captions <clip>                  burn captions in your one look -> <clip>.captioned.mp4
  mc-video vertical <clip> [--captions]     a 9:16 cut from the middle      -> <clip>.vertical.mp4
  mc-video hyperframes <command>            HyperFrames ${L.HYPERFRAMES_VERSION} as installed here: check, render, preview...
  mc-video check                            what is installed and what is missing

Your caption look: <godspeed>/video/caption-style.json. Animated slides and overlays: ask your
assistant; it uses the HyperFrames recipes this setup put in your mission control.`);
    if (sub && sub !== "help" && sub !== "--help") process.exitCode = 1;
}
