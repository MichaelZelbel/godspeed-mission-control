// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {PersonalControl} from './PersonalControl';
import { WAIT } from "@/test/wait-limits";

const personal={deadlines:[],talks:[],journal:[],health:[],habits:[],forecasts:[],watch:[],jobs:[]};
const watched={domains:[{id:'domain-one',domain:'wanted.test',state:'available',checked_at:'2026-11-17T10:00:00Z'},{id:'domain-two',domain:'quiet.test',state:'registered',checked_at:'2026-11-17T04:00:00Z',last_lookup_error:'offline',last_lookup_failed_at:'2026-11-17T10:00:00Z'}]};

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('domain watches in Settings',()=>{
 it('lists the server state and sends add and remove operations',async()=>{
  const posts:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
   const route=String(url);
   if(route==='/api/domain-watches')return new Response(JSON.stringify(watched),{status:200,headers:{'Content-Type':'application/json'}});
   if(route==='/api/personal')return new Response(JSON.stringify(personal),{status:200,headers:{'Content-Type':'application/json'}});
   if(route==='/api/functions/personal-operation'){posts.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({saved:true}),{status:200,headers:{'Content-Type':'application/json'}});}
   return new Response(JSON.stringify({data:[]}),{status:200,headers:{'Content-Type':'application/json'}});
  }));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><PersonalControl/></MemoryRouter></QueryClientProvider>);
  const heading=screen.getByText('Domains to watch'),section=heading.parentElement!;
  expect(await within(section).findByText(/wanted\.test: available/, undefined, WAIT)).toBeInTheDocument();
  fireEvent.change(within(section).getByLabelText('Domain'),{target:{value:'New.Example'}});
  fireEvent.click(within(section).getByRole('button',{name:'Watch this domain'}));
  await waitFor(()=>expect(posts).toContainEqual({type:'domain-watch-add',domain:'New.Example'}), WAIT);
  expect(within(section).getByText(/quiet\.test: registered/)).toBeInTheDocument();
  expect(within(section).getAllByText(/No registry answered on .*looked up again at the next check/)).toHaveLength(1);
  fireEvent.click(within(section).getAllByRole('button',{name:'Stop watching'})[0]);
  await waitFor(()=>expect(posts).toContainEqual({type:'domain-watch-remove',domain:'wanted.test'}), WAIT);
 });
});
