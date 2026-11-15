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

// The Update now button's hand-over (#456): start.mjs stops on SIGUSR2 with 75, which the service
// manager restarts; a restart finds the new version ready (switch.json), lets its installer switch
// the folder over, and tries the new notebook (trial.json), putting the version before back when the
// new one does not answer.
const A='a'.repeat(40),B='b'.repeat(40);
const exited=child=>new Promise(resolve=>child.on('exit',code=>resolve(code)));
const update=dir=>path.join(dir,'.godspeed','update'),runtime=dir=>path.join(dir,'.godspeed','integrated-runtime');
const status=dir=>JSON.parse(fs.readFileSync(path.join(update(dir),'status.json'),'utf8'));
// Two versions side by side, each with a supervisor and the start script writer of this checkout.
function versions(dir,{newSupervisor='process.exit(1);',installer=''}={}){
  for(const [code,body] of [[A,"console.log('old '+process.env.GODSPEED_HANDOVER);setInterval(()=>{},1000);"],[B,newSupervisor]]){
    const scripts=path.join(runtime(dir),'versions',code,'notebook','scripts');fs.mkdirSync(scripts,{recursive:true});
    fs.writeFileSync(path.join(scripts,'supervise.mjs'),body);fs.copyFileSync(writer,path.join(scripts,'native-start-script.mjs'));
    fs.writeFileSync(path.join(scripts,'install-native-notebook.sh'),installer);
  }
  fs.writeFileSync(path.join(runtime(dir),'version'),A+'\n');
}

test('SIGUSR2 stops the notebook and ends with 75, and the notebook is told its start.mjs can hand over',posix,async()=>{
  const {start}=fixture("console.log(process.env.GODSPEED_HANDOVER);setInterval(()=>{},1000);");
  const child=spawn(process.execPath,[start],{stdio:['ignore','pipe','inherit']});
  const said=await new Promise(resolve=>child.stdout.once('data',resolve));
  assert.equal(String(said).trim(),'1');
  child.kill('SIGUSR2');
  assert.equal(await exited(child),75);
});

test('a new version the installer cannot switch in leaves the version before running',posix,async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-start-switch-'));versions(dir,{installer:'exit 1\n'});
  const start=path.join(runtime(dir),'start.mjs');
  spawnSync(process.execPath,[writer,start,path.join(runtime(dir),'versions',A,'notebook','scripts','supervise.mjs')],{env:{...process.env,GODSPEED_WORKSPACE:dir}});
  fs.mkdirSync(update(dir),{recursive:true});fs.writeFileSync(path.join(update(dir),'switch.json'),JSON.stringify({commit:B,env:{}}));
  const child=spawn(process.execPath,[start],{stdio:['ignore','pipe','inherit']});
  assert.equal(String(await new Promise(resolve=>child.stdout.once('data',resolve))).trim(),'old 1');
  assert.equal(status(dir).state,'failed');assert.ok(!fs.existsSync(path.join(update(dir),'switch.json')),'it is tried once');
  child.kill('SIGTERM');assert.equal(await exited(child),0);
});

test('a switch that leaves a trial ends with 75, and a new notebook that dies in its trial is undone',posix,async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-start-trial-'));
  // The new version's installer in switch mode: the new start.mjs, the version file and the trial.
  versions(dir,{installer:[
    '[ "$GODSPEED_UPDATE_MODE" = switch ] && [ "$GODSPEED_PRODUCT_REF" = '+B+' ] || exit 1',
    'state="$1/.godspeed/integrated-runtime"',
    `GODSPEED_WORKSPACE="$1" GODSPEED_PORT=1 "${process.execPath}" "$state/versions/${B}/notebook/scripts/native-start-script.mjs" "$state/start.mjs" "$state/versions/${B}/notebook/scripts/supervise.mjs"`,
    'echo '+B+' > "$state/version"',
    `printf '{"from":"${A}","to":"${B}","backup":"/backups/one"}' > "$1/.godspeed/update/trial.json"`,'',
  ].join('\n')});
  const start=path.join(runtime(dir),'start.mjs');
  spawnSync(process.execPath,[writer,start,path.join(runtime(dir),'versions',A,'notebook','scripts','supervise.mjs')],{env:{...process.env,GODSPEED_WORKSPACE:dir,GODSPEED_PORT:'1'}});
  fs.mkdirSync(update(dir),{recursive:true});fs.writeFileSync(path.join(update(dir),'switch.json'),JSON.stringify({commit:B,env:{}}));
  assert.equal(spawnSync(process.execPath,[start],{encoding:'utf8'}).status,75,'the switched folder is started afresh');
  assert.match(fs.readFileSync(start,'utf8'),new RegExp('versions/'+B+'/'),'the new start.mjs starts the new version');
  // The service starts it again: the new notebook exits at once, so the version before comes back.
  assert.equal(spawnSync(process.execPath,[start],{encoding:'utf8'}).status,75);
  assert.equal(fs.readFileSync(path.join(runtime(dir),'version'),'utf8').trim(),A);
  assert.match(fs.readFileSync(start,'utf8'),new RegExp('versions/'+A+'/'),'start.mjs starts the version before again');
  assert.match(fs.readFileSync(start,'utf8'),/"GODSPEED_PORT":"1"/,'with the installation\'s settings');
  assert.ok(!fs.existsSync(path.join(update(dir),'trial.json')));
  assert.equal(status(dir).state,'failed');assert.match(status(dir).message,/the version that ran before is running again\. Your data backup is at: \/backups\/one/);
  const child=spawn(process.execPath,[start],{stdio:['ignore','pipe','inherit']});
  assert.equal(String(await new Promise(resolve=>child.stdout.once('data',resolve))).trim(),'old 1');
  child.kill('SIGTERM');await exited(child);
});
