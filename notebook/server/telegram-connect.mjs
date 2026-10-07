import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

// Telegram for the one-click server, connected from the web page after the account is made.
// The bot's key goes from the owner's browser to this server and nowhere else: it is checked
// with Telegram from here, kept in GODSPEED_TELEGRAM_DIR (mode 600, outside the notebook
// folder, so no sync can carry it) and never sent back to a browser or written to a log.
// The container's supervisor (docker/full-candidate/telegram-runner.mjs) watches that folder
// and runs the setup chat, then Hermes' gateway; nothing needs a redeploy or a terminal.
//
// Who owns the bot: whoever opens it from the link this page shows, which carries a one-time
// code. A bot's name can be found in Telegram's search, so "the first to press Start" was not
// enough for a server anybody can reach (decision D-291).
const KEY=/^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$/;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

export class TelegramConnection{
  constructor({dir=process.env.GODSPEED_TELEGRAM_DIR,mode=process.env.GODSPEED_TELEGRAM,environmentBot=!!process.env.GODSPEED_CANDIDATE_BOT_TOKEN,originalRuntime=process.env.GODSPEED_ORIGINAL_RUNTIME==='on',hermesHome=process.env.HERMES_HOME,api=process.env.GODSPEED_TELEGRAM_API||'https://api.telegram.org',fetcher=fetch}={}){
    Object.assign(this,{dir,mode,environmentBot,originalRuntime,hermesHome,api:api.replace(/\/+$/,''),fetcher});
  }
  // On a server whose operator set the bot in its environment, or switched Telegram off,
  // the page has nothing to connect. So does any install the supervisor does not run.
  get available(){return !!this.dir&&this.originalRuntime&&!['on','off'].includes(this.mode);}
  file(name){return path.join(this.dir,name);}
  read(name){try{return JSON.parse(fs.readFileSync(this.file(name),'utf8'));}catch{return null;}}
  status(){
    if(this.mode==='on'&&this.environmentBot)return {available:false,managed:'environment',connected:true,phase:'ready'};
    if(!this.available)return {available:false,managed:null,connected:false,phase:'none'};
    const connection=this.read('connection.json');
    if(!connection?.token)return {available:true,managed:'web',connected:false,phase:'none'};
    const setup=this.read('setup.json')||{},mine=String(setup.bot_id||'')===String(connection.bot_id);
    const phase=mine&&setup.problem==='refused'?'refused':mine&&setup.done?'ready':mine&&setup.owner_id?'setting-up':'waiting';
    return {available:true,managed:'web',connected:true,phase,bot:{username:connection.username,name:connection.name},
      ...(phase==='waiting'?{link:`https://t.me/${connection.username}?start=${connection.start_code}`}:{}),
      ...(['setting-up','ready'].includes(phase)?{owner:setup.owner_name||null}:{}),
      connected_at:connection.connected_at};
  }
  async telegram(token,method){
    let response;
    try{response=await this.fetcher(`${this.api}/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});}
    catch{throw fail('Your server could not reach Telegram. Try again in a minute.',502);}
    const data=await response.json().catch(()=>({}));
    if([401,404].includes(response.status)||data.error_code===401)throw fail('Telegram does not know this key. Copy the whole key from BotFather\'s last message and try again.');
    if(!response.ok||!data.ok)throw fail('Telegram did not answer as expected. Try again in a minute.',502);
    return data.result;
  }
  async connect(token){
    if(!this.available)throw fail('Telegram is not connected from this page on this server.',409);
    token=String(token||'').trim();
    if(!KEY.test(token))throw fail('That is not a bot key. BotFather\'s key is a number, a colon and about 35 letters, like 123456789:AAH4kq...');
    const me=await this.telegram(token,'getMe');
    if(!me?.is_bot||!me.username)throw fail('Telegram says this key does not belong to a bot.');
    const hook=await this.telegram(token,'getWebhookInfo');
    if(hook?.url)throw fail('This bot is still connected to another service. Make a new bot for your mission control with BotFather, then paste its key here.',409);
    const old=this.read('connection.json'),same=String(old?.bot_id||'')===String(me.id);
    fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    if(!same){fs.rmSync(this.file('setup.json'),{force:true});this.hermesTelegram(null);}
    else if(old.token!==token)this.hermesTelegram(token);   // BotFather's /revoke: same bot, new key
    this.write({token,bot_id:me.id,username:me.username,name:me.first_name||me.username,start_code:same&&old.start_code?old.start_code:randomBytes(24).toString('base64url'),connected_at:same?old.connected_at:new Date().toISOString()});
    return this.status();
  }
  disconnect(){
    if(!this.available)throw fail('Telegram is not connected from this page on this server.',409);
    fs.rmSync(this.file('connection.json'),{force:true});fs.rmSync(this.file('setup.json'),{force:true});
    this.hermesTelegram(null);
    return this.status();
  }
  write(connection){
    const file=this.file('connection.json'),temporary=file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(connection),{mode:0o600});fs.renameSync(temporary,file);
  }
  // Hermes' own copy of the bot (TELEGRAM_* in its .env, written by the setup chat at the
  // hand-over): removed for another bot or none, and given the new key for a revoked one.
  hermesTelegram(token){
    if(!this.hermesHome)return;
    const file=path.join(this.hermesHome,'.env');let lines;
    try{lines=fs.readFileSync(file,'utf8').split(/\r?\n/);}catch{return;}
    const kept=token===null?lines.filter(line=>!/^TELEGRAM_(BOT_TOKEN|ALLOWED_USERS|HOME_CHANNEL)=/.test(line)):lines.map(line=>/^TELEGRAM_BOT_TOKEN=/.test(line)?'TELEGRAM_BOT_TOKEN='+token:line);
    fs.writeFileSync(file,kept.join('\n'),{mode:0o600});
  }
}
