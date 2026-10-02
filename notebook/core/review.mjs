import { hash } from './records/store.mjs';
export class Review {
  constructor(domains){this.domains=domains;this.store=domains.store;this.query=domains.query;}
  apply(item){
    const p=item.payload||{},type=item.suggestion_type,changes=[],targets=[];
    const save=(table,value)=>{
      const id=value.id||'review-'+item.uid,old=this.store.get(table,id);
      const result=this.query.execute({table,operation:old?'upsert':'insert',values:{...value,id,origin:'review_queue',source_review_id:item.id}}).data[0];
      targets.push({type:table,id:result.id,before:old||null,after_hash:this.query.rows(table).find(r=>r.id===result.id)?._hash});return result;
    };
    if(['add_claim','add_profile_entry','unknown_profile_field','normalize_profile_entry'].includes(type)){
      const result=this.domains.writeFact({...p,label:p.canonical_label||p.label,origin:'review_queue'}),id=result.facts[0]?.claimId;
      if(id)targets.push({type:'claims',id,before:null,after_hash:this.store.get('claims',id)._hash,shared:result.facts[0].outcome!=='inserted'});
    }else if(type==='add_contact')save('contacts',{name:p.name,aliases:p.aliases||[],notes:p.notes||null});
    else if(type==='add_alias'){
      const old=this.store.get('contacts',p.contact_id);if(!old)throw new Error('Person missing');save('contacts',{...old,aliases:[...new Set([...(old.aliases||[]),p.alias])].filter(Boolean)});
    }else if(type==='add_moment'){
      const moment=save('moments',{...p,source:'note_auto',status:p.status||'past_fact'});
      for(const [i,participant] of (p.participants||[]).entries())if(participant.contact_id)save('moment_participants',{id:'review-'+item.uid+'-'+i,moment_id:moment.id,person_id:participant.contact_id});
    }else if(type==='add_relationship')save('contact_relationships',p);
    else if(type==='group_member_suggestion')save('contact_group_memberships',{group_id:p.group_id,contact_id:p.contact_id,status:p.default_status||null});
    else if(type==='connect_note_person')save('person_documents',{contact_id:p.contact_id,note_id:p.note_id});
    else throw new Error('Unsupported review suggestion '+type);
    return this.store.save('review_queue',{id:item.id,status:'kept',applied_at:new Date().toISOString(),applied_targets:targets,target_entity_id:targets[0]?.id,target_entity_type:targets[0]?.type});
  }
  rollback(item){
    for(const target of item.applied_targets||[]){
      if(target.shared)continue;
      const current=this.query.rows(target.type).find(r=>r.id===target.id);
      if(!current)continue;
      if(current._hash!==target.after_hash)throw new Error('This applied record was edited later. Keep the correction or resolve it individually.');
      this.query.execute({table:target.type,operation:target.before?'upsert':'delete',values:target.before,filters:[['eq','id',target.id]],expected:{[target.id]:current._hash}});
    }
    return this.store.save('review_queue',{id:item.id,status:'removed',rolled_back_at:new Date().toISOString()});
  }
  bulk(input){
    const action=input.action||input.decision,ids=input.scope?.ids||input.ids||input.review_ids;
    if(!['keep','accept','block','reject','rollback','remove','snooze'].includes(action))throw new Error('Choose a review action');
    const selected=this.query.rows('review_queue').filter(r=>ids?ids.includes(r.id):action==='rollback'?['kept','auto_applied_unreviewed'].includes(r.status):['pending','pending_review','auto_applied_unreviewed'].includes(r.status));
    const job=this.store.save('review_queue_bulk_jobs',{action,status:'running',total:selected.length,processed:0,succeeded:0,failed:0,errors:[]});let succeeded=0;const errors=[];
    for(const item of selected)try{
      if(['keep','accept'].includes(action)){if(item.status!=='kept')this.apply(item);}
      else if(action==='rollback')this.rollback(item);
      else if(action==='snooze')this.store.save('review_queue',{id:item.id,snoozed_until:input.until||new Date(Date.now()+86400000).toISOString()});
      else {
        if(['block','reject'].includes(action))this.store.save('ai_suggestion_suppressions',{id:'suppression-'+hash([item.suggestion_type,item.payload]).slice(0,24),suggestion_type:item.suggestion_type,...item.payload,normalized_value:String(item.payload?.value||'').toLowerCase(),fingerprint:item.fingerprint});
        this.store.save('review_queue',{id:item.id,status:['block','reject'].includes(action)?'blocked':'removed',reviewed_at:new Date().toISOString()});
      }succeeded++;
    }catch(e){errors.push({id:item.id,error:e.message});}
    this.store.save('review_queue_bulk_jobs',{id:job.id,status:'done',processed:selected.length,succeeded,failed:errors.length,errors,completed_at:new Date().toISOString()});
    return {job_id:job.id,processed:selected.length,succeeded,errors};
  }
}
