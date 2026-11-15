// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {MemoryRouter} from 'react-router-dom';
import {DashboardSearch} from './DashboardSearch';

const hooks=vi.hoisted(()=>({words:vi.fn(),meaning:vi.fn()}));
vi.mock('@/hooks/useNotes',()=>({useIlikeSearch:()=>({mutateAsync:hooks.words}),useSemanticSearch:()=>({mutateAsync:hooks.meaning})}));
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const row=(id:string,title:string)=>({id,title,updated_at:'2026-10-21T12:00:00Z',similarity:null});
const show=()=>render(<MemoryRouter><DashboardSearch/></MemoryRouter>);
const type=(query:string)=>fireEvent.change(screen.getByRole('textbox',{name:'Search notes'}),{target:{value:query}});
beforeEach(()=>{hooks.words.mockReset();hooks.meaning.mockReset();});
afterEach(cleanup);

describe('progressive notebook search',()=>{
  it('shows an immediately clickable word match while AI is unfinished',async()=>{
    const ai=deferred();hooks.words.mockResolvedValue([row('tax','Tax Reporting')]);hooks.meaning.mockReturnValue(ai.promise);show();type('Tax Reporting');
    expect(await screen.findByRole('button',{name:'Tax Reporting'})).toBeEnabled();
    expect(screen.getByText('Refining results…')).toBeInTheDocument();
    await act(async()=>ai.resolve({results:[row('tax','Tax Reporting'),row('filing','Filing checklist')]}));
    expect(await screen.findByRole('button',{name:'Filing checklist'})).toBeInTheDocument();
  });

  it('cancels the prior request immediately and rejects its late AI result during the new debounce',async()=>{
    const oldAI=deferred(),newAI=deferred();hooks.words.mockImplementation(async({query})=>[row(query,query)]);
    hooks.meaning.mockImplementation(({query})=>query==='Tax Reporting'?oldAI.promise:newAI.promise);show();type('Tax Reporting');
    await screen.findByRole('button',{name:'Tax Reporting'});await waitFor(()=>expect(hooks.meaning).toHaveBeenCalledTimes(1));
    const oldSignal=hooks.meaning.mock.calls[0][0].signal;type('Garden');expect(oldSignal.aborted).toBe(true);
    await act(async()=>oldAI.resolve({results:[row('wrong','Obsolete result')]}));
    expect(screen.queryByRole('button',{name:'Obsolete result'})).toBeNull();
    expect(await screen.findByRole('button',{name:'Garden'})).toBeInTheDocument();
    type('');await act(async()=>newAI.resolve({results:[row('late','Late garden result')]}));
    expect(screen.queryByRole('button',{name:'Late garden result'})).toBeNull();
  });

  it('keeps the row under the pointer stable while AI enriches the list',async()=>{
    const ai=deferred();hooks.words.mockResolvedValue([row('tax','Tax Reporting')]);hooks.meaning.mockReturnValue(ai.promise);show();type('Tax');
    const button=await screen.findByRole('button',{name:'Tax Reporting'}),dropdown=button.parentElement!.parentElement!;fireEvent.mouseEnter(dropdown);
    await act(async()=>ai.resolve({results:[row('extra','Filing checklist')]}));expect(screen.queryByText('Filing checklist')).toBeNull();
    fireEvent.mouseLeave(dropdown);expect(await screen.findByRole('button',{name:'Filing checklist'})).toBeInTheDocument();
  });
});
