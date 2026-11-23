// @vitest-environment jsdom
// A message that got no answer (no AI connected, refused, unreachable, an unusable answer) says so
// under it, with Send again, until the message right after it is the AI's answer: after a reload,
// after later sends, and when an AI is connected or removed (#1043). Send again asks it in place.
// Saves go through the notebook's own conversation merge.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {WAIT} from '@/test/wait-limits';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {NO_ANSWER_AI_WORKS} from '@/lib/chat-history';
import {clearFileChat,hydrateFileChats} from '@/local/file-chat';
import {retainCompletedConversation,saveConversationState} from '../../../../core/conversation-state.mjs';
import {AI_UNREADABLE as UNREADABLE,NO_AI_CHAT} from '../../../../core/no-ai.mjs';

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
 await screen.findByLabelText('Message',{},WAIT);
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
 fireEvent.change(await screen.findByLabelText('Message',{},WAIT),{target:{value:text}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByText(failure.reason,{},{timeout:3000})).toBeInTheDocument();
};
const sendFailing=async(surface:keyof typeof surfaces,kind:keyof typeof failures)=>{
 surfaces[surface].show();
 await typeAndFail(kind,QUESTION);
 expect(screen.getByText('No answer.')).toBeInTheDocument();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION]),WAIT);
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
 expect(await screen.findByText(reason,{},WAIT)).toBeInTheDocument();
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
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,ANSWER]),WAIT);

 await reload(surface);
 const reloaded=await screen.findByText(ANSWER,{},WAIT);
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.getAllByText(ANSWER)).toHaveLength(1);
 expect(follows(screen.getByText(QUESTION),reloaded)).toBe(true);
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(screen.queryByText(reason)).toBeNull();
 expect(conflicts).toEqual([]);
});

const SECOND='Fictional later question',SECOND_ANSWER='Fictional answer to the later question';
const noAiError=()=>({data:null,error:{message:NO_AI_CHAT,context:new Response(JSON.stringify({error:NO_AI_CHAT}),{status:400})}});
const settle=()=>new Promise(r=>setTimeout(r,1200));

it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('in %s, a send with no AI connected keeps the no-AI note and Send again, also after a reload, until it is answered',async(surface)=>{
 ai=AI.none;
 invoke.mockResolvedValueOnce(noAiError());
 surfaces[surface].show();
 fireEvent.change(await screen.findByLabelText('Message',{},WAIT),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByText(NO_AI_CHAT,{},{timeout:1500})).toBeInTheDocument();
 expect(screen.getByText('No answer.')).toBeInTheDocument();
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(1);
 expect(screen.getByLabelText('Message')).toHaveValue('');
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION]),WAIT);

 await reload(surface);
 expect(await screen.findByText(NO_AI_CHAT,{},WAIT)).toBeInTheDocument();
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.getByText('No answer.')).toBeInTheDocument();

 ai=AI.ready;
 expect(await screen.findByText(NO_ANSWER_AI_WORKS,{},{timeout:3000})).toBeInTheDocument();
 invoke.mockResolvedValueOnce({data:{reply:ANSWER},error:null});
 fireEvent.click(screen.getByRole('button',{name:'Send again'}));
 const answer=await screen.findByText(ANSWER,{},{timeout:1500});
 expect(follows(screen.getByText(QUESTION),answer)).toBe(true);
 expect(screen.queryByText('No answer.')).toBeNull();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,ANSWER]),WAIT);

 await reload(surface);
 await screen.findByText(ANSWER,{},WAIT);
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.getAllByText(ANSWER)).toHaveLength(1);
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(conflicts).toEqual([]);
});

// The invoke mock answers the way the server does: the reply lands right after its own question.
const answering=(reply:string)=>async(_fn:string,{body}:any)=>{
 ai=AI.ready;
 retainCompletedConversation(store,{...body,conversation_id:body.conversation_id},{reply});
 return {data:{reply},error:null};
};

it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('in %s, an earlier message that got no answer keeps its note and Send again when a later send is answered, also after a reload, and is answered in place',async(surface)=>{
 await sendFailing(surface,'unreachable');
 invoke.mockImplementationOnce(answering(SECOND_ANSWER));
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:SECOND}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await screen.findByText(SECOND_ANSWER,{},{timeout:1500});
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,SECOND,SECOND_ANSWER]),WAIT);
 const check=()=>{
  expect(screen.getAllByText('No answer.')).toHaveLength(1);
  expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(1);
  expect(follows(screen.getByText(QUESTION),screen.getByText('No answer.'))).toBe(true);
  expect(follows(screen.getByText('No answer.'),screen.getByText(SECOND))).toBe(true);
 };
 await settle();
 check();
 await reload(surface);
 await screen.findByText(SECOND_ANSWER,{},WAIT);
 check();

 invoke.mockImplementationOnce(answering('Fictional answer to the first question'));
 fireEvent.click(screen.getByRole('button',{name:'Send again'}));
 const answer=await screen.findByText('Fictional answer to the first question',{},{timeout:1500});
 const sent=(invoke.mock.calls.at(-1) as any)[1].body;
 expect(sent.message).toBe(QUESTION);
 expect(sent.messages.at(-1)).toEqual({role:'user',content:QUESTION});
 expect(sent.messages.filter((m:any)=>m.content===QUESTION)).toHaveLength(1);
 expect(follows(screen.getByText(QUESTION),answer)).toBe(true);
 expect(follows(answer,screen.getByText(SECOND))).toBe(true);
 expect(screen.queryByText('No answer.')).toBeNull();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,'Fictional answer to the first question',SECOND,SECOND_ANSWER]),WAIT);
 await reload(surface);
 await screen.findByText(SECOND_ANSWER,{},WAIT);
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(saved(surfaces[surface].key)).toEqual([QUESTION,'Fictional answer to the first question',SECOND,SECOND_ANSWER]);
});

it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('in %s, two messages that got no answer each keep a note and Send again',async(surface)=>{
 await sendFailing(surface,'unreachable');
 await typeAndFail('refused',SECOND);
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,SECOND]),WAIT);
 const check=()=>{
  expect(screen.getAllByText('No answer.')).toHaveLength(2);
  expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(2);
 };
 check();
 await reload(surface);
 await screen.findByText(REFUSED,{},{timeout:3000});
 check();
});

it("a note stays in a note's chat and its pop-out when a later send is answered in one of them",async()=>{
 await sendFailing("a note's chat",'unreachable');
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/dashboard/chat?note=note-1']}><GlobalAIChatFAB page/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(screen.getAllByText('No answer.')).toHaveLength(2),{timeout:3000});
 invoke.mockImplementationOnce(answering(SECOND_ANSWER));
 fireEvent.change(screen.getAllByLabelText('Message')[0],{target:{value:SECOND}});
 fireEvent.click(screen.getAllByRole('button',{name:'Send'})[0]);
 await waitFor(()=>expect(screen.getAllByText(SECOND_ANSWER).length).toBeGreaterThan(0),{timeout:3000});
 await waitFor(()=>expect(saved('note:note-1')).toEqual([QUESTION,SECOND,SECOND_ANSWER]),WAIT);
 await settle();
 expect(screen.getAllByText('No answer.')).toHaveLength(2);
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(2);
});

it.each([
 ['the chat page','refused'],
 ["a note's chat",'unreachable'],
 ["a note's chat",'refused'],
] as const)('in %s, a %s send keeps its note and Send again in every open chat when an AI is connected or removed, also after a reload',async(surface,kind)=>{
 await sendFailing(surface,kind);
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[surface==='the chat page'?'/dashboard/chat':'/dashboard/chat?note=note-1']}><GlobalAIChatFAB page/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(screen.getAllByText('No answer.')).toHaveLength(2),{timeout:3000});
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(2);

 ai=AI.ready;
 await waitFor(()=>expect(screen.getAllByText(NO_ANSWER_AI_WORKS)).toHaveLength(2),{timeout:3000});
 await settle();
 expect(screen.getAllByText('No answer.')).toHaveLength(2);
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(2);

 await reload(surface);
 expect(await screen.findByText(NO_ANSWER_AI_WORKS,{},WAIT)).toBeInTheDocument();
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(1);

 ai=AI.none;
 expect(await screen.findByText(failures[kind].reason,{},{timeout:3000})).toBeInTheDocument();
 expect(screen.getByText('No answer.')).toBeInTheDocument();
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(1);
 await reload(surface);
 expect(await screen.findByText(failures[kind].reason,{},WAIT)).toBeInTheDocument();
 expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(1);
});

const savedMessages=(key:string)=>[...rows.values()].find(r=>r.context_key===key)?.state.messages;
const deferred=()=>{let reject!:(e:unknown)=>void;const promise=new Promise((_,r)=>reject=r);return {promise,reject};};
const inConversation=(text:string)=>screen.queryAllByText(text).filter(element=>element.tagName!=='TEXTAREA');
const refusal=()=>({data:null,error:{message:REFUSED,context:new Response(JSON.stringify({error:REFUSED}),{status:400})}});

it('sends a failed message its own files again and does not attach them to the next message',async()=>{
 invoke.mockImplementationOnce(async()=>{ai=AI.refused;return refusal();});
 surfaces['the chat page'].show();
 fireEvent.change(await screen.findByLabelText('Message',{},WAIT),{target:{value:QUESTION}});
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
 await waitFor(()=>expect(savedMessages('general')?.map((m:any)=>m.attachments)).toEqual([[FILE],undefined,[],undefined]),WAIT);
});

it('does not mark a send stopped by the person as unanswered',async()=>{
 const pending=deferred();invoke.mockReturnValueOnce(pending.promise);
 surfaces['the chat page'].show();
 fireEvent.change(await screen.findByLabelText('Message',{},WAIT),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await waitFor(()=>expect(invoke).toHaveBeenCalled(),WAIT);
 fireEvent.click(screen.getByRole('button',{name:'Stop'}));
 await act(async()=>pending.reject(new Error('aborted')));
 expect(await screen.findByText('Reply stopped.',{},WAIT)).toBeInTheDocument();
 await waitFor(()=>expect(saved('general')).toEqual([QUESTION]),WAIT);

 await reload('the chat page');
 expect(await screen.findByText(QUESTION,{},WAIT)).toBeInTheDocument();
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(savedMessages('general')[0].lastFailure).toBeUndefined();
});

it('does not write a conversation cleared in another window back when its send fails',async()=>{
 const pending=deferred();invoke.mockReturnValueOnce(pending.promise);
 surfaces['the chat page'].show();
 fireEvent.change(await screen.findByLabelText('Message',{},WAIT),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await waitFor(()=>expect(saved('general')).toEqual([QUESTION]),WAIT);
 await act(async()=>{await clearFileChat('general');});
 await act(async()=>pending.reject(new Error(REFUSED)));
 expect(await screen.findByText(REFUSED,{},WAIT)).toBeInTheDocument();
 await waitFor(()=>expect(inConversation(QUESTION)).toHaveLength(0),WAIT);
 expect(screen.getByText(REFUSED)).toBeInTheDocument();
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(saved('general')).toEqual([]);
});

// The AI answered, but with something the notebook cannot read: it still reads as working.
it.each(Object.keys(surfaces) as (keyof typeof surfaces)[])('in %s, a send whose answer could not be used says so after a reload, shows once and can be sent again',async(surface)=>{
 surfaces[surface].show();
 invoke.mockImplementationOnce(async()=>({data:null,error:{message:UNREADABLE,context:new Response(JSON.stringify({error:UNREADABLE}),{status:400})}}));
 fireEvent.change(await screen.findByLabelText('Message',{},WAIT),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 const check=()=>{
  expect(screen.getByText(UNREADABLE)).toBeInTheDocument();
  expect(screen.getByText('No answer.')).toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'Send again'})).toHaveLength(1);
  expect(screen.getAllByText(QUESTION)).toHaveLength(1);
  expect(screen.getByLabelText('Message')).toHaveValue('');
 };
 expect(await screen.findByText(UNREADABLE,{},{timeout:3000})).toBeInTheDocument();
 check();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION]),WAIT);
 // The AI reads as working, which must not clear the note.
 await settle();
 check();

 await reload(surface);
 expect(await screen.findByText(UNREADABLE,{},WAIT)).toBeInTheDocument();
 check();

 invoke.mockImplementationOnce(async()=>({data:{reply:ANSWER},error:null}));
 fireEvent.click(screen.getByRole('button',{name:'Send again'}));
 const answer=await screen.findByText(ANSWER,{},{timeout:1500});
 const sent=(invoke.mock.calls.at(-1) as any)[1].body;
 expect(sent.message).toBe(QUESTION);
 expect(sent.messages.filter((m:any)=>m.role==='user').map((m:any)=>m.content)).toEqual([QUESTION]);
 expect(follows(screen.getByText(QUESTION),answer)).toBe(true);
 expect(screen.queryByText('No answer.')).toBeNull();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION,ANSWER]),WAIT);

 await reload(surface);
 await screen.findByText(ANSWER,{},WAIT);
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(screen.queryByText(UNREADABLE)).toBeNull();
 expect(conflicts).toEqual([]);
});

it('sends a summarized chat the summary and exactly the messages it does not cover when an earlier message is sent again',async()=>{
 const messages=Array.from({length:18},(_,i)=>({role:i%2?'assistant':'user',content:`Fictional message ${i}`}));
 messages[2]={role:'user',content:QUESTION,lastFailure:UNREACHABLE} as any;
 messages[3]={role:'user',content:'Fictional message 3'};
 rows.set('seeded',{id:'seeded',context_key:'general',state:{messages,summary:'Fictional summary',summarizedUpTo:6}});
 await reload('the chat page');
 invoke.mockImplementationOnce(async()=>({data:{reply:ANSWER},error:null}));
 fireEvent.click(await screen.findByRole('button',{name:'Send again'},WAIT));
 await screen.findByText(ANSWER,{},{timeout:1500});
 const sent=(invoke.mock.calls.at(-1) as any)[1].body.messages;
 const uncovered=messages.filter((_,i)=>i!==2).slice(5).map(({role,content})=>({role,content}));
 expect(sent).toEqual([{role:'system',content:'Conversation summary so far:\nFictional summary'},...uncovered,{role:'user',content:QUESTION}]);
});
