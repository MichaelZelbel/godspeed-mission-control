// The Activity Log: what the person did, derived on read from record versions.
// Every write is a version, but only some are a person's action. This turns
// versions into actions: one entry per action, each naming its record.
import {hash} from './records/store.mjs';

export const tracked=new Set(['notes','contacts','claims','entities','collections','collection_items','moments','contact_groups','contact_group_memberships','action_items','contact_topics','profile_categories','fact_slots']);
const label={notes:'note',contacts:'person',claims:'fact',entities:'world entity',collections:'collection',collection_items:'collection item',moments:'moment',contact_groups:'group',contact_group_memberships:'group membership',action_items:'action',contact_topics:'discussion topic',profile_categories:'profile category',fact_slots:'fact setting'};

// Autosaving editors (the note editor, the conversation tab) write many versions
// in one sitting; those within this gap of the entry's last write are one action.
export const FOLD_MS=2*60*1000;
// Other writes of one action (a save that sends several requests) land this close together.
export const SAVE_GAP_MS=2000;
const autosaved=(type,keys)=>type==='notes'||keys.every(k=>k.startsWith('conversation_'));
// A delete this close to the delete of a record it references went with it:
// personBelongings removes a person's memberships, facts and topics in one commit.
export const CASCADE_MS=2000;
// Fields the notebook writes by itself: useTouchPersonViewed (last_viewed_at),
// note processing in proposals.mjs (processing_status, processed_at), structural
// renames (references, former_ids) and the store's own bookkeeping.
const OWN_FIELDS=new Set(['updated_at','revision','device','recorded_at','created_at','_hash','id','former_ids','references','last_viewed_at','conversation_updated_at','processing_status','processed_at','sync_status']);
// source_app values of notes the notebook's routines write, from the
// source_app literals in notebook/core.
const OWN_SOURCES=new Set(['scheduler','routine','morning-brief','radar','radar-implementation-draft','lead','lead-monthly','lead-post-readback','audit','domain-watch','habit-check','coaching','deadline-reminder','conversation-memory','waiting-step']);

const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const blank=v=>typeof v!=='string'||!v.trim();
const first=(r,keys)=>keys.map(k=>r?.[k]).find(v=>!blank(v))?.trim()||'';
const ms=t=>Date.parse(t)||0;
const byTime=(a,b)=>ms(a.time)-ms(b.time);

function ownNote(r){return r.type==='notes'&&(r.job_id||r.routine_id||OWN_SOURCES.has(r.source_app)||String(r.source_app||'').endsWith('-tick'));}

// The versions of one record as steps: {state, time, id, correction}.
function stepsOf(versions,corrections){
  const steps=versions.sort((a,b)=>a.revision-b.revision).map(state=>({state,time:state.updated_at,id:'activity-'+hash([state.uid,state.revision,state.updated_at]).slice(0,32)}));
  let state=steps.at(-1)?.state;
  for(const c of corrections.slice().sort((a,b)=>a.sequence-b.sequence||String(a.id).localeCompare(String(b.id)))){
    state={...state,...c.patch};steps.push({state,time:c.created_at,id:'activity-'+c.uid,patch:c.patch});
  }
  return steps;
}

function entriesOf(type,steps){
  const entries=[];let open=null,prev=null;
  for(const step of steps){
    const {state:c}=step,p=prev;prev=c;
    let kind,change,keys=[];
    if(!p)kind='create';
    else if(c.removed_at&&!p.removed_at)kind='delete';
    else if(c.is_trashed===true&&p.is_trashed!==true){kind='update';change='trash';}
    else if(p.is_trashed===true&&c.is_trashed!==true){kind='update';change='restore';}
    else{
      const all=step.patch?Object.keys(step.patch):[...new Set([...Object.keys(p),...Object.keys(c)])],differing=all.filter(k=>!same(p[k],c[k]));keys=differing.filter(k=>!OWN_FIELDS.has(k));
      // The notebook's own processing of a note, or a write that changed nothing a person sees.
      if(differing.includes('processing_status')||differing.includes('processed_at')||!keys.length)continue;
      if(keys.includes('metadata')&&keys.every(k=>k==='metadata'||k==='tags'))continue;
      kind='update';
    }
    const gap=open?ms(step.time)-ms(open.last):Infinity;
    if(kind==='update'&&!change&&open&&!open.change&&open.action!=='delete'&&(gap<=SAVE_GAP_MS||(autosaved(type,keys)&&gap<=FOLD_MS))){open.state=c;open.last=step.time;continue;}
    open={id:step.id,time:step.time,last:step.time,state:c,before:p,action:kind,change,hidden:kind==='create'&&ownNote(c),correction:Boolean(step.patch),from:p||c};
    entries.push(open);
  }
  return entries;
}

export function activityRows({records,history,corrections,find}){
  const byUid=new Map();
  const add=r=>{let l=byUid.get(r.uid);if(!l)byUid.set(r.uid,l=[]);l.push(r);};
  for(const r of records)if(tracked.has(r.type))add(r);
  for(const h of history)if(tracked.has(h.source_type))add(h.snapshot);
  const moments=new Map();
  for(const c of corrections){let l=moments.get(c.moment_id);if(!l)moments.set(c.moment_id,l=[]);l.push(c);}
  const found=[];
  for(const versions of byUid.values()){
    const type=versions[0].type,id=versions.find(v=>v.id)?.id;
    const own=type==='moments'?moments.get(id)||[]:[];
    for(const e of entriesOf(type,stepsOf(versions,own)))found.push({...e,type,uid:versions[0].uid});
  }
  const deletes=found.filter(e=>e.action==='delete').map(e=>({uid:e.uid,time:ms(e.time)}));
  const goneWith=e=>e.action==='delete'&&(e.state.references||[]).some(ref=>deletes.some(d=>d.uid===ref.uid&&d.uid!==e.uid&&Math.abs(d.time-ms(e.time))<=CASCADE_MS));
  const nameOf=(type,r,fallback)=>{
    if(type==='contact_group_memberships'){
      const person=first(find('contacts',r.contact_id),['name']),group=first(find('contact_groups',r.group_id),['name']);
      return person&&group?person+' in '+group:person||group;
    }
    if(type==='claims'){const a=first(r,['attribute']),v=typeof r.value==='string'?r.value.trim():'';return a&&v?a+': '+v:a||v;}
    if(type==='notes'||type==='moments'||type==='collection_items')return first(r,['title'])||first(fallback,['title'])||'Untitled';
    return first(r,['name','title','label'])||first(fallback,['name','title','label']);
  };
  return found.filter(e=>!e.hidden&&!goneWith(e)).map(e=>{
    const itemName=nameOf(e.type,e.state,e.from),metadata={source_uid:e.uid,revision:e.state.revision};
    if(e.correction)metadata.correction=true;
    if(e.change)metadata.change=e.change;
    const before=e.before&&nameOf(e.type,e.before,{});
    if(e.action==='update'&&before&&before!==itemName&&before!=='Untitled')metadata.previous_name=before;
    return {id:e.id,actor_id:'owner',user_id:'owner',item_id:e.state.id,item_type:label[e.type],item_name:itemName,action:e.action,created_at:e.time,metadata};
  });
}
