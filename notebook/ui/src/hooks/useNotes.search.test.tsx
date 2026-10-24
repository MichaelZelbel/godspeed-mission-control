// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useIlikeSearch} from './useNotes';

vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'}})}));
vi.mock('@/sync/sync-health',()=>({isLocalFirstActive:()=>false,useLocalFirstActive:()=>false}));
const row=(id:string,title:string)=>({id,title,content_preview:'A note preview.',updated_at:'2026-10-21T12:00:00Z',tags:[]});
const response=(data:any[])=>new Response(JSON.stringify({data,error:null}),{headers:{'Content-Type':'application/json'}});
const pending=()=>{let resolve!:(value:any)=>void;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const show=()=>{const client=new QueryClient();return renderHook(()=>useIlikeSearch(),{wrapper:({children}:any)=><QueryClientProvider client={client}>{children}</QueryClientProvider>});};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('shows indexed matches first, then includes compound matches in Exact search without asking AI',async()=>{
  const expansion=pending(),words=vi.fn();
  const fetcher=vi.fn(async(url:string)=>new URL(url,'http://notebook').searchParams.has('expand')?expansion.promise:response([row('tax','Tax Reporting')]));
  vi.stubGlobal('fetch',fetcher);const hook=show();let finished:any;
  act(()=>{finished=hook.result.current.mutateAsync({query:'report',complete:true,onWords:words});});
  await waitFor(()=>expect(words).toHaveBeenCalledTimes(1));
  expect(words.mock.calls[0][0].map((r:any)=>r.id)).toEqual(['tax']);
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  expect(hook.result.current.isPending).toBe(true);
  await act(async()=>{expansion.resolve(response([row('tax','Tax Reporting'),row('compound','Jahresreport')]));await finished;});
  await waitFor(()=>expect(hook.result.current.data?.map(r=>r.id)).toEqual(['tax','compound']));
  for(const [url] of fetcher.mock.calls)expect(new URL(url,'http://notebook').searchParams.get('mode')).toBe('words');
});

it('rejects an obsolete expansion even if its transport returns after cancellation',async()=>{
  const expansion=pending(),words=vi.fn(),controller=new AbortController();
  const fetcher=vi.fn(async(url:string)=>new URL(url,'http://notebook').searchParams.has('expand')?expansion.promise:response([row('tax','Tax Reporting')]));
  vi.stubGlobal('fetch',fetcher);const hook=show();let finished:Promise<any>;
  act(()=>{finished=hook.result.current.mutateAsync({query:'report',complete:true,onWords:words,signal:controller.signal}).catch(error=>error);});
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));controller.abort();
  await act(async()=>{expansion.resolve(response([row('obsolete','Old compound match')]));const error=await finished;expect(error.name).toBe('AbortError');});
  expect(hook.result.current.data).toBeUndefined();expect(words).toHaveBeenCalledTimes(1);
});
