import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
// FULL-ALPHA.md was written once and never updated, so machines kept saying
// records/ and forbade the owner's own Git (6 October 2026).
test('an earlier generated FULL-ALPHA.md is brought up to date, an edited one is left alone',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-contract-')),file=path.join(root,'FULL-ALPHA.md'),cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url));
  const init=()=>execFileSync(process.execPath,['--no-warnings',cli,'init'],{env:{...process.env,GODSPEED_WORKSPACE:root},windowsHide:true});
  fs.writeFileSync(file,'# Integrated notebook\n\nThis is the complete Godspeed Mission Control starter with an integrated notebook. AGENTS.md and the original folder workflow remain the operating manual. Notebook records live in records/ alongside those folders. Use the notebook or its MCP tools for notebook edits; use the original commands and readable files for Godspeed work. Credentials and disposable SQLite indexes stay in .godspeed and never enter private Git sync. Connected file sync uses the conflict-preserving reconciler; do not run a second Git synchronizer on the same workspace.\n');
  init();const text=fs.readFileSync(file,'utf8');
  assert.match(text,/live in notebook\//);assert.doesNotMatch(text,/records\//);assert.match(text,/your commits and pushes go on as before/);
  fs.writeFileSync(file,'My own notes about this folder.\n');init();
  assert.equal(fs.readFileSync(file,'utf8'),'My own notes about this folder.\n');
});
