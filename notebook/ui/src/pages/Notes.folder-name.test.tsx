// @vitest-environment jsdom
// The folder-name box of the Notes page has a name (#756), both in the
// New folder popover next to the folder list and in the New Folder dialog
// the + menu opens.
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Notes from './Notes';
import {TooltipProvider} from '@/components/ui/tooltip';
import {clickLabel} from '@/test/label-click';
import { WAIT } from "@/test/wait-limits";

const empty={data:[],isLoading:false};
vi.mock('@/hooks/useNotes',()=>({useNotes:()=>empty,useNote:()=>({data:null,isFetched:false,isError:false}),useCreateNote:()=>({isPending:false}),useUpdateNote:()=>({}),useIlikeSearch:()=>({isPending:false,mutate:vi.fn()}),useSemanticSearch:()=>({isPending:false,mutate:vi.fn()})}));
vi.mock('@/components/SEOHead',()=>({SEOHead:()=>null}));
vi.mock('@/components/notes/NoteTree',()=>({NoteTree:()=>null}));
vi.mock('@/components/chat/GlobalAIChatFAB',()=>({GlobalAIChatFAB:()=>null}));
vi.mock('@/components/notes/NoteEditor',()=>({NoteEditor:()=>null}));
vi.mock('@/components/notes/NoteList',()=>({NoteList:()=>null}));
vi.mock('@/components/ui/sidebar',()=>({useSidebar:()=>({setOpen:vi.fn()})}));
vi.mock('@/hooks/use-mobile',()=>({useIsMobile:()=>false,usePanesTogether:()=>true}));
vi.mock('@/lib/flags',()=>({OFFLINE_CORE:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{const q:any={select:()=>q,order:()=>q,eq:()=>q,then:(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;}}}));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
afterEach(cleanup);

function page(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><TooltipProvider><MemoryRouter initialEntries={['/dashboard/notes']}><Routes><Route path="/dashboard/notes/*" element={<Notes/>}/></Routes></MemoryRouter></TooltipProvider></QueryClientProvider>);
}

it('names the box in the New folder popover "Folder name", and its label puts the cursor there',async()=>{
  page();
  fireEvent.click(screen.getByRole('button',{name:'New folder'}));
  const box=await screen.findByLabelText('Folder name',{exact:true}, WAIT);
  expect(box.tagName).toBe('INPUT');
  expect(screen.getAllByLabelText('Folder name',{exact:true})).toHaveLength(1);
  const label=(box as HTMLInputElement).labels![0];
  expect(label).toHaveTextContent(/^Folder name$/);
  clickLabel(label);
  expect(document.activeElement).toBe(box);
});

it('names the box in the New Folder dialog "Folder name"',async()=>{
  page();
  const plus=screen.getByRole('button',{name:'New note or folder'});
  fireEvent.pointerDown(plus,{button:0,ctrlKey:false});
  fireEvent.keyDown(plus,{key:'Enter'});
  fireEvent.click(await screen.findByRole('menuitem',{name:/New Folder/}, WAIT));
  const dialog=await screen.findByRole('alertdialog', undefined, WAIT);
  expect(within(dialog).getByText('New folder')).toBeInTheDocument();
  const box=within(dialog).getByLabelText('Folder name',{exact:true});
  expect(box.tagName).toBe('INPUT');
  expect(within(dialog).getByRole('textbox',{name:'Folder name'})).toBe(box);
});
