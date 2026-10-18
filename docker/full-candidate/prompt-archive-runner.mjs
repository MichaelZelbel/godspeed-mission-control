// The one-click server saves its conversations (12 October 2026). The Telegram chat with the
// owner's assistant lives in Hermes' own database in this container, and until this file nothing
// here ever copied it into the mission control: a reader who talks to their server from the phone
// had an empty conversation archive, and their assistant nothing to look back at. So the server
// runs the kit's harvest every hour, the way a computer runs it from its daily job, against its own
// Hermes home (HERMES_HOME) and its own folder (GODSPEED_WORKSPACE). It commits and sends what it
// saved once the folder has a backup (Settings, Connect record sync); before that the archive is
// complete in the folder and the backup's first commit carries it.
//
// Chats from before the first run stay out (the server has no "Your conversations" page to ask
// about them); every chat from then on is saved. GODSPEED_PROMPT_ARCHIVE=off in the assistant's
// ~/.godspeed/device.env stops it on this server.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const harvester=fileURLToPath(new URL('../../tools/prompt-harvest.js',import.meta.url));

// The device file the harvest reads (in the assistant's home, which is the data volume), told
// once that older chats on this server are not brought in. Never changes a line that is there.
export function recordServerChoice(home){
  const file=path.join(home,'.godspeed','device.env');
  let text='';try{text=fs.readFileSync(file,'utf8');}catch{}
  if(/^\s*GODSPEED_PROMPT_SOURCES=/m.test(text))return false;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.appendFileSync(file,(text&&!text.endsWith('\n')?'\n':'')+'GODSPEED_PROMPT_SOURCES=\n');
  return true;
}

export function startPromptArchive({env=process.env,spawnProcess=spawn,log=line=>console.log(line)}={}){
  const workspace=env.GODSPEED_WORKSPACE,home=env.HOME;
  if(!workspace||!home)return null;
  try{recordServerChoice(home);}catch(error){log('prompt archive: could not write the device file: '+error.message);}
  const seconds=(name,fallback)=>{const n=Number(env[name]);return Number.isFinite(n)&&n>0?n:fallback;};
  const every=seconds('GODSPEED_PROMPT_HARVEST_EVERY',3600)*1000,first=seconds('GODSPEED_PROMPT_HARVEST_FIRST',120)*1000;
  let running=false;
  const run=()=>{
    if(running)return;running=true;
    let child;
    try{
      child=spawnProcess(process.execPath,[harvester,'--verbose'],{stdio:['ignore','pipe','pipe'],env:{...env,GODSPEED_DIR:workspace,GODSPEED_MACHINE:env.GODSPEED_MACHINE||env.GODSPEED_DEVICE||'server'}});
    }catch(error){running=false;log('prompt archive: the harvest could not start: '+error.message);return;}
    const say=chunk=>{for(const line of String(chunk).split(/\r?\n/))if(line.trim())log('prompt archive: '+line);};
    child.stdout?.on('data',say);child.stderr?.on('data',say);
    child.on('error',error=>{running=false;log('prompt archive: the harvest could not start: '+error.message);});
    child.on('exit',()=>{running=false;});
  };
  const firstTimer=setTimeout(run,first),timer=setInterval(run,every);
  firstTimer.unref?.();timer.unref?.();
  return {run,stop(){clearTimeout(firstTimer);clearInterval(timer);}};
}
