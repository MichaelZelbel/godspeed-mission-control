// @vitest-environment jsdom
// "Open chat in a new window" opens the same conversation (issue #588): the address carries the
// context, and the chat page opened from it talks to that context again.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {hydrateFileChats} from '@/local/file-chat';

vi.mock('sonner',()=>({toast:{error:vi.fn(),warning:vi.fn()}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'},session:{user:{id:'owner'}}})}));
const invoke=vi.fn(async()=>({data:{reply:'Fictional reply'},error:null}));
const row=(data:any)=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data}),single:async()=>({data}),then:(f:any)=>Promise.resolve({data}).then(f)};return q;};
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 functions:{invoke:(...args:unknown[])=>invoke(...(args as []))},
 from:(table:string)=>row(table==='collections'?{id:'col-1'}:table==='notes'?{id:'note-1',title:'Fictional note'}:table==='contacts'?{id:'person-1',first_name:'Fictional'}:null),
}}));
vi.mock('./ChatMarkdown',()=>({default:({children}:any)=><p>{children}</p>}));
vi.mock('./ChatComposer',()=>({default:({value,onChange,onSend,busy}:any)=><><textarea aria-label="Message" value={value} onChange={e=>onChange(e.target.value)}/><button onClick={onSend} disabled={busy}>Send</button></>}));
Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
const collectionChat={messages:[{role:'user',content:'Fictional collection question'},{role:'assistant',content:'Fictional collection answer'}],summary:'',summarizedUpTo:0};
const response=(value:any)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
beforeEach(async()=>{
 AbortSignal.timeout??=()=>new AbortController().signal;
 invoke.mockClear();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/query')return response({data:[{context_key:'collection:col-1',state:collectionChat}]});
  if(url==='/api/chat-state')return response({state:JSON.parse(String(init?.body)).state});
  return response({});
 }));
 await hydrateFileChats();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const show=(path:string,page=false)=>render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><GlobalAIChatFAB page={page}/></MemoryRouter></QueryClientProvider>);
const popOut=async(path:string)=>{
 show(path);
 fireEvent.click(await screen.findByRole('button',{name:/chat/i}));
 const link=await screen.findByRole('link',{name:'Open chat in a new window'});
 expect(link).toHaveAttribute('target','_blank');
 return link.getAttribute('href');
};

it("a collection's chat opens in its own window with the collection in the address",async()=>{
 expect(await popOut('/collections/fictional-books')).toBe('/dashboard/chat?collection=fictional-books');
});

it("a collection item's chat keeps the item too",async()=>{
 expect(await popOut('/collections/fictional-books/item-7')).toBe('/dashboard/chat?collection=fictional-books&item=item-7');
});

it('note and person chats keep their links',async()=>{
 expect(await popOut('/dashboard/notes/note-1')).toBe('/dashboard/chat?note=note-1');
 cleanup();
 expect(await popOut('/dashboard/people/person-1')).toBe('/dashboard/chat?person=person-1');
 cleanup();
 expect(await popOut('/dashboard')).toBe('/dashboard/chat');
});

it('the chat page opened from it shows and talks to that collection',async()=>{
 show('/dashboard/chat?collection=fictional-books&item=item-7',true);
 expect(await screen.findByText('Fictional collection answer')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Fictional new question'}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await waitFor(()=>expect(invoke).toHaveBeenCalled());
 const [fn,{body}]=invoke.mock.calls[0] as any;
 expect(fn).toBe('collection-chat');
 expect(body.collection_id).toBe('col-1');
 expect(body.item_id).toBe('item-7');
 expect(body.messages.at(-1)).toEqual({role:'user',content:'Fictional new question'});
});

// A note chat's pop-out window has no note editor. Its send waited for one to save the note
// first, so for the whole wait the reply spun and nothing reached the AI (#758).
const sendFromPopOut=async(text:string)=>{
 show('/dashboard/chat?note=note-1',true);
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:text}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
};
const spinning=()=>document.querySelector('.animate-spin');
it("a message sent from a note chat's pop-out reaches the AI at once and its reply ends the wait",async()=>{
 await sendFromPopOut('Fictional pop-out question');
 await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1),{timeout:1500});
 const [fn,{body}]=invoke.mock.calls[0] as any;
 expect(fn).toBe('note-chat');
 expect(body.note_id).toBe('note-1');
 expect(body.message).toBe('Fictional pop-out question');
 expect(await screen.findByText('Fictional reply')).toBeInTheDocument();
 expect(spinning()).toBeNull();
 expect(invoke).toHaveBeenCalledTimes(1);
});

it("a pop-out send the AI does not answer stops spinning and says so",async()=>{
 const refused='Your AI could not be used. Check Settings, Your AI, then try again.';
 // The notebook's own answer to a send the AI refused (server/main.mjs), as the client hands it on.
 invoke.mockImplementationOnce(async()=>({data:null,error:{message:refused,context:new Response(JSON.stringify({error:refused}),{status:400})}}) as any);
 await sendFromPopOut('Fictional unanswered question');
 expect(await screen.findByText(refused,{},{timeout:1500})).toBeInTheDocument();
 expect(spinning()).toBeNull();
 expect(screen.getByLabelText('Message')).toHaveValue('Fictional unanswered question');
});

it("the note's own chat still asks its open editor to save the note before sending",async()=>{
 const asked=vi.fn((event:Event)=>{const {requestId}=(event as CustomEvent).detail;window.dispatchEvent(new CustomEvent('menerio:flush-note-save-done',{detail:{requestId,updatedAt:'2026-11-19T00:00:00.000Z',content:'Fictional body'}}));});
 window.addEventListener('menerio:flush-note-save',asked);
 try{
  show('/dashboard/notes/note-1');
  fireEvent.click(await screen.findByRole('button',{name:/chat/i}));
  fireEvent.change(await screen.findByLabelText('Message'),{target:{value:'Fictional panel question'}});
  fireEvent.click(screen.getByRole('button',{name:'Send'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
  expect(asked).toHaveBeenCalledTimes(1);
  expect((invoke.mock.calls[0] as any)[1].body.base_updated_at).toBe('2026-11-19T00:00:00.000Z');
  await waitFor(()=>expect(spinning()).toBeNull());
 }finally{window.removeEventListener('menerio:flush-note-save',asked);}
});
