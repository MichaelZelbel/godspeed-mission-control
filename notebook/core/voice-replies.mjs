import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomic} from './records/store.mjs';
import {setConfigValue,readConfigValue,deleteConfigValue} from './hermes-config.mjs';
import {KEY_NAME,SETTINGS,STT_PROVIDER,STT_MODEL,STT_PERMISSION,readVoiceRecord,writeVoiceRecord,envValue,elevenLabsSpeech,elevenLabsMayTranscribe,voiceSettings,VoiceProblem} from './voice-speech.mjs';

// VOICE REPLIES (25 October 2026, discussion #41 of the public repository). A voice note sent to the
// assistant in Telegram is answered with a voice note and the same answer as text; a written request
// for a spoken answer gets one too. Hermes can do all of it (it transcribes voice notes, and
// `/voice on` in a chat answers them with a voice note, the text as its caption or right after it),
// but it is off until a chat asks for it, and Godspeed never said so.
//
// ON BY DEFAULT, BUT ONLY IN THE CHAT. Hermes' global switch voice.auto_tts is also what the Hermes
// app on a computer writes for "Read replies aloud" (apps/desktop, use-auto-speak-replies.ts), so
// turning it on would have that app read every answer aloud. Instead the owner's Telegram chat gets
// the mode `/voice on` would give it (voice_only: a voice note is answered with a voice note), in
// Hermes' own per-chat file <Hermes home>/gateway_voice_mode.json, which the gateway reads when it
// starts. A chat that has a mode already keeps it (`/voice off` stays off, `/voice tts` stays all),
// and where the owner set voice.auto_tts themselves, that global choice decides and nothing is added.
//
// THE VOICE. The free Microsoft Edge voice is Hermes' default; Godspeed gives it a multilingual
// Edge voice, which speaks the language of the answer (Hermes' default voice is an American English
// one), unless the owner chose an Edge voice. ElevenLabs, with the person's key, voice, model and
// voice settings, is chosen in Settings, Voice replies: a short sample is made first and nothing is
// kept unless it worked. The key goes into Hermes' .env with the other keys; the voice into
// config.yaml as a command provider (core/voice-speech.mjs says why Hermes' own ElevenLabs connection
// is not used), and Godspeed's own copy of the choice into <mission control>/.godspeed/voice-replies.json.
export const PROVIDER='godspeed-elevenlabs';
export const FREE_VOICE='en-US-AvaMultilingualNeural';
export const VOICE_MODE_FILE='gateway_voice_mode.json';
export const DEFAULT_CHAT_MODE='voice_only';
// eleven_v4_turbo speaks one sentence in about a second, where eleven_v3 took about three (measured
// on a Godspeed server on 26 October 2026), and a voice note that comes back while the person is
// still holding the phone is a different thing from one that comes back later. Another model can be
// picked in Settings, and the model somebody picked is what they keep.
export const ELEVENLABS_DEFAULTS={model:'eleven_v4_turbo',stability:0.5,similarity_boost:0.75,style:0};
export const SPEECH_SCRIPT=fileURLToPath(new URL('../scripts/elevenlabs-voice.mjs',import.meta.url));
// Hermes stops a command provider that prints nothing for this long; a long answer on a slow model
// may take a minute.
export const SPEECH_TIMEOUT_SECONDS=180;

const read=file=>{try{return fs.readFileSync(file,'utf8').replace(/^﻿/,'');}catch{return '';}};
const writePrivate=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});atomic(file,text);if(process.platform!=='win32')try{fs.chmodSync(file,0o600);}catch{}};
const unquote=v=>typeof v==='string'?v.trim().replace(/^(["'])(.*)\1$/,'$2').trim():'';

// HOW HERMES RUNS THE COMMAND: through the shell (cmd.exe on Windows, /bin/sh elsewhere). Hermes
// quotes its own placeholders ({voice}, {input_path}, ...); the paths written here are quoted for
// that shell.
export function shellWord(value,platform=process.platform){
 const text=String(value);
 if(platform==='win32'){if(/["%\r\n]/.test(text))throw Error('A path with a quotation mark or a percent sign cannot be used for the voice: '+text);return '"'+text+'"';}
 return "'"+text.replaceAll("'","'\\''")+"'";
}
export function speechCommand({node=process.execPath,script=SPEECH_SCRIPT,home,state,choice,platform=process.platform}){
 const number=v=>String(Number(v)),join=(platform==='win32'?path.win32:path.posix).join;
 return [shellWord(node,platform),shellWord(script,platform),'--voice {voice} --model {model}',
  '--stability',number(choice.stability),'--similarity',number(choice.similarity_boost),'--style',number(choice.style),
  '--keys',shellWord(join(home,'.env'),platform),'--state',shellWord(state,platform),'{input_path} {output_path}'].join(' ');
}

// THE VOICE IN config.yaml. ElevenLabs: Hermes' tts.provider is Godspeed's command provider, with the
// voice and the model as Hermes' own placeholders and the voice settings on its command line. The
// free voice: Hermes' default provider (Edge), with the multilingual voice unless one was chosen.
export function withElevenLabs(text,{home,state,choice,node,script,platform}){
 let out=setConfigValue(text,['tts','provider'],JSON.stringify(PROVIDER));
 const at=key=>['tts','providers',PROVIDER,key];
 out=setConfigValue(out,at('type'),'command');
 out=setConfigValue(out,at('command'),JSON.stringify(speechCommand({home,state,choice,node,script,platform})));
 out=setConfigValue(out,at('voice'),JSON.stringify(choice.voice_id));
 out=setConfigValue(out,at('model'),JSON.stringify(choice.model));
 out=setConfigValue(out,at('format'),'ogg');
 out=setConfigValue(out,at('voice_compatible'),'true');
 out=setConfigValue(out,at('timeout'),String(SPEECH_TIMEOUT_SECONDS));
 return out;
}
export function withFreeVoice(text){
 let out=String(text||'');
 if(unquote(readConfigValue(out,['tts','provider'])||'')===PROVIDER)out=deleteConfigValue(out,['tts','provider']);
 out=deleteConfigValue(out,['tts','providers',PROVIDER]);
 // A providers section left with nothing under it goes too; one with the owner's own providers stays.
 const without=deleteConfigValue(out,['tts','providers']);
 if(readConfigValue(out,['tts','providers'])===''&&out.split('\n').length-without.split('\n').length===1)out=without;
 const provider=unquote(readConfigValue(out,['tts','provider'])||'');
 if((!provider||provider==='edge')&&readConfigValue(out,['tts','edge','voice'])===null)out=setConfigValue(out,['tts','edge','voice'],JSON.stringify(FREE_VOICE));
 return out;
}
// AT EVERY WIRING (scripts/wire-assistant.mjs), for a mission control made from the starter: an
// ElevenLabs voice chosen in Settings gets its command again, since an update moves the script; a
// tts.provider the owner set in Hermes by hand is theirs and stays.
export function godspeedVoiceSettings(text,{home,state,node,script,platform}){
 const provider=unquote(readConfigValue(text,['tts','provider'])||''),record=readVoiceRecord(state);
 if(provider===PROVIDER&&record.service==='elevenlabs'&&record.elevenlabs?.voice_id)return withElevenLabs(text,{home,state,choice:record.elevenlabs,node,script,platform});
 if(!provider||provider==='edge')return withFreeVoice(text);
 return text;
}

// UNDERSTANDING THE VOICE NOTE WITH ELEVENLABS (core/voice-speech.mjs says what Hermes reads and why
// no package is needed). Hermes is set to it only when the person's key may transcribe, which Settings
// asks the key once; otherwise the voice note is understood on the computer itself, as before. An
// stt.provider the owner set in Hermes themselves is theirs and stays, as a tts.provider does: only
// an empty one, or the one Godspeed wrote itself, is written again.
export function withElevenLabsTranscription(text){
 let out=setConfigValue(text,['stt','provider'],JSON.stringify(STT_PROVIDER));
 return setConfigValue(out,['stt','elevenlabs','model_id'],JSON.stringify(STT_MODEL));
}
// Godspeed's own: the stt.provider in config.yaml is ElevenLabs and Godspeed's record says Godspeed
// wrote it. Only that one is Godspeed's to write again or to take away.
export function godspeedWroteTranscription(config,record={}){
 return unquote(readConfigValue(config,['stt','provider'])||'')===STT_PROVIDER&&record.stt===STT_PROVIDER;
}
export function mayWriteTranscription(config,record={}){
 return !unquote(readConfigValue(config,['stt','provider'])||'')||godspeedWroteTranscription(config,record);
}
// TAKING IT AWAY AGAIN, when the key that switched it on is replaced by one ElevenLabs refuses the
// permission: without this, Hermes would keep sending voice notes to ElevenLabs with a key that may
// not transcribe them, and the page would say ElevenLabs understands them. Hermes understands them
// here again, as it did before. A section left with nothing under it goes too, as withFreeVoice does.
export function withoutElevenLabsTranscription(text){
 let out=deleteConfigValue(text,['stt','provider']);
 out=deleteConfigValue(out,['stt','elevenlabs','model_id']);
 return dropEmpty(dropEmpty(out,['stt','elevenlabs']),['stt']);
}
function dropEmpty(text,keys){
 if(readConfigValue(text,keys)!=='')return text;
 const without=deleteConfigValue(text,keys);
 return text.split('\n').length-without.split('\n').length===1?without:text;
}
// What Settings says about understanding a voice note: where it happens, with which model, and what
// the last answer from ElevenLabs means for it.
//
// Every sentence has to be true of the state it is shown in. An answer that is not a yes is still
// open, and it is shown whether the voice note is understood here or at ElevenLabs, because both
// states can hold one: a key replaced while ElevenLabs is down leaves ElevenLabs set with the new
// key's permission unread, and nobody is served by a page that then says ElevenLabs understands the
// voice notes. While ElevenLabs is set, the page says that is still where they go; while they are
// understood here, it says that instead. A provider the owner chose themselves is their own, so
// nothing about an ElevenLabs key is said under it.
export function transcribeStatus({config,record={}}){
 const provider=unquote(readConfigValue(config,['stt','provider'])||'');
 const asked=record.transcribe||null,open=asked&&asked.answer!=='yes'?asked:null;
 if(provider===STT_PROVIDER)return {service:'elevenlabs',model:unquote(readConfigValue(config,['stt','elevenlabs','model_id'])||'')||STT_MODEL,
  words:!open?null:open.answer==='no'
   ?'Your ElevenLabs key may not transcribe, and your voice notes are sent to ElevenLabs all the same, because stt.provider says so in Hermes itself: allow the key '+STT_PERMISSION+' on the ElevenLabs page for API keys, or change that setting in Hermes.'
   :String(open.words||'')+' Your voice notes are sent to ElevenLabs until you save your key again.'};
 if(provider&&provider!=='local')return {service:'hermes',provider,words:null};
 return {service:'local',model:null,
  words:!open?null:open.answer==='no'?open.words||null:String(open.words||'')+' Your voice notes are understood on this computer until it is known.'};
}

// THE OWNER'S TELEGRAM CHAT, wherever this installation keeps it: TELEGRAM_HOME_CHANNEL in Hermes'
// .env (the server installer, a computer) or in the gateway's environment, and on the one-click
// server the setup chat's own record (GODSPEED_TELEGRAM_DIR/setup.json).
const CHAT=/^-?\d{1,20}$/;
export function ownerChats({home,env=process.env}){
 const found=[envValue(read(path.join(home||'','.env')),'TELEGRAM_HOME_CHANNEL'),String(env.TELEGRAM_HOME_CHANNEL||'').trim()];
 if(env.GODSPEED_TELEGRAM==='on')found.push(String(env.GODSPEED_CANDIDATE_BOT_OWNER||'').trim());
 if(env.GODSPEED_TELEGRAM_DIR){try{const setup=JSON.parse(read(path.join(env.GODSPEED_TELEGRAM_DIR,'setup.json')));if(setup?.done)found.push(String(setup.chat_id??''));}catch{}}
 return [...new Set(found.filter(chat=>CHAT.test(chat)))];
}
// Hermes' per-chat voice modes, as the gateway writes them: {"telegram:<chat id>": "voice_only"}.
export function readChatModes(home){
 const file=path.join(home,VOICE_MODE_FILE);
 try{const data=JSON.parse(read(file)||'null');return data&&typeof data==='object'&&!Array.isArray(data)?data:null;}catch{return null;}
}
// The default for the owner's chat, before the gateway starts (it reads the file once, then). Returns
// the chats that got it. A file Hermes could not read is left alone.
export function chatVoiceDefaults({home,chats,config}){
 if(!home||!chats?.length)return [];
 if(readConfigValue(config??read(path.join(home,'config.yaml')),['voice','auto_tts'])!==null)return [];
 const file=path.join(home,VOICE_MODE_FILE),exists=fs.existsSync(file),modes=exists?readChatModes(home):{};
 if(!modes)return [];
 const added=[];
 for(const chat of chats){const key='telegram:'+chat;if(CHAT.test(String(chat))&&!(key in modes)){modes[key]=DEFAULT_CHAT_MODE;added.push(String(chat));}}
 if(added.length){fs.mkdirSync(home,{recursive:true});atomic(file,JSON.stringify(modes,null,2));}
 return added;
}

// WHAT SETTINGS SHOWS: the voice Hermes speaks with (read from config.yaml, so a choice made in Hermes
// itself shows as that), Godspeed's own copy of an ElevenLabs choice for the form, whether a key is
// saved, what the Telegram chats are set to, where a voice note is understood, and the last failure.
export function voiceStatus({home,state}){
 const config=read(path.join(home,'config.yaml')),record=readVoiceRecord(state),provider=unquote(readConfigValue(config,['tts','provider'])||'');
 let voice;
 if(provider===PROVIDER)voice={service:'elevenlabs',voice_id:unquote(readConfigValue(config,['tts','providers',PROVIDER,'voice'])||''),model:unquote(readConfigValue(config,['tts','providers',PROVIDER,'model'])||''),
  ...Object.fromEntries(SETTINGS.map(name=>[name,record.elevenlabs?.[name]??null]))};
 else if(!provider||provider==='edge')voice={service:'edge',voice_id:unquote(readConfigValue(config,['tts','edge','voice'])||'')||null};
 else voice={service:'hermes',provider};
 const modes=Object.entries(readChatModes(home)||{}).filter(([key])=>/^telegram:/.test(key)).map(([,mode])=>mode);
 const autoTts=readConfigValue(config,['voice','auto_tts']);
 return {available:true,voice,elevenlabs:{...ELEVENLABS_DEFAULTS,...(record.elevenlabs||{})},key:!!envValue(read(path.join(home,'.env')),KEY_NAME),
  chats:{voice_only:modes.filter(m=>m==='voice_only').length,all:modes.filter(m=>m==='all').length,off:modes.filter(m=>m==='off').length},
  auto_tts:autoTts===null?null:unquote(autoTts).toLowerCase()==='true',
  transcribe:transcribeStatus({config,record}),
  failing:record.failing_since?{since:record.failing_since,error:record.last_error||null,at:record.last_failed_at||null}:null};
}

// The sample Settings makes before anything is kept, in the language of the browser when it is one
// of these.
const SAMPLES={
 en:'Hello. This is how I sound when I answer your voice notes.',
 de:'Hallo. So klinge ich, wenn ich auf deine Sprachnachrichten antworte.',
};
export const sampleText=language=>SAMPLES[String(language||'').toLowerCase().slice(0,2)]||SAMPLES.en;

// The choice from the form, checked before ElevenLabs is asked.
export function elevenLabsChoice(input={}){
 const voice_id=String(input.voice_id||'').trim(),model=String(input.model||'').trim()||ELEVENLABS_DEFAULTS.model;
 if(!/^[A-Za-z0-9]{8,64}$/.test(voice_id))throw new VoiceProblem('Copy the voice id from the voice\'s page at ElevenLabs. It is a row of letters and digits.');
 if(!/^[a-z0-9_]{3,64}$/.test(model))throw new VoiceProblem('Write the model the way ElevenLabs writes it, for example '+ELEVENLABS_DEFAULTS.model+'.');
 const given=voiceSettings({stability:input.stability,similarity_boost:input.similarity_boost,style:input.style});
 return {voice_id,model,...Object.fromEntries(SETTINGS.map(name=>[name,given[name]??ELEVENLABS_DEFAULTS[name]]))};
}

// SAVING A VOICE FROM SETTINGS. ElevenLabs: a short sample with the key, the voice, the model and the
// settings first; only when it came back is anything written, and the sample goes back to the page so
// the person hears it. The key may be left out when one is saved already. The free voice: nothing to
// test (no key, no account), so it is saved at once; an ElevenLabs key already saved stays saved.
export async function saveVoice({home,state,input={},fetcher,api,node,script,platform,now=new Date()}){
 const configFile=path.join(home,'config.yaml'),envFile=path.join(home,'.env');
 const record=readVoiceRecord(state);
 if(input.service==='edge'){
  writePrivate(configFile,withFreeVoice(read(configFile)));
  writeVoiceRecord(state,{...clearFailure(record),service:'edge',at:now.toISOString()});
  return voiceStatus({home,state});
 }
 if(input.service!=='elevenlabs')throw new VoiceProblem('Choose the free voice or ElevenLabs.');
 const choice=elevenLabsChoice(input),typed=typeof input.key==='string'?input.key.trim():'';
 if(typed&&!/^[A-Za-z0-9_-]{16,200}$/.test(typed))throw new VoiceProblem('The key has a space or a sign a key never has. Copy it again from your ElevenLabs account.');
 const key=typed||envValue(read(envFile),KEY_NAME);
 if(!key)throw new VoiceProblem('Paste your ElevenLabs key.');
 const sample=await elevenLabsSpeech({key,voice:choice.voice_id,model:choice.model,settings:Object.fromEntries(SETTINGS.map(n=>[n,choice[n]])),text:sampleText(input.language),fetcher,api,timeoutMs:60000});
 // Loaded only here: routine-ai.mjs brings the notebook's runtime, which the Telegram runner, which
 // imports this module for the chat's default, does not need.
 if(typed){const {setEnvValue}=await import('./routine-ai.mjs');writePrivate(envFile,setEnvValue(read(envFile),KEY_NAME,typed));}
 // UNDERSTANDING THE VOICE NOTE, asked once with a one-second sample, the way the voice was just
 // tried with a sample: a key given now, or a key whose permission is not settled yet (an answer that
 // never arrived is asked again next time). An answer of yes switches ElevenLabs on; a no switches a
 // key's own earlier yes off again, so the voice note is understood here rather than with a key that
 // may not do it; an ElevenLabs that could not be reached leaves everything as it is and is asked
 // again at the next save. The words go to the page either way.
 const asked=await askedToTranscribe({key,typed,record,fetcher,api});
 let config=withElevenLabs(read(configFile),{home,state,choice,node,script,platform});
 const wrote=asked?.answer==='yes'&&mayWriteTranscription(config,record);
 const undid=asked?.answer==='no'&&godspeedWroteTranscription(config,record);
 if(wrote)config=withElevenLabsTranscription(config);
 if(undid)config=withoutElevenLabsTranscription(config);
 writePrivate(configFile,config);
 const next={...clearFailure(record),service:'elevenlabs',elevenlabs:choice,at:now.toISOString()};
 if(wrote)next.stt=STT_PROVIDER;
 if(undid)delete next.stt;
 if(asked)next.transcribe={...asked,at:now.toISOString()};
 writeVoiceRecord(state,next);
 return {...voiceStatus({home,state}),sample:'data:audio/ogg;base64,'+sample.toString('base64')};
}
// Nothing is asked again once the answer is settled (ElevenLabs transcribes, or it said the key may
// not), unless a new key is given: a key is only as settled as the key itself.
async function askedToTranscribe({key,typed,record,fetcher,api}){
 const settled=record.transcribe?.answer==='yes'||record.transcribe?.answer==='no';
 if(!typed&&settled)return record.transcribe;
 const {may,words}=await elevenLabsMayTranscribe({key,fetcher,api});
 return {answer:may,words:words||null};
}
function clearFailure(record){const out={...record};for(const name of ['failing_since','last_error','last_failed_at','told_for'])delete out[name];return out;}
