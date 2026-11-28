import fs from 'node:fs';
import path from 'node:path';
import {folderOf,readAdded,runStep} from './addons-install.mjs';

// AN ADD-ON'S PAGES IN THE NOTEBOOK (#1182). An installed add-on whose catalog entry has a `pages`
// command answers it with JSON: {format:1, menu:{title,icon}, pages:[{id,title,parts:[...]}]}. This
// file checks that answer and keeps it per add-on (until the add-on is added again), so the menu
// costs no program run per page load. `action` and `job` run the same program as `pages`; `changed`
// runs after a bound field was written. Only plain data reaches the screen: the add-on never
// supplies HTML or script, and the notebook decides which note a field is written to.
export const PART_KINDS=['steps','text','list','choice','note','people','action'];
const idPattern=/^[a-z0-9-]{1,60}$/,jobPattern=/^[A-Za-z0-9._-]{1,80}$/;
export const PAGES_FAILED='This add-on did not say what its pages are, so it has none in the notebook.';
const line=(value,limit=300)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,limit):'';
const list=value=>Array.isArray(value)?value:[];

function part(raw,seen){
  const kind=typeof raw?.kind==='string'?raw.kind:'';
  if(!PART_KINDS.includes(kind))return {kind:kind||'unknown'};
  const out={kind,id:idPattern.test(raw.id||'')&&!seen.has(raw.id)?raw.id:'',title:line(raw.title,120)};
  if(out.id)seen.add(out.id);
  if(kind==='text'||kind==='list'){
    if(!out.id||typeof raw.bind?.note!=='string'||typeof raw.bind?.section!=='string'||!line(raw.bind.section,120))return {kind:'unknown'};
    out.bind={note:raw.bind.note,section:line(raw.bind.section,120)};out.hint=line(raw.hint);
  }
  if(kind==='steps')out.steps=list(raw.steps).slice(0,50).map(s=>({title:line(s?.title),state:['done','current','todo'].includes(s?.state)?s.state:'todo'}));
  if(kind==='choice'){out.text=line(raw.text,1000);out.choices=list(raw.choices).slice(0,12).map(c=>({id:line(c?.id,80),title:line(c?.title,120)})).filter(c=>c.id);out.action=idPattern.test(raw.action||'')?raw.action:'';}
  if(kind==='note')out.note=typeof raw.note==='string'?raw.note:'';
  if(kind==='people')out.filter={property:line(raw.filter?.property,80),value:line(raw.filter?.value,200)};
  if(kind==='action'){out.action=idPattern.test(raw.action||'')?raw.action:'';out.label=line(raw.label,80)||out.title;out.inputs=list(raw.inputs).slice(0,8).map(i=>({id:line(i?.id,80),label:line(i?.label,120)})).filter(i=>i.id);}
  return out;
}

export function validatePages(raw){
  if(raw?.format!==1||!Array.isArray(raw.pages))throw new Error(PAGES_FAILED);
  const ids=new Set(),pages=[];
  for(const p of raw.pages){
    if(!idPattern.test(p?.id||'')||ids.has(p.id))continue;
    ids.add(p.id);const seen=new Set();
    pages.push({id:p.id,title:line(p.title,120)||p.id,parts:list(p.parts).slice(0,60).map(x=>part(x,seen))});
  }
  if(!pages.length)throw new Error(PAGES_FAILED);
  return {menu:{title:line(raw.menu?.title,60)||pages[0].title,icon:line(raw.menu?.icon,40)},pages};
}

export class AddonNotebook{
  constructor({addons,timeoutMs=20000}){Object.assign(this,{addons,timeoutMs});this.cache=new Map();}
  // The installed, fetched add-on with this id and its catalog entry; null otherwise.
  installed(id){
    const {root}=this.addons,record=readAdded(root)[id],entry=this.addons.catalog.find(e=>e.id===id),dir=path.join(folderOf(root),String(id));
    return record&&entry&&fs.existsSync(dir)?{entry,dir,record}:null;
  }
  run(found,args,{input,timeoutMs}={}){
    const {root,env,run}=this.addons;
    return runStep(args,{dir:found.dir,root,env,run:(exe,a,o)=>run(exe,a,{...o,input,timeoutMs:timeoutMs??o.timeoutMs})}).catch(error=>({code:null,stdout:'',stderr:'',error}));
  }
  // {pages} or {error}, from the add-on's `pages` command, kept until the add-on is added again.
  async model(id){
    const found=this.installed(id);
    if(!found||!found.entry.pages)return null;
    const key=found.record.commit+'|'+found.record.checked_at;
    const kept=this.cache.get(id);
    if(kept?.key===key)return kept.value;
    let value;
    try{
      const r=await this.run(found,found.entry.pages,{timeoutMs:this.timeoutMs});
      if(r.code!==0)throw new Error(PAGES_FAILED);
      let parsed;try{parsed=JSON.parse(r.stdout);}catch{throw new Error(PAGES_FAILED);}
      value=validatePages(parsed);
    }catch{value={error:PAGES_FAILED};}
    this.cache.set(id,{key,value});
    return value;
  }
  // What /api/addons adds to an add-on: its menu entry, or one plain line saying why it has none.
  async summary(id){
    const m=await this.model(id);
    if(!m)return {};
    return m.error?{pagesError:m.error}:{pages:{title:m.menu.title,icon:m.menu.icon,pages:m.pages.map(p=>({id:p.id,title:p.title}))}};
  }
  async page(id,pageId){
    const m=await this.model(id);
    return m?.pages?.find(p=>p.id===pageId)||null;
  }
  async changed(id,partId){
    const found=this.installed(id);
    if(!found?.entry.changed)return {changed:true};
    const r=await this.run(found,[...found.entry.changed,'--field',partId],{timeoutMs:this.timeoutMs});
    return r.code===0?{changed:true}:{changed:false,message:'Saved. The add-on could not be told about it yet.'};
  }
  // `action <id>` with the person's inputs on stdin; the reply is {state,message,refresh}.
  async action(id,actionId,input){
    const found=this.installed(id);
    if(!found?.entry.pages||!idPattern.test(actionId||''))return null;
    const r=await this.run(found,[found.entry.pages[0],'action',actionId],{input:JSON.stringify(input??{}),timeoutMs:120000});
    return reply(r);
  }
  async job(id,jobId){
    const found=this.installed(id);
    if(!found?.entry.pages||!jobPattern.test(jobId||''))return null;
    return reply(await this.run(found,[found.entry.pages[0],'job',jobId],{timeoutMs:20000}));
  }
}

function reply(r){
  const failed={state:'failed',message:'The add-on did not answer.',refresh:false};
  if(r.code!==0)return failed;
  try{const v=JSON.parse(r.stdout);return {state:['done','ask','failed','working'].includes(v?.state)?v.state:'failed',message:line(v?.message,1000)||(v?.state==='failed'?failed.message:''),refresh:v?.refresh===true,...(jobPattern.test(v?.job||'')?{job:v.job}:{}),...(typeof v?.progress==='number'?{progress:v.progress}:{})};}
  catch{return failed;}
}
