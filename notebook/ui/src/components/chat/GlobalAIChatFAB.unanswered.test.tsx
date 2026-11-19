// @vitest-environment jsdom
// A message the AI did not answer says why under it, keeps saying so after a reload, shows once,
// and can be sent again in place (#790). Saves go through the notebook's own conversation merge.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {clearFileChat,hydrateFileChats} from '@/local/file-chat';
import {saveConversationState} from '../../../../core/conversation-state.mjs';

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
 conflicts.length=0;invoke.mockReset();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/query')return response({data:[...rows.values()].map(({context_key,state})=>({context_key,state}))});
  if(url==='/api/chat-state')return response({state:saveConversationState(store,JSON.parse(String(init?.body))).state});
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

it.each([
 ['the chat page','refused',REFUSED],
 ['the chat page','unreachable',UNREACHABLE],
 ["a note's chat",'refused',REFUSED],
 ["a note's chat",'unreachable',UNREACHABLE],
] as const)('in %s, a %s send says why after a reload, shows once and can be sent again',async(surface,_kind,reason)=>{
 invoke.mockResolvedValueOnce({data:null,error:{message:reason,context:new Response(JSON.stringify({error:reason}),{status:400})}});
 surfaces[surface].show();
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByText(reason,{},{timeout:1500})).toBeInTheDocument();
 await waitFor(()=>expect(saved(surfaces[surface].key)).toEqual([QUESTION]));

 await reload(surface);
 expect(await screen.findByText(reason)).toBeInTheDocument();
 expect(screen.getAllByText(QUESTION)).toHaveLength(1);
 expect(screen.getByText('No answer.')).toBeInTheDocument();
 expect(screen.getByLabelText('Message')).toHaveValue('');

 invoke.mockResolvedValueOnce({data:{reply:ANSWER},error:null});
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

const savedMessages=(key:string)=>[...rows.values()].find(r=>r.context_key===key)?.state.messages;
const deferred=()=>{let reject!:(e:unknown)=>void;const promise=new Promise((_,r)=>reject=r);return {promise,reject};};
const refusal=()=>({data:null,error:{message:REFUSED,context:new Response(JSON.stringify({error:REFUSED}),{status:400})}});

it('sends a failed message its own files again and does not attach them to the next message',async()=>{
 invoke.mockResolvedValueOnce(refusal());
 surfaces['the chat page'].show();
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:QUESTION}});
 fireEvent.click(screen.getByRole('button',{name:'Attach'}));
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await screen.findByText(REFUSED,{},{timeout:1500});
 expect(screen.queryByText('Staged fictional.txt')).toBeNull();

 invoke.mockResolvedValueOnce({data:{reply:ANSWER},error:null});
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
 await waitFor(()=>expect(screen.queryByText(QUESTION)).toBeNull());
 expect(screen.getByText(REFUSED)).toBeInTheDocument();
 expect(screen.queryByText('No answer.')).toBeNull();
 expect(saved('general')).toEqual([]);
});
