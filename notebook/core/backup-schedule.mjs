import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';

// A backup a day, on the machine that runs the routines, after 03:00 in the
// owner's timezone; the newest seven are kept. Until 6 October 2026 a backup
// was only made when someone pressed "Save a backup".
//
// A backup that fails is written down where the owner hears of it: in
// .godspeed/backup-status.json, and as a failed job receipt, which the daily
// job check turns into a repair item. It is tried again after a wait that
// doubles from an hour to a day, kept across restarts. Until 6 October 2026 a
// failing backup was tried again every ten minutes, each time leaving a
// partial copy, and nobody was told.
export class BackupSchedule{
 constructor({store,runner,device,keep=7,hour=3}){Object.assign(this,{store,runner,device,keep,hour});}
 folder(){return path.join(this.store.state,'backups');}
 statusFile(){return path.join(this.store.state,'backup-status.json');}
 status(){try{return {failures:0,last_error:null,retry_after:null,...JSON.parse(fs.readFileSync(this.statusFile(),'utf8'))};}catch{return {failures:0,last_error:null,retry_after:null};}}
 saved(){
  const folder=this.folder();if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).filter(id=>/^\d+$/.test(id)&&fs.existsSync(path.join(folder,id,'backup.json'))).map(Number).sort((a,b)=>b-a);
 }
 due(now=Date.now()){
  const settings=this.store.get('settings','installation');
  if(!settings||settings.owner!==this.device||this.store.get('settings','backups')?.enabled===false)return false;
  const retry=Date.parse(this.status().retry_after);if(Number.isFinite(retry)&&now<retry)return false;
  const zone=settings.timezone||'UTC',day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(t);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(now));
  const last=this.saved()[0];
  return hour>=this.hour&&(!last||day(last)!==day(now));
 }
 // A server short of disk keeps fewer (settings/backups keep, 1 to 30).
 kept(){const keep=Number(this.store.get('settings','backups')?.keep);return Number.isInteger(keep)&&keep>=1&&keep<=30?keep:this.keep;}
 // What a backup that stopped part-way left behind (a worker that died), while
 // no backup of this runner is being made.
 clean(){
  const folder=this.folder();if(this.runner.active||!fs.existsSync(folder))return;
  for(const name of fs.readdirSync(folder))if(/^\.partial-\d+$/.test(name))fs.rmSync(path.join(folder,name),{recursive:true,force:true});
 }
 async tick(now=Date.now()){
  if(this.running||!this.due(now))return null;
  this.running=true;
  const started=new Date(now).toISOString(),before=this.status();
  try{
   this.clean();
   let result;
   try{result=await this.runner.run();}
   catch(error){
    this.clean();
    const failures=(before.failures||0)+1,retry=now+Math.min(24,2**(failures-1))*3600000;
    this.note({failures,last_attempt:started,last_success:before.last_success||null,last_error:String(error.message||error),retry_after:new Date(retry).toISOString()});
    await this.receipt({state:'failed',error:String(error.message||error),started_at:started});
    throw error;
   }
   // Only complete backups count, and only older ones are removed.
   for(const id of this.saved().slice(this.kept()))fs.rmSync(path.join(this.folder(),String(id)),{recursive:true,force:true});
   this.note({failures:0,last_attempt:started,last_success:new Date().toISOString(),last_error:null,retry_after:null});
   // A run that works after failures clears the repair item they made.
   if(before.failures)await this.receipt({state:'verified',started_at:started,path:result?.path||null});
   return result;
  }finally{this.running=false;}
 }
 note(status){try{atomic(this.statusFile(),JSON.stringify(status,null,2));}catch{}}
 async receipt(fields){
  try{await this.store.saveAsync('job_receipts',{id:'daily-backup-'+Date.parse(fields.started_at),job_id:'daily-backup',kind:'backup',...fields,finished_at:new Date().toISOString()},undefined,{timeoutMs:30000});}catch{}
 }
}
