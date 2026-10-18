import {hash} from './records/store.mjs';
import {dueCommand,dueDelivered} from './native-due.mjs';
import {personalOperation} from './personal-operations.mjs';

// The notebook's deadline reminders: one note for the obligations that need attention, once per stage,
// and an obligation closed by the completion text it agreed on. Until 18 October 2026 this lived in
// goal-loop.mjs beside a second goal loop of the notebook's own (a decision and a draft worker over an
// endpoint key) that no installation ran: every installer starts the notebook with the original
// assistant, whose goal loop is mc-research, mc-decide and mc-work-run run by Hermes' routines. That
// second loop was removed so there is one; the reminders stayed, here.
export function remind(job,{store,query},now=Date.now()){
 // The check answers 3 when the only thing wrong is a due file that needs a look; that file is said
 // below, so the reminders still run (9 October 2026).
 if(query.rows('deadlines').some(d=>d.native_file))try{dueCommand(store,['check']);}catch(error){if(error.status!==3)throw error;}
 for(const d of query.rows('deadlines').filter(d=>d.status==='open'&&!d.native_file&&d.completion_check?.type==='note-contains')){
  const check=d.completion_check,note=store.get('notes',check.note_id);
  if(note&&!note.is_trashed&&note._hash!==d.completion_baseline_hash&&note.content.includes(check.text)&&Date.parse(note.updated_at)>=Date.parse(d.start_at||d.created_at))personalOperation({store,query},{type:'obligation-complete',id:d.id,evidence:'Local note '+note.id+' revision '+note.revision+' contains the agreed completion text'});
 }
 const due=query.rows('deadlines').filter(d=>!['closed','completed'].includes(d.status)&&(d.native_file?d.attention:(d.due_at&&Date.parse(d.due_at)-now<3*86400000||!d.due_at&&d.target_at&&Date.parse(d.target_at)<=now))&&(!d.start_at||Date.parse(d.start_at)<=now)&&(!d.snoozed_until||Date.parse(d.snoozed_until)<=now)).sort((a,b)=>Date.parse(a.due_at||a.target_at)-Date.parse(b.due_at||b.target_at));
 const changes=[];
 for(const d of due){const stage=d.native_file?d.band:!d.due_at?'target':Date.parse(d.due_at)<=now?'overdue':'approaching',key=hash([d.id,d.due_at||d.target_at,stage,...(d.native_file?[new Date(now).toISOString().slice(0,10)]:[])]);if(store.get('notifications',key))continue;changes.push({d,stage,key});if(changes.length===3)break;}
 if(!changes.length)return {verified:true,silent:true};
 const note=store.save('notes',{title:'Obligations needing attention',content:changes.map(({d,stage})=>d.sentence||`${d.title}: ${stage}, ${d.due_at?'due':'target'} ${d.due_at||d.target_at}`).join('\n'),source_app:'deadline-reminder'});
 for(const {d,stage,key} of changes)store.save('notifications',{id:key,deadline_id:d.id,stage,record_id:note.id,status:'ready'});
 if(changes.some(c=>c.d.native_file))dueDelivered(store,changes.filter(c=>c.d.native_file).map(c=>c.d.native_slug),new Date(now));
 return {verified:true,silent:false,record_id:note.id,delivery:'notebook'};
}
