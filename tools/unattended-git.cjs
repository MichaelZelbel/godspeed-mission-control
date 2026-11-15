#!/usr/bin/env node
'use strict';
/* EVERY GIT CALL NOBODY IS WATCHING TAKES ITS ENVIRONMENT FROM HERE (4 November 2026).
 * On 3 November a Windows computer showed GitHub sign-in windows while nobody sat at it: Git
 * Credential Manager opens a window when a credential is missing unless it is told not to. Every
 * unattended Git call therefore runs with GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=Never (and the
 * Windows long-paths flag the record sync already used). Which credential is read does not change;
 * only the asking does. A failure for lack of a sign-in becomes one notice a day, through
 * notebook/core/notices.mjs, that names Connect in Settings.
 * The one place allowed to open a sign-in page is Connect (notebook/core/sync/github-sign-in.mjs),
 * and a spawn there, or any other run by a person, carries a "A person is present:" comment.
 * It is CommonJS and lives in tools/ because kit-bootstrap installs every file of tools/, the tools
 * are copied away from notebook/, and their CI's Node 20 cannot require() ESM. The notebook's ESM
 * loads it with createRequire.
 * Command form, for shell and Python: node unattended-git.cjs [--tell <mission control>] <git args> */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const SIGN_IN_WORDS = 'This computer is not signed in to GitHub, so what it saves stays on it and is not sent to your private repository; to sign it in, open Settings in the notebook and press Connect record sync.';
const SIGN_IN_FAILURE = /terminal prompts disabled|could not read (Username|Password)|Authentication failed for|user interactivity has been disabled|Invalid username or (password|token)|Password authentication is not supported/i;
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' };

/* [command, args, options] to spread into spawnSync, execFileSync, execFile or promisify(execFile). */
function quietGit(args, options = {}, platform = process.platform) {
  const env = Object.assign({}, options.env || process.env);
  for (const key of Object.keys(env)) if (Object.keys(NO_PROMPT).some((k) => k === key.toUpperCase())) delete env[key];
  Object.assign(env, NO_PROMPT);
  return ['git', platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : args, Object.assign({ windowsHide: true }, options, { env })];
}

function signInMissing(output) { return SIGN_IN_FAILURE.test(String(output || '')); }

function signInNotice(now = new Date()) { return { id: 'git-sign-in-' + now.toISOString().slice(0, 10), text: SIGN_IN_WORDS }; }

/* Queues the day's notice in a mission control; false when nobody reads notices there (no
 * .godspeed) or the tools were copied away from the notebook. */
async function tellSignInMissing(missionControl, { now } = {}) {
  if (!missionControl) return false;
  const state = path.join(missionControl, '.godspeed');
  const notices = path.join(__dirname, '..', 'notebook', 'core', 'notices.mjs');
  if (!fs.existsSync(state) || !fs.existsSync(notices)) return false;
  const { queueNotice } = await import(pathToFileURL(notices).href);
  return queueNotice({ state }, signInNotice(now));
}

async function main(argv) {
  let tell = '';
  if (argv[0] === '--tell') { tell = argv[1] || ''; argv = argv.slice(2); }
  const [cmd, args, options] = quietGit(argv, { stdio: ['inherit', 'inherit', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  const r = spawnSync(cmd, args, options);
  // Written synchronously: on Windows a pipe write through process.stderr can be cut off at exit.
  if (r.stderr && r.stderr.length) fs.writeSync(2, r.stderr);
  if (r.error) { process.exitCode = 127; return; }
  process.exitCode = r.status === null ? 1 : r.status;
  if (tell && r.status !== 0 && signInMissing(r.stderr)) { try { await tellSignInMissing(tell); } catch (_) {} }
}

module.exports = { quietGit, signInMissing, signInNotice, tellSignInMissing, SIGN_IN_WORDS };

if (require.main === module) main(process.argv.slice(2));
