import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { systemdService, systemdTimer, launchAgentPlist, windowsTaskXml, scheduleKind, scheduleFiles, removeSchedule } from "../lib/schedule.mjs";
import { randomMinute } from "../lib/settings.mjs";

const p = { node: "/usr/bin/node", script: "/usr/local/lib/godspeed-workouts/bin/godspeed-workouts.mjs", stateDir: "/var/lib/godspeed/workouts", version: "0.1.0", minute: 7, second: 42, path: "/usr/bin:/bin", home: "/root" };

test("the minute is never 0 and never 59, whatever the dice say", () => {
  assert.deepEqual(randomMinute(() => 0), { minute: 1, second: 0 });
  assert.equal(randomMinute(() => 0.99999).minute, 58);
  for (let i = 0; i < 2000; i++) { const m = randomMinute().minute; assert.ok(m >= 1 && m <= 58); }
});

test("systemd: a oneshot service and an hourly timer at the minute, made up after a stop", () => {
  const svc = systemdService(p, { system: true });
  assert.match(svc, /^Type=oneshot$/m);
  assert.match(svc, /^ExecStart="\/usr\/bin\/node" "\/usr\/local\/lib\/godspeed-workouts\/bin\/godspeed-workouts.mjs" "run" "--state" "\/var\/lib\/godspeed\/workouts" "--scheduled"$/m);
  assert.match(svc, /^UMask=0077$/m);
  assert.match(svc, /^EnvironmentFile=-\/var\/lib\/godspeed\/workouts\/service.env$/m);
  const t = systemdTimer(p);
  assert.match(t, /^OnCalendar=\*-\*-\* \*:07:42$/m);
  assert.match(t, /^Persistent=true$/m);
  assert.match(t, /^WantedBy=timers.target$/m);
  assert.deepEqual(scheduleFiles({ ...p, kind: "systemd-system" }), ["/etc/systemd/system/godspeed-workouts.service", "/etc/systemd/system/godspeed-workouts.timer"].map((f) => f.replace(/\//g, require_sep())));
});
function require_sep() { return process.platform === "win32" ? "\\" : "/"; }

test("macOS: a LaunchAgent at that minute of every hour; Windows: a task every hour from that minute", () => {
  const plist = launchAgentPlist(p);
  assert.match(plist, /<key>StartCalendarInterval<\/key>\s*<dict>\s*<key>Minute<\/key><integer>7<\/integer>/);
  assert.doesNotMatch(plist, /KeepAlive|RunAtLoad/);
  const xml = windowsTaskXml({ ...p, node: "C:\\node\\node.exe", script: "C:\\gw\\bin\\godspeed-workouts.mjs", stateDir: "C:\\Users\\a\\.godspeed\\workouts", user: "PC\\a", conhost: "C:\\Windows\\System32\\conhost.exe" }, { now: new Date(2026, 9, 24, 13, 50) });
  assert.match(xml, /<StartBoundary>2026-10-24T13:07:42<\/StartBoundary>/);
  assert.match(xml, /<Interval>PT1H<\/Interval>/);
  assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(xml, /--headless &quot;C:\\node\\node.exe&quot; &quot;C:\\gw\\bin\\godspeed-workouts.mjs&quot; &quot;run&quot;/);
  assert.equal(scheduleKind({ platform: "linux", root: true }), "systemd-system");
  assert.equal(scheduleKind({ platform: "linux", root: false }), "systemd-user");
  assert.equal(scheduleKind({ platform: "darwin" }), "launch-agent");
  assert.equal(scheduleKind({ platform: "win32" }), "windows-task");
});

test("removing a schedule reports every platform command refusal", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-workouts-schedule-"));
  try {
    const refused = () => ({ status: 1, stderr: "scheduler refused removal" });
    const windows = removeSchedule({ ...p, kind: "windows-task" }, { runCommand: refused });
    assert.equal(windows.ok, false);
    assert.match(windows.text, /scheduler refused removal/);
    for (const kind of ["launch-agent", "systemd-user"]) {
      const options = { ...p, kind, home };
      const files = scheduleFiles(options);
      fs.mkdirSync(path.dirname(files[0]), { recursive: true });
      for (const file of files) fs.writeFileSync(file, "scheduled");
      const result = removeSchedule(options, { runCommand: refused });
      assert.equal(result.ok, false, kind);
      assert.ok(files.every(fs.existsSync), kind);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
