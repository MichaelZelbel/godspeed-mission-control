export function visibleRows(query,type){
  const rows=query.rows(type),hideSensitive=query.rows('mcp_preferences')[0]?.hide_sensitive_from_ai!==false;
  const blockedPeople=new Set(query.rows('contacts').filter(r=>r.ai_visibility==='hidden'||r.merged_into||hideSensitive&&r.is_sensitive).map(r=>r.id));
  const blockedEntities=new Set(query.rows('entities').filter(r=>r.ai_visibility==='hidden'||hideSensitive&&r.is_sensitive).map(r=>r.id));
  const blockedNotes=new Set(query.rows('person_documents').filter(r=>blockedPeople.has(r.contact_id)).map(r=>r.note_id));
  const blockedMoments=new Set(query.rows('moment_participants').filter(r=>blockedPeople.has(r.person_id||r.contact_id)).map(r=>r.moment_id));
  return rows.filter(r=>r.ai_visibility!=='hidden'&&!(hideSensitive&&r.is_sensitive)&&r.visibility_scope!=='private'&&!blockedPeople.has(r.contact_id||r.person_id)&&!blockedNotes.has(r.note_id)&&!blockedMoments.has(r.moment_id)&&
    !(type==='contacts'&&blockedPeople.has(r.id))&&!(type==='entities'&&blockedEntities.has(r.id))&&!(type==='notes'&&blockedNotes.has(r.id))&&!(type==='moments'&&blockedMoments.has(r.id))&&
    !(r.subject_type==='contact'&&blockedPeople.has(r.subject_id))&&!(r.subject_type==='entity'&&blockedEntities.has(r.subject_id)));
}
