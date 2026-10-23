import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const {createDueCommands}=createRequire(import.meta.url)('../../tools/due.js');
const script=fileURLToPath(new URL('../../tools/due.js',import.meta.url));

// DEADLINES AN ADD-ON KEEPS (discussion #27, 23 October 2026). A documents add-on reads "pay by
// 20 November" in a letter; this makes it a Godspeed deadline. It is an ordinary file in due/,
// made by tools/due.js like every other, so the deadline reminders, the morning brief and the
// deadline list read it and the person closes or moves it the usual way. The add-on reaches it on
// the notebook's local door, POST /api/functions/addon-deadlines, with its name and its own key for
// each deadline:
//   {addon, action:'list'}                                               its deadlines
//   {addon, action:'create', key, title, due, done_when, cost, link?, start?}   made once per key
//   {addon, action:'update', key, due?, title?}                          only while nobody touched it
// A deadline the person changed (its title or a date) or closed or dropped is theirs: an update
// answers {updated:false, touched:true} and changes nothing (tools/due.js, "add-on deadlines").
// docs/full-version/addon-model.md is the contract add-on authors read.
const NAME=/^[a-z0-9][a-z0-9-]{0,39}$/,KEY=/^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,119}$/;
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const dayOf=(store,at=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:store.get('settings','installation')?.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
const realDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const line=(value,label,max)=>{const v=String(value??'').trim();if(!v)fail(label);if(/[\r\n]/.test(v)||v.length>max)fail(label.replace(/^Say /,'Give ').replace(/\.$/,'')+' in one line of at most '+max+' characters.');return v;};
// The same name Settings gives a deadline (native-due.mjs), a number when it is taken.
const slugOf=title=>String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50).replace(/-+$/,'')||'deadline';

function rows(store,addon){
 if(!fs.existsSync(path.join(store.root,'due')))return [];
 return createDueCommands({root:store.root,commandArgs:[],date:dayOf(store)}).stateRows().filter(r=>r.addon?.name===addon).map(r=>({
  key:r.addon.key,slug:r.slug,title:r.title,due:r.addon.due||null,start:r.addon.from||null,
  state:r.state,touched:r.addon.touched,closed_on:r.closedOn||null,link:r.addon.link||null}));
}
const find=(store,addon,key)=>rows(store,addon).find(d=>d.key===key)||null;
// tools/due.js as its own process under the workspace lock, as every other deadline change is made.
function due(store,args){
 return store.withLock(()=>{
  const run=spawnSync(process.execPath,[script,...args,'--godspeed',store.root],{cwd:store.root,encoding:'utf8',timeout:15000,windowsHide:true,shell:false,env:{...process.env,GODSPEED_TODAY:dayOf(store)}});
  return {status:run.status,out:String(run.stdout||run.stderr||'').trim()};
 });
}

export function addonDeadlines(store,input={}){
 const addon=String(input.addon||'');
 if(!NAME.test(addon))fail('Give the add-on\'s name: small letters, digits and dashes, at most 40.');
 if(input.action==='list')return {deadlines:rows(store,addon)};
 if(!['create','update'].includes(input.action))fail('The action is list, create or update.');
 const key=String(input.key||'');
 if(!KEY.test(key))fail('Give the add-on\'s own key for the deadline: letters, digits and . _ : # / -, no spaces, at most 120.');
 if(input.action==='update'){
  const now=find(store,addon,key);if(!now)fail('No deadline of this add-on has that key.');
  if(input.due!==undefined&&input.due!==null&&!realDay(input.due))fail('The deadline needs a real day, written year first, like 2027-03-14.');
  const title=input.title!==undefined&&input.title!==null?line(input.title,'Say what needs doing.',300):'';
  if(!input.due&&!title)fail('Say what changes: due, title or both.');
  if(now.touched)return {updated:false,touched:true,deadline:now};
  const r=due(store,['addon-update',now.slug,'--addon',addon,...(input.due?['--to',input.due]:[]),...(title?['--title',title]:[])]);
  if(r.status===4)return {updated:false,touched:true,deadline:find(store,addon,key)};
  if(r.status!==0)fail(r.out.split('\n')[0]||'The deadline could not be changed.');
  return {updated:true,deadline:find(store,addon,key)};
 }
 const title=line(input.title,'Say what needs doing.',300);
 if(!realDay(input.due))fail('The deadline needs a real day, written year first, like 2027-03-14.');
 const doneWhen=line(input.done_when,'Say what is true when it is done.',1000),cost=line(input.cost,'Say what it costs if the deadline passes.',1000);
 if(input.start!==undefined&&input.start!==null&&(!realDay(input.start)||input.start>input.due))fail('The start is a real day on or before the deadline.');
 let link='';
 if(input.link){link=String(input.link).trim();let u=null;try{u=new URL(link);}catch{}if(!u||!['http:','https:'].includes(u.protocol)||/\s/.test(link)||link.length>500)fail('The link is an http or https address.');}
 const old=find(store,addon,key);if(old)return {created:false,deadline:old};
 const args=['--title',title,'--to',input.due,'--done-when',doneWhen,'--cost',cost,...(input.start?['--from',input.start]:[]),...(link?['--link',link]:[]),'--addon',addon,'--addon-key',key];
 const base=slugOf(title);
 for(let n=1;n<=30;n++){
  const slug=n===1?base:base.slice(0,56)+'-'+n;
  if(fs.existsSync(path.join(store.root,'due',slug+'.md')))continue;
  const r=due(store,['add',slug,...args]);
  if(r.status!==0){if(/already have one called|was used before/.test(r.out))continue;fail(r.out.split('\n')[0]||'The deadline could not be made.');}
  const made=find(store,addon,key);
  return {created:/^Made /.test(r.out),deadline:made};
 }
 fail('Every name for this deadline is taken; give it another title.');
}
