// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {ChatConnectionEmptyState,chatAIState} from './ChatConnectionEmptyState';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

const surfaces=['floating chat','note chat','collection chat','pop-out chat'];
function show(options:unknown){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(options),{status:200,headers:{'Content-Type':'application/json'}})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ChatConnectionEmptyState ready={<p>Ordinary ready state</p>}/></MemoryRouter></QueryClientProvider>);
}

describe.each(surfaces)('%s pre-composer state',surface=>{
  it('names no AI and routes to Settings, Your AI',async()=>{
    show({connected:false,usable:false});
    expect(await screen.findByText('No AI connected')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
    expect(screen.queryByText('Ordinary ready state')).not.toBeInTheDocument();
  });
  it('replaces ready wording when the configured AI is unusable',async()=>{
    show({connected:true,usable:false});
    expect(await screen.findByText('Your AI could not be used')).toBeInTheDocument();
    expect(screen.getByText(/sign-in, key, or connection/)).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
    expect(screen.queryByText('Ordinary ready state')).not.toBeInTheDocument();
  });
  it('keeps the ordinary empty state when the AI is usable',async()=>{
    show({connected:true,usable:true});
    expect(await screen.findByText('Ordinary ready state')).toBeInTheDocument();
    await waitFor(()=>expect(screen.queryByText('Checking AI connection…')).not.toBeInTheDocument());
  });
});

it('preserves a ready state when connection checking is unavailable',()=>{
  expect(chatAIState({connected:true})).toBe('ready');
});
