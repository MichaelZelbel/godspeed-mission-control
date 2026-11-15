import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// start.mjs, the one program the Linux service (or the reader, without systemd)
// starts: the installed Node.js runs supervise.mjs of the installed version with the
// notebook's settings. A notebook killed by a signal (out of memory, kill -9) has
// failed, so it exits the way a shell reports that, 128 plus the signal's number,
// and systemd's Restart=on-failure brings it back. Until 6 October 2026 such a death
// counted as a clean exit and the notebook stayed down. A stop the service asked
// for (SIGTERM or SIGINT, passed on to the notebook) still ends cleanly.
// GODSPEED_WEB_PORT and GODSPEED_HOST are a server's: its web door, and the name its web
// address has, which a later installation keeps (install-native-notebook.sh).
// GODSPEED_WEB_ADDRESS is that whole address, which the notebook gives an assistant asked
// for the link to it (core/notebook-address.mjs).
export const NAMES=['GODSPEED_WORKSPACE','GODSPEED_ORIGINAL_RUNTIME','GODSPEED_PORT','GODSPEED_BIND','HERMES_HOME','GODSPEED_DEVICE','GODSPEED_MEDIA_ROOT','GODSPEED_WEB_PORT','GODSPEED_HOST','GODSPEED_WEB_ADDRESS'];

// The Update now button (core/update.mjs) cannot stop and start the service it runs in: that needs
// the administrator, and the service's stop ends every program the notebook started. So start.mjs
// takes the new version over, in three steps around restarts the service makes by itself when
// start.mjs ends with an error (75; systemd's Restart=on-failure, launchd's KeepAlive):
//   SIGUSR2      the new version is ready beside this one (.godspeed/update/switch.json): stop
//   switch.json  before any notebook starts, the new version's installer switches the folder over
//                (GODSPEED_UPDATE_MODE=switch) and leaves trial.json; with none, this version runs on
//   trial.json   the new notebook must answer its own /health within two minutes; then the update
//                is finished (godspeed.mjs update --settle), else the version before is put back
// GODSPEED_HANDOVER=1 tells the notebook its start.mjs does this, so Settings may offer the button.
export const SWITCH=75;
export function startScript({node,supervise,env}){
  return `import {spawn,spawnSync} from 'node:child_process';import os from 'node:os';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const node=${JSON.stringify(node)},supervise=${JSON.stringify(supervise)},settings=${JSON.stringify(env)};
const root=path.resolve(settings.GODSPEED_WORKSPACE||process.env.GODSPEED_WORKSPACE||'.'),runtime=path.join(root,'.godspeed','integrated-runtime'),update=path.join(root,'.godspeed','update');
const at=name=>path.join(update,name),commit=/^[0-9a-f]{40}$/;
const read=name=>{try{return JSON.parse(fs.readFileSync(at(name),'utf8'));}catch{return null;}};
const status=(state,message)=>{try{fs.writeFileSync(at('status.json'),JSON.stringify({...read('status.json'),state,message,at:new Date().toISOString()},null,2)+'\\n');}catch{}};
const log=()=>fs.openSync(at('update.log'),'a');
try{fs.mkdirSync(update,{recursive:true});fs.writeFileSync(at('start.pid'),String(process.pid));}catch{}
const handover=read('switch.json');
if(handover){
  fs.rmSync(at('switch.json'),{force:true});
  if(commit.test(handover.commit||'')){
    const out=log();
    spawnSync('bash',[path.join(runtime,'versions',handover.commit,'notebook','scripts','install-native-notebook.sh'),root],{stdio:['ignore',out,out],env:{...process.env,...handover.env,GODSPEED_UPDATE_MODE:'switch',GODSPEED_PRODUCT_REF:handover.commit}});
    fs.closeSync(out);
  }
  if(read('trial.json'))process.exit(${SWITCH});
  status('failed','The new version could not be switched in, so the version that ran before is running. What went wrong is in '+at('update.log')+'.');
}
const trial=read('trial.json');
let phase=trial&&commit.test(trial.from||'')&&commit.test(trial.to||'')?'trial':'running';
const child=spawn(node,[supervise],{stdio:'inherit',env:{...process.env,...settings,GODSPEED_HANDOVER:'1'}});
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;child.kill(signal);});
process.on('SIGUSR2',()=>{phase='switching';child.kill('SIGTERM');});
child.on('error',()=>process.exit(1));
child.on('exit',(code,signal)=>{
  if(phase==='switching')return process.exit(${SWITCH});
  if(phase==='trial'&&!stopping)return putBack();
  if(phase==='putting back')return;
  process.exit(signal?(stopping?0:128+(os.constants.signals[signal]||0)):(code??1));
});
function putBack(){
  phase='putting back';
  const before=path.join(runtime,'versions',trial.from,'notebook','scripts');
  fs.writeFileSync(path.join(runtime,'version'),trial.from+'\\n');
  spawnSync(node,[path.join(before,'native-start-script.mjs'),fileURLToPath(import.meta.url),path.join(before,'supervise.mjs')],{env:{...process.env,...settings}});
  fs.rmSync(at('trial.json'),{force:true});
  status('failed','The new version did not start, so the version that ran before is running again. Your data backup is at: '+trial.backup);
  if(child.exitCode===null&&child.signalCode===null){child.once('exit',()=>process.exit(${SWITCH}));child.kill('SIGTERM');}else process.exit(${SWITCH});
}
if(phase==='trial')(async()=>{
  const own=crypto.createHash('sha256').update(root).digest('hex').slice(0,24),until=Date.now()+120000;
  const answers=()=>fetch('http://127.0.0.1:'+(settings.GODSPEED_PORT||47831)+'/health').then(r=>r.ok?r.json():null).then(h=>h?.ok===true&&h.instance===own,()=>false);
  while(phase==='trial'&&Date.now()<until){
    if(await answers()){
      phase='running';fs.rmSync(at('trial.json'),{force:true});
      const out=log();
      spawn(node,[path.join(runtime,'versions',trial.to,'notebook','bin','godspeed.mjs'),'update','--settle',...(trial.backup?['--made',trial.backup]:[])],{stdio:['ignore',out,out],env:{...process.env,...settings}}).on('error',()=>{});
      fs.closeSync(out);return;
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(phase==='trial')putBack();
})();
`;
}

// node native-start-script.mjs <start.mjs> <supervise.mjs>, with the settings in
// the environment.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [file,supervise]=process.argv.slice(2);
  if(!file||!supervise)throw Error('Name the start file and the supervisor');
  const env=Object.fromEntries(NAMES.filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]]));
  fs.writeFileSync(file,startScript({node:process.execPath,supervise,env}),{mode:0o600});fs.chmodSync(file,0o600);
}
