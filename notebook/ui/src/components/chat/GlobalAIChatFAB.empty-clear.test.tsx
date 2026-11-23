// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {hydrateFileChats} from '@/local/file-chat';
import { WAIT } from "@/test/wait-limits";

// Issue #975: Clear conversation was offered on a conversation with nothing in it.
vi.mock('sonner',()=>({toast:{error:vi.fn(),warning:vi.fn()}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'},session:{user:{id:'owner'}}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:async()=>({data:{reply:'x'},error:null})}}}));
vi.mock('./ChatMarkdown',()=>({default:({children}:any)=><p>{children}</p>}));
vi.mock('./ChatComposer',()=>({default:({value,onChange}:any)=><textarea aria-label="Message" value={value} onChange={e=>onChange(e.target.value)}/>}));
Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
const response=(value:any)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
let rows:any[]=[];
beforeEach(()=>{
 AbortSignal.timeout??=()=>new AbortController().signal;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/query'?response({data:rows}):response({})));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

async function open(){
 await hydrateFileChats();
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/dashboard/chat']}><GlobalAIChatFAB page/></MemoryRouter></QueryClientProvider>);
}

it('does not offer Clear conversation while the conversation is empty',async()=>{
 rows=[];
 await open();
 await screen.findByLabelText('Message',undefined,WAIT);
 expect(screen.queryByRole('button',{name:'Clear conversation'})).toBeNull();
});

it('offers Clear conversation once the conversation has messages',async()=>{
 rows=[{context_key:'general',state:{messages:[{role:'user',content:'Fictional earlier message'}],summary:'',summarizedUpTo:0}}];
 await open();
 await screen.findByText('Fictional earlier message',undefined,WAIT);
 expect(screen.getByRole('button',{name:'Clear conversation'})).toBeInTheDocument();
});
