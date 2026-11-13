// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {GlobalAIChatFAB} from './GlobalAIChatFAB';
import {useChatEntry} from './chat-entry';

vi.mock('sonner',()=>({toast:{error:vi.fn(),warning:vi.fn()}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'owner'},session:{user:{id:'owner'}}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn()}}}));

Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
// Issue #530: at a 390px window the round chat button sat over the bottom-right corner of the
// Dashboard's Godspeed card. While the page's own chat button is on screen, a narrow window shows
// no round button; scrolled past it, the round button is back.
let observed:{cb:IntersectionObserverCallback,el?:Element}[]=[];
class FakeObserver{cb:IntersectionObserverCallback;constructor(cb:IntersectionObserverCallback){this.cb=cb;}observe(el:Element){observed.push({cb:this.cb,el});}disconnect(){observed=observed.filter(o=>o.cb!==this.cb);}unobserve(){}takeRecords(){return [];}}
const scroll=(isIntersecting:boolean)=>act(()=>{for(const o of observed)o.cb([{target:o.el,isIntersecting} as IntersectionObserverEntry],{} as IntersectionObserver);});
function Page(){const ref=useChatEntry<HTMLButtonElement>();return <><button ref={ref}>Chat with Godspeed</button><GlobalAIChatFAB/></>;}
const show=(width:number)=>{Object.defineProperty(window,'innerWidth',{configurable:true,value:width});render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/dashboard']}><Page/></MemoryRouter></QueryClientProvider>);};
const round=()=>screen.queryAllByRole('button',{name:'Chat with Godspeed'}).filter(b=>b.title);
beforeEach(()=>{observed=[];vi.stubGlobal('IntersectionObserver',FakeObserver);vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{headers:{'Content-Type':'application/json'}})));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('a narrow window shows the round chat button only once the page\'s own chat button is off screen',()=>{
 show(390);
 scroll(true);expect(round()).toHaveLength(0);
 scroll(false);expect(round()).toHaveLength(1);
 scroll(true);expect(round()).toHaveLength(0);
});

it('a wide window keeps the round chat button',()=>{
 show(1280);
 scroll(true);expect(round()).toHaveLength(1);
});

it('the round button is back when the page\'s chat button leaves the page',()=>{
 show(390);scroll(true);expect(round()).toHaveLength(0);
 cleanup();render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><GlobalAIChatFAB/></MemoryRouter></QueryClientProvider>);
 expect(round()).toHaveLength(1);
});
