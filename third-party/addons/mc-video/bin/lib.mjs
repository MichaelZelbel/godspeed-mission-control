// The parts of mc-video that decide things, kept apart from the parts that talk, so the
// tests can check every decision without a network, an ffmpeg or a terminal.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HyperFrames is pinned. Its skills and its renderer change on their own clock, and a
// reader's godspeed should change only when this add-on says so.
export const HYPERFRAMES_TAG = "v0.8.43";
export const HYPERFRAMES_VERSION = HYPERFRAMES_TAG.slice(1);
export const MARKER = ".installed-by-mc-video";
export const RECIPE = "video-finishing";

export function home() {
  return process.env.GODSPEED_VIDEO_HOME || path.join(os.homedir(), ".mc-video");
}

export function nodeMajor(version = process.versions.node) {
  return Number(String(version).split(".")[0]);
}

// Where the mission control is, in the order a reader would expect: said on the command line, recorded
// by the kit's installer, the folder you are standing in, then the book's default.
export function findGodspeed({ arg, cwd = process.cwd(), userHome = os.homedir() } = {}) {
  const looksLikeGodspeed = (d) => d && fs.existsSync(path.join(d, "AGENTS.md"));
  if (arg) return looksLikeGodspeed(path.resolve(arg)) ? path.resolve(arg) : null;
  const envFile = path.join(userHome, ".godspeed", "device.env");
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^\s*GODSPEED_DIR=(.+)$/m);
    if (m) {
      const d = m[1].trim().replace(/^["']|["']$/g, "");
      if (looksLikeGodspeed(d)) return d;
    }
  }
  if (looksLikeGodspeed(cwd)) return cwd;
  const dflt = path.join(userHome, "godspeed");
  return looksLikeGodspeed(dflt) ? dflt : null;
}

function countRecipes(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "SKILL.md"))).length;
  } catch {
    return 0;
  }
}

// The same answer the kit's installer gives: the visible skills/ room unless this mission control keeps
// its recipes only in .claude/skills.
export function skillsRoom(godspeed) {
  if (countRecipes(path.join(godspeed, "skills")) > 0) return path.join(godspeed, "skills");
  if (countRecipes(path.join(godspeed, ".claude", "skills")) > 0) return path.join(godspeed, ".claude", "skills");
  return path.join(godspeed, "skills");
}

// May this installer write the skill folder `dir`? Only when it is new or was put there by
// this installer before. A recipe the reader wrote under the same name is never replaced.
export function mayReplace(dir) {
  if (!fs.existsSync(dir)) return true;
  return fs.existsSync(path.join(dir, MARKER));
}

// An ffmpeg is good enough when it can write H.264 and draw subtitles. The Windows Store
// "ffmpeg" and some minimal Linux builds can do neither, and they say nothing until a render.
export function ffmpegIsUsable(encodersText, filtersText) {
  const h264 = /\blibx264\b/.test(encodersText || "");
  const subs = /^\s*\S*\s+subtitles\s/m.test(filtersText || "");
  return { h264, subs, ok: h264 && subs };
}

export function ffmpegCandidates(platform = process.platform, env = process.env) {
  const c = ["ffmpeg"];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) c.unshift(path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe"));
  } else if (platform === "darwin") {
    c.push("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  } else {
    c.push("/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  }
  return c;
}

// The install line for what is missing. On Linux `unzip` rides along: HyperFrames unpacks the
// browser it draws with using `unzip`, which a fresh Ubuntu does not have, and without it the
// first render fails after a 114 MB download.
export function installCommand(platform = process.platform, has = () => false, { ffmpeg = true, unzip = false } = {}) {
  if (platform === "win32") {
    return ffmpeg ? { cmd: "winget", args: ["install", "--id", "Gyan.FFmpeg", "-e", "--accept-source-agreements", "--accept-package-agreements"] } : null;
  }
  if (platform === "darwin") return ffmpeg && has("brew") ? { cmd: "brew", args: ["install", "ffmpeg"] } : null;
  const pkgs = [ffmpeg && "ffmpeg", unzip && "unzip"].filter(Boolean);
  if (!pkgs.length) return null;
  if (has("apt-get")) return { cmd: "sudo", args: ["apt-get", "install", "-y", ...pkgs] };
  if (has("dnf")) return { cmd: "sudo", args: ["dnf", "install", "-y", ...pkgs] };
  return null;
}

export function uvCandidates(platform = process.platform, env = process.env, userHome = os.homedir()) {
  const exe = platform === "win32" ? "uv.exe" : "uv";
  const c = ["uv", path.join(userHome, ".local", "bin", exe), path.join(userHome, ".cargo", "bin", exe)];
  if (platform === "win32" && env.LOCALAPPDATA) c.push(path.join(env.LOCALAPPDATA, "hermes", "bin", exe));
  return c;
}

export function venvPython(venv, platform = process.platform) {
  return platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

// Where the command goes: the kit's own command folder when this machine has one, which the
// kit already put on PATH, otherwise the usual per-user folder.
export function binDir(userHome = os.homedir()) {
  const kit = path.join(userHome, ".godspeed", "bin");
  return fs.existsSync(kit) ? kit : path.join(userHome, ".local", "bin");
}

export function onPath(dir, envPath = process.env.PATH || "", platform = process.platform) {
  const sep = platform === "win32" ? ";" : ":";
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, "");
  return envPath.split(sep).filter(Boolean).some((p) => norm(p) === norm(dir));
}

export function launchers(appDir, platform = process.platform) {
  const script = path.join(appDir, "bin", "mc-video.mjs");
  const out = [{ name: "mc-video", body: `#!/bin/sh\nexec node "${script.replace(/\\/g, "/")}" "$@"\n`, mode: 0o755 }];
  if (platform === "win32") out.push({ name: "mc-video.cmd", body: `@echo off\r\nnode "${script}" %*\r\n`, mode: 0o644 });
  return out;
}

export function readConfig(file = path.join(home(), "config.json")) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function writeConfig(cfg, file = path.join(home(), "config.json")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}

export function copyDir(src, dst, { skip = () => false } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, { skip });
    else fs.copyFileSync(s, d);
  }
}

// The published skill folders inside an unpacked HyperFrames release: every folder under
// skills/ that holds a SKILL.md.
export function hyperframesSkills(unpackedRoot) {
  const dir = path.join(unpackedRoot, "skills");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

// The mission control's .gitignore with one block listing HyperFrames' recipe folders. The block is
// rewritten in place on every run, so a newer pin that adds or drops a recipe leaves no stale
// lines, and nothing outside the block is touched.
export const IGNORE_START = "# mc-video: HyperFrames' recipes. `mc-video setup` downloads them on each computer.";
export const IGNORE_END = "# end mc-video";
export function gitignoreBlock(text, relPaths) {
  const lines = [IGNORE_START, ...relPaths.map((p) => p.split(/[\\/]/).join("/") + "/").sort(), IGNORE_END];
  const body = lines.join("\n") + "\n";
  const start = text.indexOf(IGNORE_START);
  const endAt = start >= 0 ? text.indexOf(IGNORE_END, start) : -1;
  if (start >= 0 && endAt >= 0) {
    let after = endAt + IGNORE_END.length;
    if (text[after] === "\n") after += 1;
    return text.slice(0, start) + body + text.slice(after);
  }
  if (!relPaths.length) return text;
  return (text && !text.endsWith("\n") ? text + "\n" : text) + (text ? "\n" : "") + body;
}

// HyperFrames commands that reach outside this computer: hosting, cloud rendering, accounts,
// usage reports, and updates that would move the pin. `mc-video hyperframes` refuses them and
// says how to run one on purpose.
export const HF_REFUSED = new Set(["publish", "cloud", "cloudrun", "lambda", "auth", "feedback", "telemetry", "upgrade", "skills"]);

// The recipes say `npx hyperframes ...`. Hermes blocks `npx` as a package download, and `npx`
// would also ignore the pin. In the mission control's copy every such call becomes `mc-video hyperframes`,
// which runs the pinned copy the setup installed.
const NPX_HF = /npx\s+(?:--yes\s+|-y\s+)?hyperframes(?:@[\w.-]+)?(?=[\s`'")\]]|$)/g;
export function rewriteNpx(text) {
  return text.replace(NPX_HF, "mc-video hyperframes");
}

export const GODSPEED_NOTE = `> **In this mission control** (added by mc-video, not part of HyperFrames): wherever these recipes say
> \`npx hyperframes <command>\`, the command is \`mc-video hyperframes <command>\`, which runs
> HyperFrames ${HYPERFRAMES_VERSION} as installed on this computer. It works offline once set up, and
> it refuses the commands that publish, render in the cloud, sign in or send reports. Captions in
> the person's own look and the vertical cut come from the \`video-finishing\` recipe; read it
> too before you start.
`;

export function addGodspeedNote(skillMd) {
  if (skillMd.includes("**In this mission control** (added by mc-video")) return skillMd;
  const m = skillMd.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const head = m ? m[0] : "";
  return head + "\n" + GODSPEED_NOTE + "\n" + skillMd.slice(head.length).replace(/^\r?\n/, "");
}
