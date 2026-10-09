import {spawn,spawnSync} from 'node:child_process';
// SIGNING A COMPUTER IN TO GITHUB, ONCE (8 October 2026).
//
// Settings > Sync and schedule ownership > Connect record sync checks that the repository is
// private and that this computer can read it (git.mjs verifyRemote, unchanged and as strict as
// before). The read runs with every Git sign-in window switched off, because a sync that runs
// every minute must never open one. So a Windows PC or a Mac that had never signed in to GitHub
// could only ever get "The private repository could not be read with this device Git
// credentials", and nothing in the product signed it in. The book's Chapter 21 tells such a
// reader the mission control walks them through it. Now it does: when exactly that refusal comes
// back, the computer signs in once with a program made for it, and the same check runs again.
//
//   Windows   Git Credential Manager, which Git for Windows brings along:
//             `git credential-manager github login --browser`. It opens GitHub's page in the
//             browser itself and keeps the sign-in in Windows' own credential store, where the
//             next check finds it. The command came with Git Credential Manager 2.2.0 (June 2023),
//             which Git for Windows has brought along since the summer of 2023; the installer's
//             winget Git.Git brings 2.56 with Git Credential Manager 2.9.0, whose help lists
//             `github login [--browser|--web] [--device] ...`.
//   Mac/Linux the GitHub CLI: `gh auth login --web --hostname github.com --git-protocol https`,
//             then `gh auth setup-git --hostname github.com` so Git uses that sign-in. Without a
//             terminal gh prints a one-time code and https://github.com/login/device and waits;
//             it does not open a browser, so this opens the page and the notebook shows the code.
//   Older Git on Windows, no gh: one `git ls-remote` with Git Credential Manager allowed to ask,
//             which shows its own sign-in window.
//
// A public repository never gets this far: verifyRemote refuses it before it reads anything.
export const credentialRefusal='The private repository could not be read with this device Git credentials; no files were uploaded';
export const noProgram="This computer is not signed in to GitHub, and it has no program to sign in with. Run the Godspeed installer again: where this computer can install programs, it now brings GitHub's sign-in program (gh) along. Then press Connect record sync again.";
const LIMIT=15*60*1000; // GitHub's one-time code lasts about 15 minutes
const devicePage=/https:\/\/github\.com\/login\/device\b[^\s"'<>]*/;
const oneTimeCode=/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/;
const said={
  gcm:'This computer is not signed in to GitHub yet. A GitHub sign-in page opens in your browser. Sign in there and allow Git Credential Manager. When you are done, the notebook checks your private repository again by itself.',
  ghWaiting:'This computer is not signed in to GitHub yet. Asking GitHub for a one-time code...',
  gh:code=>'This computer is not signed in to GitHub yet. A GitHub sign-in page opens in your browser. Type this one-time code there: '+code+'. If no page opened, open https://github.com/login/device yourself. When you are done, the notebook checks your private repository again by itself.',
  git:'This computer is not signed in to GitHub yet. Git opens a GitHub sign-in window on this computer. Sign in there. When you are done, the notebook checks your private repository again by itself.',
  checking:'You are signed in to GitHub. Checking your private repository again...',
  connected:'You are signed in to GitHub, the repository is private, and record sync is connected. Your pages go up to it every minute.',
  stillRefused:'You are signed in to GitHub, but that account cannot read this repository, so no files were uploaded. Check the address, and that you signed in with the GitHub account that owns the repository.',
  notFinished:'The GitHub sign-in did not finish, so nothing was uploaded. Press Connect record sync to try again.',
  tooLong:'The GitHub sign-in was not finished within 15 minutes, so nothing was uploaded. Press Connect record sync to try again.',
  gitNotTold:'You are signed in to GitHub, but Git could not be told to use that sign-in, so nothing was uploaded. Press Connect record sync to try again.',
};
const quiet=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,timeout:20000});return {status:r.error?null:r.status,stdout:r.stdout||'',stderr:r.stderr||''};};
// Which way this computer signs in, or null when it has none.
export function chooseMethod({platform=process.platform,probe=quiet}={}){
  if(platform==='win32'){
    const gcm=probe('git',['credential-manager','github','--help']);
    if(gcm.status===0&&/^\s*login\b/m.test(gcm.stdout+'\n'+gcm.stderr))return 'gcm';
  }
  if(probe('gh',['--version']).status===0)return 'gh';
  return platform==='win32'?'git':null;
}
export function openPage(url,{platform=process.platform,env=process.env,run=spawn}={}){
  if(!devicePage.test(url))return false;
  const [command,args]=platform==='win32'?['rundll32',['url.dll,FileProtocolHandler',url]]:platform==='darwin'?['open',[url]]:['xdg-open',[url]];
  if(platform==='linux'&&!env.DISPLAY&&!env.WAYLAND_DISPLAY)return false;
  try{const child=run(command,args,{stdio:'ignore',windowsHide:true,detached:platform!=='win32'});child.on?.('error',()=>{});child.unref?.();return true;}catch{return false;}
}
// Git and its credential manager with sign-in windows allowed again, for this one step only.
function signInEnvironment(env){const out={...env,GIT_TERMINAL_PROMPT:'0'};for(const name of Object.keys(out))if(name.toUpperCase()==='GCM_INTERACTIVE')delete out[name];return out;}
export class GitHubSignIn{
  constructor({platform=process.platform,env=process.env,run=spawn,probe=quiet,open=url=>openPage(url,{platform,env,run}),limitMs=LIMIT}={}){
    Object.assign(this,{platform,env,run,probe,open,limitMs});this.current={state:'idle'};this.child=null;
  }
  status(){return {...this.current};}
  get busy(){return ['signing_in','checking'].includes(this.current.state);}
  // Starts the sign-in for `url` and, once it succeeds, `retry` (the same strict check as
  // before). Returns at once with what the page shows; status() follows it.
  start(url,retry){
    if(this.busy)return this.status();
    const method=chooseMethod({platform:this.platform,probe:this.probe});
    if(!method)throw new Error(noProgram);
    this.current={state:'signing_in',method,message:method==='gh'?said.ghWaiting:said[method],started_at:new Date().toISOString()};
    const env=signInEnvironment(this.env);
    const [command,args]=method==='gcm'?['git',['credential-manager','github','login','--browser']]:method==='gh'?['gh',['auth','login','--web','--hostname','github.com','--git-protocol','https']]:['git',['ls-remote',url]];
    let child,timer,ended=false,text='';
    const finish=async ok=>{
      if(ended)return;ended=true;clearTimeout(timer);this.child=null;
      if(ok!==true){this.current={state:'failed',method,message:ok==='late'?said.tooLong:said.notFinished};return;}
      if(method==='gh'&&this.probe('gh',['auth','setup-git','--hostname','github.com']).status!==0){this.current={state:'failed',method,message:said.gitNotTold};return;}
      this.current={state:'checking',method,message:said.checking};
      try{await retry();this.current={state:'connected',method,message:said.connected};}
      catch(error){this.current={state:'failed',method,message:error.message===credentialRefusal?said.stillRefused:error.message};}
    };
    try{child=this.child=this.run(command,args,{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});}
    catch{this.current={state:'failed',method,message:said.notFinished};return this.status();}
    const read=chunk=>{
      if(text.length<65536)text+=String(chunk);
      if(method!=='gh'||this.current.code)return;
      const code=text.match(oneTimeCode)?.[1],page=text.match(devicePage)?.[0];
      if(code&&page){this.current={...this.current,code,url:page,message:said.gh(code)};this.open(page);}
    };
    child.stdout?.on('data',read);child.stderr?.on('data',read);
    child.on('error',()=>void finish(false));
    child.on('close',code=>void finish(code===0));
    timer=setTimeout(()=>{try{child.kill();}catch{}void finish('late');},this.limitMs);timer.unref?.();
    return this.status();
  }
  close(){if(this.child){try{this.child.kill();}catch{}}}
}
// Connect record sync, as Settings asks for it: the strict check first, and only when it says
// this computer's Git sign-in is missing, the sign-in and then the same check again.
export async function connectRecordSync({url,configure,signIn}){
  try{return {status:await configure(url)};}
  catch(error){if(error.message!==credentialRefusal||!signIn)throw error;return {signIn:signIn.start(url,()=>configure(url))};}
}
