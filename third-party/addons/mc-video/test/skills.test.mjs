// The recipes the setup puts in a mission control's skills folder, proved against a mission
// control in a temporary folder with no network: the four this add-on carries in skill/ -
// video-finishing, video-captions, video-hooks, embedded-captions - beside HyperFrames' own from
// the release it unpacked.
//
// Until Godspeed Mission Control 2.0.0-beta.13 those four came with every install, whether the
// reader made videos or not. Now only the people who set this add-on up get them, so it has to
// bring them itself, and that is what these tests watch.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as L from "../bin/lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mc-video-skills-"));

// A mission control, the way the kit's installer leaves one: AGENTS.md and a skills/ room that
// already holds a recipe of the reader's own, so skillsRoom picks the visible folder.
function godspeedAt(dir) {
  fs.mkdirSync(path.join(dir, "skills", "morning-note"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# godspeed\n");
  fs.writeFileSync(path.join(dir, "skills", "morning-note", "SKILL.md"), "---\nname: morning-note\n---\n");
  return dir;
}

// A HyperFrames release as `tar` leaves it: a folder with skills/<name>/SKILL.md inside.
function hyperframesRelease(dir, names) {
  for (const n of names) {
    fs.mkdirSync(path.join(dir, "skills", n), { recursive: true });
    fs.writeFileSync(path.join(dir, "skills", n, "SKILL.md"),
      `---\nname: ${n}\n---\n\nRender it with \`npx hyperframes render\`.\n`);
  }
  return dir;
}

const installInto = (godspeed, hyperframesRoot) => {
  const room = L.skillsRoom(godspeed);
  const result = L.installRecipes({ room, hyperframesRoot, pkgRoot: ROOT, version: "1.1.0" });
  return { room, ...result };
};

test("every recipe this add-on carries is really in skill/, with a SKILL.md", () => {
  assert.deepEqual(L.RECIPES, ["video-finishing", "video-captions", "video-hooks", "embedded-captions"]);
  for (const r of L.RECIPES) {
    assert.ok(fs.existsSync(path.join(ROOT, "skill", r, "SKILL.md")), `skill/${r}/SKILL.md is missing`);
  }
});

test("the setup puts all four recipes in a mission control's skills folder, beside HyperFrames' own", () => {
  const home = tmp();
  const godspeed = godspeedAt(path.join(home, "godspeed"));
  const release = hyperframesRelease(path.join(home, "hyperframes-0.8.43"), ["hyperframes", "slideshow", "embedded-captions"]);
  const { room, written } = installInto(godspeed, release);

  assert.equal(room, path.join(godspeed, "skills"));
  for (const r of ["video-finishing", "video-captions", "video-hooks", "embedded-captions"]) {
    assert.ok(fs.existsSync(path.join(room, r, "SKILL.md")), `${r} did not reach the skills folder`);
    assert.ok(written.includes(r), `${r} was not reported as written`);
  }
  // HyperFrames' own still arrive, and the reader's own recipe is untouched.
  for (const r of ["hyperframes", "slideshow"]) assert.ok(fs.existsSync(path.join(room, r, "SKILL.md")), r);
  assert.ok(fs.existsSync(path.join(room, "morning-note", "SKILL.md")), "the reader's own recipe");
  // Each folder arrives whole, not just its SKILL.md. (embedded-captions came from the stub
  // release here, so its whole folder is proved in the no-download test below.)
  assert.ok(fs.existsSync(path.join(room, "video-hooks", "judge.md")));
  assert.ok(fs.existsSync(path.join(room, "video-captions", "scripts", "burn.py")));
  assert.ok(fs.existsSync(path.join(room, "video-captions", "fonts", "ArchivoBlack-Regular.ttf")));
  // And says who put it there, so an update knows what it may replace.
  for (const r of written) assert.match(fs.readFileSync(path.join(room, r, L.MARKER), "utf8"), /^mc-video 1\.1\.0, HyperFrames v0\.8\.43/);
});

// embedded-captions is HyperFrames' own skill (skill/embedded-captions/LICENSE says so). The
// pinned release's copy is the newer one, so it wins; ours is what a reader gets when the
// download could not be made.
test("the pinned release's copy of a recipe we also carry wins, and ours stands in when there is no download", () => {
  const home = tmp();
  const withRelease = godspeedAt(path.join(home, "with"));
  const release = hyperframesRelease(path.join(home, "hyperframes-0.8.43"), ["embedded-captions"]);
  const a = installInto(withRelease, release);
  assert.equal(a.written.filter((n) => n === "embedded-captions").length, 1, "installed once, not twice");
  assert.match(fs.readFileSync(path.join(a.room, "embedded-captions", "SKILL.md"), "utf8"), /^---\nname: embedded-captions\n---/,
    "the stub release's copy, not the one carried here");

  const alone = godspeedAt(path.join(home, "alone"));
  const b = installInto(alone, null);
  for (const r of L.RECIPES) assert.ok(fs.existsSync(path.join(b.room, r, "SKILL.md")), `${r} without a download`);
  assert.match(fs.readFileSync(path.join(b.room, "embedded-captions", "SKILL.md"), "utf8"), /name: embedded-captions/);
  assert.ok(fs.existsSync(path.join(b.room, "embedded-captions", "themes", "ordnance.json")), "the whole folder, from here");
});

test("a recipe the reader wrote under one of these names is never replaced", () => {
  const home = tmp();
  const godspeed = godspeedAt(path.join(home, "godspeed"));
  const room = path.join(godspeed, "skills");
  fs.mkdirSync(path.join(room, "video-hooks"), { recursive: true });
  fs.writeFileSync(path.join(room, "video-hooks", "SKILL.md"), "mine\n");
  const { kept, written } = installInto(godspeed, hyperframesRelease(path.join(home, "hf"), ["hyperframes"]));
  assert.ok(kept.includes("video-hooks"));
  assert.ok(!written.includes("video-hooks"));
  assert.equal(fs.readFileSync(path.join(room, "video-hooks", "SKILL.md"), "utf8"), "mine\n");
  // Run twice and it is still theirs.
  installInto(godspeed, hyperframesRelease(path.join(home, "hf"), ["hyperframes"]));
  assert.equal(fs.readFileSync(path.join(room, "video-hooks", "SKILL.md"), "utf8"), "mine\n");
});

// The reader's mission control keeps what is theirs in its history and leaves HyperFrames' recipes
// out: they are about 19 MB and the setup fetches them again on every computer. embedded-captions
// is HyperFrames', carried here or downloaded, so it stays out with the rest of theirs.
test("the .gitignore block lists HyperFrames' recipes, including embedded-captions, and none of ours", () => {
  assert.deepEqual(L.OURS, ["video-finishing", "video-captions", "video-hooks"]);
  const written = ["hyperframes", "slideshow", "embedded-captions", ...L.OURS];
  const upstream = written.filter((n) => !L.OURS.includes(n)).map((n) => `skills/${n}`);
  const block = L.gitignoreBlock("", upstream);
  for (const n of ["hyperframes", "slideshow", "embedded-captions"]) assert.match(block, new RegExp(`^skills/${n}/$`, "m"), n);
  for (const n of L.OURS) assert.doesNotMatch(block, new RegExp(`^skills/${n}/$`, "m"), n);
});

test("every recipe the add-on carries is listed in what npm ships", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("skill"), "package.json must ship skill/");
});

// Apache 2.0 asks for the licence and a word on what we changed, and embedded-captions is the one
// folder here that is not ours.
test("the carried HyperFrames recipe keeps its own licence beside it", () => {
  for (const r of L.HYPERFRAMES_OWN) {
    const lic = fs.readFileSync(path.join(ROOT, "skill", r, "LICENSE"), "utf8");
    assert.match(lic, /Apache License/);
    assert.match(lic, /HeyGen/);
    assert.match(lic, /Changed from the original/);
  }
});
