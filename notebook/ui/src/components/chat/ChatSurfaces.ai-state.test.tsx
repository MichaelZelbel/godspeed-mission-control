// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {NoteChatPanel} from '@/components/notes/NoteChatPanel';
import {CollectionChatPanel} from '@/components/collections/CollectionChatPanel';

vi.mock('sonner',()=>({toast:{error:vi.fn(),warning:vi.fn()}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'},session:{user:{id:'owner'}}})}));
vi.mock('@/lib/side-chat',()=>({useDockedChat:()=>({})}));
vi.mock('@/components/common/ConfirmDialog',()=>({useConfirmDialog:()=>[vi.fn(),null]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn()},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})}}));
vi.mock('./ChatComposer',()=>({default:()=> <div data-testid="composer"/>}));
vi.mock('./ChatMarkdown',()=>({default:({children}:any)=><p>{children}</p>}));
Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});

const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const wrap=(node:React.ReactNode,path='/dashboard')=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>);
const surfaces=[
  ['floating',()=>{wrap(<GlobalAIChatFAB/>);fireEvent.click(screen.getByRole('button',{name:'Chat with Godspeed'}));}],
  ['pop-out',()=>wrap(<GlobalAIChatFAB page/>,'/dashboard/chat')],
  ['note',()=>wrap(<NoteChatPanel note={{id:'note-1',title:'Fictional note',content:''} as any} onClose={()=>{}} onNoteChanged={()=>{}}/>)],
  ['collection',()=>wrap(<CollectionChatPanel collectionId="collection-1" collectionName="Fictional collection" onClose={()=>{}} onCollectionChanged={()=>{}}/>)],
] as const;

beforeEach(()=>{localStorage.clear();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

for(const [name,show] of surfaces){
  it(`${name} shows setup guidance with no AI`,async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/chat/options'?response({connected:false,usable:false,current:'No AI connected',models:[{id:'',efforts:[]}]}):response({data:[]})));
    show();expect(await screen.findByText('No AI connected')).toBeInTheDocument();expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
  });
  it(`${name} replaces ready wording when configured AI is unusable`,async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/chat/options'?response({connected:true,usable:false,current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]}):response({data:[]})));
    show();expect(await screen.findByText('Your AI could not be used')).toBeInTheDocument();expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toBeInTheDocument();
  });
  it(`${name} retains its ready empty state with usable AI`,async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/chat/options'?response({connected:true,usable:true,current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]}):response({data:[]})));
    show();expect(await screen.findByTestId('composer')).toBeInTheDocument();expect(screen.queryByText('Your AI could not be used')).not.toBeInTheDocument();expect(screen.queryByText('No AI connected')).not.toBeInTheDocument();
  });
}
