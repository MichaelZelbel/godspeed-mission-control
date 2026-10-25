import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installStarter} from '../core/starter-workspace.mjs';
import {readConfigValue,configList,godspeedHermesSettings} from '../core/hermes-config.mjs';
import {PROVIDER,FREE_VOICE,VOICE_MODE_FILE,SPEECH_SCRIPT,withElevenLabs,withFreeVoice,godspeedVoiceSettings,speechCommand,chatVoiceDefaults,ownerChats,saveVoice,voiceStatus,elevenLabsChoice,sampleText} from '../core/voice-replies.mjs';
import {elevenLabsProblem,elevenLabsSpeech,readVoiceRecord,noteVoiceFailed,noteVoiceWorked,failureWords,VOICE_FILE} from '../core/voice-speech.mjs';
import {readNotices} from '../core/notices.mjs';
import {TelegramRunner} from '../../docker/full-candidate/telegram-runner.mjs';

// VOICE REPLIES (25 October 2026, discussion #41): a voice note in Telegram is answered with a voice
// note and the same text, by default and only in the chat; the voice is the free one or the person's
// ElevenLabs voice with its voice settings, tried with a sample before it is kept; the text always
// arrives, and a voice that fails is told once. Every id, key and voice here is made up.
for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_|TELEGRAM_|ELEVENLABS_)/.test(key))delete process.env[key];
const kit=fileURLToPath(new URL('../../',import.meta.url));
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const havePython=spawnSync(python,['--version']).status===0;
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-voice-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const CHAT='424242',VOICE='FictionalVoice00001',KEY='sk_fictional000000000000000000000000';
const CHOICE={voice_id:VOICE,model:'eleven_v3',stability:0.3,similarity_boost:1,style:0.3};
const OGG=Buffer.concat([Buffer.from('OggS'),Buffer.alloc(60,1)]);
const where={home:'/opt/data/hermes',state:'/opt/data/workspace/.godspeed',node:'/usr/local/bin/node',script:'/opt/kit/notebook/scripts/elevenlabs-voice.mjs',platform:'linux'};

test('an ElevenLabs voice is Hermes\' command provider, with the voice settings on its command line',()=>{
 const owner='terminal:\n  cwd: "/x"\ntts:\n  provider: edge\n  providers:\n    my-piper:\n      type: command\n      command: "piper"\n# the owner\'s note\n';
 const out=withElevenLabs(owner,{...where,choice:CHOICE});
 assert.equal(readConfigValue(out,['tts','provider']),'"'+PROVIDER+'"');
 const at=key=>readConfigValue(out,['tts','providers',PROVIDER,key]);
 assert.equal(at('type'),'command');assert.equal(at('format'),'ogg');assert.equal(at('voice_compatible'),'true');
 assert.equal(JSON.parse(at('voice')),VOICE);assert.equal(JSON.parse(at('model')),'eleven_v3');assert.equal(at('timeout'),'180');
 assert.equal(JSON.parse(at('command')),"'/usr/local/bin/node' '/opt/kit/notebook/scripts/elevenlabs-voice.mjs' --voice {voice} --model {model} --stability 0.3 --similarity 1 --style 0.3 --keys '/opt/data/hermes/.env' --state '/opt/data/workspace/.godspeed' {input_path} {output_path}");
 assert.equal(readConfigValue(out,['tts','providers','my-piper','command']),'"piper"','the owner\'s own provider stays');
 assert.match(out,/# the owner's note\n$/);
 assert.equal(withElevenLabs(out,{...where,choice:CHOICE}),out,'written once');
 // On Windows Hermes runs it through cmd.exe: the paths in double quotes.
 assert.equal(speechCommand({home:'C:\\Users\\Jo Doe\\hermes',state:'C:\\mc\\.godspeed',choice:CHOICE,node:'C:\\Program Files\\nodejs\\node.exe',script:'C:\\kit\\elevenlabs-voice.mjs',platform:'win32'}),
  '"C:\\Program Files\\nodejs\\node.exe" "C:\\kit\\elevenlabs-voice.mjs" --voice {voice} --model {model} --stability 0.3 --similarity 1 --style 0.3 --keys "C:\\Users\\Jo Doe\\hermes\\.env" --state "C:\\mc\\.godspeed" {input_path} {output_path}');
 assert.throws(()=>speechCommand({...where,platform:'win32',node:'C:\\100%\\node.exe',choice:CHOICE}),/percent sign/);
 assert.equal(JSON.parse(at('command')).includes("'\\''"),false);
 assert.match(speechCommand({...where,state:"/opt/it's/.godspeed",choice:CHOICE}),/--state '\/opt\/it'\\''s\/\.godspeed'/);
 // Back to the free voice: Hermes' default provider, the owner's providers kept.
 const free=withFreeVoice(out);
 assert.equal(readConfigValue(free,['tts','provider']),null);assert.equal(readConfigValue(free,['tts','providers',PROVIDER]),null);
 assert.equal(readConfigValue(free,['tts','providers','my-piper','type']),'command');
 assert.equal(JSON.parse(readConfigValue(free,['tts','edge','voice'])),FREE_VOICE);
 assert.equal(withFreeVoice(withElevenLabs('',{...where,choice:CHOICE})),'tts:\n  edge:\n    voice: "'+FREE_VOICE+'"\n','nothing of it is left behind');
});

test('every wiring gives the free voice a multilingual voice, renews an ElevenLabs command, and keeps the owner\'s own choice',t=>{
 const state=temporary(t);
 const free=godspeedVoiceSettings('',{...where,state});
 assert.equal(JSON.parse(readConfigValue(free,['tts','edge','voice'])),FREE_VOICE);assert.equal(godspeedVoiceSettings(free,{...where,state}),free);
 const chosen='tts:\n  edge:\n    voice: de-DE-KatjaNeural\n';assert.equal(godspeedVoiceSettings(chosen,{...where,state}),chosen,'an Edge voice the owner chose stays');
 const openai='tts:\n  provider: openai\n';assert.equal(godspeedVoiceSettings(openai,{...where,state}),openai,'another provider the owner chose stays');
 fs.writeFileSync(path.join(state,VOICE_FILE),JSON.stringify({service:'elevenlabs',elevenlabs:CHOICE}));
 const old=withElevenLabs('',{...where,state,choice:CHOICE,script:'/opt/kit-1.0/notebook/scripts/elevenlabs-voice.mjs'});
 const renewed=godspeedVoiceSettings(old,{...where,state});
 assert.match(readConfigValue(renewed,['tts','providers',PROVIDER,'command']),/\/opt\/kit\/notebook\/scripts\/elevenlabs-voice\.mjs/,'the update\'s own script');
 assert.equal(godspeedVoiceSettings(renewed,{...where,state}),renewed);
 // Godspeed's Hermes settings never switch off the text_to_speech tool, which a written request needs.
 for(const config of ['','agent:\n  disabled_toolsets: ["browser"]\n'])assert.ok(!configList(readConfigValue(godspeedHermesSettings(config),['agent','disabled_toolsets'])).includes('tts'));
});

test('the owner\'s Telegram chat answers voice notes with a voice note by default, and a chat\'s own choice stays',t=>{
 const home=temporary(t),file=path.join(home,VOICE_MODE_FILE),modes=()=>JSON.parse(fs.readFileSync(file,'utf8'));
 assert.deepEqual(chatVoiceDefaults({home,chats:[CHAT],config:''}),[CHAT]);
 assert.deepEqual(modes(),{['telegram:'+CHAT]:'voice_only'},'the mode /voice on gives, in Hermes\' own file');
 assert.equal(fs.readFileSync(file,'utf8').charCodeAt(0),123,'no byte order mark, which Hermes would not read');
 assert.deepEqual(chatVoiceDefaults({home,chats:[CHAT],config:''}),[],'once');
 fs.writeFileSync(file,JSON.stringify({['telegram:'+CHAT]:'off','telegram:777':'all','discord:5':'voice_only'}));
 assert.deepEqual(chatVoiceDefaults({home,chats:[CHAT,'777','-100123'],config:''}),['-100123']);
 assert.deepEqual(modes(),{['telegram:'+CHAT]:'off','telegram:777':'all','discord:5':'voice_only','telegram:-100123':'voice_only'},'/voice off stays off, /voice tts stays all');
 // voice.auto_tts set by the owner is their choice for every chat, whichever way: nothing is added.
 const other=temporary(t);
 for(const value of ['true','false'])assert.deepEqual(chatVoiceDefaults({home:other,chats:[CHAT],config:'voice:\n  auto_tts: '+value+'\n'}),[]);
 assert.equal(fs.existsSync(path.join(other,VOICE_MODE_FILE)),false);
 // A file Hermes could not read either is left as it is, and only chat ids count.
 fs.writeFileSync(path.join(other,VOICE_MODE_FILE),'{not json');assert.deepEqual(chatVoiceDefaults({home:other,chats:[CHAT],config:''}),[]);
 assert.equal(fs.readFileSync(path.join(other,VOICE_MODE_FILE),'utf8'),'{not json');
 assert.deepEqual(chatVoiceDefaults({home:temporary(t),chats:['@someone','12ab'],config:''}),[]);
});

test('the owner\'s chat is found where each installation keeps it',t=>{
 const home=temporary(t),dir=temporary(t);
 fs.writeFileSync(path.join(home,'.env'),'OPENROUTER_API_KEY=kept\nTELEGRAM_ALLOWED_USERS='+CHAT+'\nTELEGRAM_HOME_CHANNEL='+CHAT+'\n');
 assert.deepEqual(ownerChats({home,env:{}}),[CHAT],'the server installer and a computer: Hermes\' .env');
 fs.writeFileSync(path.join(dir,'setup.json'),JSON.stringify({bot_id:1,owner_id:5551,chat_id:5551,done:true}));
 assert.deepEqual(ownerChats({home:temporary(t),env:{GODSPEED_TELEGRAM_DIR:dir}}),['5551'],'the one-click server: the setup chat\'s record');
 fs.writeFileSync(path.join(dir,'setup.json'),JSON.stringify({chat_id:5551,done:false}));
 assert.deepEqual(ownerChats({home:temporary(t),env:{GODSPEED_TELEGRAM_DIR:dir}}),[],'a setup still under way has no owner yet');
 assert.deepEqual(ownerChats({home:temporary(t),env:{GODSPEED_TELEGRAM:'on',GODSPEED_CANDIDATE_BOT_OWNER:'8080',TELEGRAM_HOME_CHANNEL:'8080'}}),['8080']);
});

// A stand-in for ElevenLabs: the request as it arrived, and the answer it gives.
function elevenLabs(answer=()=>[200,OGG]){
 const calls=[];
 const fetcher=async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});const [status,body]=answer(calls.length);return new Response(Buffer.isBuffer(body)?body:JSON.stringify(body),{status});};
 return {calls,fetcher};
}
function installation(t){
 const base=temporary(t),home=path.join(base,'hermes'),state=path.join(base,'workspace','.godspeed');fs.mkdirSync(home,{recursive:true});fs.mkdirSync(state,{recursive:true});
 fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openrouter\n');fs.writeFileSync(path.join(home,'.env'),'OPENROUTER_API_KEY=kept\n');
 return {home,state,config:()=>fs.readFileSync(path.join(home,'config.yaml'),'utf8'),env:()=>fs.readFileSync(path.join(home,'.env'),'utf8')};
}

test('Settings keeps an ElevenLabs voice only after a sample worked, and sends the sample back to be heard',async t=>{
 const f=installation(t),{calls,fetcher}=elevenLabs();
 const result=await saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',key:KEY,voice_id:VOICE,model:'eleven_v3',stability:'0.3',similarity_boost:1,style:0.3,language:'de-AT'},fetcher,node:where.node,script:where.script,platform:'linux'});
 assert.equal(calls.length,1);
 const [{url,init,body}]=calls;
 assert.equal(url,'https://api.elevenlabs.io/v1/text-to-speech/'+VOICE+'?output_format=opus_48000_64');
 assert.equal(init.method,'POST');assert.equal(init.headers['xi-api-key'],KEY);
 assert.deepEqual(body,{text:sampleText('de'),model_id:'eleven_v3',voice_settings:{stability:0.3,similarity_boost:1,style:0.3}});
 assert.equal(result.sample,'data:audio/ogg;base64,'+OGG.toString('base64'));
 assert.deepEqual(result.voice,{service:'elevenlabs',voice_id:VOICE,model:'eleven_v3',stability:0.3,similarity_boost:1,style:0.3});
 assert.equal(result.key,true);
 assert.equal(f.env(),'OPENROUTER_API_KEY=kept\nELEVENLABS_API_KEY='+KEY+'\n','the key goes with the other keys');
 assert.equal(readConfigValue(f.config(),['tts','provider']),'"'+PROVIDER+'"');assert.equal(readConfigValue(f.config(),['model','provider']),'openrouter');
 assert.equal(JSON.stringify(readVoiceRecord(f.state)).includes(KEY),false,'Godspeed\'s own copy holds no key');
 // Tuning it again needs no key: the saved one is used.
 await saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',voice_id:VOICE,model:'eleven_v3',stability:0.6},fetcher,node:where.node,script:where.script,platform:'linux'});
 assert.equal(calls[1].init.headers['xi-api-key'],KEY);assert.deepEqual(calls[1].body.voice_settings,{stability:0.6,similarity_boost:0.75,style:0});
 assert.match(readConfigValue(f.config(),['tts','providers',PROVIDER,'command']),/--stability 0\.6 --similarity 0\.75 --style 0 /);
 // The free voice again: Hermes' default provider; the key stays for a later return.
 const free=await saveVoice({home:f.home,state:f.state,input:{service:'edge'}});
 assert.deepEqual(free.voice,{service:'edge',voice_id:FREE_VOICE});assert.equal(readConfigValue(f.config(),['tts','provider']),null);
 assert.match(f.env(),/ELEVENLABS_API_KEY=/);assert.equal(free.elevenlabs.stability,0.6,'the form remembers the voice');
});

test('a refused sample keeps nothing and says why in plain words',async t=>{
 const f=installation(t),before=[f.config(),f.env()];
 const refusals=[
  [401,{detail:{status:'invalid_api_key',message:'Invalid API key'}},/did not accept the key/],
  [401,{detail:{status:'quota_exceeded',message:'This request exceeds your quota of 10000. You have 3 credits remaining.'}},/no credits left/],
  [404,{detail:{status:'voice_not_found',message:'A voice with the voice_id was not found.'}},/does not know this voice id/],
  [422,{detail:[{loc:['body','voice_settings','stability'],msg:'Input should be less than or equal to 1'}]},/did not accept these voice settings\. ElevenLabs says: Input should be/],
 ];
 for(const [status,answer,words] of refusals){
  const {fetcher}=elevenLabs(()=>[status,answer]);
  await assert.rejects(saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',key:KEY,voice_id:VOICE},fetcher}),error=>words.test(error.message)&&error.status===undefined);
 }
 assert.deepEqual([f.config(),f.env()],before);assert.deepEqual(readVoiceRecord(f.state),{});
 // What is wrong in the form is said before ElevenLabs is asked.
 const {calls,fetcher}=elevenLabs();
 await assert.rejects(saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',key:KEY,voice_id:'not a voice'},fetcher}),/voice id/);
 await assert.rejects(saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',key:KEY,voice_id:VOICE,style:2},fetcher}),/numbers from 0 to 1/);
 await assert.rejects(saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',key:'sk with space',voice_id:VOICE},fetcher}),/Copy it again/);
 await assert.rejects(saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',voice_id:VOICE},fetcher}),/Paste your ElevenLabs key/);
 assert.equal(calls.length,0);
 // A server that cannot reach ElevenLabs, and an answer that is no voice recording.
 await assert.rejects(saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',key:KEY,voice_id:VOICE},fetcher:async()=>{throw new TypeError('fetch failed');}}),/could not be reached/);
 await assert.rejects(saveVoice({home:f.home,state:f.state,input:{service:'elevenlabs',key:KEY,voice_id:VOICE},fetcher:elevenLabs(()=>[200,Buffer.from('<html>')]).fetcher}),/something else than a voice recording/);
 assert.equal(elevenLabsChoice({voice_id:VOICE}).model,'eleven_multilingual_v2');
 assert.match(elevenLabsProblem(500,''),/problem of its own/);assert.match(elevenLabsProblem(418,'teapot'),/HTTP 418\)\. ElevenLabs says: teapot/);
});

test('Settings shows the voice, what the chats are set to, and the last failure',t=>{
 const f=installation(t);
 fs.writeFileSync(path.join(f.home,VOICE_MODE_FILE),JSON.stringify({['telegram:'+CHAT]:'voice_only','telegram:777':'off'}));
 const status=voiceStatus(f);
 assert.deepEqual(status.voice,{service:'edge',voice_id:null});assert.deepEqual(status.chats,{voice_only:1,all:0,off:1});assert.equal(status.key,false);assert.equal(status.auto_tts,null);assert.equal(status.failing,null);
 fs.writeFileSync(path.join(f.home,'config.yaml'),'tts:\n  provider: openai\nvoice:\n  auto_tts: true\n');
 assert.deepEqual(voiceStatus(f).voice,{service:'hermes',provider:'openai'});assert.equal(voiceStatus(f).auto_tts,true);
 noteVoiceFailed(f.state,'ElevenLabs did not accept the key.',new Date('2026-10-25T08:00:00Z'));
 assert.deepEqual(voiceStatus(f).failing,{since:'2026-10-25T08:00:00.000Z',error:'ElevenLabs did not accept the key.',at:'2026-10-25T08:00:00.000Z'});
});

test('a voice that fails is told once for each stretch of failures, and a voice note that works ends it',t=>{
 const state=temporary(t);
 noteVoiceFailed(state,'Your ElevenLabs account has no credits left for this.',new Date('2026-10-25T08:00:00Z'));
 noteVoiceFailed(state,'Your ElevenLabs account has no credits left for this.',new Date('2026-10-25T09:00:00Z'));
 let notices=readNotices({state});assert.equal(notices.length,1);
 assert.equal(notices[0].text,failureWords('Your ElevenLabs account has no credits left for this.'));
 assert.match(notices[0].text,/Your answers still arrive as text\. To fix it, open Settings in your notebook and look at Voice replies\.$/);
 assert.ok(!/[—–]/.test(notices[0].text));
 noteVoiceWorked(state);assert.equal(readVoiceRecord(state).failing_since,undefined);
 noteVoiceFailed(state,'ElevenLabs did not accept the key.',new Date('2026-10-26T08:00:00Z'));
 notices=readNotices({state});assert.equal(notices.length,2,'a new stretch is told again');
});

// THE COMMAND HERMES RUNS, against a stand-in ElevenLabs on this machine.
function standIn(t,answer){
 const seen=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{seen.push({url:req.url,key:req.headers['xi-api-key'],body:JSON.parse(raw)});const [status,body]=answer(seen.length);res.writeHead(status,{'Content-Type':Buffer.isBuffer(body)?'audio/ogg':'application/json'});res.end(Buffer.isBuffer(body)?body:JSON.stringify(body));});});
 t.after(()=>server.close());
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({seen,api:'http://127.0.0.1:'+server.address().port})));
}
const run=(args,env)=>new Promise(resolve=>{const child=spawn(process.execPath,[SPEECH_SCRIPT,...args],{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot||'',...env},windowsHide:true});let err='';child.stderr.on('data',c=>err+=c);child.on('exit',code=>resolve({code,err}));});

test('the command writes the voice note with the voice settings, and on a refusal exits so Hermes sends the text',async t=>{
 let refuse=false;const {seen,api}=await standIn(t,()=>refuse?[401,{detail:{status:'quota_exceeded',message:'You have 0 credits remaining.'}}]:[200,OGG]);
 const base=temporary(t),keys=path.join(base,'.env'),state=path.join(base,'.godspeed'),input=path.join(base,'input.txt'),output=path.join(base,'tts_reply.ogg');
 fs.writeFileSync(keys,'TELEGRAM_HOME_CHANNEL='+CHAT+'\nELEVENLABS_API_KEY="'+KEY+'"\n');fs.writeFileSync(input,'Guten Morgen. Dein Termin ist um neun.');
 const args=['--voice',VOICE,'--model','eleven_v3','--stability','0.3','--similarity','1','--style','0.3','--keys',keys,'--state',state,input,output];
 const ok=await run(args,{GODSPEED_ELEVENLABS_API:api});
 assert.equal(ok.code,0,ok.err);assert.deepEqual(fs.readFileSync(output),OGG);
 assert.equal(seen[0].url,'/v1/text-to-speech/'+VOICE+'?output_format=opus_48000_64');assert.equal(seen[0].key,KEY,'the key from Hermes\' .env, quotes and all');
 assert.deepEqual(seen[0].body,{text:'Guten Morgen. Dein Termin ist um neun.',model_id:'eleven_v3',voice_settings:{stability:0.3,similarity_boost:1,style:0.3}});
 refuse=true;fs.rmSync(output);
 const failed=await run(args,{GODSPEED_ELEVENLABS_API:api});
 assert.equal(failed.code,1);assert.match(failed.err,/no credits left/);assert.equal(fs.existsSync(output),false,'no sound file, so Hermes sends the text');
 await run(args,{GODSPEED_ELEVENLABS_API:api});
 assert.equal(readNotices({state}).length,1,'told once');
 refuse=false;assert.equal((await run(args,{GODSPEED_ELEVENLABS_API:api})).code,0);assert.equal(readVoiceRecord(state).failing_since,undefined);
 // An MP3 when Hermes asks for one, and nothing without a key.
 assert.equal((await run([...args.slice(0,-1),path.join(base,'reply.mp3')],{GODSPEED_ELEVENLABS_API:api})).code,0);assert.match(seen.at(-1).url,/output_format=mp3_44100_128$/);
 fs.writeFileSync(keys,'TELEGRAM_HOME_CHANNEL='+CHAT+'\n');const none=await run(args,{GODSPEED_ELEVENLABS_API:api});
 assert.equal(none.code,1);assert.match(none.err,/No ElevenLabs key is saved/);
 assert.equal((await run(['--voice',VOICE,input,path.join(base,'reply.wav')],{})).code,2);
});

test('the assistant is asked to send the same text with a voice note it was asked for, and told how voice replies work',{skip:!havePython&&'no Python here'},()=>{
 const plugin=path.join(kit,'notebook','assistant-files','godspeed-context','__init__.py');
 const out=execFileSync(python,['-c',`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
asks=["Answer me with a voice note please","Kannst du mir das als Sprachnachricht schicken?","Lies mir die Liste vor","read the answer aloud","how do I stop the voice replies?","what's the weather?","Remind me to call the voice teacher",[{"type":"text","text":"send an audio message"}]]
print(json.dumps([m.voice_block(a) for a in asks]))
print(json.dumps(m.on_pre_llm_call(user_message="voice note please", platform="cron")))
print(json.dumps(m.on_pre_llm_call(user_message="voice note please", platform="telegram")))`,plugin],{encoding:'utf8'}).trim().split('\n').map(l=>JSON.parse(l));
 const [blocks,cron,telegram]=out;
 const [english,german,vorlesen,aloud,howto,weather,teacher,parts]=blocks;
 for(const block of [english,german,vorlesen,aloud,howto,parts])assert.match(block,/^\[godspeed-voice\] .*call text_to_speech once with the same words/);
 assert.equal(weather,null);assert.equal(teacher,null);
 assert.match(english,/\/voice off in a chat stops that there/);assert.match(english,/Settings, Voice replies/);assert.match(english,/Never ask for an ElevenLabs key/);
 assert.equal(cron,null,'a scheduled run is not a conversation');assert.match(telegram.context,/\[godspeed-voice\]/);
 assert.ok(!/[—–]/.test(english));
});

test('on the one-click server the chat gets the default right before the gateway starts',async t=>{
 const base=temporary(t),dir=path.join(base,'telegram'),home=path.join(base,'hermes'),root=path.join(base,'workspace');fs.mkdirSync(dir);fs.mkdirSync(home);installStarter(root);
 const started=[];
 const runner=new TelegramRunner({dir,env:{PATH:'/usr/bin',HOME:'/fictional',HERMES_HOME:home,GODSPEED_WORKSPACE:root},now:()=>1_000_000,python:'/fictional/python3',hermes:'/fictional/hermes',
  address:()=>({link:null}),spawnProcess:(command,args,options)=>{const child=new EventEmitter();child.pid=started.length+1;child.kill=()=>{};Object.assign(child,{command,args,options,modes:fs.existsSync(path.join(home,VOICE_MODE_FILE))?JSON.parse(fs.readFileSync(path.join(home,VOICE_MODE_FILE),'utf8')):null});started.push(child);return child;},kill:()=>{}});
 fs.writeFileSync(path.join(dir,'connection.json'),JSON.stringify({token:'123456789:AAHfictionalKeyForTestsOnly_0123456789',bot_id:4242,username:'fictional_bot',start_code:'fictionalStartCode0123456789abcd'}));
 fs.writeFileSync(path.join(dir,'setup.json'),JSON.stringify({bot_id:4242,owner_id:Number(CHAT),chat_id:Number(CHAT),done:true}));
 runner.tick();
 assert.deepEqual(started[0].args,['gateway','run']);
 assert.deepEqual(started[0].modes,{['telegram:'+CHAT]:'voice_only'},'written before the gateway read it');
});

const wireScript=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
const wire=(root,home)=>execFileSync(process.execPath,[wireScript,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41993',GODSPEED_DEVICE:'local',GODSPEED_ORIGINAL_RUNTIME:'on'},windowsHide:true});

test('every wiring of a mission control made from the starter switches voice replies on for the owner\'s chat; an adopted one keeps its assistant',t=>{
 const base=temporary(t),root=path.join(base,'workspace'),home=path.join(base,'hermes');installStarter(root);fs.mkdirSync(home);
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:fictional\nTELEGRAM_ALLOWED_USERS='+CHAT+'\nTELEGRAM_HOME_CHANNEL='+CHAT+'\n');
 wire(root,home);
 const config=fs.readFileSync(path.join(home,'config.yaml'),'utf8');
 assert.equal(JSON.parse(readConfigValue(config,['tts','edge','voice'])),FREE_VOICE);assert.equal(readConfigValue(config,['voice','auto_tts']),null,'never the global switch');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,VOICE_MODE_FILE),'utf8')),{['telegram:'+CHAT]:'voice_only'});
 fs.writeFileSync(path.join(home,VOICE_MODE_FILE),JSON.stringify({['telegram:'+CHAT]:'off'}));
 wire(root,home);
 assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),config,'wiring again changes nothing');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,VOICE_MODE_FILE),'utf8')),{['telegram:'+CHAT]:'off'},'the owner\'s /voice off stays');
 const adopted=path.join(base,'adopted'),other=path.join(base,'other-hermes');
 fs.mkdirSync(path.join(adopted,'rules'),{recursive:true});fs.writeFileSync(path.join(adopted,'AGENTS.md'),'# Mine\n');fs.writeFileSync(path.join(adopted,'rules','mine.md'),'Mine.\n');installStarter(adopted);
 fs.mkdirSync(other);fs.writeFileSync(path.join(other,'.env'),'TELEGRAM_HOME_CHANNEL='+CHAT+'\n');
 wire(adopted,other);
 assert.equal(fs.existsSync(path.join(other,VOICE_MODE_FILE)),false);assert.equal(readConfigValue(fs.readFileSync(path.join(other,'config.yaml'),'utf8'),['tts']),null);
});

test('the real ElevenLabs request is the one the stand-in saw',async()=>{
 // No network here: the request is checked as fetch receives it.
 let seen;await elevenLabsSpeech({key:KEY,voice:VOICE,model:'eleven_v3',settings:{stability:0.3},text:'Hi',fetcher:async(url,init)=>{seen={url,init};return new Response(OGG);}});
 assert.equal(seen.url,'https://api.elevenlabs.io/v1/text-to-speech/'+VOICE+'?output_format=opus_48000_64');
 assert.deepEqual(seen.init.headers,{'xi-api-key':KEY,'Content-Type':'application/json',Accept:'audio/*'});
});
