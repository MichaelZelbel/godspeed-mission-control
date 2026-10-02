// Network-free tests for the decisions mc-video makes. Run: node --test test/
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as L from "../bin/lib.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hv-test-"));
const godspeedAt = (d) => {
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "AGENTS.md"), "# godspeed\n");
  return d;
};

test("the mission control named on the command line wins, and a folder without AGENTS.md is refused", () => {
  const home = tmp();
  const godspeed = godspeedAt(path.join(home, "elsewhere"));
  assert.equal(L.findGodspeed({ arg: godspeed, userHome: home, cwd: home }), godspeed);
  assert.equal(L.findGodspeed({ arg: home, userHome: home, cwd: home }), null);
});

test("the mission control recorded by the kit comes before the current folder", () => {
  const home = tmp();
  const recorded = godspeedAt(path.join(home, "recorded"));
  const here = godspeedAt(path.join(home, "here"));
  fs.mkdirSync(path.join(home, ".godspeed"));
  fs.writeFileSync(path.join(home, ".godspeed", "device.env"), `GODSPEED_PROMPT_SOURCES=hermes\nGODSPEED_DIR=${recorded}\n`);
  assert.equal(L.findGodspeed({ userHome: home, cwd: here }), recorded);
});

test("without a record, the current folder, then ~/godspeed", () => {
  const home = tmp();
  const here = godspeedAt(path.join(home, "here"));
  assert.equal(L.findGodspeed({ userHome: home, cwd: here }), here);
  const dflt = godspeedAt(path.join(home, "godspeed"));
  assert.equal(L.findGodspeed({ userHome: home, cwd: home }), dflt);
});

test("recipes go to the visible skills room unless the mission control only has .claude/skills", () => {
  const godspeed = godspeedAt(tmp());
  assert.equal(L.skillsRoom(godspeed), path.join(godspeed, "skills"));
  fs.mkdirSync(path.join(godspeed, ".claude", "skills", "x"), { recursive: true });
  fs.writeFileSync(path.join(godspeed, ".claude", "skills", "x", "SKILL.md"), "x");
  assert.equal(L.skillsRoom(godspeed), path.join(godspeed, ".claude", "skills"));
  fs.mkdirSync(path.join(godspeed, "skills", "y"), { recursive: true });
  fs.writeFileSync(path.join(godspeed, "skills", "y", "SKILL.md"), "y");
  assert.equal(L.skillsRoom(godspeed), path.join(godspeed, "skills"));
});

test("a recipe the reader wrote is never replaced; one this installer wrote is", () => {
  const room = tmp();
  assert.equal(L.mayReplace(path.join(room, "new")), true);
  fs.mkdirSync(path.join(room, "theirs"));
  assert.equal(L.mayReplace(path.join(room, "theirs")), false);
  fs.mkdirSync(path.join(room, "ours"));
  fs.writeFileSync(path.join(room, "ours", L.MARKER), "mc-video");
  assert.equal(L.mayReplace(path.join(room, "ours")), true);
});

test("an ffmpeg must write H.264 and draw subtitles", () => {
  const enc = " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)\n";
  const fil = " ... subtitles         V->V       Render text subtitles onto input video using the libass library.\n";
  assert.deepEqual(L.ffmpegIsUsable(enc, fil), { h264: true, subs: true, ok: true });
  assert.equal(L.ffmpegIsUsable("", fil).ok, false);
  assert.equal(L.ffmpegIsUsable(enc, " ... scale             V->V       Scale the input video size\n").ok, false);
});

test("the install line fits the system, and there is none where it cannot be known", () => {
  assert.equal(L.installCommand("win32").cmd, "winget");
  assert.deepEqual(L.installCommand("darwin", (c) => c === "brew"), { cmd: "brew", args: ["install", "ffmpeg"] });
  assert.equal(L.installCommand("darwin", () => false), null);
  assert.deepEqual(L.installCommand("linux", (c) => c === "apt-get").args, ["apt-get", "install", "-y", "ffmpeg"]);
  assert.equal(L.installCommand("linux", () => false), null);
});

test("on Linux, unzip joins the line when it is missing, alone or with ffmpeg", () => {
  const apt = (c) => c === "apt-get";
  assert.deepEqual(L.installCommand("linux", apt, { ffmpeg: true, unzip: true }).args, ["apt-get", "install", "-y", "ffmpeg", "unzip"]);
  assert.deepEqual(L.installCommand("linux", apt, { ffmpeg: false, unzip: true }).args, ["apt-get", "install", "-y", "unzip"]);
  assert.equal(L.installCommand("linux", apt, { ffmpeg: false, unzip: false }), null);
});

test("Windows looks for winget's ffmpeg before the one on PATH", () => {
  const c = L.ffmpegCandidates("win32", { LOCALAPPDATA: "C:\\Users\\r\\AppData\\Local" });
  assert.match(c[0], /WinGet[\\/]Links[\\/]ffmpeg\.exe$/);
  assert.equal(c[1], "ffmpeg");
});

test("launchers: a shell one everywhere, and a .cmd twin on Windows", () => {
  const unix = L.launchers("/home/r/.mc-video/app", "linux");
  assert.deepEqual(unix.map((l) => l.name), ["mc-video"]);
  assert.match(unix[0].body, /exec node ".*\/bin\/mc-video\.mjs" "\$@"/);
  const win = L.launchers("C:\\Users\\r\\.mc-video\\app", "win32");
  assert.deepEqual(win.map((l) => l.name), ["mc-video", "mc-video.cmd"]);
  assert.match(win[1].body, /node ".*mc-video\.mjs" %\*/);
});

test("the kit's command folder is used when it exists", () => {
  const home = tmp();
  assert.equal(L.binDir(home), path.join(home, ".local", "bin"));
  fs.mkdirSync(path.join(home, ".godspeed", "bin"), { recursive: true });
  assert.equal(L.binDir(home), path.join(home, ".godspeed", "bin"));
});

test("PATH comparison ignores case and a trailing slash on Windows", () => {
  assert.equal(L.onPath("C:\\Users\\R\\.godspeed\\bin", "C:\\Windows;c:\\users\\r\\.godspeed\\bin\\", "win32"), true);
});

test("the HyperFrames pin is an exact tag", () => {
  assert.match(L.HYPERFRAMES_TAG, /^v\d+\.\d+\.\d+$/);
  assert.equal(L.HYPERFRAMES_VERSION, L.HYPERFRAMES_TAG.slice(1));
});

test("only folders with a SKILL.md count as published HyperFrames skills", () => {
  const root = tmp();
  for (const n of ["hyperframes", "media-use"]) {
    fs.mkdirSync(path.join(root, "skills", n), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", n, "SKILL.md"), n);
  }
  fs.mkdirSync(path.join(root, "skills", "not-a-skill"));
  fs.writeFileSync(path.join(root, "skills", "python-encoding.test.mjs"), "");
  assert.deepEqual(L.hyperframesSkills(root), ["hyperframes", "media-use"]);
});

test("the .gitignore block is added once, rewritten in place, and leaves other lines alone", () => {
  const first = L.gitignoreBlock("node_modules/\n", [path.join("skills", "hyperframes"), path.join("skills", "media-use")]);
  assert.match(first, /^node_modules\/\n\n# mc-video/);
  assert.match(first, /skills\/hyperframes\/\nskills\/media-use\/\n# end mc-video\n$/);
  const second = L.gitignoreBlock(first + "secrets/\n", [path.join("skills", "hyperframes")]);
  assert.equal((second.match(/# mc-video/g) || []).length, 1);
  assert.doesNotMatch(second, /media-use/);
  assert.match(second, /secrets\/\n$/);
  assert.equal(L.gitignoreBlock("", []), "");
});

test("every npx call to HyperFrames becomes mc-video hyperframes, and nothing else changes", () => {
  const src = "Run `npx hyperframes check`, then npx --yes hyperframes@0.8.43 render -o a.mp4 and (npx hyperframes@latest init x).\nnpx tsx build.ts\nnpx hyperframes";
  assert.equal(L.rewriteNpx(src),
    "Run `mc-video hyperframes check`, then mc-video hyperframes render -o a.mp4 and (mc-video hyperframes init x).\nnpx tsx build.ts\nmc-video hyperframes");
  assert.equal(L.rewriteNpx("npx hyperframes-localize-fonts"), "npx hyperframes-localize-fonts");
});

test("the mission control note goes after the front matter, once", () => {
  const md = "---\nname: hyperframes\ndescription: x\n---\n\n# HyperFrames entry point\n";
  const once = L.addGodspeedNote(md);
  assert.match(once, /^---\nname: hyperframes\ndescription: x\n---\n\n> \*\*In this mission control\*\*/);
  assert.match(once, /# HyperFrames entry point\n$/);
  assert.equal(L.addGodspeedNote(once), once);
});

test("commands that leave the computer are refused", () => {
  for (const c of ["publish", "cloud", "lambda", "auth", "feedback", "skills"]) assert.ok(L.HF_REFUSED.has(c), c);
  for (const c of ["check", "render", "preview", "init", "snapshot", "add", "catalog"]) assert.ok(!L.HF_REFUSED.has(c), c);
});
