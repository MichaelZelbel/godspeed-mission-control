// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

const queries:any[]=[];
beforeEach(()=>{
 vi.resetModules();localStorage.clear();queries.length=0;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:any)=>{
  const body=JSON.parse(init.body);queries.push(body);
  const data=body.operation==='upsert'?[{_hash:'h2'}]:[{preferences:{'theme-mode':'dark'},_hash:'h1'}];
  return new Response(JSON.stringify({data}),{status:200});
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it('loads saved preferences, drops stale durable keys, and saves later durable changes',async()=>{
 localStorage.setItem('theme-old','x');localStorage.setItem('scratch','keep');
 const {hydrateFilePreferences}=await import('./file-preferences');
 await hydrateFilePreferences();
 expect(localStorage.getItem('theme-mode')).toBe('dark');
 expect(localStorage.getItem('theme-old')).toBeNull();
 expect(localStorage.getItem('scratch')).toBe('keep');
 vi.useFakeTimers();
 localStorage.setItem('theme-mode','light');
 localStorage.setItem('scratch','2');
 await vi.advanceTimersByTimeAsync(300);
 const saves=queries.filter(q=>q.operation==='upsert');
 expect(saves).toHaveLength(1);
 expect(saves[0].values.preferences).toEqual({'theme-mode':'light'});
 expect(saves[0].expected).toEqual({'ui-preferences':'h1'});
});
