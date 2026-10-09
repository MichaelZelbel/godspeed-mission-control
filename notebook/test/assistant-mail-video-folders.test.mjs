import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {assistantEnvironment} from '../core/assistant-files.mjs';
// The assistant and a terminal use one place for mail and for video (8 October 2026). Until then
// the assistant was sent to <folder>/.godspeed/device-home for mail and <folder>/.godspeed/video
// for video, so what a reader set up in a terminal, as the book teaches, was invisible to it.
function places(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed folders ')),home=path.join(base,'home'),workspace=path.join(base,'mission control');
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(workspace,{recursive:true});
  const env={PATH:process.env.PATH,[process.platform==='win32'?'USERPROFILE':'HOME']:home};
  return {base,home,workspace,env,assistant:()=>assistantEnvironment({home:path.join(base,'hermes'),workspace,env})};
}
test('mail is never redirected: the assistant reads the same home folder as a terminal',()=>{
  const p=places(),env=p.assistant();
  assert.equal(env.GODSPEED_MAIL_HOME,undefined);
  assert.equal(env[process.platform==='win32'?'USERPROFILE':'HOME'],p.home);
  // A setting the owner made on purpose still passes through.
  assert.equal(assistantEnvironment({home:path.join(p.base,'hermes'),workspace:p.workspace,env:{...p.env,GODSPEED_MAIL_HOME:path.join(p.base,'chosen')}}).GODSPEED_MAIL_HOME,path.join(p.base,'chosen'));
});
test('video: the home folder\'s kit wins; an assistant that set it up in the old place keeps it until then',()=>{
  const p=places();
  assert.equal(p.assistant().GODSPEED_VIDEO_HOME,undefined,'nothing set up anywhere: mc-video uses ~/.mc-video, like a terminal');
  const old=path.join(p.workspace,'.godspeed','video');fs.mkdirSync(path.join(old,'hyperframes'),{recursive:true});
  assert.equal(p.assistant().GODSPEED_VIDEO_HOME,old,'set up by the assistant before 8 October: still found');
  fs.mkdirSync(path.join(p.home,'.mc-video'),{recursive:true});
  assert.equal(p.assistant().GODSPEED_VIDEO_HOME,undefined,'set up in a terminal: the assistant uses that one');
  assert.equal(assistantEnvironment({home:path.join(p.base,'hermes'),workspace:p.workspace,env:{...p.env,GODSPEED_VIDEO_HOME:path.join(p.base,'chosen')}}).GODSPEED_VIDEO_HOME,path.join(p.base,'chosen'));
});
