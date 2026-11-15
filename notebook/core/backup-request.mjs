import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

// THE REQUEST /backupai LEAVES (22 October 2026, core/backup-ai.mjs): Telegram's /backupai on the
// one-click server writes it (scripts/backup-ai.mjs telegram-request), the container's Telegram
// runner reads it (docker/full-candidate/telegram-runner.mjs) and hands the chat to the setup
// program's backup flow, whose own state (FLOW_STATE) says when the request is done. Only Node's
// own modules here: the runner lives in the container's supervisor, which stays small.
export const REQUEST_FILE='backup-request.json';
export const FLOW_STATE='backup-setup.json';
export const REQUEST_MINUTES=30;
export const HANDED_OVER='One moment: the backup AI setup takes over this chat for a few minutes. No AI reads what you send it, and a key is deleted from the chat as soon as it is read. I am back right after.';

// A request still open (not older than REQUEST_MINUTES, and its chat not done) is kept, so pressing
// /backupai twice opens one chat.
export function requestBackupChat(dir,now=new Date()){
 fs.mkdirSync(dir,{recursive:true});
 const json=name=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}catch{return null;}};
 const open=json(REQUEST_FILE),flow=json(FLOW_STATE);
 if(open?.id&&now-Date.parse(open.at)<REQUEST_MINUTES*60000&&!(flow?.request===open.id&&flow.done))return open;
 const request={id:randomBytes(8).toString('hex'),at:now.toISOString()},file=path.join(dir,REQUEST_FILE),temporary=file+'.'+process.pid+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify(request)+'\n',{mode:0o600});fs.renameSync(temporary,file);
 return request;
}
