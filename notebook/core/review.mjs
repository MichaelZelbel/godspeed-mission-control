import { hash,atomic,safe } from './records/store.mjs';
import {QueryService} from './query.mjs';
import fs from 'node:fs';
import path from 'node:path';
export class Review {
  constructor(domains){this.domains=domains;this.store=domains.store;this.query=domains.query;}
  apply(item){
    return this.store.transaction((store,changed,before)=>{
      const current=store.get('review_queue',item.id);if(!current)throw Error('Review item missing');
      if(['kept','auto_applied_unreviewed'].includes(current.status)&&current.applied_at)return current;
      if(!['pending','pending_review','auto_applied_unreviewed'].includes(current.status||'pending_review'))throw Error('This suggestion is no longer pending');
      const query=new QueryService(store),domains=Object.assign(Object.create(Object.getPrototypeOf(this.domains)),this.domains,{store,query});
      return new Review(domains).applyStaged(current,changed,before);
    });
  }
  applyStaged(item,changed,before){
    const p=item.payload||{},type=item.suggestion_type,targets=[];let primaryId;
    const save=(table,value)=>{
      const id=value.id||'review-'+item.uid,old=this.store.get(table,id);
      const result=this.query.execute({table,operation:old?'upsert':'insert',values:{...value,id,origin:'review_queue',source_review_id:item.id}}).data[0];
      targets.push({type:table,id:result.id,before:old||null,after_hash:this.query.rows(table).find(r=>r.id===result.id)?._hash});return result;
    };
    if(['add_claim','add_profile_entry','unknown_profile_field','normalize_profile_entry'].includes(type)){
      const result=this.domains.writeFact({...p,label:p.canonical_label||p.label,origin:'review_queue'}),id=result.facts[0]?.claimId;
      primaryId=id;
      if(id&&result.facts[0].outcome!=='inserted')targets.push({type:'claims',id,before:this.store.get('claims',id),after_hash:this.store.get('claims',id)._hash,shared:true});
    }else if(type==='media_conflict'){
      const root=this.domains.mediaRoot;
      for(const mapping of [p.local,p.remote])if(hash(fs.readFileSync(path.join(root,safe(mapping.file))))!==mapping.sha256)throw new Error('A retained media version needs repair before resolving');
      const local={...p.local,path:p.local.path+'.conflict-'+p.local.sha256.slice(0,12)};
      atomic(path.join(root,hash(local.path)+'.mapping.json'),JSON.stringify(local));atomic(path.join(root,hash(p.remote.path)+'.mapping.json'),JSON.stringify(p.remote));
    }else if(type==='source_version'){
      if(!this.store.get('notes',p.previous_note_id)||!this.store.get('notes',p.new_note_id))throw new Error('An imported source version is missing');
    }else if(type==='add_contact')save('contacts',{name:p.name,aliases:p.aliases||[],notes:p.notes||null});
    else if(type==='add_entity')save('entities',{name:p.name,entity_type:p.entity_type||'other',description:p.description||null});
    else if(type==='add_alias'){
      const old=this.store.get('contacts',p.contact_id);if(!old)throw new Error('Person missing');save('contacts',{...old,aliases:[...new Set([...(old.aliases||[]),p.alias])].filter(Boolean)});
    }else if(type==='add_moment'){
      const moment=save('moments',{...p,source:'note_auto',status:p.status||'past_fact'});
      for(const [i,participant] of (p.participants||[]).entries())if(participant.contact_id)save('moment_participants',{id:'review-'+item.uid+'-'+i,moment_id:moment.id,person_id:participant.contact_id});
    }else if(type==='add_relationship')save('contact_relationships',p);
    else if(type==='group_member_suggestion')save('contact_group_memberships',{group_id:p.group_id,contact_id:p.contact_id,status:p.default_status||null});
    else if(type==='connect_note_person')save('person_documents',{contact_id:p.contact_id,note_id:p.note_id});
    else throw new Error('Unsupported review suggestion '+type);
    const receipt=[...changed].map(([key,record])=>({type:record.type,id:record.id,before:before.get(key)||null,after_hash:this.store.get(record.type,record.id)._hash}));
    // Duplicate facts were not written by this suggestion, and must stay.
    receipt.push(...targets.filter(t=>t.shared));
    const primary=receipt.find(t=>t.id===primaryId)||receipt[0],targetType=primary?.type==='claims'?'claim':primary?.type;
    return this.store.save('review_queue',{id:item.id,status:'kept',applied_at:new Date().toISOString(),undo_receipt_version:1,undo_supported:type!=='media_conflict',applied_targets:receipt,target_entity_id:primary?.id,target_entity_type:targetType});
  }
  rollback(item){
    return this.store.transaction(store=>{
      const current=store.get('review_queue',item.id);if(!current)throw Error('Review item missing');
      return this.rollbackStaged(current,store);
    });
  }
  rollbackStaged(item,store=this.store){
    if(!['kept','auto_applied_unreviewed'].includes(item.status)&&!item.applied_at)return store.save('review_queue',{id:item.id,status:'removed',reviewed_at:new Date().toISOString()});
    if(item.undo_receipt_version!==1||item.undo_supported===false||!Array.isArray(item.applied_targets))throw Error('This applied suggestion has no complete undo receipt. Correct its records directly.');
    const checked=item.applied_targets.map(target=>{
      const current=target.type==='moments'?new QueryService(store).rows('moments').find(r=>r.id===target.id):store.get(target.type,target.id);
      if(!target.after_hash||!current||current._hash!==target.after_hash)throw Error('This applied record was edited later. Keep the correction or resolve it individually.');
      return {target,current};
    });
    // Nothing changes until every target has passed the current-version check.
    const records=checked.filter(({target})=>!target.shared).map(({target,current})=>{
      if(target.type==='moments')return store.prepare('event_corrections',{moment_id:current.id,patch:target.before||{removed_at:new Date().toISOString()},sequence:store.list('event_corrections').filter(c=>c.moment_id===current.id).length+1,references:[{type:'moments',id:current.id,uid:current.uid}]});
      if(target.before){const prior={...target.before};delete prior._hash;return store.prepare(target.type,prior,{...prior,revision:current.revision});}
      return store.prepare(target.type,{removed_at:new Date().toISOString()},current);
    });
    records.push(store.prepare('review_queue',{status:'removed',rolled_back_at:new Date().toISOString()},item));store.commit(records);
    return store.get('review_queue',item.id);
  }
  bulk(input){
    const action=input.action||input.decision,ids=input.scope?.ids||input.ids||input.review_ids;
    if(!['keep','accept','block','reject','never_again','rollback','remove','snooze'].includes(action))throw new Error('Choose a review action');
    const selected=this.query.rows('review_queue').filter(r=>ids?ids.includes(r.id):['rollback','remove','block','reject','never_again'].includes(action)?['pending','pending_review','kept','auto_applied_unreviewed'].includes(r.status):['pending','pending_review','auto_applied_unreviewed'].includes(r.status));
    const job=this.store.save('review_queue_bulk_jobs',{action,status:'running',total:selected.length,processed:0,succeeded:0,failed:0,errors:[]});let succeeded=0;const errors=[];
    for(const item of selected)try{
      if(['keep','accept'].includes(action)){if(item.status!=='kept')this.apply(item);}
      else if(action==='rollback')this.rollback(item);
      else if(action==='snooze')this.store.save('review_queue',{id:item.id,snoozed_until:input.until||new Date(Date.now()+86400000).toISOString()});
      else {
        this.store.transaction(store=>{
          const current=store.get('review_queue',item.id),block=['block','reject','never_again'].includes(action);
          if(current.applied_at||['kept','auto_applied_unreviewed'].includes(current.status))this.rollbackStaged(current,store);
          if(block){
            const p=current.payload||{},subject_type=p.entity_id?'entity':p.contact_id?'contact':p.subject_type||'self',subject_id=p.entity_id||p.contact_id||p.subject_id||null,attribute=p.attribute||String(p.canonical_label||p.label||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
            store.save('ai_suggestion_suppressions',{id:'suppression-'+hash([current.suggestion_type,p]).slice(0,24),suggestion_type:current.suggestion_type,...p,subject_type,subject_id,attribute,normalized_value:String(p.value||'').toLowerCase(),fingerprint:current.fingerprint,suppression_key:`${subject_type}:${subject_id||''}:${attribute}:${String(p.value||'').toLowerCase()}`});
          }
          store.save('review_queue',{id:item.id,status:block?'blocked':'removed',reviewed_at:new Date().toISOString()});
        });
      }succeeded++;
    }catch(e){errors.push({id:item.id,error:e.message});}
    this.store.save('review_queue_bulk_jobs',{id:job.id,status:'done',processed:selected.length,succeeded,failed:errors.length,errors,completed_at:new Date().toISOString()});
    return {job_id:job.id,processed:selected.length,succeeded,errors};
  }
}
