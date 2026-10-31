// "Caption this clip", asked of an assistant, failed every time until 18 October 2026. The
// assistant's own mc-video (the kit's wire-assistant.mjs) adds `--godspeed <its mission control>`
// after whatever it is asked to run, and `captions` and `vertical` handed that on to burn.py, whose
// argument parser refused it. The other tests ran the commands as a person types them, without the
// option, so they passed. These run bin/mc-video.mjs with the option, every way the arguments can
// arrive (as given, through the .cmd launcher's marker, and as the PowerShell launcher's base64),
// with burn.py and HyperFrames replaced by stand-ins that write down what they were handed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ARGV_FLAG, CMD_END, CMDLINE_ENV, LAUNCHER_ENV } from "../bin/argv.mjs";
import * as L from "../bin/lib.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "mc-video.mjs");

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mcv-godspeed-"));
  const godspeed = (d, look) => {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "AGENTS.md"), "# godspeed\n");
    if (look) {
      fs.mkdirSync(path.join(d, "video"), { recursive: true });
      fs.writeFileSync(path.join(d, "video", "caption-style.json"), "{}\n");
    }
    return d;
  };
  // Setup recorded one mission control without a look; the assistant names its own, which has one.
  const recorded = godspeed(path.join(base, "recorded-by-setup"), false);
  const wired = godspeed(path.join(base, "assistant's mission control"), true);
  const home = path.join(base, "mc-video-home");
  const record = path.join(base, "record.json");
  // "python" is this Node; a preloaded file stops it before it reads burn.py and writes down what
  // burn.py would have been handed. HyperFrames is a file that does the same.
  const recorder = path.join(base, "recorder.cjs");
  fs.writeFileSync(recorder,
    "const p=require('path');if(p.basename(process.argv[1]||'')==='burn.py'){require('fs').writeFileSync(process.env.MC_VIDEO_TEST_RECORD," +
    "JSON.stringify({ran:'burn.py',args:process.argv.slice(2),style:process.env.GODSPEED_VIDEO_STYLE||null}));process.exit(0);}\n");
  const hf = path.join(home, "hyperframes", "node_modules", "hyperframes");
  fs.mkdirSync(path.join(hf, "bin"), { recursive: true });
  fs.writeFileSync(path.join(hf, "package.json"), JSON.stringify({ name: "hyperframes", version: L.HYPERFRAMES_VERSION }));
  fs.writeFileSync(path.join(hf, "bin", "hyperframes.mjs"),
    "import fs from 'node:fs';fs.writeFileSync(process.env.MC_VIDEO_TEST_RECORD,JSON.stringify({ran:'hyperframes',args:process.argv.slice(2)}));\n");
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ godspeed: recorded, ffmpeg: "ffmpeg", python: process.execPath }));
  const clip = path.join(base, "Sam's clips", "talk 1.mp4");
  fs.mkdirSync(path.dirname(clip));
  fs.writeFileSync(clip, "");
  const env = { ...process.env, GODSPEED_VIDEO_HOME: home, MC_VIDEO_TEST_RECORD: record, NODE_OPTIONS: `--require ${JSON.stringify(recorder)}` };
  delete env[LAUNCHER_ENV];
  delete env[CMDLINE_ENV];
  return { wired, recorded, clip, record, env };
}

const recorded = (f) => {
  const r = JSON.parse(fs.readFileSync(f.record, "utf8"));
  fs.rmSync(f.record);
  return r;
};

// The three ways the arguments reach mc-video (bin/argv.mjs).
const WAYS = {
  "as given": (f, args) => ({ argv: args, env: f.env }),
  "through the .cmd launcher": (f, args) => ({ argv: [...args, CMD_END], env: { ...f.env, [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: "mc-video.cmd" } }),
  "through the PowerShell launcher": (f, args) => ({ argv: [ARGV_FLAG, Buffer.from(JSON.stringify(args), "utf8").toString("base64")], env: f.env }),
};

function run(f, way, args) {
  const { argv, env } = WAYS[way](f, args);
  const r = spawnSync(process.execPath, [BIN, ...argv], { env, encoding: "utf8", windowsHide: true });
  return { status: r.status, out: r.stdout + r.stderr };
}

for (const way of Object.keys(WAYS)) {
  test(`"caption this clip" ${way}: burn.py gets the clip and no --godspeed, with the named mission control's look`, () => {
    const f = fixture();
    for (const word of ["captions", "caption"]) {
      const r = run(f, way, [word, f.clip, "--godspeed", f.wired]);
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(recorded(f), { ran: "burn.py", args: ["captions", f.clip], style: path.join(f.wired, "video", "caption-style.json") }, word);
    }
    const r = run(f, way, ["captions", f.clip, "--language", "de", `--godspeed=${f.wired}`]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(recorded(f).args, ["captions", f.clip, "--language", "de"]);
  });

  test(`"make the vertical cut with captions" ${way}`, () => {
    const f = fixture();
    const r = run(f, way, ["vertical", f.clip, "--captions", "--godspeed", f.wired]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(recorded(f).args, ["vertical", f.clip, "--captions"]);
  });

  test(`a HyperFrames command ${way} reaches HyperFrames without --godspeed`, () => {
    const f = fixture();
    const r = run(f, way, ["hyperframes", "render", "-o", "card.mp4", "--godspeed", f.wired]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(recorded(f), { ran: "hyperframes", args: ["render", "-o", "card.mp4"] });
  });
}

test("mc-video check looks at the mission control named with --godspeed", () => {
  const f = fixture();
  const r = run(f, "as given", ["check", "--godspeed", f.wired]);
  assert.ok(r.out.includes(`ok: godspeed ${f.wired}`), r.out);
  assert.ok(r.out.includes(`ok: caption look ${path.join(f.wired, "video", "caption-style.json")}`), r.out);
});

test("without --godspeed the caption look is still the one setup recorded", () => {
  const f = fixture();
  const r = run(f, "as given", ["captions", f.clip]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(recorded(f), { ran: "burn.py", args: ["captions", f.clip], style: null }, "the recorded mission control has no look");
});
