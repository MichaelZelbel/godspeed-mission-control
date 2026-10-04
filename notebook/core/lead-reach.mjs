export function validateReach(reach,{contacts,sources,local,notes,now=Date.now()}){
 if(reach===null)return null;
 if(!reach||typeof reach!=='object')throw Error('Choose one source-checked reach or null');
 const contact=contacts.find(c=>c.id===reach.contact_id),source=sources.find(s=>s.id===reach.source_id&&s.contact_id===reach.contact_id),offer=local.find(n=>n.id===reach.offer_source_id);
 if(!contact||!source)throw Error('A named reach needs the selected person and their actually read source');
 if(contact.known_person&&(!contact.relationship_confirmed||!contact.relationship||!notes.some(n=>n.id===contact.shared_event_note_id)))throw Error('The selected personal relationship and shared event are not confirmed');
 for(const key of ['quote','date_quote','offer_quote','why_them','offer','draft'])if(typeof reach[key]!=='string'||!reach[key].trim())throw Error('A named reach is missing '+key);
 if(!source.content.includes(reach.quote)||!source.content.includes(reach.date_quote)||!offer?.content.includes(reach.offer_quote))throw Error('Reach statement, date and useful offer must quote their actual sources');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(reach.statement_date)||!reach.date_quote.includes(reach.statement_date))throw Error('Use the actual ISO date quoted in the recent statement');
 const date=Date.parse(reach.statement_date+'T00:00:00Z');if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==reach.statement_date||date>now||now-date>14*86400000)throw Error('The selected statement is not a verified recent dated source');
 if(reach.draft.trim().split(/\s+/).length>100||reach.draft.includes('\u2014'))throw Error('Keep the reach draft short and plain');
 return {...reach,name:contact.name,url:source.url,state:'draft',statement_date_source:'quoted-primary-source'};
}
