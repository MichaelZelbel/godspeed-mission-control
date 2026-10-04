import {spawn} from 'node:child_process';
const children=[];
function start(file){const child=spawn(process.execPath,[file],{stdio:'inherit',env:process.env});children.push(child);child.on('exit',code=>{for(const other of children)if(other!==child)other.kill('SIGTERM');process.exitCode=code||0;});return child;}
if(process.env.GODSPEED_COMPUTER==='on')start('/opt/godspeed/kit/computer/relay.js');
start('/opt/godspeed/kit/notebook/scripts/supervise.mjs');
if(process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&process.env.GODSPEED_TELEGRAM==='on'&&process.env.GODSPEED_CANDIDATE_BOT_TOKEN){
 const gateway=spawn('/opt/hermes/bin/hermes',['gateway','run'],{stdio:'inherit',env:{...process.env,TELEGRAM_BOT_TOKEN:process.env.GODSPEED_CANDIDATE_BOT_TOKEN,TELEGRAM_ALLOWED_USERS:process.env.GODSPEED_CANDIDATE_BOT_OWNER,TELEGRAM_HOME_CHANNEL:process.env.GODSPEED_CANDIDATE_BOT_OWNER}});
 children.push(gateway);gateway.on('exit',code=>{for(const other of children)if(other!==gateway)other.kill('SIGTERM');process.exitCode=code||1;});
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const child of children)child.kill(signal);});
