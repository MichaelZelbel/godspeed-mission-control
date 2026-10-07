// What may leave the owner's view: every path that sends records to a model or
// an assistant reads them through visibleRows, and nothing else decides it.
// A fact in a private section, its section's setting row, a hidden or
// sensitive subject, and a private (or, while sensitive things are hidden,
// sensitive) group are never given out. Until 6 October 2026 the private
// section held only for the profile views: the same fact read as a claim, or
// by note processing, reached the model. Whether "Always show to assistants"
// (show_to_agent) is on is not a hiding rule: like Menerio's curated profile,
// it decides what arrives unasked, and everything else stays searchable.
function privateFacts(query){
  const sections=new Set(query.rows('profile_categories').filter(c=>c.visibility_scope==='private').map(c=>c.slug+'|'+(c.contact_id||'')));
  const slots=new Map(query.rows('fact_slots').map(s=>[s.subject_type+'|'+(s.subject_id||'')+'|'+s.attribute,s]));
  // A section belongs to the person the fact is about, or to the owner (as in the profile_facts view).
  const slot=s=>!!s&&sections.has(s.category_slug+'|'+(s.subject_type==='contact'?s.subject_id||'':''));
  return {slot,claim:c=>slot(slots.get(c.subject_type+'|'+(c.subject_id||'')+'|'+c.attribute))};
}
export function visibleRows(query,type){
  return query.withSnapshot(()=>{
  const rows=query.rows(type),hideSensitive=query.rows('mcp_preferences')[0]?.hide_sensitive_from_ai!==false;
  // A person merged into another (Menerio's merge, kept by the import) is not
  // a second person, and what is about them is as visible as the person they
  // went into. Until 7 October 2026 a merged person counted as hidden, so
  // their notes, documents, events and facts never reached an assistant.
  const people=query.rows('contacts'),byId=new Map(people.map(r=>[r.id,r])),byUid=new Map(people.map(r=>[r.uid,r]));
  const closed=r=>r.ai_visibility==='hidden'||hideSensitive&&r.is_sensitive;
  const blocked=r=>{for(let hops=0;r;hops++){if(closed(r))return true;if(!r.merged_into||r.merged_into==='self')return false;if(hops>5)return true;r=byId.get(r.merged_into)||byUid.get(r.merged_into);}return false;};
  const blockedPeople=new Set(people.filter(blocked).map(r=>r.id)),duplicates=new Set(people.filter(r=>r.merged_into).map(r=>r.id));
  const blockedEntities=new Set(query.rows('entities').filter(r=>r.ai_visibility==='hidden'||hideSensitive&&r.is_sensitive).map(r=>r.id));
  const blockedNotes=new Set([...query.rows('person_documents').filter(r=>blockedPeople.has(r.contact_id)).map(r=>r.note_id),...query.rows('notes').filter(r=>blockedPeople.has(r.contact_id)||r.ai_visibility==='hidden'||hideSensitive&&r.is_sensitive).map(r=>r.id)]);
  const blockedMoments=new Set(query.rows('moment_participants').filter(r=>blockedPeople.has(r.person_id||r.contact_id)).map(r=>r.moment_id));
  const blockedGoals=new Set(query.rows('goals').filter(r=>r.ai_visibility==='hidden'||hideSensitive&&r.is_sensitive||r.visibility_scope==='private').map(r=>r.id));
  const blockedCollections=new Set(query.rows('collections').filter(r=>r.ai_visibility==='hidden'||hideSensitive&&r.is_sensitive||r.visibility_scope==='private').map(r=>r.id));
  // A group's sensitivity is set on its About card (GroupDetail.tsx): normal, sensitive or private.
  const blockedGroups=new Set(query.rows('contact_groups').filter(r=>r.ai_visibility==='hidden'||r.sensitivity==='private'||hideSensitive&&(r.sensitivity==='sensitive'||r.is_sensitive)).map(r=>r.id));
  const facts=['claims','fact_slots'].includes(type)?privateFacts(query):null;
  return rows.filter(r=>r.ai_visibility!=='hidden'&&!(hideSensitive&&r.is_sensitive)&&r.visibility_scope!=='private'&&!blockedPeople.has(r.contact_id||r.person_id)&&!blockedNotes.has(r.note_id||r.source_note_id)&&!blockedMoments.has(r.moment_id)&&
    !blockedGoals.has(r.goal_id)&&!blockedCollections.has(r.collection_id)&&!blockedGroups.has(r.group_id)&&!(type==='contact_groups'&&(blockedGroups.has(r.id)||blockedGroups.has(r.parent_group_id)))&&
    !(type==='claims'&&facts.claim(r))&&!(type==='fact_slots'&&facts.slot(r))&&
    !(type==='contacts'&&(blockedPeople.has(r.id)||duplicates.has(r.id)))&&!(type==='entities'&&blockedEntities.has(r.id))&&!(type==='notes'&&blockedNotes.has(r.id))&&!(type==='moments'&&blockedMoments.has(r.id))&&
    !((r.subject_type==='contact'||r.subject_kind==='contact')&&blockedPeople.has(r.subject_id))&&!((r.subject_type==='entity'||r.subject_kind==='entity')&&blockedEntities.has(r.subject_id))&&
    !(type==='world_entities'&&((r.kind==='person'&&blockedPeople.has(r.id))||(r.kind!=='person'&&blockedEntities.has(r.id))))&&
    !(r.source_type==='contact'&&blockedPeople.has(r.source_id))&&!(r.target_type==='contact'&&blockedPeople.has(r.target_id))&&!(r.source_type==='entity'&&blockedEntities.has(r.source_id))&&!(r.target_type==='entity'&&blockedEntities.has(r.target_id)));
  });
}
export function knowledgeContext(query){return query.withSnapshot(()=>{const types=['contacts','entities','world_claims','moments','collections','collection_items','contact_groups','contact_group_memberships','contact_topics','media_analysis','action_items','agent_instructions'];return Object.fromEntries(types.map(type=>[type,visibleRows(query,type)]));});}
