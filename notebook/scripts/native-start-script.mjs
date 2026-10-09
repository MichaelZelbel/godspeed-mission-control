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

export function startScript({node,supervise,env}){
  return `import {spawn} from 'node:child_process';import os from 'node:os';
const child=spawn(${JSON.stringify(node)},[${JSON.stringify(supervise)}],{stdio:'inherit',env:{...process.env,...${JSON.stringify(env)}}});
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;child.kill(signal);});
child.on('error',()=>process.exit(1));
child.on('exit',(code,signal)=>process.exit(signal?(stopping?0:128+(os.constants.signals[signal]||0)):(code??1)));
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
