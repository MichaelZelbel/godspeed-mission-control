import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {GitHubSignIn,chooseMethod,connectRecordSync,openPage,credentialRefusal,noProgram} from '../core/sync/github-sign-in.mjs';
// Connect record sync on a computer that never signed in to GitHub (8 October 2026). Every
// program is a stand-in here: nothing reaches GitHub and no browser opens.
const gcmHelp='Description:\n  Commands for interacting with the GitHub host provider\n\nCommands:\n  list              List all known GitHub accounts.\n  login             Add a GitHub account.\n  logout <account>  Remove a GitHub account.\n';
const probeWith=answers=>(command,args)=>{const key=[command,...args].join(' ');for(const [k,v] of Object.entries(answers))if(key.startsWith(k))return v;return {status:null,stdout:'',stderr:''};};
function fakeRun(){
  const calls=[];
  const run=(command,args,options)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.killed=false;child.kill=()=>{child.killed=true;setImmediate(()=>child.emit('close',null));};calls.push({command,args,options,child});return child;};
  return {run,calls};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
const publicRefusal='This repository is publicly readable. Choose a private repository for your knowledge';

test('the way to sign in is chosen from what the computer has',()=>{
  assert.equal(chooseMethod({platform:'win32',probe:probeWith({'git credential-manager github --help':{status:0,stdout:gcmHelp,stderr:''}})}),'gcm');
  // Git for Windows before Git Credential Manager 2.1 has no github login: gh if it is there, else Git asks by itself.
  assert.equal(chooseMethod({platform:'win32',probe:probeWith({'git credential-manager github --help':{status:1,stdout:'',stderr:"git: 'credential-manager' is not a git command."},'gh --version':{status:0,stdout:'gh version 2.97.0',stderr:''}})}),'gh');
  assert.equal(chooseMethod({platform:'win32',probe:probeWith({'git credential-manager github --help':{status:1,stdout:'',stderr:''}})}),'git');
  assert.equal(chooseMethod({platform:'darwin',probe:probeWith({'gh --version':{status:0,stdout:'gh version 2.97.0',stderr:''}})}),'gh');
  assert.equal(chooseMethod({platform:'darwin',probe:probeWith({})}),null);
  assert.equal(chooseMethod({platform:'linux',probe:probeWith({})}),null);
});

test('only the missing sign-in starts one: a public repository, an unclear privacy answer and success do not',async()=>{
  let started=0;const signIn={start:()=>{started++;return {state:'signing_in'};}};
  assert.deepEqual(await connectRecordSync({url:'https://github.com/a/b',configure:async()=>({state:'synced'}),signIn}),{status:{state:'synced'}});
  await assert.rejects(connectRecordSync({url:'https://github.com/a/b',configure:async()=>{throw Error(publicRefusal);},signIn}),/publicly readable/);
  await assert.rejects(connectRecordSync({url:'https://github.com/a/b',configure:async()=>{throw Error('Repository privacy could not be verified; no files were uploaded');},signIn}),/could not be verified/);
  assert.equal(started,0);
  assert.deepEqual(await connectRecordSync({url:'https://github.com/a/b',configure:async()=>{throw Error(credentialRefusal);},signIn}),{signIn:{state:'signing_in'}});
  assert.equal(started,1);
});

test('Windows: Git Credential Manager opens the browser, then the same check runs again',async()=>{
  const {run,calls}=fakeRun();let retries=0;
  const signIn=new GitHubSignIn({platform:'win32',env:{PATH:'x',GCM_INTERACTIVE:'Never',GIT_TERMINAL_PROMPT:'0'},run,probe:probeWith({'git credential-manager github --help':{status:0,stdout:gcmHelp,stderr:''}}),open:()=>assert.fail('Git Credential Manager opens the page itself')});
  const first=signIn.start('https://github.com/a/b',async()=>{retries++;return {state:'synced'};});
  assert.equal(first.state,'signing_in');assert.match(first.message,/A GitHub sign-in page opens in your browser/);
  assert.deepEqual([calls[0].command,...calls[0].args],['git','credential-manager','github','login','--browser']);
  assert.equal(calls[0].options.env.GCM_INTERACTIVE,undefined,'the sign-in window is allowed for this one step');
  assert.equal(calls[0].options.env.GIT_TERMINAL_PROMPT,'0');
  assert.equal(signIn.start('https://github.com/a/b',async()=>{}).state,'signing_in');assert.equal(calls.length,1,'a second press joins the running sign-in');
  calls[0].child.emit('close',0);await settle();
  assert.equal(retries,1);assert.equal(signIn.status().state,'connected');assert.match(signIn.status().message,/record sync is connected/);
});

test('Mac and Linux: gh shows a one-time code, the page opens, Git is told to use the sign-in',async()=>{
  const {run,calls}=fakeRun();const opened=[],probed=[];
  const probe=(command,args)=>{probed.push([command,...args].join(' '));return command==='gh'?{status:0,stdout:'',stderr:''}:{status:null,stdout:'',stderr:''};};
  const signIn=new GitHubSignIn({platform:'darwin',env:{PATH:'x'},run,probe,open:url=>opened.push(url)});
  let retried=false;signIn.start('https://github.com/a/b',async()=>{retried=true;return {state:'synced'};});
  assert.deepEqual([calls[0].command,...calls[0].args],['gh','auth','login','--web','--hostname','github.com','--git-protocol','https']);
  assert.match(signIn.status().message,/one-time code/);assert.equal(signIn.status().code,undefined);
  // What gh 2.97.0 really prints without a terminal (8 October 2026), with a made-up code.
  calls[0].child.stderr.emit('data','\n! First copy your one-time code: AB12-CD34\n');
  calls[0].child.stderr.emit('data','Open this URL to continue in your web browser: https://github.com/login/device\n');
  const shown=signIn.status();
  assert.equal(shown.code,'AB12-CD34');assert.equal(shown.url,'https://github.com/login/device');
  assert.match(shown.message,/Type this one-time code there: AB12-CD34/);assert.deepEqual(opened,['https://github.com/login/device']);
  calls[0].child.emit('close',0);await settle();
  assert.ok(probed.includes('gh auth setup-git --hostname github.com'));assert.ok(retried);assert.equal(signIn.status().state,'connected');
});

test('after signing in, a repository that account cannot read is still refused, in plain words',async()=>{
  const {run,calls}=fakeRun();
  const signIn=new GitHubSignIn({platform:'win32',env:{},run,probe:probeWith({'git credential-manager github --help':{status:0,stdout:gcmHelp,stderr:''}})});
  signIn.start('https://github.com/a/b',async()=>{throw Error(credentialRefusal);});
  calls[0].child.emit('close',0);await settle();
  assert.equal(signIn.status().state,'failed');assert.match(signIn.status().message,/that account cannot read this repository, so no files were uploaded/);
  // The next press starts again.
  signIn.start('https://github.com/a/b',async()=>{throw Error(publicRefusal);});assert.equal(calls.length,2);
  calls[1].child.emit('close',0);await settle();
  assert.equal(signIn.status().message,publicRefusal,'the check stays as strict as before');
});

test('a sign-in that is stopped, fails or takes too long uploads nothing and says so',async()=>{
  for(const ending of ['fail','late']){
    const {run,calls}=fakeRun();let retried=false;
    const signIn=new GitHubSignIn({platform:'win32',env:{},run,probe:probeWith({'git credential-manager github --help':{status:0,stdout:gcmHelp,stderr:''}}),limitMs:ending==='late'?30:60000});
    signIn.start('https://github.com/a/b',async()=>{retried=true;});
    if(ending==='fail')calls[0].child.emit('close',1);
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(retried,false);assert.equal(signIn.status().state,'failed');
    assert.match(signIn.status().message,ending==='late'?/not finished within 15 minutes/:/did not finish, so nothing was uploaded/);
    if(ending==='late')assert.ok(calls[0].child.killed);
  }
});

test('gh that cannot hand its sign-in to Git leaves the check unrun',async()=>{
  const {run,calls}=fakeRun();let retried=false;
  const probe=(command,args)=>args[0]==='--version'?{status:0,stdout:'',stderr:''}:{status:1,stdout:'',stderr:'failed'};
  const signIn=new GitHubSignIn({platform:'linux',env:{},run,probe,open:()=>{}});
  signIn.start('https://github.com/a/b',async()=>{retried=true;});calls[0].child.emit('close',0);await settle();
  assert.equal(retried,false);assert.match(signIn.status().message,/Git could not be told to use that sign-in/);
});

test('an older Git on Windows without gh lets its own credential manager ask, for this one read',async()=>{
  const {run,calls}=fakeRun();
  const signIn=new GitHubSignIn({platform:'win32',env:{GCM_INTERACTIVE:'Never'},run,probe:probeWith({})});
  signIn.start('https://github.com/a/b',async()=>({}));
  assert.deepEqual([calls[0].command,...calls[0].args],['git','ls-remote','https://github.com/a/b']);
  assert.equal(calls[0].options.env.GCM_INTERACTIVE,undefined);assert.match(signIn.status().message,/sign-in window on this computer/);
});

test('a computer with no way to sign in is told what to do',()=>{
  const signIn=new GitHubSignIn({platform:'darwin',env:{},run:()=>assert.fail('nothing starts'),probe:probeWith({})});
  assert.throws(()=>signIn.start('https://github.com/a/b',async()=>{}),error=>error.message===noProgram);
});

test('only GitHub\'s device page is ever opened, and a server without a screen opens nothing',()=>{
  const runs=[];const run=(c,a)=>{runs.push([c,...a]);return {on(){},unref(){}};};
  assert.equal(openPage('https://evil.example/login/device',{platform:'win32',run}),false);
  assert.equal(openPage('https://github.com/login/device',{platform:'linux',env:{},run}),false);
  assert.equal(openPage('https://github.com/login/device',{platform:'win32',env:{},run}),true);
  assert.deepEqual(runs,[['rundll32','url.dll,FileProtocolHandler','https://github.com/login/device']]);
});
