import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {passedEnvironment} from '../../notebook/core/assistant-files.mjs';
import {notebookAddress} from '../../notebook/core/notebook-address.mjs';
import {REQUEST_FILE,REQUEST_MINUTES,FLOW_STATE as BACKUP_STATE} from '../../notebook/core/backup-request.mjs';
const HANDOVER_MS=4000;

// Telegram on the one-click server, switched on from the web page instead of a redeploy.
// The page (notebook/server/telegram-connect.mjs) writes the bot's key to
// GODSPEED_TELEGRAM_DIR/connection.json; this runner sees it within two seconds and starts
// the setup chat (godspeed-telegram-setup, notebook flow) with the key and the one-time
// start code. Once its owner has finished the chat (setup.json says done), it starts Hermes'
// gateway with that bot instead. Never both at once: Telegram hands a bot's messages to one
// reader. A program that stops is started again after a pause that grows to five minutes,
// and a Telegram problem never takes the notebook down with it.
const kit=fileURLToPath(new URL('../../',import.meta.url));
const digest=(...parts)=>createHash('sha256').update(parts.map(String).join('\n')).digest('hex').slice(0,16);
// Where the owner opens the notebook, for the chat's last message (since 16 October 2026): the
// address the server knows for itself (GODSPEED_WEB_ADDRESS, which docker/server/install.sh and
// Hostinger's compose.yaml set, or the Hostinger hostname), else the one the setup page was opened
// at. An address that opens only on this machine is no use on a phone, so none is given then.
const loopback=link=>{try{return ['127.0.0.1','localhost','[::1]','::1','0.0.0.0'].includes(new URL(link).hostname);}catch{return true;}};
// The zone on the top-level timezone line of Hermes' config.yaml, "" for none, null without a file.
export function hermesZone(home){try{return fs.readFileSync(path.join(home,'config.yaml'),'utf8').match(/^timezone:[ \t]*["']?([^"'#\s]*)/m)?.[1]??'';}catch{return null;}}
export function notebookLink(env,connection,address=notebookAddress){
  let own=null;try{own=address({env}).link;}catch{}
  if(own&&!loopback(own))return own;
  const seen=connection?.web_address?connection.web_address.replace(/\/+$/,'')+'/dashboard':null;
  return seen&&!loopback(seen)?seen:'';
}

export class TelegramRunner{
  constructor({dir,env=process.env,spawnProcess=spawn,interval=2000,now=Date.now,kill=(pid,signal)=>process.kill(-pid,signal),
    python=env.GODSPEED_TG_PYTHON||'/opt/hermes/.venv/bin/python3',hermes=env.GODSPEED_TG_HERMES_BIN||'/opt/hermes/bin/hermes',
    setup=path.join(kit,'docker/rootfs/usr/local/bin/godspeed-telegram-setup'),finish=path.join(kit,'notebook/scripts/telegram-setup-finish.mjs'),
    backup=path.join(kit,'notebook/scripts/backup-ai.mjs'),address=notebookAddress}={}){
    Object.assign(this,{dir,env,spawnProcess,interval,now,kill,python,hermes,setup,finish,backup,address});
    this.child=null;this.failures=0;this.notBefore=0;this.lastKey=null;this.lastExit=null;
  }
  read(name){try{return JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8'));}catch{return null;}}
  // What should run now, from the two files alone, so a restarted container picks up the same.
  // THE BACKUP AI CHAT (22 October 2026): /backupai in Telegram, a Hermes quick command, leaves a
  // request (notebook/scripts/backup-ai.mjs telegram-request). A few seconds later, so the gateway
  // has sent its "one moment", the gateway stops and the setup program runs its backup flow with the
  // owner it already knows; once that flow says done for this request, the gateway takes the bot
  // again. A request older than REQUEST_MINUTES is ignored, so the assistant is never kept away
  // longer than that, whatever happens in the backup chat.
  backupRequest(){
    const request=this.read(REQUEST_FILE);if(!request?.id||!request.at)return null;
    const age=this.now()-Date.parse(request.at);
    if(!(age>=HANDOVER_MS&&age<REQUEST_MINUTES*60000))return null;
    const flow=this.read(BACKUP_STATE);
    return flow?.request===request.id&&flow.done?null:request;
  }
  plan(){
    const connection=this.read('connection.json');if(!connection?.token)return null;
    const setup=this.read('setup.json')||{};
    const owned=setup.done&&String(setup.bot_id)===String(connection.bot_id)&&setup.owner_id&&setup.chat_id;
    const request=owned?this.backupRequest():null;
    if(request)
      return {kind:'backup',key:'backup:'+request.id,command:this.python,args:[this.setup],
        env:{...this.env,PATH:path.dirname(this.python)+path.delimiter+(this.env.PATH||''),GODSPEED_TELEGRAM_TOKEN:connection.token,
          GODSPEED_TG_FLOW:'backup',GODSPEED_TG_HERMES:this.hermes,GODSPEED_TG_REQUEST:request.id,
          GODSPEED_TG_OWNER_ID:String(setup.owner_id),GODSPEED_TG_CHAT_ID:String(setup.chat_id),GODSPEED_TG_OWNER_NAME:String(setup.owner_name||''),
          GODSPEED_TG_STATE:path.join(this.dir,BACKUP_STATE),GODSPEED_TG_LOG:path.join(this.dir,'backup-setup.log'),
          GODSPEED_TG_BACKUP:`${JSON.stringify(process.execPath)} ${JSON.stringify(this.backup)}`}};
    if(owned)
      return {kind:'gateway',key:'gateway:'+digest(connection.token,setup.owner_id,setup.chat_id),command:this.hermes,args:['gateway','run'],
        // The assistant with tools sees only what passedEnvironment allows (assistant-files.mjs).
        env:{...passedEnvironment(this.env),TELEGRAM_BOT_TOKEN:connection.token,TELEGRAM_ALLOWED_USERS:String(setup.owner_id),TELEGRAM_HOME_CHANNEL:String(setup.chat_id)}};
    return {kind:'setup',key:'setup:'+digest(connection.token,connection.start_code),command:this.python,args:[this.setup],
      env:{...this.env,PATH:path.dirname(this.python)+path.delimiter+(this.env.PATH||''),GODSPEED_TELEGRAM_TOKEN:connection.token,
        GODSPEED_TELEGRAM_START_CODE:connection.start_code,GODSPEED_TG_FLOW:'notebook',GODSPEED_TG_HERMES:this.hermes,
        GODSPEED_TG_BROWSER_TZ:connection.timezone||'',GODSPEED_TG_NOTEBOOK_URL:notebookLink(this.env,connection,this.address),
        GODSPEED_TG_STATE:path.join(this.dir,'setup.json'),GODSPEED_TG_LOG:path.join(this.dir,'setup.log'),
        GODSPEED_TG_FINISH:`${JSON.stringify(process.execPath)} ${JSON.stringify(this.finish)}`}};
  }
  // A city named later in the getting-to-know-you chat (notebook/core/context-setup.mjs) changes
  // Hermes' clock, which a running gateway read once at its start (hermes_time keeps it), so "remind
  // me at 9:00" would still be read on the old clock. The gateway is started again, half a minute
  // after the change and only while that chat is not in the middle of an answer (16 October 2026).
  zoneChanged(){
    const home=this.env.HERMES_HOME;if(!home||this.child?.kind!=='gateway')return false;
    const zone=hermesZone(home);if(zone===null||zone===this.child.zone)return false;
    try{if(Date.now()-fs.statSync(path.join(home,'config.yaml')).mtimeMs<30000)return false;}catch{return false;}
    try{const chat=JSON.parse(fs.readFileSync(path.join(this.env.GODSPEED_WORKSPACE||'','.godspeed','context-setup.json'),'utf8'));if(Date.now()-Date.parse(chat.updated_at)<60000)return false;}catch{}
    return true;
  }
  tick(){
    const plan=this.plan();
    if(this.child){if(!plan||plan.key!==this.child.key||this.zoneChanged())this.stop();return;}
    if(!plan){this.report('idle');return;}
    if(plan.key!==this.lastKey){this.failures=0;this.notBefore=0;}
    if(this.now()<this.notBefore){this.report('waiting-to-retry');return;}
    this.start(plan);
  }
  start(plan){
    const started=this.now(),child=this.spawnProcess(plan.command,plan.args,{env:plan.env,stdio:'inherit',detached:true});
    this.child={key:plan.key,kind:plan.kind,process:child,started,stopping:false,zone:plan.kind==='gateway'&&this.env.HERMES_HOME?hermesZone(this.env.HERMES_HOME):undefined};this.lastKey=plan.key;
    this.report(plan.kind);
    const done=code=>{
      const ended=this.child;if(!ended||ended.process!==child)return;this.child=null;this.lastExit={kind:plan.kind,code,at:new Date(this.now()).toISOString()};
      // Finished on purpose (setup done, or stopped for a new key): no pause. Otherwise wait.
      const next=this.plan();
      if(ended.stopping||(code===0&&next?.key!==plan.key)){this.failures=0;this.notBefore=0;}
      else{this.failures=this.now()-started>60000?1:this.failures+1;this.notBefore=this.now()+Math.min(300000,5000*2**(this.failures-1));}
      this.report('stopped');
    };
    child.on('exit',done);child.on('error',()=>done(127));
  }
  stop(){
    if(!this.child||this.child.stopping)return;this.child.stopping=true;
    this.signal(this.child.process,'SIGTERM');
  }
  report(state){
    if(state===this.reported&&state!=='stopped')return;this.reported=state;
    try{fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
      fs.writeFileSync(path.join(this.dir,'runner.json'),JSON.stringify({state,pid:this.child?.process.pid||null,failures:this.failures,retry_at:this.notBefore?new Date(this.notBefore).toISOString():null,last_exit:this.lastExit,at:new Date(this.now()).toISOString()}),{mode:0o600});}catch{}
  }
  begin(){this.tick();this.timer=setInterval(()=>this.tick(),this.interval);return this;}
  end(signal='SIGTERM'){clearInterval(this.timer);if(this.child){this.child.stopping=true;this.signal(this.child.process,signal);}}
  // The whole process group, so the chat's short helper commands stop with it.
  signal(child,signal){try{this.kill(child.pid,signal);}catch{try{child.kill(signal);}catch{}}}
}
