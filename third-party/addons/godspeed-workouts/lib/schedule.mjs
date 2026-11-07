// The hourly run, at the minute setup picked at random (Hevy asks that nobody polls at minute 0):
//   Linux server   a systemd timer and service as root (/etc/systemd/system/godspeed-workouts.{timer,service})
//   Linux desktop  the same as a user timer (~/.config/systemd/user)
//   macOS          a LaunchAgent with a calendar interval (~/Library/LaunchAgents/com.godspeed.workouts.plist)
//   Windows        a scheduled task "Godspeed Workouts", every hour from logon, no window
// A run that was missed (the machine was off) is made up at the next start. The file builders are
// pure (the tests read them); install and remove run the system's tools.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TASK = "Godspeed Workouts";
export const AGENT = "com.godspeed.workouts";
export const UNIT = "godspeed-workouts.service";
export const TIMER = "godspeed-workouts.timer";

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 60000, stdio: ["ignore", "pipe", "pipe"], ...opts });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error };
};

export function scheduleKind({ platform = process.platform, root = typeof process.getuid === "function" && process.getuid() === 0 } = {}) {
  if (platform === "win32") return "windows-task";
  if (platform === "darwin") return "launch-agent";
  return root ? "systemd-system" : "systemd-user";
}

const two = (n) => String(n).padStart(2, "0");
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const winQuote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
// systemd: see The Clerk's service.mjs. A list setting (ExecStart=, Environment=) reads quotes; a
// single-path setting (WorkingDirectory=) is the rest of the line, only % doubled.
const sdPath = (s) => String(s).replace(/%/g, "%%");
const sdQuote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export const runArgs = (p) => [p.script, "run", "--state", p.stateDir, "--scheduled"];

export function systemdService(p, { system = false } = {}) {
  return [
    "[Unit]",
    `Description=Godspeed Mission Control: workouts from Hevy into the notebook (godspeed-workouts ${p.version})`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=oneshot",
    ...(system ? [`Environment=${sdQuote(`HOME=${p.home || "/root"}`)}`] : []),
    `Environment=${sdQuote(`PATH=${p.path}`)}`,
    `EnvironmentFile=-${sdPath(`${p.stateDir}/service.env`)}`,
    `WorkingDirectory=${sdPath(p.stateDir)}`,
    `ExecStart=${[p.node, ...runArgs(p)].map(sdQuote).join(" ")}`,
    "Nice=10",
    "UMask=0077",
    "TimeoutStartSec=1800",
    "",
  ].join("\n");
}

export function systemdTimer(p) {
  return [
    "[Unit]",
    `Description=Godspeed Mission Control: workouts from Hevy, every hour at minute ${p.minute}`,
    "",
    "[Timer]",
    `OnCalendar=*-*-* *:${two(p.minute)}:${two(p.second || 0)}`,
    "Persistent=true",
    "AccuracySec=1s",
    `Unit=${UNIT}`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

export function launchAgentPlist(p) {
  const s = (v) => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${s(AGENT)}
  <key>ProgramArguments</key>
  <array>
    ${[p.node, ...runArgs(p)].map(s).join("\n    ")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>${s(p.path)}
  </dict>
  <key>WorkingDirectory</key>${s(p.stateDir)}
  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key><integer>${p.minute}</integer>
  </dict>
  <key>ProcessType</key>${s("Background")}
  <key>StandardOutPath</key>${s(path.join(p.stateDir, "run.out.log"))}
  <key>StandardErrorPath</key>${s(path.join(p.stateDir, "run.out.log"))}
</dict>
</plist>
`;
}

// The scheduled task, as Task Scheduler XML: from the next whole hour plus the minute, every hour,
// for as long as the person is logged on; a run missed is made up when they are back. conhost
// --headless gives node a console nobody sees, so no window opens.
export function windowsTaskXml(p, { now = new Date() } = {}) {
  const conhost = p.conhost !== undefined ? p.conhost : path.join(process.env.SystemRoot || "C:\\Windows", "System32", "conhost.exe");
  const args = runArgs(p).map(winQuote).join(" ");
  const command = conhost || p.node;
  const argline = conhost ? `--headless ${winQuote(p.node)} ${args}` : args;
  const user = p.user || `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`;
  const start = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(p.minute)}:${two(p.second || 0)}`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(`Godspeed Mission Control: workouts from Hevy into the notebook, every hour at minute ${p.minute} (godspeed-workouts ${p.version})`)}</Description>
    <URI>\\${xml(TASK)}</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${start}</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1H</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(command)}</Command>
      <Arguments>${xml(argline)}</Arguments>
      <WorkingDirectory>${xml(p.stateDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export function scheduleFiles(p) {
  if (p.kind === "launch-agent") return [path.join(p.home, "Library", "LaunchAgents", `${AGENT}.plist`)];
  const dir = p.kind === "systemd-system" ? "/etc/systemd/system" : p.kind === "systemd-user" ? path.join(p.home, ".config", "systemd", "user") : null;
  return dir ? [path.join(dir, UNIT), path.join(dir, TIMER)] : [];
}

// Installs (or replaces) the hourly run. Returns { ok, text }.
export function installSchedule(p) {
  if (p.kind === "windows-task") {
    const file = path.join(os.tmpdir(), `godspeed-workouts-task-${process.pid}.xml`);
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(windowsTaskXml(p), "utf16le")]));
    try {
      const c = run("schtasks", ["/Create", "/TN", TASK, "/XML", file, "/F"]);
      return c.status === 0 ? { ok: true, text: `scheduled task "${TASK}": every hour at minute ${p.minute}` } : { ok: false, text: `the scheduled task was refused: ${(c.stderr || c.stdout).trim()}` };
    } finally { fs.rmSync(file, { force: true }); }
  }
  if (p.kind === "launch-agent") {
    const [file] = scheduleFiles(p);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, launchAgentPlist(p));
    const uid = process.getuid?.() ?? 0;
    run("launchctl", ["bootout", `gui/${uid}/${AGENT}`]);
    let r = run("launchctl", ["bootstrap", `gui/${uid}`, file]);
    if (r.status !== 0) r = run("launchctl", ["load", "-w", file]);
    return r.status === 0 ? { ok: true, text: `LaunchAgent ${AGENT}: every hour at minute ${p.minute}` } : { ok: false, text: `the LaunchAgent did not load: ${(r.stderr || r.stdout).trim()}` };
  }
  const system = p.kind === "systemd-system";
  const [service, timer] = scheduleFiles(p);
  fs.mkdirSync(path.dirname(service), { recursive: true });
  fs.writeFileSync(service, systemdService(p, { system }));
  fs.writeFileSync(timer, systemdTimer(p));
  const sc = (...a) => run("systemctl", system ? a : ["--user", ...a]);
  sc("daemon-reload");
  const r = sc("enable", "--now", TIMER);
  if (r.status !== 0) return { ok: false, text: `${TIMER} did not start: ${(r.stderr || r.stdout).trim()}${system ? "" : " (a user timer needs a logged-in session; on a server run `loginctl enable-linger` for this account)"}` };
  sc("restart", TIMER); // a changed minute takes effect now
  return { ok: true, text: `${system ? "" : "user "}timer ${TIMER}: every hour at minute ${p.minute}` };
}

const commandFailure = (what, r) => ({ ok: false, text: `${what}: ${(r.stderr || r.stdout || r.error?.message || "the system command failed").trim()}` });
const missingWindowsTask = (r) => /the system cannot find the file specified\.?/i.test(`${r.stderr || ""}\n${r.stdout || ""}`);

export function removeSchedule(p, { runCommand = run } = {}) {
  if (p.kind === "windows-task") {
    const r = runCommand("schtasks", ["/Delete", "/TN", TASK, "/F"]);
    if (r.status === 0) return { ok: true, text: `scheduled task "${TASK}" removed` };
    if (missingWindowsTask(r)) return { ok: true, text: `no scheduled task "${TASK}" to remove` };
    return commandFailure(`the scheduled task "${TASK}" was not removed`, r);
  }
  const files = scheduleFiles(p).filter((f) => fs.existsSync(f));
  if (!files.length) return { ok: true, text: "no hourly run to remove" };
  if (p.kind === "launch-agent") {
    const uid = process.getuid?.() ?? 0;
    const r = runCommand("launchctl", ["bootout", `gui/${uid}/${AGENT}`]);
    if (r.status !== 0) {
      const fallback = runCommand("launchctl", ["unload", "-w", files[0]]);
      if (fallback.status !== 0) return commandFailure(`the LaunchAgent ${AGENT} was not unloaded`, fallback);
    }
  } else {
    const sc = (...a) => runCommand("systemctl", p.kind === "systemd-system" ? a : ["--user", ...a]);
    const r = sc("disable", "--now", TIMER);
    if (r.status !== 0) return commandFailure(`${TIMER} was not stopped`, r);
  }
  for (const f of files) fs.rmSync(f, { force: true });
  if (p.kind !== "launch-agent") runCommand("systemctl", p.kind === "systemd-system" ? ["daemon-reload"] : ["--user", "daemon-reload"]);
  return { ok: true, text: "the hourly run is removed" };
}

// For `status`: whether the hourly run is there, and when it runs next, as the system says.
export function scheduleStatus(p) {
  if (p.kind === "windows-task") {
    const r = run("schtasks", ["/Query", "/TN", TASK, "/FO", "LIST"]);
    if (r.status !== 0) return { installed: false, text: "no scheduled task" };
    const next = (r.stdout.match(/^Next Run Time:\s*(.+)$/m) || [])[1];
    return { installed: true, text: `scheduled task "${TASK}"${next ? `, next run ${next.trim()}` : ""}` };
  }
  const files = scheduleFiles(p);
  if (!files.length || !fs.existsSync(files[0])) return { installed: false, text: "no hourly run is installed" };
  if (p.kind === "launch-agent") return { installed: true, text: `LaunchAgent ${AGENT}` };
  const sc = (...a) => run("systemctl", p.kind === "systemd-system" ? a : ["--user", ...a]);
  const next = sc("show", TIMER, "--property=NextElapseUSecRealtime", "--value").stdout.trim();
  const active = sc("is-active", TIMER).stdout.trim();
  return { installed: true, text: `${TIMER} ${active || "unknown"}${next && next !== "n/a" ? `, next run ${next}` : ""}` };
}
