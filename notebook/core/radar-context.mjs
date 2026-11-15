const bytes=value=>Buffer.byteLength(JSON.stringify(value));
function excerpt(text,limit){text=String(text||'');let lo=0,hi=Math.min(text.length,Math.max(0,limit));while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(Buffer.byteLength(text.slice(0,mid))<=limit)lo=mid;else hi=mid-1;}if(lo&&/[\uD800-\uDBFF]/.test(text[lo-1]))lo--;return text.slice(0,lo);}
export function radarContext({workflow,sources,goals,prior,notes}){
 const limit=96*1024;
 // Authored instructions are always complete. Large installed methods fail
 // explicitly rather than silently losing their behavior sections.
 if(bytes(workflow)>48*1024)throw Error('The complete radar workflow exceeds the request budget. Review the selected installed workflow.');
 const context={workflow,goals,prior_proposals:[],sources:[],local_evidence:[],coverage:{full_sources_retained:true,source_excerpts:true,omitted_prior_proposals:0,omitted_local_notes:0}};
 if(bytes(context)>64*1024)throw Error('The full goals and radar workflow exceed the request budget. Review the selected goal scope.');
 const history=[...prior].sort((a,b)=>(b.radar?.verdict==='Caution')-(a.radar?.verdict==='Caution')||String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
 for(const note of history){const item={id:note.id,title:note.title,radar:{change:note.radar.change,item_id:note.radar.item_id,verdict:note.radar.verdict,source_hash:note.radar.source_hash}};if(context.prior_proposals.length>=50||bytes(context.prior_proposals)+bytes(item)>8000){context.coverage.omitted_prior_proposals++;continue;}context.prior_proposals.push(item);}
 const sourceBudget=Math.min(48000,Math.max(0,limit-bytes(context)-20000)),perSource=Math.floor(sourceBudget/Math.max(1,sources.length));
 for(const source of sources){const content=excerpt(source.content,Math.max(0,perSource-700));context.sources.push({...source,content,excerpted:content!==source.content,original_bytes:Buffer.byteLength(source.content)});}
 const terms=[...new Set(goals.flatMap(g=>String(g.title||g.own_words||'').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g)||[]).filter(w=>!['this','that','with','from','only','after','before','actual','fictional','test','software','using','must','have','into','through'].includes(w)))].slice(0,60);
 const rank=note=>{const title=String(note.title||'').toLowerCase(),body=String(note.content||'').slice(0,6000).toLowerCase();return (note.source_app==='goal-work'?5:0)+terms.reduce((score,term)=>score+(title.includes(term)?3:0)+(body.includes(term)?1:0),0)+(/personal ai|mission control|agent|retrieval|memory/i.test(title)?3:0);};
 const selected=notes.map(note=>({note,score:rank(note)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(b.note.updated_at||'').localeCompare(String(a.note.updated_at||'')));
 for(const {note} of selected){if(context.local_evidence.length>=12)break;const budget=Math.min(2400,limit-bytes(context)-1000);if(budget<300)break;const content=excerpt(note.content,budget),item={id:note.id,title:excerpt(note.title,300),content,excerpted:content!==note.content};if(bytes(context)+bytes(item)+1000>limit)break;context.local_evidence.push(item);}
 context.coverage.omitted_local_notes=notes.length-context.local_evidence.length;
 if(bytes(context)>limit)throw Error('Radar request metadata exceeds its bounded context. Select fewer sources.');
 return context;
}
