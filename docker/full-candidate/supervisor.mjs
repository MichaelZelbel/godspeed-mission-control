import {spawn} from 'node:child_process';
const children=[];
function start(file){const child=spawn(process.execPath,[file],{stdio:'inherit',env:process.env});children.push(child);child.on('exit',code=>{for(const other of children)if(other!==child)other.kill('SIGTERM');process.exitCode=code||0;});return child;}
if(process.env.GODSPEED_COMPUTER==='on')start('/opt/godspeed/kit/computer/relay.js');
start('/opt/godspeed/kit/notebook/server/main.mjs');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const child of children)child.kill(signal);});
