// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import '@testing-library/jest-dom/vitest';
import ChatComposer from './ChatComposer';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {ChatConnectionEmptyState} from './ChatConnectionEmptyState';
import {loadChatOptions} from '@/local/chat-options.mjs';
import { WAIT } from "@/test/wait-limits";

// Issue #563: with no AI connected the model picker said "Connected model" while the Dashboard and
// the chat said no AI is connected. The same composer is the global chat's, a note's and a collection's.
const answer=(body:object)=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}})));
function show(){
 const props={value:'',onChange(){},onSend(){},onStop(){},busy:false,files:[],onFiles(){},model:'',effort:'',onModel:vi.fn(),onEffort(){},reply:'',onError(){}};
 render(<ChatComposer {...props}/>);return props;
}
// jsdom has no AbortSignal.timeout or AbortSignal.any, which the model loader uses in browsers; these stand-ins never fire.
beforeEach(()=>{const S=AbortSignal as any;S.timeout??=()=>new AbortController().signal;S.any??=(signals:AbortSignal[])=>signals[0];});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});

it('does not let an older options response overwrite a newer live state',async()=>{
 let finishOlder:(value:Response)=>void=()=>{};
 const older=loadChatOptions({fetcher:()=>new Promise(resolve=>{finishOlder=resolve;})});
 const refused=await loadChatOptions({fetcher:async()=>new Response(JSON.stringify({connected:true,usable:false,availability:'refused',current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]}),{headers:{'Content-Type':'application/json'}})});
 finishOlder(new Response(JSON.stringify({connected:true,usable:true,availability:'ready',current:'fictional-model',models:[{id:'fictional-model',efforts:[]}]}),{headers:{'Content-Type':'application/json'}}));
 expect(await older).toEqual(refused);
});

it('refreshes an already-open composer when an AI is connected',async()=>{
 vi.useFakeTimers();let connected=false;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(connected?{connected:true,usable:true,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}:{connected:false,usable:false,current:'No AI connected',models:[{id:'',efforts:[]}]}),{headers:{'Content-Type':'application/json'}})));
 const props=show();await vi.waitFor(()=>expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('Model: No AI connected'), WAIT);
 connected=true;await act(()=>vi.advanceTimersByTimeAsync(5000));
 expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('fictional-model');expect(props.onModel).toHaveBeenLastCalledWith('fictional-model');
});

it('keeps an open chat notice and picker on the same state after reconnection',async()=>{
 vi.useFakeTimers();let ready=false;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(ready?{connected:true,usable:true,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}:{connected:true,usable:false,availability:'refused',current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}),{headers:{'Content-Type':'application/json'}})));
 const props={value:'',onChange(){},onSend(){},onStop(){},busy:false,files:[],onFiles(){},model:'',effort:'',onModel:vi.fn(),onEffort(){},reply:'',onError(){}};
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ChatConnectionEmptyState ready={<p>Ready notice</p>}/><ChatComposer {...props}/></MemoryRouter></QueryClientProvider>);
 await vi.waitFor(()=>expect(screen.getByText('Your AI key or sign-in was refused')).toBeInTheDocument(), WAIT);
 expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('Model: Your AI key or sign-in was refused');
 ready=true;await act(()=>vi.advanceTimersByTimeAsync(5000));
 await vi.waitFor(()=>expect(screen.getByText('Ready notice')).toBeInTheDocument(), WAIT);
 expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('fictional-model');
});

it('an open chat notice and its picker follow a refusal, an outage and recovery within about five seconds, without a reload',async()=>{
 vi.useFakeTimers();let state:'ready'|'refused'|'unreachable'='ready';
 const body=()=>state==='ready'?{connected:true,usable:true,availability:'ready',current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}:{connected:true,usable:false,availability:state,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(body()),{headers:{'Content-Type':'application/json'}})));
 const props={value:'',onChange(){},onSend(){},onStop(){},busy:false,files:[],onFiles(){},model:'',effort:'',onModel:vi.fn(),onEffort(){},reply:'',onError(){}};
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ChatConnectionEmptyState ready={<p>Ready notice</p>}/><ChatComposer {...props}/></MemoryRouter></QueryClientProvider>);
 await vi.waitFor(()=>expect(screen.getByText('Ready notice')).toBeInTheDocument(), WAIT);
 for(const [next,notice,picker] of [['refused','Your AI key or sign-in was refused','Model: Your AI key or sign-in was refused'],['unreachable','Your AI could not be reached','Model: Your AI could not be reached'],['ready','Ready notice','fictional-model']] as const){
  state=next;
  // Two seconds, well inside the five the server takes between its own checks: the page reads the
  // shared state each second, and the picker refreshes as soon as that state changes.
  await act(()=>vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByText(notice)).toBeInTheDocument();
  expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue(picker);
 }
});

it('with no AI connected the model picker says so and both pickers are off',async()=>{
 answer({connected:false,usable:false,current:'No AI connected',models:[{id:'',efforts:[]}]});show();
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue('Model: No AI connected'), WAIT);
 expect(model).toBeDisabled();expect(screen.getByRole('combobox',{name:'Reasoning effort'})).toBeDisabled();
 expect(screen.queryByText('Connected model')).not.toBeInTheDocument();
});

it('a connected AI without a model list still shows the connected model',async()=>{
 answer({current:'Connected model',models:[{id:'',efforts:[]}]});show();
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue('Connected model'), WAIT);
 expect(model).toBeEnabled();
});

it('a connected AI keeps its model and effort choices',async()=>{
 answer({current:'fictional-model',models:[{id:'fictional-model',efforts:['low','high']},{id:'other-model',efforts:[]}]});
 const props=show();
 await waitFor(()=>expect(props.onModel).toHaveBeenCalledWith('fictional-model'), WAIT);
 expect(screen.getByRole('option',{name:'fictional-model'})).toBeInTheDocument();expect(screen.getByRole('option',{name:'other-model'})).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Model'})).toBeEnabled();
});

it('clears an already selected model when the connected AI is unusable',async()=>{
 answer({connected:true,usable:false,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]});
 const props={value:'',onChange(){},onSend(){},onStop(){},busy:false,files:[],onFiles(){},model:'fictional-model',effort:'high',onModel:vi.fn(),onEffort:vi.fn(),reply:'',onError(){}};
 const {rerender}=render(<ChatComposer {...props}/>);
 await waitFor(()=>expect(props.onModel).toHaveBeenCalledWith(''), WAIT);
 expect(props.onEffort).toHaveBeenCalledWith('');
 rerender(<ChatComposer {...props} model="" effort=""/>);
 expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('Model: Your AI could not be reached');
 expect(screen.getByRole('combobox',{name:'Model'})).toBeDisabled();
});

it('refreshes an already-open chat when AI availability changes',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});let available=false;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(available?{connected:true,usable:true,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}:{connected:false,current:'No AI connected',models:[{id:'',efforts:[]}]}),{headers:{'Content-Type':'application/json'}})));
 const props=show();
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('Model: No AI connected'), WAIT);
 available=true;await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 await waitFor(()=>expect(props.onModel).toHaveBeenLastCalledWith('fictional-model'), WAIT);
 expect(screen.getByRole('combobox',{name:'Model'})).toBeEnabled();
});

it.each([
 ['refused','Your AI key or sign-in was refused'],
 ['unreachable','Your AI could not be reached'],
] as const)('an unusable AI marked %s does not present its model or effort as active',async(availability,label)=>{
 answer({connected:true,usable:false,availability,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]});
 show();
 const model=screen.getByRole('combobox',{name:'Model'}),effort=screen.getByRole('combobox',{name:'Reasoning effort'});
 await waitFor(()=>expect(model).toHaveDisplayValue('Model: '+label), WAIT);
 expect(model).toBeDisabled();expect(effort).toBeDisabled();expect(effort).toHaveDisplayValue('Effort: '+label);
 expect(model.closest('[data-chat-toolbar]')).toHaveAttribute('data-chat-unavailable','true');
 expect(screen.queryByRole('option',{name:'fictional-model'})).not.toBeInTheDocument();
});

it.each([
 ['collection chat at 1280 px','Model: No AI connected',{connected:false,usable:false,current:'No AI connected',models:[{id:'',efforts:[]}]}],
 ['collection chat at 1280 px','claude-sonnet-4-5-20250929',{connected:true,current:'claude-sonnet-4-5-20250929',models:[{id:'claude-sonnet-4-5-20250929',efforts:[]}]}],
 ['collection chat at 1280 px','Model choices unavailable',null],
 ['full chat at 1280 px','Model: Your AI could not be reached',{connected:true,usable:false,availability:'unreachable',current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}],
 ['pop-out chat at 720 px','Model: Your AI key or sign-in was refused',{connected:true,usable:false,availability:'refused',current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}],
 ['Settings-only chat at 720 px','Model: Your AI is connected only to the notebook',{connected:true,usable:false,availability:'settings-only',current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}],
 ['floating chat at 375 px','Model: No AI connected',{connected:false,usable:false,current:'No AI connected',models:[{id:'',efforts:[]}]}],
 ['floating chat at 375 px','claude-sonnet-4-5-20250929',{connected:true,current:'claude-sonnet-4-5-20250929',models:[{id:'claude-sonnet-4-5-20250929',efforts:[]}]}],
 ['floating chat at 375 px','Model choices unavailable',null],
] as const)('%s leaves the complete current Model label readable in the narrow composer',async(_surface,label,state)=>{
 if(state)answer(state);else vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
 const width=_surface.startsWith('full')?1280:_surface.includes('375')?351:_surface.includes('720')?720:480;
 const {container}=render(<div style={{width}}><ChatComposer {...{value:'',onChange(){},onSend(){},onStop(){},busy:false,files:[],onFiles(){},model:state?.current||'',effort:'',onModel(){},onEffort(){},reply:'',onError(){}}}/></div>);
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue(label), WAIT);
 const css=readFileSync(join(process.cwd(),'src/index.css'),'utf8');
 expect(css).toMatch(/@container \(max-width: 48rem\)[\s\S]*?\[data-chat-toolbar\][\s\S]*?display: grid;[\s\S]*?grid-template-columns: 2\.75rem minmax\(0, 1fr\) auto;/);
 expect(css).toMatch(/@container \(max-width: 48rem\)[\s\S]*?\[data-chat-model\][\s\S]*?grid-column: 1 \/ -1;[\s\S]*?max-width: none;[\s\S]*?width: 100%;/);
 expect(css).toMatch(/@container \(max-width: 48rem\)[\s\S]*?\[data-chat-effort\][\s\S]*?grid-column: 1 \/ -1;[\s\S]*?max-width: none;[\s\S]*?width: 100%;/);
 if(state?.usable===false)expect(css).toMatch(/\[data-chat-toolbar\]\[data-chat-unavailable\][\s\S]*?display: grid;[\s\S]*?\[data-chat-model\][\s\S]*?max-width: none;[\s\S]*?\[data-chat-effort\][\s\S]*?max-width: none;/);
 expect(container.querySelector('[data-chat-toolbar]')).toContainElement(model);
});

it('keeps model selection and Enter submission behavior with the responsive toolbar',async()=>{
 answer({current:'fictional-model',models:[{id:'fictional-model',efforts:[]},{id:'other-model',efforts:[]}]});
 const onModel=vi.fn(),onSend=vi.fn();
 render(<div style={{width:351}}><ChatComposer {...{value:'Ready',onChange(){},onSend,onStop(){},busy:false,files:[],onFiles(){},model:'fictional-model',effort:'',onModel,onEffort(){},reply:'',onError(){}}}/></div>);
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toBeEnabled(), WAIT);
 fireEvent.change(model,{target:{value:'other-model'}});
 expect(onModel).toHaveBeenLastCalledWith('other-model');
 fireEvent.keyDown(screen.getByRole('textbox',{name:'Message'}),{key:'Enter',shiftKey:false});
 expect(onSend).toHaveBeenCalledOnce();
});
