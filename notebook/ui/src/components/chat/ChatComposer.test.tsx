// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ChatComposer from './ChatComposer';

// Issue #563: with no AI connected the model picker said "Connected model" while the Dashboard and
// the chat said no AI is connected. The same composer is the global chat's, a note's and a collection's.
const answer=(body:object)=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}})));
function show(extra:Partial<React.ComponentProps<typeof ChatComposer>>={},width?:number){
 const props={value:'',onChange(){},onSend(){},onStop(){},busy:false,files:[],onFiles(){},model:'',effort:'',onModel:vi.fn(),onEffort(){},reply:'',onError(){},...extra};
 const composer=<ChatComposer {...props}/>;
 render(width?<div style={{width}}>{composer}</div>:composer);return props;
}
// jsdom has no AbortSignal.timeout or AbortSignal.any, which the model loader uses in browsers; these stand-ins never fire.
beforeEach(()=>{const S=AbortSignal as any;S.timeout??=()=>new AbortController().signal;S.any??=(signals:AbortSignal[])=>signals[0];});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('with no AI connected the model picker says so, is off, and no effort is offered',async()=>{
 answer({connected:false,current:'No AI connected',models:[{id:'',efforts:[]}]});show();
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue('No AI connected'));
 expect(model).toBeDisabled();expect(screen.queryByRole('combobox',{name:'Reasoning effort'})).toBeNull();
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

// #573: the pickers were cut to "No AI connect", "No" or "Conn" with no sign, named no model, and a tab
// opened before the AI was connected kept saying "No AI connected". jsdom lays nothing out, so what is
// checked is what the browser needs to show a label that does not fit: the whole label in the option,
// an ellipsis where it is cut (truncate) and the whole label as the tooltip. The floating chat is
// compact, a note's has no context line, a collection's names the collection, and the chat page
// (the pop-out) is the floating chat's full form.
const chats={floating:{compact:true,context:'Your notebook / Relevant notes and people'},note:{},collection:{context:'Current collection: Fictional recipes'},'pop-out':{context:'Your notebook / Relevant notes and people'}};
for(const [chat,extra] of Object.entries(chats))for(const width of [375,1280]){
 it(`the ${chat} chat at ${width} px shows the whole model name, or an ellipsis and the whole name as its tooltip`,async()=>{
  answer({current:'fictional-vendor/fictional-model-with-a-long-name',models:[{id:'',efforts:[]}]});show(extra,width);
  const model=screen.getByRole('combobox',{name:'Model'});
  await waitFor(()=>expect(model).toHaveDisplayValue('fictional-vendor/fictional-model-with-a-long-name'));
  expect(model).toHaveAttribute('title','fictional-vendor/fictional-model-with-a-long-name');expect(model).toHaveClass('truncate','min-w-0');
  expect(screen.queryByRole('combobox',{name:'Reasoning effort'})).toBeNull();
 });
 it(`the ${chat} chat at ${width} px says in full that no AI is connected`,async()=>{
  answer({connected:false,current:'No AI connected',models:[{id:'',efforts:[]}]});show(extra,width);
  const model=screen.getByRole('combobox',{name:'Model'});
  await waitFor(()=>expect(model).toHaveDisplayValue('No AI connected'));
  expect(model).toHaveAttribute('title','No AI connected');expect(model).toHaveClass('truncate');
 });
}

it('an AI that could not be used says so in the picker, with the reason as its tooltip',async()=>{
 const problem='The AI at api.example.test refused its key, so it could not be used. Check the key in Settings, Your AI.';
 answer({current:'fictional-model',problem,models:[{id:'',efforts:[]}]});show();
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue('AI could not be used'));
 expect(model).toHaveAttribute('title',problem);expect(model).toBeEnabled();
});

it('a chat open while the AI was connected shows it when the person comes back, and after the next reply',async()=>{
 answer({connected:false,current:'No AI connected',models:[{id:'',efforts:[]}]});
 const props={value:'',onChange(){},onSend(){},onStop(){},files:[],onFiles(){},model:'',effort:'',onModel:vi.fn(),onEffort(){},reply:'',onError(){}};
 const {rerender}=render(<ChatComposer {...props} busy={false}/>);
 const model=screen.getByRole('combobox',{name:'Model'});
 await waitFor(()=>expect(model).toHaveDisplayValue('No AI connected'));
 answer({current:'fictional-model',models:[{id:'',efforts:[]}]});
 act(()=>{window.dispatchEvent(new Event('focus'));});
 await waitFor(()=>expect(model).toHaveDisplayValue('fictional-model'));expect(model).toBeEnabled();
 const problem='The AI at 127.0.0.1:9 could not be reached. Check that it is running and this computer is online, and that its address in Settings, Your AI is right.';
 answer({current:'fictional-model',problem,models:[{id:'',efforts:[]}]});
 rerender(<ChatComposer {...props} busy={true}/>);rerender(<ChatComposer {...props} busy={false}/>);
 await waitFor(()=>expect(model).toHaveDisplayValue('AI could not be used'));
});
