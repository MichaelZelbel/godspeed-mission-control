import fs from 'node:fs';
import path from 'node:path';

// A backup a day, on the machine that runs the routines, after 03:00 in the
// owner's timezone; the newest seven are kept. Until 6 October 2026 a backup
// was only made when someone pressed "Save a backup".
export class BackupSchedule{
 constructor({store,runner,device,keep=7,hour=3}){Object.assign(this,{store,runner,device,keep,hour});}
 folder(){return path.join(this.store.state,'backups');}
 saved(){
  const folder=this.folder();if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).filter(id=>/^\d+$/.test(id)&&fs.existsSync(path.join(folder,id,'backup.json'))).map(Number).sort((a,b)=>b-a);
 }
 due(now=Date.now()){
  const settings=this.store.get('settings','installation');
  if(!settings||settings.owner!==this.device||this.store.get('settings','backups')?.enabled===false)return false;
  const zone=settings.timezone||'UTC',day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(t);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(now));
  const last=this.saved()[0];
  return hour>=this.hour&&(!last||day(last)!==day(now));
 }
 async tick(now=Date.now()){
  if(this.running||!this.due(now))return null;
  this.running=true;
  try{
   const result=await this.runner.run();
   // Only complete backups count, and only older ones are removed.
   for(const id of this.saved().slice(this.keep))fs.rmSync(path.join(this.folder(),String(id)),{recursive:true,force:true});
   return result;
  }finally{this.running=false;}
 }
}
