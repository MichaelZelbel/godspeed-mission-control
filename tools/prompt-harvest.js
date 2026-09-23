#!/usr/bin/env node
/* prompt-harvest.js - the one thing that starts a prompt harvest, on any machine.
 *
 * This is the program the book means when it says "a program fills it". It runs once a day,
 * reads the conversation logs your AI tools keep on this computer, and writes the human turns
 * into prompts/archive/ inside your mission control. The installer puts it on this machine and schedules
 * it; you never run it by hand. What it writes and what it refuses to write: mc-prompt-archive
 * next to this file, and prompts/README.md in your mission control.
 *
 * WHY THIS FILE EXISTS. The harvester itself was fine and had been for a month. What was
 * broken was every way of starting it:
 *
 *   1. The only trigger was a Claude Code SessionEnd hook, and it ran `python`. There is no
 *      command called `python` on Debian, only `python3`. So on the server the hook ran, the
 *      command was not found, the hook reported nothing, and no prompt was ever harvested.
 *   2. A SessionEnd hook fires when a human ends a session in this folder. A laptop can go a
 *      fortnight without one while still writing session logs every day from other folders.
 *   3. Nothing pushed. A harvest on a machine nobody commits from stays on that machine, so
 *      the whole point (any AI, any machine, one searchable archive) never happened.
 *
 * So the trigger is not one mechanism, it is one PROGRAM with several callers: the daily
 * schedule the installer sets up on this computer, and a session-end hook as a bonus for long
 * sessions. They all land here, so there is one behaviour to fix and one place to fix it.
 *
 * Node, not Python, for one reason: node is already needed by the assistant this is installed
 * beside, and the interpreter this has to find on Windows is the very thing that was broken.
 * Finding python is now this program's job and it says so out loud when it cannot.
 *
 * Usage (the schedule does this for you; these are for proving something by hand):
 *   mc-prompt-harvest              harvest, commit, pull, push. Quiet unless something is wrong.
 *   mc-prompt-harvest --verbose    say what happened
 *   mc-prompt-harvest --no-push    harvest and commit only
 *   mc-prompt-harvest --once-a-day do nothing if it already ran today on this computer
 */

'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes('--verbose') || ARGS.includes('-v');
const NO_PUSH = ARGS.includes('--no-push');
const ONCE_A_DAY = ARGS.includes('--once-a-day');
const STAMP = path.join(os.homedir(), '.godspeed', 'prompt-harvest-last');

/* Per-device non-secret overrides, the same file scripts/secrets.{sh,ps1} read. Loaded here
 * because cron and a session-end hook get almost no environment, and the one variable that
 * matters is GODSPEED_MACHINE: without it a rented server files its prompts under its hosting
 * name, which tells you nothing when you go looking for where a prompt came from. */
(function loadDeviceEnv() {
  const p = path.join(os.homedir(), '.godspeed', 'device.env');
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch (_) { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.replace(/^\s*export\s+/, ''));
    if (!m || /^\s*#/.test(line)) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
})();

/* WHERE IS THE GODSPEED? This program is INSTALLED on the computer, like your assistant is, rather
 * than kept inside the folder it writes to. That is deliberate: your mission control is meant to be a
 * folder of text files you can read, and a Node program sitting in it would be the first thing
 * in there that is not one. It also means this cannot simply look one folder up to find the
 * godspeed, so it asks, in order:
 *
 *   1. GODSPEED_DIR, which the installer writes into ~/.godspeed/device.env when it wires this machine.
 *      This is the answer in every normal case, and it is why nothing here has to guess.
 *   2. The usual places, for a mission control that was moved or made by hand.
 *   3. The folder above this file, which is the right answer only when the program IS living
 *      inside a mission control. Kept so an older setup keeps working after an update.
 *
 * If none of them holds a mission control, that is said out loud rather than harvesting into thin air. */
/* WHAT MAKES A FOLDER A GODSPEED, and why this is not one folder name.
 *
 * Until 2026-08-29 this asked one question: does it contain `memory/`. On 2026-08-21 the mission control
 * renamed that folder to `observations/` and deleted the old name, and every machine stopped
 * harvesting the same day: the work PC, the server and the laptop all went quiet within a day
 * of each other and nothing said so, because the only place this failure is written down is a
 * warning on the standard error of a session-end hook nobody reads. It was found eight days
 * later, by hand.
 *
 * Two things made that possible and both are fixed here. The first is that a single hardcoded
 * folder name is a dependency on a layout the mission control is allowed to change, so the question is now
 * asked of several names, plus the file where a mission control declares its own folders. The second is
 * worse: the starter godspeed this kit INSTALLS ships `observations/` and no `memory/`, so the
 * harvester could not find the mission control the kit itself had just created. It was broken for every new
 * reader on day one, and the suite could not see it because the fixture built a `memory/` of its
 * own. test-prompt-archive.sh now builds the layout the kit really ships.
 *
 * An explicitly set GODSPEED_DIR is now believed rather than second-guessed. Michael's work PC had
 * GODSPEED_DIR=C:\godspeed set correctly in ~/.godspeed/device.env throughout, and this function overruled it
 * on the strength of a missing folder. If someone has said where their godspeed is, that is the
 * answer; guessing is only for when nobody has said. */
const GODSPEED_MARKERS = ['observations', 'profile', 'rules', 'prompts', 'memory'];
function looksLikeGodspeed(p) {
  try {
    if (!p) return false;
    if (fs.existsSync(path.join(p, 'scripts', 'config', 'mc-layout.json'))) return true;
    return GODSPEED_MARKERS.some(function (d) {
      try { return fs.statSync(path.join(p, d)).isDirectory(); } catch (_) { return false; }
    });
  } catch (_) { return false; }
}
function findGodspeed() {
  /* Said out loud beats inferred. Only the shape of the answer is checked: a GODSPEED_DIR that
   * names something which is not a directory at all is a typo worth reporting, not obeyed. */
  const told = process.env.GODSPEED_DIR;
  if (told) {
    try { if (fs.statSync(told).isDirectory()) return path.resolve(told); } catch (_) {}
    warn('GODSPEED_DIR is set to "' + told + '", which is not a folder I can open. Fix it in '
       + '~/.godspeed/device.env, or unset it and I will look in the usual places.');
  }
  const cands = [path.join(os.homedir(), 'godspeed'), '/root/godspeed', 'C:\\godspeed'];
  for (const c of cands) if (looksLikeGodspeed(c)) return path.resolve(c);
  const up = path.resolve(__dirname, '..');
  return looksLikeGodspeed(up) ? up : null;
}
const GODSPEED = findGodspeed();

/* The collector is the other half of this pair and travels with it, so look next to this file
 * first. The two fallbacks are for a mission control that still carries its own copy from before this
 * program was installed rather than kept in the folder. */
function findCollector() {
  const names = [path.join(__dirname, 'mc-prompt-archive')];
  if (GODSPEED) {
    names.push(path.join(GODSPEED, 'agents', 'mc-cli', 'mc-prompt-archive'));
    names.push(path.join(GODSPEED, 'bin', 'mc-prompt-archive'));
  }
  for (const n of names) { try { if (fs.statSync(n).isFile()) return n; } catch (_) {} }
  return null;
}

function say(msg) { if (VERBOSE) process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('prompt-harvest: ' + msg + '\n'); }

function run(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({ cwd: GODSPEED, encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: true }, opts || {}));
}

/* A python that exists AND runs. `py` on Windows and `python3` on Linux are the usual
 * answers, but Windows also ships a fake `python` that only opens the Microsoft Store, so
 * "the command resolved" is not the same as "the command works". Each candidate is asked to
 * print its version before it is trusted. */
function findPython() {
  const cands = [[process.env.GODSPEED_PYTHON, []], ['python3', []], ['python', []], ['py', ['-3']]];
  for (const [cmd, pre] of cands) {
    if (!cmd) continue;
    const r = run(cmd, pre.concat(['-c', 'print(1)']), { timeout: 30000 });
    if (r && r.status === 0 && String(r.stdout || '').trim() === '1') return { cmd, pre };
  }
  return null;
}

function today() { return new Date().toISOString().slice(0, 10); }

function alreadyRanToday() {
  try { return fs.readFileSync(STAMP, 'utf8').trim().slice(0, 10) === today(); } catch (_) { return false; }
}
function stampNow() {
  try {
    fs.mkdirSync(path.dirname(STAMP), { recursive: true });
    fs.writeFileSync(STAMP, new Date().toISOString() + '\n');
  } catch (_) { /* a stamp we cannot write only means we harvest more often than needed */ }
}

/* THE RECEIPT: every run says, in your mission control, whether it worked.
 *
 * WHY. Until 2026-08-29 the only thing a harvest put into the mission control was archived prompts, and
 * prompts are legitimately absent when there is nothing new to archive. So "ran and found
 * nothing" and "could not run at all" were the same thing to anyone looking, and the only
 * place a failure was written down was the standard error of a scheduled job, on the machine
 * it happened on. When this program went blind on 2026-08-21 it printed a correct and
 * specific sentence ninety times, into logs on three machines, and reached nobody. It took
 * eight days and a person to find.
 *
 * A machine writes only its own file, like its own month file next door, so two machines
 * harvesting at once still cannot collide. It goes inside prompts/archive/ so it rides the
 * commit rule this program already has and nothing else needs to change. One object rather
 * than an append-only log, because `git log` is the history and it is free.
 *
 * IT IS WRITTEN ON EVERY PATH OUT, INCLUDING THE FAILURES. That is the entire point.
 */
const MACHINE = (process.env.GODSPEED_MACHINE || os.hostname()).toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/* The last godspeed that worked, remembered on this machine. If mc-finding breaks tomorrow there
 * is no repository to write a receipt into, which is exactly when one is worth having, so a
 * failing run files its receipt in the mission control it used last. Used for the receipt only, never to
 * decide where to harvest: a remembered path is evidence about the past, not an instruction. */
const LAST_GODSPEED = path.join(os.homedir(), '.godspeed', 'prompt-harvest-godspeed');

function toolVersion() {
  /* Which copy of this pair is this machine running? These programs are INSTALLED, and an
   * installed program does not update itself, so "envy is still on the old harvester" has to
   * be readable from another machine or nobody will ever notice it. */
  try {
    const crypto = require('crypto'), h = crypto.createHash('sha256');
    h.update(fs.readFileSync(__filename));
    const c = findCollector();
    if (c) h.update(fs.readFileSync(c));
    return h.digest('hex').slice(0, 12);
  } catch (_) { return null; }
}

function receipt(fields) {
  let godspeed = GODSPEED;
  if (!godspeed) {
    /* The remembered godspeed has to STILL BE THERE. A path that has been moved or deleted is a
     * memory, not a place, and writing into it would quietly recreate a folder somebody got
     * rid of - mkdir -p is happy to build a whole tree out of a stale note to self. */
    try {
      const remembered = fs.readFileSync(LAST_GODSPEED, 'utf8').trim();
      if (remembered && fs.statSync(remembered).isDirectory()) godspeed = remembered;
    } catch (_) {}
  }
  if (!godspeed) return;                     // nowhere to file it. The stale receipt is the signal.
  const dir = path.join(godspeed, 'prompts', 'archive', 'status');
  const body = Object.assign({
    at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    machine: MACHINE,
    ok: false,
    godspeed: GODSPEED,
    added: 0,
    sources: null,
    error: null,
    tool_version: toolVersion()
  }, fields);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MACHINE + '.json'),
                     JSON.stringify(body, null, 2) + '\n');
  } catch (e) { warn('could not write the run receipt: ' + String(e.message || e)); }
  if (GODSPEED) { try { fs.writeFileSync(LAST_GODSPEED, GODSPEED + '\n'); } catch (_) {} }
}

/* How many rows the collector added, and which sources it could read, taken from its own
 * output rather than counted again here - two counters disagreeing is a bug you only meet on
 * the machine you are not sitting at. It prints "archived N prompts" and, when a source was
 * skipped, "not read, by your choice: <names>". */
function readHarvestOutput(out) {
  const s = String(out || '');
  const n = /archived\s+(\d+)\s+prompt/i.exec(s);
  const skipped = /not read, by your choice:\s*(.+)/i.exec(s);
  return {
    added: n ? Number(n[1]) : 0,
    skipped: skipped ? skipped[1].trim().split(/[,\s]+/).filter(Boolean) : []
  };
}

function main() {
  /* `--where` answers the one question this program used to get wrong in silence: which folder
   * do you think my mission control is? It writes nothing and changes nothing, so it is safe to run at any
   * time, it is what the suite uses to test mc-finding without starting a real harvest, and it
   * is the first thing to run when prompts stop appearing in the archive. */
  if (ARGS.includes('--where')) {
    if (GODSPEED) { process.stdout.write(GODSPEED + '\n'); return 0; }
    warn('I could not find your mission control folder. Set GODSPEED_DIR in ~/.godspeed/device.env to the folder '
       + 'your mission control is in, or run the installer again.');
    return 1;
  }

  /* A day this already ran is not a day nothing happened: the earlier run filed the receipt
   * and it still stands. Leaving it alone keeps `at` meaning "when this machine last did the
   * work", which is what the check on the other side reads. */
  if (ONCE_A_DAY && alreadyRanToday()) { say('already harvested today'); return 0; }

  if (!GODSPEED) {
    const msg = 'I could not find your mission control folder, so there is nowhere to file what you have '
      + 'typed. Set GODSPEED_DIR in ~/.godspeed/device.env to the folder your mission control is in, or run the '
      + 'installer again.';
    warn(msg);
    receipt({ error: msg });        // into the mission control this machine used last, if there was one
    return 1;
  }
  const collector = findCollector();
  if (!collector) {
    const msg = 'the collector (mc-prompt-archive) is not beside this program or in your '
      + 'godspeed, so nothing can be archived. Run the installer again to put it back.';
    warn(msg);
    receipt({ error: msg });
    return 1;
  }

  const py = findPython();
  if (!py) {
    // Loud, because this is not a quiet skip: this machine's prompts are being lost.
    const msg = 'no working python on this machine, so its prompts CANNOT be archived. '
      + 'Install Python 3 or set GODSPEED_PYTHON.';
    warn(msg);
    receipt({ error: msg });
    return 1;
  }

  /* Pull first. The harvester skips a prompt whose exact text is already in ANY machine's
   * file, so a current clone is what stops two machines archiving the same thing twice. */
  const pulled = run('git', ['pull', '--rebase', '--autostash', 'origin', 'main']);
  if (!pulled || pulled.status !== 0) say('pull failed (offline is fine): ' + String((pulled && pulled.stderr) || '').slice(0, 200));

  const h = run(py.cmd, py.pre.concat([collector, '--godspeed', GODSPEED, 'archive']));
  if (!h || h.status !== 0) {
    const msg = 'the harvester failed: '
      + String((h && (h.stderr || h.stdout)) || 'no output').slice(0, 400);
    warn(msg);
    receipt({ error: msg });
    return 1;
  }
  say(String(h.stdout || '').trim());
  stampNow();

  /* The run worked. Say so IN THE GODSPEED, before the commit, so the receipt is part of the same
   * commit as whatever was archived - and so a day with nothing to archive still commits the
   * one line that says this machine is alive and looking. A quiet day and a dead harvester
   * used to be the same picture from anywhere else. */
  const seen = readHarvestOutput(h.stdout);
  receipt({ ok: true, added: seen.added, sources: { skipped: seen.skipped } });

  /* Commit ONLY the archive path. `git commit -- <path>` ignores whatever else is staged, so
   * a harvest that fires while you are mid-edit can never carry your unfinished work into a
   * commit you did not write. The receipt lives inside this path on purpose. */
  const rel = path.join('prompts', 'archive');
  run('git', ['add', '--', rel]);
  const dirty = run('git', ['status', '--porcelain', '--', rel]);
  if (!String((dirty && dirty.stdout) || '').trim()) { say('nothing new to commit'); return 0; }

  const machine = MACHINE;
  const c = run('git', ['commit', '-m', 'Archive the prompts typed on ' + machine, '--', rel]);
  if (!c || c.status !== 0) { warn('commit failed: ' + String((c && (c.stderr || c.stdout)) || '').slice(0, 200)); return 1; }
  say('committed');

  if (NO_PUSH) return 0;
  let p = run('git', ['push', 'origin', 'main']);
  if (!p || p.status !== 0) {
    // Somebody else pushed while we worked. Rebase onto them and try once more; a second
    // failure is left alone, because the next run picks the commit up anyway.
    run('git', ['pull', '--rebase', '--autostash', 'origin', 'main']);
    p = run('git', ['push', 'origin', 'main']);
  }
  if (!p || p.status !== 0) { say('push did not go through; the commit is local and the next run will carry it'); return 0; }
  say('pushed');
  return 0;
}

process.exit(main());
