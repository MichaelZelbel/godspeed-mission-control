import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {installStarter} from '../core/starter-workspace.mjs';
import {Store} from '../core/records/store.mjs';
const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));

// On a Mac or Linux the shared installer puts Hermes in ~/.hermes and adds the mail tool to its
// config.yaml (tools/mc-mail-wire.js, in this shape) before the notebook is wired. That made the
// mcp_servers section, holding only mc-mail, and until 18 October 2026 the notebook entry was
// written only when there was no such section: a fresh Ubuntu install had an assistant without
// notebook tools, which answered "make a note" with "your notebook is not connected".
const MAIL='  mc-mail:\n    command: /usr/bin/node\n    args:\n      - "/home/reader/.local/bin/mc-mail.js"\n      - "mcp"\n';
const HERMES=sections=>'model:\n  provider: auto\nterminal:\n  backend: local\n'+sections+'display:\n  compact: false\n';
function fixture(yaml){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-notebook-beside-mail-')),root=path.join(base,'workspace'),home=path.join(base,'assistant');
  installStarter(root);fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),yaml);return {root,home};
}
const wire=(root,home,device='local')=>execFileSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41991',GODSPEED_DEVICE:device,GODSPEED_COMPUTER:'off'},windowsHide:true});
const config=home=>fs.readFileSync(path.join(home,'config.yaml'),'utf8');
const servers=text=>text.match(/^mcp_servers:[^\n]*\n(?:[ \t]+[^\n]*\n|\n)*/m)?.[0]||'';

test('a config that already lists the mail tool gets the notebook beside it',()=>{
  const {root,home}=fixture(HERMES('mcp_servers:\n'+MAIL));
  wire(root,home);
  const text=config(home),section=servers(text);
  assert.equal(text.match(/^mcp_servers:/gm).length,1,'one mcp_servers section');
  assert.ok(section.includes(MAIL),'the mail tool is kept as it was');
  assert.match(section,/^  notebook:\n    url: http:\/\/127\.0\.0\.1:41991\/mcp\n/m,'the notebook is in the same section');
  assert.match(text,/^display:\n  compact: false\n/m,'the settings after it are untouched');
});

test('wiring again does not add the notebook twice',()=>{
  const {root,home}=fixture(HERMES('mcp_servers:\n'+MAIL));
  wire(root,home);const once=config(home);
  wire(root,home);
  assert.equal(config(home),once);
  assert.equal(once.match(/^  notebook:/gm).length,1);
});

test('on the server the added notebook entry carries the assistant\'s key',()=>{
  const {root,home}=fixture(HERMES('mcp_servers:\n'+MAIL));
  wire(root,home,'vps');
  const key=JSON.parse(fs.readFileSync(path.join(new Store(root).state,'assistant-mcp.json'),'utf8')).key;
  assert.ok(key,'the assistant has a key');
  const section=servers(config(home));
  assert.ok(section.includes(MAIL));
  assert.ok(section.includes(`  notebook:\n    url: http://127.0.0.1:41991/mcp\n    headers:\n      Authorization: ${JSON.stringify('Bearer '+key)}\n`),section);
  wire(root,home,'vps');
  assert.equal(config(home).match(/^  notebook:/gm).length,1);
  assert.equal(config(home).match(/Authorization:/g).length,1);
});

test('an empty mcp_servers: {} becomes a section holding the notebook',()=>{
  const {root,home}=fixture(HERMES('mcp_servers: {}\n'));
  wire(root,home);
  const text=config(home);
  assert.doesNotMatch(text,/\{\}/);
  assert.match(servers(text),/^mcp_servers:\n  notebook:\n    url: http:\/\/127\.0\.0\.1:41991\/mcp\n/m);
});

test('a config written with Windows line endings gets the notebook too',()=>{
  const {root,home}=fixture(HERMES('mcp_servers:\n'+MAIL).replace(/\n/g,'\r\n'));
  wire(root,home);
  const text=config(home);
  assert.equal(text.match(/^  notebook:/gm).length,1);
  assert.match(text,/^  mc-mail:\r?\n[\s\S]*"mcp"\r?\n  notebook:\n    url: http:\/\/127\.0\.0\.1:41991\/mcp\n/m);
  wire(root,home);
  assert.equal(config(home).match(/^  notebook:/gm).length,1);
});

test('an older godspeed entry beside the mail tool is renamed, not doubled',()=>{
  const {root,home}=fixture(HERMES('mcp_servers:\n'+MAIL+'  godspeed:\n    url: http://127.0.0.1:47000/mcp\n'));
  wire(root,home);
  const section=servers(config(home));
  assert.ok(section.includes(MAIL));
  assert.doesNotMatch(section,/godspeed:/);
  assert.equal(section.match(/^  notebook:/gm).length,1);
  assert.match(section,/^  notebook:\n    url: http:\/\/127\.0\.0\.1:41991\/mcp\n/m);
});
