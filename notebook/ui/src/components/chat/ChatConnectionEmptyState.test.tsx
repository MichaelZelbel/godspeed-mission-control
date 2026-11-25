// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {ChatConnectionEmptyState,chatAIState,useChatOptions,stateSaid} from './ChatConnectionEmptyState';
import {AI_CONNECTION_UNREADABLE_STATUS} from '../../../../core/no-ai.mjs';
import { WAIT } from "@/test/wait-limits";

afterEach(()=>{cleanup();vi.unstubAllGlobals();try{window.localStorage.clear();}catch{}});

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

// #822: the Dashboard's arrival read asks for a check only once a chat has read the shared state
// since the last confirmation. Its flag rides the first read only, and comes back when that read
// fails, so the arrival still gets confirmed.
it('rides the check flag on the first read only, and gets it back when that read fails',async()=>{
  const calls:string[]=[];let broken=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    calls.push(String(url));
    if(broken)throw Error('Could not read AI connection status');
    return new Response(JSON.stringify({connected:true,usable:true,availability:'ready'}),{status:200,headers:{'Content-Type':'application/json'}});
  }));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  // A chat surface reads the shared state; that is what lets the next arrival confirm afresh.
  function Chat(){useChatOptions();return null;}
  const chat=render(<QueryClientProvider client={client}><MemoryRouter><Chat/></MemoryRouter></QueryClientProvider>);
  await waitFor(()=>expect(calls.length).toBeGreaterThan(0),WAIT);
  expect(calls[0]).not.toContain('check=1');
  chat.unmount();
  broken=true;
  function Probe(){useChatOptions({confirmOnMount:true});return null;}
  render(<QueryClientProvider client={client}><MemoryRouter><Probe/></MemoryRouter></QueryClientProvider>);
  await waitFor(()=>expect(calls.length).toBeGreaterThan(1),WAIT);
  expect(calls[calls.length-1]).toContain('check=1');
  broken=false;
  await client.refetchQueries({queryKey:['chat-options']});
  expect(calls[calls.length-1]).toContain('check=1');
  await client.refetchQueries({queryKey:['chat-options']});
  expect(calls[calls.length-1]).not.toContain('check=1');
});

// #963: the flag behind #822 lived in module memory, so a chat in one tab never let a Dashboard
// arrival in another tab ask for a check: each tab had its own copy of the flag. Two module
// instances of this module sharing one localStorage stand in for two tabs. The test above is the
// same-context control: there, the arrival already asked for a check.
it('lets a chat read in one tab make a Dashboard arrival in another tab ask for a check',async()=>{
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    calls.push(String(url));
    return new Response(JSON.stringify({connected:true,usable:true,availability:'ready'}),{status:200,headers:{'Content-Type':'application/json'}});
  }));
  // Tab A: a chat surface reads the shared state, which is what lets the next arrival confirm afresh.
  const mod1=await import('./ChatConnectionEmptyState');
  const {default:React}=await import('react');
  const {render}=await import('@testing-library/react');
  function Chat(){mod1.useChatOptions();return null;}
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Chat/></QueryClientProvider>);
  await waitFor(()=>expect(calls.length).toBeGreaterThan(0),WAIT);
  expect(calls[0]).not.toContain('check=1');
  cleanup();

  // Tab B: a fresh JS context, the same localStorage. Its Dashboard arrival must still ask for a check.
  vi.resetModules();
  const mod2=await import('./ChatConnectionEmptyState');
  const React2=(await import('react')).default;
  const lib2=await import('@testing-library/react');
  function Probe(){mod2.useChatOptions({confirmOnMount:true});return null;}
  lib2.render(React2.createElement(QueryClientProvider as any,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},React2.createElement(Probe)));
  await waitFor(()=>expect(calls.length).toBeGreaterThan(1),WAIT);
  expect(calls[calls.length-1]).toContain('check=1');
});

// #963 review: with the browser denying storage, the same tab keeps the flag in memory, as on main.
it('still asks for a check on a Dashboard arrival after a chat read in the same tab when storage is denied',async()=>{
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    calls.push(String(url));
    return new Response(JSON.stringify({connected:true,usable:true,availability:'ready'}),{status:200,headers:{'Content-Type':'application/json'}});
  }));
  const denied=()=>{throw new DOMException('denied','SecurityError');};
  vi.stubGlobal('localStorage',{getItem:denied,setItem:denied,removeItem:denied,clear:denied});
  vi.resetModules();
  const mod=await import('./ChatConnectionEmptyState');
  const React=(await import('react')).default;
  const lib=await import('@testing-library/react');
  const client=()=>new QueryClient({defaultOptions:{queries:{retry:false}}});
  function Chat(){mod.useChatOptions();return null;}
  function Dash(){mod.useChatOptions({confirmOnMount:true});return null;}
  lib.render(React.createElement(QueryClientProvider as any,{client:client()},React.createElement(Chat)));
  await waitFor(()=>expect(calls.length).toBeGreaterThan(0),WAIT);
  expect(calls[0]).not.toContain('check=1');
  cleanup();
  lib.render(React.createElement(QueryClientProvider as any,{client:client()},React.createElement(Dash)));
  await waitFor(()=>expect(calls.length).toBeGreaterThan(1),WAIT);
  expect(calls[calls.length-1]).toContain('check=1');
});

describe('a model list that cannot load (#1124)',()=>{
  const fail=()=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'no'}),{status:500,headers:{'Content-Type':'application/json'}})));
  const mount=(ready:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ChatConnectionEmptyState ready={ready}/></MemoryRouter></QueryClientProvider>);
  it('says so in the chat notice without claiming a connection',async()=>{
    fail();mount(<p>Ordinary ready state</p>);
    expect(await screen.findByText('The list of AI models could not be loaded.',undefined,WAIT)).toBeInTheDocument();
    expect(document.querySelector('[data-chat-ai-state="models-unavailable"]')).not.toBeNull();
  });
  it('keeps an open conversation quiet, as before',async()=>{
    fail();mount(null);
    await new Promise(r=>setTimeout(r,200));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('The list of AI models could not be loaded.')).toBeNull();
  });
});
