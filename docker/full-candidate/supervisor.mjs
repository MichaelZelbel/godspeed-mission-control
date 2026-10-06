import {spawn} from 'node:child_process';
import {TelegramRunner} from './telegram-runner.mjs';
const children=[];let telegram=null;
function start(file){const child=spawn(process.execPath,[file],{stdio:'inherit',env:process.env});children.push(child);child.on('exit',code=>{telegram?.end();for(const other of children)if(other!==child)other.kill('SIGTERM');process.exitCode=code||0;});return child;}
if(process.env.GODSPEED_COMPUTER==='on')start('/opt/godspeed/kit/computer/relay.js');
start('/opt/godspeed/kit/notebook/scripts/supervise.mjs');
// GODSPEED_TELEGRAM=on: the operator's own bot from the environment (the development server).
// off: no Telegram. Anything else: the owner connects a bot from the web page (telegram-runner.mjs).
if(process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&process.env.GODSPEED_TELEGRAM==='on'&&process.env.GODSPEED_CANDIDATE_BOT_TOKEN){
 const gateway=spawn('/opt/hermes/bin/hermes',['gateway','run'],{stdio:'inherit',env:{...process.env,TELEGRAM_BOT_TOKEN:process.env.GODSPEED_CANDIDATE_BOT_TOKEN,TELEGRAM_ALLOWED_USERS:process.env.GODSPEED_CANDIDATE_BOT_OWNER,TELEGRAM_HOME_CHANNEL:process.env.GODSPEED_CANDIDATE_BOT_OWNER}});
 children.push(gateway);gateway.on('exit',code=>{for(const other of children)if(other!==gateway)other.kill('SIGTERM');process.exitCode=code||1;});
}else if(process.env.GODSPEED_ORIGINAL_RUNTIME==='on'&&process.env.GODSPEED_TELEGRAM!=='off'&&process.env.GODSPEED_TELEGRAM_DIR){
 telegram=new TelegramRunner({dir:process.env.GODSPEED_TELEGRAM_DIR}).begin();
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{telegram?.end(signal);for(const child of children)child.kill(signal);});
