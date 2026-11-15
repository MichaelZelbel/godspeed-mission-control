import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
function noLinks(file){let target=path.resolve(file);for(;;){if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('Picture permission paths must not follow symbolic links');const parent=path.dirname(target);if(parent===target)return;target=parent;}}
function permission(){
 const root=process.env.GODSPEED_WORKSPACE,file=process.env.GODSPEED_SOCIAL_VISUALS_APPROVAL;
 if(!root||!file)throw Error('Approve this selected picture project and its current paid budget before uploading or generating');
 const base=path.resolve(root,'.godspeed','approvals'),target=path.resolve(file);
 noLinks(target);
 if(!target.startsWith(base+path.sep)||fs.lstatSync(target).isSymbolicLink())throw Error('Use this installation’s device-private picture approval');
 const approval=JSON.parse(fs.readFileSync(target,'utf8')),now=Date.now(),expires=Date.parse(approval.expires_at),approved=Date.parse(approval.approved_at),priced=Date.parse(approval.price_checked_at);
 if(approval.status!=='approved'||approval.approved_by!=='user'||!approval.user_quote?.trim()||approval.provider!=='kie'||!Number.isFinite(expires)||expires<=now||!Number.isFinite(approved)||approved>now||now-approved>3600000||expires-approved>3600000)throw Error('The exact user-approved picture budget is missing or expired');
 if(!Number.isFinite(priced)||priced>now||now-priced>86400000||!/^https:\/\//.test(approval.price_source_url||''))throw Error('Verify the current price before approving paid picture work');
 const project=path.resolve(approval.project_directory||''),outputRoot=path.resolve(root,'work','visuals');
 if(!project.startsWith(outputRoot+path.sep)||!Array.isArray(approval.models)||!approval.models.length||!Number.isFinite(approval.max_credits)||approval.max_credits<=0||!Number.isInteger(approval.max_tasks)||approval.max_tasks<1||approval.max_tasks>100)throw Error('Choose the exact project, model, task cap and credit cap');
 return {approval,file:target,project};
}
function inside(file,base){const relative=path.relative(base,path.resolve(file));return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
export function requireOutputPermission(file){const selected=permission();noLinks(file);if(!inside(file,selected.project))throw Error('The output is outside the user-approved picture project');return selected;}
export function requireUploadPermission(file){
 const {approval,project}=permission(),absolute=path.resolve(file),sha=hash(fs.readFileSync(absolute));
 noLinks(absolute);
 if(fs.lstatSync(absolute).isSymbolicLink())throw Error('A reference upload cannot follow symbolic links');
 if(approval.reference_files?.some(ref=>path.resolve(ref.path)===absolute&&ref.sha256===sha))return true;
 if(approval.allow_generated_references&&inside(absolute,project)){
  const sidecar=absolute.replace(/\.(jpe?g|png|webp)$/i,'')+'.render.json';
  if(fs.existsSync(sidecar)){const record=JSON.parse(fs.readFileSync(sidecar,'utf8'));if(record.state==='ready'&&record.task_id&&record.image_sha256===sha)return true;}
 }
 throw Error('This exact local reference image has no upload permission');
}
export function reserveGeneration({model,resolution,prompt,imageUrls}){
 const selected=permission(),{approval,file}=selected,price=approval.task_credits?.[resolution];
 if(!approval.models.includes(model)||!Number.isFinite(price)||price<=0)throw Error('This model or resolution is outside the approved current-price budget');
 const lock=file+'.lock';let fd;
 try{fd=fs.openSync(lock,'wx');}catch(error){if(error.code==='EEXIST')throw Error('Another picture task is reserving this budget; do not repeat it');throw error;}
 try{
  const current=permission();if(hash(JSON.stringify(current.approval))!==hash(JSON.stringify(approval)))throw Error('The picture permission changed before reservation');
  const ledger=file+'.tasks.json',tasks=fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger,'utf8')):[];
  if(tasks.length>=approval.max_tasks||tasks.reduce((sum,task)=>sum+task.reserved_credits,0)+price>approval.max_credits)throw Error('The approved picture task or credit budget is exhausted');
  const receipt={id:randomUUID(),state:'reserved',reserved_at:new Date().toISOString(),reserved_credits:price,model,resolution,request_hash:hash(JSON.stringify({model,resolution,prompt,imageUrls}))};
  const temp=ledger+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify([...tasks,receipt],null,2),{flag:'wx'});fs.renameSync(temp,ledger);return {...receipt,approval_file:file};
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
export function retainSubmittedTask(receipt,taskId){
 if(!taskId)throw Error('A submitted picture task needs its actual provider ID');
 const retained=receipt.approval_file+'.submitted-'+receipt.id+'.json';
 if(fs.existsSync(retained)){if(JSON.parse(fs.readFileSync(retained,'utf8')).task_id!==taskId)throw Error('The retained provider task ID changed');}
 else fs.writeFileSync(retained,JSON.stringify({...receipt,task_id:taskId,state:'submitted'}),{flag:'wx'});
 const file=receipt.approval_file,lock=file+'.lock',fd=fs.openSync(lock,'wx');
 try{
  const ledger=file+'.tasks.json',tasks=JSON.parse(fs.readFileSync(ledger,'utf8')),task=tasks.find(row=>row.id===receipt.id&&row.request_hash===receipt.request_hash);
  if(!task||task.task_id&&task.task_id!==taskId)throw Error('The retained picture reservation changed; preserve the returned task ID for review');
  Object.assign(task,{state:'submitted',task_id:taskId,submitted_at:new Date().toISOString()});
  const temp=ledger+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(tasks,null,2),{flag:'wx'});fs.renameSync(temp,ledger);
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
