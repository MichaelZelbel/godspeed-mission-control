// @vitest-environment jsdom
// A message the AI refused or could not be reached for says why under it, keeps saying so after a
// reload while the AI still fails, shows once, and can be sent again in place; once the AI works
// again the note goes from every open chat and stays gone, even when the AI fails again later
// (#821), and with no AI connected the no-AI sentence shows alone (#790). Saves go through the
// notebook's own conversation merge.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {clearFileChat,hydrateFileChats} from '@/local/file-chat';
import {saveConversationState} from '../../../../core/conversation-state.mjs';
import {NO_AI_CHAT} from '../../../../core/no-ai.mjs';

vi.mock('sonner',()=>({toast:{error:vi.fn(),warning:vi.fn()}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'},session:{user:{id:'owner'}}})}));
const invoke=vi.fn();
const row=(data:any)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data}),single:async()=>({data}),then:(f:any)=>Promise.resolve({data}).then(f)};return q;};
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 functions:{invoke:(...args:unknown[])=>invoke(...args)},
 from:(table:string)=>row(table==='notes'?{id:'note-1',title:'Fictional note'}:null),
}}));
vi.mock('./ChatMarkdown',()=>({default:({children}:any)=><p>{children}</p>}));
const FILE={path:'uploads/fictional.txt',name:'fictional.txt',type:'text/plain'};
vi.mock('./ChatComposer',()=>({default:({value,onChange,onSend,onStop,busy,files,onFiles}:any)=><><textarea aria-label="Message" value={value} onChange={e=>onChange(e.target.value)}/>
 {files.map((f:any)=><span key={f.path}>Staged {f.name}</span>)}<button onClick={()=>onFiles([...files,FILE])}>Attach</button>
 <button onClick={busy?onStop:onSend}>{busy?'Stop':'Send'}</button></>}));
Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});

// The notebook's answers to a send its AI refused or could not reach (server/main.mjs).
const REFUSED='Your AI key or sign-in was refused. Check it in Settings, Your AI, then try again.';
const UNREACHABLE='Your AI could not be reached. Check its connection in Settings, Your AI, then try again.';
const QUESTION='Fictional unanswered question',ANSWER='Fictional answer';

// What the notebook says about its AI (/api/chat/options): it reads a send's failure as the AI's state.
const MODELS=[{id:'',efforts:[]}];
const AI={
 ready:{connected:true,usable:true,availability:'ready',current:'',models:MODELS},
 refused:{connected:true,usable:false,availability:'refused',current:'',models:MODELS},
 unreachable:{connected:true,usable:false,availability:'unreachable',current:'',models:MODELS},
 none:{connected:false,usable:false,current:'No AI connected',models:MODELS},
};
let ai:any=AI.ready;
const rows=new Map<string,any>();
const conflicts:unknown[]=[];
const store={get:(_table:string,id:string)=>rows.get(id),withLock:(f:()=>any)=>f(),prepare:(table:string,record:any)=>({table,record}),
 commit:(ops:any[])=>ops.forEach(({table,record})=>{if(table==='note_conversations')rows.set(record.id,record);}),conflict:(...args:unknown[])=>conflicts.push(args)};
const response=(value:any)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const flushed=(event:Event)=>{const {requestId}=(event as CustomEvent).detail;window.dispatchEvent(new CustomEvent('menerio:flush-note-save-done',{detail:{requestId,updatedAt:null,content:null}}));};
beforeEach(async()=>{
 AbortSignal.timeout??=()=>new AbortController().signal;
 // The loaded conversations outlive a test, so each starts from the last one's emptied.
 for(const [id,record] of rows)rows.set(id,{...record,state:{messages:[],summary:'',summarizedUpTo:0}});
 conflicts.length=0;invoke.mockReset();ai=AI.ready;localStorage.clear();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/query')return response({data:[...rows.values()].map(({context_key,state})=>({context_key,state}))});
  if(url==='/api/chat-state')return response({state:saveConversationState(store,JSON.parse(String(init?.body))).state});
  if(url==='/api/chat/options')return response(ai);
  return response({});
 }));
 window.addEventListener('menerio:flush-note-save',flushed);
 await hydrateFileChats();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.removeEventListener('menerio:flush-note-save',flushed);});

const surfaces={
 'the chat page':{key:'general',show:()=>render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/dashboard/chat']}><GlobalAIChatFAB page/></MemoryRouter></QueryClientProvider>)},
 "a note's chat":{key:'note:note-1',show:()=>{
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/dashboard/notes/note-1']}><GlobalAIChatFAB embedded/></MemoryRouter></QueryClientProvider>);
  act(()=>{window.dispatchEvent(new Event('godspeed:toggle-note-chat'));});
 }},
};
const reload=async(surface:keyof typeof surfaces)=>{
 cleanup();
 await hydrateFileChats();
 surfaces[surface].show();
 await screen.findByLabelText('Message');
};
const saved=(key:string)=>[...rows.values()].find(r=>r.context_key===key)?.state.messages.map((m:any)=>m.content);
const follows=(a:HTMLElement,b:HTMLElement)=>!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING);

// The notebook's answer to each failed send, and what it then says about the AI.
const failures={
 refused:{reason:REFUSED,state:AI.refused,answer:()=>({data:null,error:{message:REFUSED,context:new Response(JSON.stringify({error:REFUSED}),{status:400})}})},
 unreachable:{reason:UNREACHABLE,state:AI.unreachable,answer:()=>({data:null,error:{message:UNREACHABLE,context:new Response(JSON.stringify({error:UNREACHABLE}),{status:502})}})},
};
const typeAndFail=async(kind:keyof typeof failures,text:string)=>{
 const failure=failures[kind];
 invoke.mockImplementationOnce(async()=>{ai=failure.state;return failure.answer();});
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:text}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByText(failure.reason,{},{timeout:3000})).toBeInTheDocument();
};
const sendFailing=async(surface:keyof typeof surfaces,kind:keyof typeof failures)=>{
 surfaces[surface].show();
 await typeAndFail(kind,QUESTION);
 expect(screen.getByText('No answer.')).toBeInTheDocument();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION]));
};

it.each([
 ['the chat page','refused'],
 ['the chat page','unreachable'],
 ["a note's chat",'refused'],
 ["a note's chat",'unreachable'],
] as const)('in %s, a %s send says why after a reload, shows once and can be sent again',async(surface,kind)=>{
 const {reason}=failures[kind];
 await sendFailing(surface,kind);
 expect(document.querySelector('.animate-spin')).toBeNull();

 await reload(surface);
 expect(await screen.findByText(reason)).toBeInTheDocument();
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.getByText('No answer.')).toBeInTheDocument();
 expect(screen.getByLabelText('Message')).toHaveValue('');

 invoke.mockImplementationOnce(async()=>{ai=AI.ready;return {data:{reply:ANSWER},error:null};});
 fireEvent.click(screen.getByRole('button',{name:'Send again'}));
 const answer=await screen.findByText(ANSWER,{},{timeout:1500});
 const sent=(invoke.mock.calls.at(-1) as any)[1].body;
 expect(sent.message).toBe(QUESTION);
 expect(sent.messages.filter((m:any)=>m.role==='user').map((m:any)=>m.content)).toEqual([QUESTION]);
 expect(follows(screen.getByText(QUESTION),answer)).toBe(true);
 expect(screen.queryByText('No answer.')).toBeNull();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,ANSWER]));

 await reload(surface);
 const reloaded=await screen.findByText(ANSWER);
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.getAllByText(ANSWER)).toHaveLength(1);
 expect(follows(screen.getByText(QUESTION),reloaded)).toBe(true);
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(screen.queryByText(reason)).toBeNull();
 expect(conflicts).toEqual([]);
});

it.each([
 ['the chat page','refused','its key is accepted again'],
 ["a note's chat",'unreachable','it can be reached again'],
 ["a note's chat",'refused','its key is accepted again'],
] as const)('in %s, the note of a %s send goes from every open chat once %s, and stays gone after a reload',async(surface,kind,_recovery)=>{
 await sendFailing(surface,kind);
 // The same conversation open in its own window says the same.
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[surface==='the chat page'?'/dashboard/chat':'/dashboard/chat?note=note-1']}><GlobalAIChatFAB page/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(screen.getAllByText('No answer.')).toHaveLength(2),{timeout:3000});
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(2);

 ai=AI.ready;
 await waitFor(()=>expect(screen.queryAllByText('No answer.')).toHaveLength(0),{timeout:3000});
 expect(screen.queryAllByRole('button',{name:'Send again'})).toHaveLength(0);
 expect(screen.queryByText(failures[kind].reason)).toBeNull();

 await reload(surface);
 await waitFor(()=>expect(screen.getAllByText(QUESTION)).toHaveLength(1));
 await new Promise(r=>setTimeout(r,1200));
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(screen.queryByText(failures[kind].reason)).toBeNull();
});

const SECOND='Fictional later question';
it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('in %s, a note that cleared once the AI worked stays cleared when a later send fails, also after a reload',async(surface)=>{
 await sendFailing(surface,'unreachable');
 ai=AI.ready;
 await waitFor(()=>expect(screen.queryAllByText('No answer.')).toHaveLength(0),{timeout:3000});

 // A second outage: only the message sent after the AI last worked gets a note.
 await typeAndFail('refused',SECOND);
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,SECOND]));
 const check=()=>{
  expect(screen.getAllByText('No answer.')).toHaveLength(1);
  expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(1);
  expect(follows(screen.getByText(SECOND),screen.getByText('No answer.'))).toBe(true);
  expect(screen.queryByText(UNREACHABLE)).toBeNull();
 };
 check();
 await reload(surface);
 expect(await screen.findByText(REFUSED,{},{timeout:3000})).toBeInTheDocument();
 check();
});

it('a note in a chat that was closed while the AI worked again stays cleared in a later outage',async()=>{
 await sendFailing("a note's chat",'unreachable');
 cleanup();
 // The AI works again while only the chat page is open.
 ai=AI.ready;
 surfaces['the chat page'].show();
 await waitFor(()=>expect(localStorage.getItem('godspeed:ai-worked-at')).not.toBeNull(),{timeout:3000});
 cleanup();

 ai=AI.unreachable;
 await reload("a note's chat");
 await waitFor(()=>expect(document.querySelector('[data-chat-ai-state="unreachable"]')).not.toBeNull(),{timeout:3000});
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(screen.queryByRole('button',{name:'Send again'})).toBeNull();
});

it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('in %s, a send with no AI connected says the no-AI sentence alone, and sending it again keeps one copy',async(surface)=>{
 ai=AI.none;
 invoke.mockResolvedValueOnce({data:null,error:{message:NO_AI_CHAT,context:new Response(JSON.stringify({error:NO_AI_CHAT}),{status:400})}});
 surfaces[surface].show();
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByText(NO_AI_CHAT,{},{timeout:1500})).toBeInTheDocument();
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(screen.queryByRole('button',{name:'Send again'})).toBeNull();
 expect(screen.getByLabelText('Message')).toHaveValue(QUESTION);

 // An AI is connected, and the words left in the composer are sent: the question shows once.
 ai=AI.ready;
 invoke.mockResolvedValueOnce({data:{reply:ANSWER},error:null});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await screen.findByText(ANSWER,{},{timeout:1500});
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,ANSWER]));
 await reload(surface);
 await screen.findByText(ANSWER);
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
});

const savedMessages=(key:string)=>[...rows.values()].find(r=>r.context_key===key)?.state.messages;
const deferred=()=>{let reject!:(e:unknown)=>void;const promise=new Promise((_,r)=>reject=r);return {promise,reject};};
const inConversation=(text:string)=>screen.queryAllByText(text).filter(element=>element.tagName!=='TEXTAREA');
const refusal=()=>({data:null,error:{message:REFUSED,context:new Response(JSON.stringify({error:REFUSED}),{status:400})}});

it('sends a failed message its own files again and does not attach them to the next message',async()=>{
 invoke.mockImplementationOnce(async()=>{ai=AI.refused;return refusal();});
 surfaces['the chat page'].show();
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Attach'}));
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await screen.findByText(REFUSED,{},{timeout:1500});
 expect(screen.queryByText('Staged fictional.txt')).toBeNull();

 invoke.mockImplementationOnce(async()=>{ai=AI.ready;return {data:{reply:ANSWER},error:null};});
 fireEvent.click(screen.getByRole('button',{name:'Send again'}));
 await screen.findByText(ANSWER,{},{timeout:1500});
 expect((invoke.mock.calls.at(-1) as any)[1].body.files).toEqual([FILE]);
 expect(screen.queryByText('Staged fictional.txt')).toBeNull();

 invoke.mockResolvedValueOnce({data:{reply:'Fictional second answer'},error:null});
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Fictional next message'}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await screen.findByText('Fictional second answer',{},{timeout:1500});
 await waitFor(()=>expect(savedMessages('general')?.map((m:any)=>m.attachments)).toEqual([[FILE],undefined,[],undefined]));
});

it('does not mark a send stopped by the person as unanswered',async()=>{
 const pending=deferred();invoke.mockReturnValueOnce(pending.promise);
 surfaces['the chat page'].show();
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await waitFor(()=>expect(invoke).toHaveBeenCalled());
 fireEvent.click(screen.getByRole('button',{name:'Stop'}));
 await act(async()=>pending.reject(new Error('aborted')));
 expect(await screen.findByText('Reply stopped.')).toBeInTheDocument();
 await waitFor(()=>expect(saved('general')).toEqual([QUESTION]));

 await reload('the chat page');
 expect(await screen.findByText(QUESTION)).toBeInTheDocument();
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(savedMessages('general')[0].lastFailure).toBeUndefined();
});

it('does not write a conversation cleared in another window back when its send fails',async()=>{
 const pending=deferred();invoke.mockReturnValueOnce(pending.promise);
 surfaces['the chat page'].show();
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await waitFor(()=>expect(saved('general')).toEqual([QUESTION]));
 await act(async()=>{await clearFileChat('general');});
 await act(async()=>pending.reject(new Error(REFUSED)));
 expect(await screen.findByText(REFUSED)).toBeInTheDocument();
 await waitFor(()=>expect(inConversation(QUESTION)).toHaveLength(0));
 expect(screen.getByText(REFUSED)).toBeInTheDocument();
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(saved('general')).toEqual([]);
});
