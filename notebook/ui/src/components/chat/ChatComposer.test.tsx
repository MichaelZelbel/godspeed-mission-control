// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import '@testing-library/jest-dom/vitest';
import ChatComposer from './ChatComposer';

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

it('refreshes an already-open composer when an AI is connected',async()=>{
 vi.useFakeTimers();let connected=false;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(connected?{connected:true,usable:true,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}:{connected:false,usable:false,current:'No AI connected',models:[{id:'',efforts:[]}]}),{headers:{'Content-Type':'application/json'}})));
 const props=show();await vi.waitFor(()=>expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('Model: No AI connected'));
 connected=true;await act(()=>vi.advanceTimersByTimeAsync(5000));
 expect(screen.getByRole('combobox',{name:'Model'})).toHaveDisplayValue('fictional-model');expect(props.onModel).toHaveBeenLastCalledWith('fictional-model');
});

it('with no AI connected the model picker says so and both pickers are off',async()=>{
 answer({connected:false,current:'No AI connected',models:[{id:'',efforts:[]}]});show();
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue('No AI connected'));
 expect(model).toBeDisabled();expect(screen.getByRole('combobox',{name:'Reasoning effort'})).toBeDisabled();
 expect(screen.queryByText('Connected model')).not.toBeInTheDocument();
});

it('a connected AI without a model list still shows the connected model',async()=>{
 answer({current:'Connected model',models:[{id:'',efforts:[]}]});show();
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue('Connected model'));
 expect(model).toBeEnabled();
});

it('a connected AI keeps its model and effort choices',async()=>{
 answer({current:'fictional-model',models:[{id:'fictional-model',efforts:['low','high']},{id:'other-model',efforts:[]}]});
 const props=show();
 await waitFor(()=>expect(props.onModel).toHaveBeenCalledWith('fictional-model'));
 expect(screen.getByRole('option',{name:'fictional-model'})).toBeInTheDocument();expect(screen.getByRole('option',{name:'other-model'})).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Model'})).toBeEnabled();
});

it.each([
 ['refused','Your AI key or sign-in was refused'],
 ['unreachable','Your AI could not be reached'],
] as const)('an unusable AI marked %s does not present its model or effort as active',async(availability,label)=>{
 answer({connected:true,usable:false,availability,current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]});
 show();
 const model=screen.getByRole('combobox',{name:'Model'}),effort=screen.getByRole('combobox',{name:'Reasoning effort'});
 await waitFor(()=>expect(model).toHaveDisplayValue('Model: '+label));
 expect(model).toBeDisabled();expect(effort).toBeDisabled();expect(effort).toHaveDisplayValue('Effort: '+label);
 expect(model.closest('[data-chat-toolbar]')).toHaveAttribute('data-chat-unavailable','true');
 expect(screen.queryByRole('option',{name:'fictional-model'})).not.toBeInTheDocument();
});

it.each([
 ['collection chat at 1280 px','No AI connected',{connected:false,current:'No AI connected',models:[{id:'',efforts:[]}]}],
 ['collection chat at 1280 px','claude-sonnet-4-5-20250929',{connected:true,current:'claude-sonnet-4-5-20250929',models:[{id:'claude-sonnet-4-5-20250929',efforts:[]}]}],
 ['collection chat at 1280 px','Model choices unavailable',null],
 ['full chat at 1280 px','Model: Your AI could not be reached',{connected:true,usable:false,availability:'unreachable',current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}],
 ['pop-out chat at 720 px','Model: Your AI key or sign-in was refused',{connected:true,usable:false,availability:'refused',current:'fictional-model',models:[{id:'fictional-model',efforts:['high']}]}],
 ['floating chat at 375 px','No AI connected',{connected:false,current:'No AI connected',models:[{id:'',efforts:[]}]}],
 ['floating chat at 375 px','claude-sonnet-4-5-20250929',{connected:true,current:'claude-sonnet-4-5-20250929',models:[{id:'claude-sonnet-4-5-20250929',efforts:[]}]}],
 ['floating chat at 375 px','Model choices unavailable',null],
] as const)('%s leaves the complete current Model label readable in the narrow composer',async(_surface,label,state)=>{
 if(state)answer(state);else vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
 const width=_surface.startsWith('full')?1280:_surface.includes('375')?351:_surface.includes('720')?720:480;
 const {container}=render(<div style={{width}}><ChatComposer {...{value:'',onChange(){},onSend(){},onStop(){},busy:false,files:[],onFiles(){},model:state?.current||'',effort:'',onModel(){},onEffort(){},reply:'',onError(){}}}/></div>);
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue(label));
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
 await waitFor(()=>expect(model).toBeEnabled());
 fireEvent.change(model,{target:{value:'other-model'}});
 expect(onModel).toHaveBeenLastCalledWith('other-model');
 fireEvent.keyDown(screen.getByRole('textbox',{name:'Message'}),{key:'Enter',shiftKey:false});
 expect(onSend).toHaveBeenCalledOnce();
});
