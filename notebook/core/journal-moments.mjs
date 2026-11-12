// Every task finished in the journal is also a moment in the timeline (issue #457).
//
// The notebook works the moments out from the journal's own entry files, so closing a task never
// waits on the notebook or fails because it is not running: a close made with the notebook stopped
// becomes a moment on its next run. The moment's id comes from the task and the time it ended, so
// a second run, a restart or another try finds the record it already wrote, even one the person
// removed, and never writes it twice. A reopened task's moment is removed the notebook's own way,
// which keeps a tombstone; closing it again ends at a new time and so writes a new moment. A moment
// is never removed because the journal cannot read its task, since entry files can be missing on
// one computer for a while.
import {hash} from './records/store.mjs';
import {readEntries} from '../../third-party/addons/godspeed-journal/lib/store.mjs';
import {loadSettings} from '../../third-party/addons/godspeed-journal/lib/settings.mjs';
import {tasksFrom} from '../../third-party/addons/godspeed-journal/lib/tasks.mjs';

export const journalMomentId=task=>'journal-'+hash(['journal-moment',task.id,task.ended]).slice(0,24);

export async function reconcileJournalMoments({store,query,now=new Date()}){
 const result={written:[],updated:[],removed:[]},settings=loadSettings(store.root);
 if(settings.save_as_moments===false)return result;
 const tasks=new Map(tasksFrom(readEntries(store.root,settings,{days:3650,until:now})).map(t=>[t.id,t]));
 const live=new Map(query.rows('moments').filter(m=>m.source_type==='journal').map(m=>[m.id,m]));
 for(const m of live.values()){
  const t=tasks.get(m.source_id);
  if(!t||t.state==='done'&&journalMomentId(t)===m.id)continue;
  await query.executeAsync({table:'moments',operation:'delete',filters:[['eq','id',m.id]]});
  live.delete(m.id);result.removed.push(m.id);
 }
 for(const t of tasks.values()){
  if(t.state!=='done')continue;
  const id=journalMomentId(t);
  if(!store.get('moments',id)){
   await query.executeAsync({table:'moments',operation:'insert',values:{id,uid:hash(id).slice(0,32),title:t.title,description:t.done_means.length?'Done meant: '+t.done_means.join('; '):null,happened_at:t.started,happened_end:t.ended,status:'past_fact',impact_level:t.impact||1,source_type:'journal',source_id:t.id,origin:'journal',metadata:{journal_ended:t.ended,...(t.impactAt?{journal_impact_at:t.impactAt}:{})}}});
   result.written.push(id);continue;
  }
  // Only an answer given in the journal after the moment was written changes its impact, so a
  // level the person set in the notebook is not put back every minute.
  const m=live.get(id);
  if(m&&t.impactAt&&t.impactAt!==m.metadata?.journal_impact_at){
   await query.executeAsync({table:'moments',operation:'update',values:{impact_level:t.impact,metadata:{...m.metadata,journal_impact_at:t.impactAt}},filters:[['eq','id',id]]});
   result.updated.push(id);
  }
 }
 return result;
}

// Only the computer that runs the routines writes, so two computers never both write the moment
// for one close; the others get it through sync. A computer with no installation record yet is
// on its own and writes, as the nightly backup does.
export class JournalMoments{
 constructor({store,query,device=store.device}){Object.assign(this,{store,query,device});}
 due(){const owner=this.store.get('settings','installation')?.owner;return !owner||owner===this.device;}
 async tick(now=new Date()){
  if(this.running||!this.due())return null;
  this.running=true;
  try{return await reconcileJournalMoments({store:this.store,query:this.query,now});}
  finally{this.running=false;}
 }
}
