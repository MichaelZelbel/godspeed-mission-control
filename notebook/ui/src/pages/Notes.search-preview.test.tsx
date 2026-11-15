// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Notes from './Notes';
import {TooltipProvider} from '@/components/ui/tooltip';

const state=vi.hoisted(()=>({full:null as any}));
const preview={id:'tax',title:'Tax Reporting',content_preview:'Only a preview',updated_at:'2026-10-21T12:00:00Z',tags:[]};
const empty={data:[],isLoading:false};
const words={isPending:false,mutate:(_input:any,options:any)=>options?.onSuccess([preview])};
const meaning={isPending:false,mutate:vi.fn()};
vi.mock('@/hooks/useNotes',()=>({useNotes:()=>empty,useNote:()=>({data:state.full,isFetched:!!state.full,isError:false}),useCreateNote:()=>({isPending:false}),useUpdateNote:()=>({}),useIlikeSearch:()=>words,useSemanticSearch:()=>meaning}));
vi.mock('@/components/SEOHead',()=>({SEOHead:()=>null}));
vi.mock('@/components/notes/NoteTree',()=>({NoteTree:()=>null}));
vi.mock('@/components/chat/GlobalAIChatFAB',()=>({GlobalAIChatFAB:()=>null}));
vi.mock('@/components/notes/NoteEditor',()=>({NoteEditor:({note}:any)=><div data-testid="editor">{note.content}</div>}));
vi.mock('@/components/notes/NoteList',()=>({NoteList:({notes,onSelect}:any)=><div>{notes.map((n:any)=><button key={n.id} onClick={()=>onSelect(n.id)}>{n.title}</button>)}</div>}));
vi.mock('@/components/ui/sidebar',()=>({useSidebar:()=>({setOpen:vi.fn()})}));
vi.mock('@/hooks/use-mobile',()=>({useIsMobile:()=>false}));
vi.mock('@/lib/flags',()=>({OFFLINE_CORE:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{const q:any={select:()=>q,order:()=>q,eq:()=>q,then:(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;}}}));
afterEach(()=>{cleanup();state.full=null;});

it('waits for the whole note after selecting a compact search result before mounting the editor',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const tree=()=><QueryClientProvider client={client}><TooltipProvider><MemoryRouter initialEntries={['/dashboard/notes?q=Tax']}><Routes><Route path="/dashboard/notes/*" element={<Notes/>}/></Routes></MemoryRouter></TooltipProvider></QueryClientProvider>;
  const view=render(tree());
  fireEvent.click(await screen.findByRole('button',{name:'Tax Reporting'}));
  expect(await screen.findByText('Opening note…')).toBeInTheDocument();
  expect(screen.queryByTestId('editor')).toBeNull();
  state.full={...preview,content:'The entire original tax reporting note.'};view.rerender(tree());
  expect(await screen.findByTestId('editor')).toHaveTextContent('The entire original tax reporting note.');
});
