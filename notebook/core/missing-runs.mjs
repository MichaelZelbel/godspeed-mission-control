import fs from 'node:fs';
import path from 'node:path';
import {safe} from './records/store.mjs';
import {recordsFolder} from './file-policy.mjs';
import {systemFolder} from './records/layout.mjs';

// The supervisor reads only saved scheduling evidence. It must not construct a
// Store, recover a writer lock, change permissions or replay an uncertain action.
// Settings, jobs and receipts are system records; a workspace not yet converted
// to the readable layout still has them one folder per type.
export function missingRuns(root,now=Date.now(),device='local'){
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 const folderOf=type=>[path.join(root,recordsFolder,systemFolder,type),path.join(root,recordsFolder,type)].find(dir=>fs.existsSync(dir))||path.join(root,recordsFolder,systemFolder,type);
 const settingsFile=path.join(folderOf('settings'),'installation.json');
 if(!fs.existsSync(settingsFile))return [];
 const settings=read(settingsFile),folder=folderOf('jobs');
 if(!settings.owner||settings.owner!==device||!fs.existsSync(folder))return [];
 const missed=[];
 for(const filename of fs.readdirSync(folder).filter(f=>f.endsWith('.json'))){
  const job=read(path.join(folder,filename));
  if(job.removed_at||job.paused||job.owner!==settings.owner||!['pending','failed'].includes(job.state))continue;
  const due=Date.parse(job.next_run);if(!Number.isFinite(due)||now-due<3600000)continue;
  const id=safe(job.id)+'-'+due,receiptFile=path.join(folderOf('job_receipts'),id+'.json');
  const receipt=fs.existsSync(receiptFile)?read(receiptFile):null;
  if(receipt?.state==='verified')continue;
  // Attempted work can still be running or have an uncertain side effect.
  // The supervisor reports that separately through its health monitor.
  if(receipt?.state==='attempted')continue;
  missed.push({job_id:job.id,kind:job.kind,due_at:job.next_run,receipt_id:id,receipt_state:receipt?.state||'missing'});
 }
 return missed;
}
