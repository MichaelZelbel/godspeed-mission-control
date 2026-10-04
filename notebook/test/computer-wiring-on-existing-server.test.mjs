import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {installStarter} from '../core/starter-workspace.mjs';
const script=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-computer-wiring-')),root=path.join(base,'workspace'),home=path.join(base,'assistant');
  installStarter(root);return {root,home};
}
const wire=(root,home,computer)=>execFileSync(process.execPath,[script,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41990',GODSPEED_DEVICE:'local',GODSPEED_COMPUTER:computer},windowsHide:true});
const config=home=>fs.readFileSync(path.join(home,'config.yaml'),'utf8');

// Michael asked his assistant on the test server for a connection code and it
// had no such tool, because the computer connection was off. Switching it on is
// only half the answer: the tool was added to the assistant's configuration only
// when that configuration was being written for the first time, so a server that
// had already been set up could never gain it.
test('switching the computer connection on reaches a server that is already set up',()=>{
  const {root,home}=fixture();
  wire(root,home,'off');
  assert.doesNotMatch(config(home),/godspeed_computer/,'precondition: off means the tool is absent');
  assert.match(config(home),/mcp_servers:/,'precondition: the assistant is already configured');
  wire(root,home,'on');
  assert.match(config(home),/godspeed_computer:/,'the tool must appear once the connection is on');
  assert.match(config(home),/computer\/mcp\.js/,'and it must point at the computer program');
});

test('switching it back off takes the tool away again',()=>{
  const {root,home}=fixture();
  wire(root,home,'on');
  assert.match(config(home),/godspeed_computer:/);
  wire(root,home,'off');
  assert.doesNotMatch(config(home),/godspeed_computer/,'a connection that is off must not leave its tool behind');
  assert.match(config(home),/notebook:\s*\n\s+url: http:\/\/127\.0\.0\.1:41990\/mcp/,'the notebook connection stays');
});

test('wiring it twice does not add it twice',()=>{
  const {root,home}=fixture();
  wire(root,home,'on');wire(root,home,'on');
  assert.equal(config(home).match(/godspeed_computer:/g).length,1);
});
