// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {AddonsList} from './AddonsList';
import {WAIT} from '@/test/wait-limits';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const wingman={id:'wingman',name:'the Wingman',description:'Helps with dating.',added:false,busy:false};

it('lists each add-on with what it does, and Add adds it',async()=>{
  let added=false;const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{calls.push(url+' '+(init?.body||''));
    if(url==='/api/addons/add'){added=true;return json({state:'added',message:'I added the Wingman. Open your Dating page in the notebook.'});}
    return json({addons:[{...wingman,added}]});}));
  render(<AddonsList onError={()=>{}}/>);
  expect(await screen.findByText(/Helps with dating/,undefined,WAIT)).toHaveTextContent('Not added');
  fireEvent.click(screen.getByRole('button',{name:'Add the Wingman'}));
  expect(await screen.findByText('I added the Wingman. Open your Dating page in the notebook.',undefined,WAIT)).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByText(/Helps with dating/)).toHaveTextContent('Added'),WAIT);
  expect(calls).toContain('/api/addons/add {"addon":"wingman"}');
});

it('shows the GitHub sign-in link and code, and asks for no password',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/addons/add'
    ?json({state:'signing_in',signIn:{state:'signing_in',message:'Type this one-time code there: D53B-7352.',code:'D53B-7352',url:'https://github.com/login/device'}})
    :json({addons:[wingman]})));
  render(<AddonsList onError={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Add the Wingman'},WAIT));
  expect(await screen.findByText('D53B-7352',undefined,WAIT)).toBeInTheDocument();
  expect(screen.getByRole('link',{name:"Open GitHub's sign-in page"})).toHaveAttribute('href','https://github.com/login/device');
  expect(screen.queryByLabelText(/password|token/i)).toBeNull();
});

it("shows an add-on's page as a link with its title, and no link for an add-on without one",async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>json({addons:[
    {...wingman,id:'teston',name:'the Teston',description:'A test add-on.',added:true,page:{title:'Teston',path:'/addons/teston/'}},
    {...wingman,added:true}]})));
  render(<AddonsList onError={()=>{}}/>);
  const link=await screen.findByRole('link',{name:'Teston'},WAIT);
  expect(link).toHaveAttribute('href','/addons/teston/');
  expect(screen.getAllByRole('link')).toHaveLength(1);
});
