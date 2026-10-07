import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';

// The Linux service starts start.mjs with Restart=on-failure. Until 6 October 2026 a
// notebook killed by a signal (out of memory, kill -9) made start.mjs exit 0, so systemd
// saw a clean stop and never brought it back.
const writer=fileURLToPath(new URL('../scripts/native-start-script.mjs',import.meta.url));
function fixture(body){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-start-')),supervise=path.join(dir,'supervise.mjs'),start=path.join(dir,'start.mjs');
  fs.writeFileSync(supervise,body);
  spawnSync(process.execPath,[writer,start,supervise],{env:{...process.env,GODSPEED_WORKSPACE:dir,GODSPEED_PORT:'41995'},stdio:'inherit'});
  return {dir,start};
}
const run=start=>spawnSync(process.execPath,[start],{encoding:'utf8',env:{...process.env,GODSPEED_PORT:'1'}});

test('the notebook\'s own exit code comes back, with the installed settings',()=>{
  const {dir,start}=fixture("console.log(process.env.GODSPEED_WORKSPACE+' '+process.env.GODSPEED_PORT);process.exit(3);");
  const result=run(start);
  assert.equal(result.status,3);
  assert.equal(result.stdout.trim(),dir+' 41995','the settings written at install win over the caller\'s');
  assert.equal(run(fixture('process.exit(0);').start).status,0);
});

const posix={skip:process.platform==='win32'&&'signals are POSIX'};
test('a notebook killed by a signal is a failure the service restarts',posix,()=>{
  const result=run(fixture("process.kill(process.pid,'SIGKILL');setTimeout(()=>{},10000);").start);
  assert.equal(result.status,128+os.constants.signals.SIGKILL);
});

test('a stop the service asked for still ends cleanly',posix,async()=>{
  // The notebook takes the signal's default action, as a process with no handler does.
  const {start}=fixture("setInterval(()=>{},1000);console.log('up');");
  const child=spawn(process.execPath,[start],{stdio:['ignore','pipe','inherit']});
  await new Promise(resolve=>child.stdout.once('data',resolve));
  child.kill('SIGTERM');
  const [code]=await new Promise(resolve=>child.on('exit',(...a)=>resolve(a)));
  assert.equal(code,0);
});
