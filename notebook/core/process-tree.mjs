import fs from 'node:fs';import {spawn} from 'node:child_process';
function identity(pid){try{const fields=fs.readFileSync('/proc/'+pid+'/stat','utf8').match(/^\d+ \(.*\) (.*)$/s)?.[1].trim().split(/\s+/);return fields?{pid:Number(pid),parent:Number(fields[1]),start:fields[19]}:null;}catch{return null;}}
// Only an observed direct child and its observed descendants are eligible.
// Linux identities include start ticks so escalation cannot hit a reused PID.
export async function terminateOwnedTree(child){
 if(!child?.pid||child.exitCode!==null)return;
 if(process.platform==='win32'){
  await new Promise((resolve,reject)=>{
   const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
   killer.once('error',reject);
   killer.once('close',code=>{
    if(code===0)return resolve();
    try{process.kill(child.pid,0);reject(Error('The owned process tree did not stop'));}
    catch(error){error.code==='ESRCH'?resolve():reject(error);}
   });
  });return;
 }
 const root=identity(child.pid);if(!root||root.parent!==process.pid)return;
 const rows=fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n)).map(identity).filter(Boolean),owned=[root];
 for(let i=0;i<owned.length;i++)for(const row of rows)if(row.parent===owned[i].pid&&!owned.some(p=>p.pid===row.pid))owned.push(row);
 const stop=signal=>{for(const row of [...owned].reverse()){const current=identity(row.pid);if(current?.start===row.start)try{process.kill(row.pid,signal);}catch{}}};
 // Keep the supervisor alive for bounded escalation even if its direct child exits.
 stop('SIGTERM');await new Promise(resolve=>setTimeout(resolve,5000));stop('SIGKILL');
}
