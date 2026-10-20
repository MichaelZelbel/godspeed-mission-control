// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {hydrateFileChats,loadFileChat} from '@/local/file-chat';

vi.mock('sonner',()=>({toast:{error:vi.fn(),warning:vi.fn()}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'},session:{user:{id:'owner'}}})}));
const invoke=vi.fn(async()=>({data:{reply:'Fictional new reply'},error:null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:(...args:unknown[])=>invoke(...(args as []))}}}));
vi.mock('./ChatMarkdown',()=>({default:({children}:any)=><p>{children}</p>}));
vi.mock('./ChatComposer',()=>({default:({value,onChange,onSend,busy}:any)=><><textarea aria-label="Message" value={value} onChange={e=>onChange(e.target.value)}/><button onClick={onSend} disabled={busy}>Send</button></>}));
Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
const old={messages:[{role:'user',content:'Fictional earlier message'},{role:'assistant',content:'Fictional earlier answer'}],summary:'Earlier summary',summarizedUpTo:0};
const reset={messages:[],summary:'',summarizedUpTo:0,session_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'};
let finish:(r:Response)=>void;
const response=(value:any,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
beforeEach(async()=>{
 finish=undefined as any;
 AbortSignal.timeout??=()=>new AbortController().signal;
 invoke.mockClear();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/query')return response({data:[{context_key:'general',state:old}]});
  if(url==='/api/chat-state'){
   const body=JSON.parse(String(init?.body));
   if(body.clear)return new Promise<Response>(resolve=>finish=resolve);
   return response({state:body.state});
  }
  return response({});
 }));
 await hydrateFileChats();
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/dashboard/chat']}><GlobalAIChatFAB page/></MemoryRouter></QueryClientProvider>);
 await screen.findByText('Fictional earlier answer');
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('keeps the transcript until Clear is confirmed by the server and sends the new session thereafter',async()=>{
 fireEvent.click(screen.getByRole('button',{name:'Clear conversation'}));
 fireEvent.click(await screen.findByRole('button',{name:'Clear',exact:true}));
 await waitFor(()=>expect(finish).toBeTypeOf('function'));
 expect(screen.getByText('Fictional earlier answer')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();
 finish(response({state:reset}));
 await waitFor(()=>expect(screen.queryByText('Fictional earlier answer')).toBeNull());
 expect(loadFileChat('general')).toEqual(reset);
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Fictional new question'}});
 fireEvent.click(screen.getByRole('button',{name:'Send'}));
 await waitFor(()=>expect(invoke).toHaveBeenCalled());
 const sent=(invoke.mock.calls[0] as any)[1].body;
 expect(sent.conversation_session).toBe(reset.session_id);
 expect(sent.messages).toEqual([{role:'user',content:'Fictional new question'}]);
});

it('keeps the transcript and shows the reason when the server refuses Clear',async()=>{
 fireEvent.click(screen.getByRole('button',{name:'Clear conversation'}));
 fireEvent.click(await screen.findByRole('button',{name:'Clear',exact:true}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Send'})).toBeDisabled());
 finish(response({error:'Conversation changed before clearing. Reopen it and review the current history.'},409));
 expect(await screen.findByText('Conversation changed before clearing. Reopen it and review the current history.')).toBeInTheDocument();
 expect(screen.getByText('Fictional earlier answer')).toBeInTheDocument();
 expect(loadFileChat('general')).toEqual(old);
 expect(screen.getByRole('button',{name:'Send'})).toBeEnabled();
});
