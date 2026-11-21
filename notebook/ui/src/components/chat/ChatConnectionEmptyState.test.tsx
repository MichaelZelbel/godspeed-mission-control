// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {ChatConnectionEmptyState,chatAIState,stateSaid} from './ChatConnectionEmptyState';
import {AI_CONNECTION_UNREADABLE_STATUS} from '../../../../core/no-ai.mjs';
import { WAIT } from "@/test/wait-limits";

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

const surfaces=['floating chat','note chat','collection chat','pop-out chat'];
function show(options:unknown){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(options),{status:200,headers:{'Content-Type':'application/json'}})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ChatConnectionEmptyState ready={<p>Ordinary ready state</p>}/></MemoryRouter></QueryClientProvider>);
}

describe.each(surfaces)('%s pre-composer state',surface=>{
  it('names no AI and routes to Settings, Your AI',async()=>{
    show({connected:false,usable:false});
    expect(await screen.findByText('No AI is connected yet', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
    expect(screen.queryByText('Ordinary ready state')).not.toBeInTheDocument();
  });
  it('replaces ready wording when the configured AI cannot be reached',async()=>{
    show({connected:true,usable:false,availability:'unreachable'});
    expect(await screen.findByText('Your AI could not be reached', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText('Check its connection before you type.')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
    expect(screen.queryByText('Ordinary ready state')).not.toBeInTheDocument();
  });
  it('keeps the ordinary empty state when the AI is usable',async()=>{
    show({connected:true,usable:true});
    expect(await screen.findByText('Ordinary ready state', undefined, WAIT)).toBeInTheDocument();
    await waitFor(()=>expect(screen.queryByText('Checking AI connection…')).not.toBeInTheDocument(), WAIT);
  });
  // #808: a stall was headlined "Your AI could not be reached", the outage wording.
  it('says a stalled AI is not answering, not that it could not be reached',async()=>{
    show({connected:true,usable:false,availability:'stalled'});
    expect(await screen.findByText('Your AI is not answering', undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/could not be reached/)).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
  });
  it('explains an AI connected only to the notebook and names the Settings box',async()=>{
    show({connected:true,usable:false,availability:'settings-only'});
    expect(await screen.findByText('Your AI is connected only to the notebook', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText(/Use it for the daily routines and the chat too/)).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
  });
  // #826: the saved connection exists but cannot be read, so the chat says what Settings says.
  it('says the saved connection cannot be read, as Settings does',async()=>{
    show({connected:true,usable:false,availability:'unreadable'});
    expect(await screen.findByText('The saved AI connection could not be read.', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText('Remove it in Settings, Your AI, to connect one again.')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Open Settings, Your AI'})).toHaveAttribute('href','/dashboard/settings#connect-ai');
    expect(screen.queryByText('Ordinary ready state')).not.toBeInTheDocument();
  });
});

it('preserves a ready state when connection checking is unavailable',()=>{
  expect(chatAIState({connected:true})).toBe('ready');
});

it('knows a stalled reply already says the stall, so the notice under it does not repeat it',()=>{
  expect(stateSaid('Your AI is not answering. Try again in a moment, or check it in Settings, Your AI.')).toBe('stalled');
});

it('knows a reply that says the saved connection cannot be read, so the notice does not repeat it',()=>{
  expect(stateSaid(AI_CONNECTION_UNREADABLE_STATUS)).toBe('unreadable');
});
