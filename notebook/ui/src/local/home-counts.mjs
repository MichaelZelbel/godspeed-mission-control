// The dashboard's count of people is the People list's own total
// (search_contacts_page), so the two cannot disagree. Until 6 October 2026 the
// dashboard counted all contacts, so the real notebook showed 294 people on
// the dashboard and 275 in the list (19 merged); until issue 266 it still
// counted people saved without a name, whom the list leaves out.
export const peopleCountRequest = {rpc:'search_contacts_page',args:{search_text:'',page_size:1}};
