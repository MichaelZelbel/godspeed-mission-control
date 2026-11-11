// Who counts as a named person: the People list and its count (query.mjs) and the screens that show
// people (ui/src/components/timeline/people.ts) both read this one rule.
/** A person's real names and nicknames, lower-cased; entries that are not text or are blank are left out. */
export const personNames=p=>[p.name,...(Array.isArray(p.aliases)?p.aliases:[])]
  .filter(n=>typeof n==='string'&&n.trim()!=='').map(n=>n.toLowerCase());
