// The dashboard's count of people is the People list's count: a person
// merged into another is not a second person. Until 6 October 2026 the
// dashboard counted all contacts, so the real notebook showed 294 people on
// the dashboard and 275 in the list (19 merged).
export const peopleCountQuery = {table:'contacts',filters:[['is','merged_into',null]],selection:'id',options:{head:true}};
