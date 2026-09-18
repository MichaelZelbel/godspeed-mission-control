#!/usr/bin/env node
'use strict';
// Final root phase of the existing server installer. It never starts a second service.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function activate({home,user,attempts=12},run=cp.spawnSync,pause=wait,now=Date.now) {
  if(!path.isAbsolute(home)||!user||user.startsWith('-'))throw new Error('Invalid server account');
  const profile=path.join(home,'.hermes'),configPath=path.join(profile,'hub-chat.json');
  if(!fs.existsSync(configPath)) {
    const env=path.join(profile,'.env');
    if(fs.existsSync(env)&&/^TELEGRAM_HOME_CHANNEL=.+/m.test(fs.readFileSync(env,'utf8')))
      throw new Error('Telegram is connected, but conversation protection was not installed.');
    return {state:'not_connected'};
  }
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(config.enabled===false)return {state:'disabled_by_user'};
  if(config.enabled!==true)throw new Error('Conversation protection configuration is incomplete.');
  const started=now();
  if(run('systemctl',['restart','hermes-gateway'],{stdio:'inherit'}).status!==0)
    throw new Error('The existing gateway did not restart. The update is not verified.');
  for(let attempt=0;attempt<attempts;attempt++) {
    const check=run('runuser',['-u',user,'--','node',path.join(home,'.local/bin/hub-chat.js'),
      '--profile',profile,'doctor','--require-live'],{stdio:'ignore'});
    let loaded=NaN;
    try {loaded=Date.parse(JSON.parse(fs.readFileSync(path.join(profile,'chat-runtime.json'),'utf8')).loaded_at);} catch(e) {}
    if(check.status===0&&loaded>=started)return {state:'active'};
    if(attempt+1<attempts)pause(5000);
  }
  throw new Error('The restarted gateway has not confirmed conversation protection. The update is not verified.');
}
module.exports={activate};
if(require.main===module) {
  try {
    if(process.platform!=='linux'||process.getuid()!==0)throw new Error('Run the server installer as the administrator to finish this update.');
    const result=activate({user:process.argv[2],home:process.argv[3]});
    console.log(result.state==='active'?'Telegram conversation protection is active on this server.':
      result.state==='disabled_by_user'?'Telegram protection remains disabled, as you chose.':
      'Telegram is not connected. Run the server installer again after connecting it.');
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
