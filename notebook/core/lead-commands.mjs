import {safe} from './records/store.mjs';import {visibleRows} from './visibility.mjs';
const result=value=>({result:typeof value==='string'?value:JSON.stringify(value,null,2)});
export function leadWords(message){const match=String(message).match(/^\/lead\s*(\S+)?\s*([\s\S]*)$/);if(!match)throw Error('Choose a lead command');const command=match[1]||'help',tail=match[2].trim();if(command==='outcome'){const outcome=tail.match(/^(\S+)\s+([\s\S]+)$/);if(!outcome)throw Error('Supply an entry ID and JSON outcome');return ['/lead',command,outcome[1],outcome[2]];}return ['/lead',command,...(tail?(command==='source'?tail.split(/\s+/):[tail]):[])];}
const nonempty=(value,name)=>{if(typeof value!=='string'||!value.trim()||value.length>10000)throw Error(name+' needs text');return value.trim();};
function publicURL(raw){const url=new URL(raw);if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))||[...url.searchParams.keys()].some(k=>/^(?:token|key|api[_-]?key|access[_-]?token|password|secret)$/i.test(k)))throw Error('Use a public HTTPS URL without credentials');return url.href;}
function json(words){let value;try{value=JSON.parse(words.join(' '));}catch{throw Error('Supply one JSON object; use /lead help');}if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Supply one JSON object');return value;}
export function leadCommand({store,query},args){
 if(!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.length>20000))throw Error('Choose a supported lead command');
 const [command='help',...words]=args;
 if(['help','-h','--help'].includes(command))return result('/lead queue|runs|examples|positions|contacts\n/lead example JSON {content,status:approved|refused,position_id?,shape?}\n/lead position JSON {id?,title,status:adopted|paused,research_due_at?,research_action?}\n/lead contact JSON {id?,name,url,hot?}\n/lead configure JSON {profile_urls:[HTTPS]}\n/lead source NOTE_ID on|off\n/lead outcome ENTRY_ID JSON {status:shown|refused|ignored|posted,feedback?,posted_url?,posted_at?}\nThese commands prepare local drafts and retain your reported outcomes. They never publish. Posted links require separate verification before being treated as observed publication. Enable the Lead routine in Settings only when you want it to run.');
 const tables={queue:'lead_entries',runs:'lead_runs',examples:'lead_examples',positions:'lead_positions',contacts:'lead_contacts'};
 if(tables[command])return result(visibleRows(query,tables[command]));
 if(command==='source'){const id=safe(words[0]||''),note=visibleRows(query,'notes').find(n=>n.id===id);if(!note)throw Error('Select an existing assistant-visible note');if(!['on','off'].includes(words[1]))throw Error('Choose source on or off');return result(store.save('notes',{id,lead_evidence:words[1]==='on'},note._hash));}
 if(command==='outcome'){
  const id=safe(words.shift()||''),entry=visibleRows(query,'lead_entries').find(e=>e.id===id);if(!entry)throw Error('Select an existing contribution');const input=json(words),status=input.status;if(!['shown','refused','ignored','posted'].includes(status))throw Error('Choose an observed outcome');
  const fields={status,feedback:input.feedback?nonempty(input.feedback,'Feedback'):null,outcome_source:'user-report',outcome_at:new Date().toISOString()};
  if(status==='shown')fields.shown_at=new Date().toISOString();
  if(status==='posted'){fields.posted_url=publicURL(input.posted_url);if(!Number.isFinite(Date.parse(input.posted_at))||Date.parse(input.posted_at)>Date.now())throw Error('Supply the actual past posting date');fields.posted_at=new Date(input.posted_at).toISOString();fields.posted_verification={state:'unverified',reason:'User supplied the link; its published text has not been read'};}
  return result(store.save('lead_entries',{id,...fields},entry._hash));
 }
 const input=json(words);if(input.id)safe(input.id);
 if(command==='example'){if(!['approved','refused'].includes(input.status))throw Error('Choose approved or refused');return result(store.save('lead_examples',{content:nonempty(input.content,'Example'),status:input.status,...(input.position_id?{position_id:safe(input.position_id)}:{}),...(input.shape?{shape:input.shape}:{})}));}
 if(command==='position'){if(!['adopted','paused'].includes(input.status))throw Error('Choose adopted or paused');if(input.research_due_at&&!Number.isFinite(Date.parse(input.research_due_at)))throw Error('Supply an actual research date');return result(store.save('lead_positions',{...(input.id?{id:input.id}:{}),title:nonempty(input.title,'Position'),status:input.status,research_due_at:input.research_due_at||null,research_action:input.research_action?nonempty(input.research_action,'Research step'):null}));}
 if(command==='contact')return result(store.save('lead_contacts',{...(input.id?{id:input.id}:{}),name:nonempty(input.name,'Name'),url:publicURL(input.url),hot:input.hot===true,status:'selected'}));
 if(command==='configure'){if(!Array.isArray(input.profile_urls)||input.profile_urls.length>10)throw Error('Select at most ten public profile URLs');return result(store.save('settings',{id:'lead',profile_urls:input.profile_urls.map(publicURL)}));}
 throw Error('Choose a supported lead command; use /lead help');
}
