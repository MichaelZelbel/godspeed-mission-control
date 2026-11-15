import {createRequire} from 'node:module';
import {visibleRows} from './visibility.mjs';
const require=createRequire(import.meta.url),{createGoalCommands}=require('../../tools/goals.js');
export function goalContracts(store,query){
 const goalCard=g=>({id:g.id,f:{...(g.legacy_fields||{}),ID:g.id,KIND:g.kind||'outcome',STATUS:g.status==='active'?'adopted':g.status,TITLE:g.title,AREA:g.area||'work-money',MEASURE:g.measure||'',LEAD:g.lead||'',DEADLINE:g.deadline||'',SERVES:(g.serves||[]).join(','),'DEPENDS ON':(g.depends_on||[]).join(','),PROTECTED:g.protected?'yes':'no',IMPORTANCE:g.importance||'normal'},log:[...(g.legacy_log||[]),...(g.progress||[]).map(p=>({date:(p.at||g.created_at).slice(0,10),event:'PROGRESS',rest:p.evidence||''})),...(g.last_attention?[{date:g.last_attention.slice(0,10),event:'ATTENTION',rest:'Integrated decision selected this goal'}]:[])]});
 const readableGoals=()=>visibleRows(query,'goals'),readableWork=()=>visibleRows(query,'work_items');
 const goals={all:()=>readableGoals().map(goalCard),read:id=>{const g=readableGoals().find(g=>g.id===id);return g?goalCard(g):null;},exists:id=>readableGoals().some(g=>g.id===id)};
 const work={exists:id=>readableWork().some(w=>w.id===id),read:id=>{const w=readableWork().find(w=>w.id===id);return w?{id:w.id,f:{STATUS:w.state},log:w.state==='verified'?[{date:(w.verification?.at||w.updated_at).slice(0,10),event:'VERIFIED',rest:w.verification?.evidence||''}]:[]}:null;}};
 return createGoalCommands({root:store.root,goalStore:goals,workStore:work});
}
