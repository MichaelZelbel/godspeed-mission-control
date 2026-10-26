import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {queueNotice} from './notices.mjs';

// AN ELEVENLABS VOICE WITH ITS VOICE SETTINGS (25 October 2026, discussion #41 of the public
// repository). Hermes' own ElevenLabs connection passes only the voice and the model, so a voice
// chosen on the ElevenLabs page (stability, similarity, style) sounded different in Telegram, and it
// needs the elevenlabs SDK, which Hermes installs only at first use. This is the one request that
// makes the speech, plain HTTPS without any SDK, for Settings' sample (core/voice-replies.mjs) and
// for every voice note (scripts/elevenlabs-voice.mjs, which Hermes runs as a command provider).
//
// It is kept light on purpose: Hermes starts the script once per voice note, so it imports nothing
// from the notebook beyond the notices.
export const VOICE_FILE='voice-replies.json';
export const KEY_NAME='ELEVENLABS_API_KEY';
// GODSPEED_ELEVENLABS_API points every request here at a stand-in, which is how voice replies are
// tried end to end without an ElevenLabs account (notebook/test/voice-replies.test.mjs).
export const ELEVENLABS_API='https://api.elevenlabs.io';
export const elevenLabsApi=(env=process.env)=>String(env.GODSPEED_ELEVENLABS_API||'').trim()||ELEVENLABS_API;
// The voice settings as the ElevenLabs voice page names them, each from 0 to 1.
export const SETTINGS=['stability','similarity_boost','style'];
// UNDERSTANDING THE VOICE NOTE (26 October 2026). Hermes transcribes with ElevenLabs Scribe when its
// stt.provider says so, and reads the model at stt.elevenlabs.model_id (its
// tools/transcription_tools.py, _BUILTIN_MODEL_KEYS; its own default is scribe_v2, in
// tools/transcription_common.py). About 0.6 s for a seven-second note, against about 5 s for the
// local Whisper on a server with two cores. It needs no package an install lacks: Hermes posts the
// sound with requests, which it always has, and not with the elevenlabs SDK its own voice needs.
export const STT_PROVIDER='elevenlabs';
export const STT_MODEL='scribe_v2';
// What ElevenLabs calls the permission on its own page for API keys.
export const STT_PERMISSION='Speech to Text';

const read=file=>{try{return fs.readFileSync(file,'utf8').replace(/^﻿/,'');}catch{return '';}};
export function readVoiceRecord(state){try{const r=JSON.parse(read(path.join(state,VOICE_FILE)));return r&&typeof r==='object'&&!Array.isArray(r)?r:{};}catch{return {};}}
export function writeVoiceRecord(state,record){fs.mkdirSync(state,{recursive:true});atomic(path.join(state,VOICE_FILE),JSON.stringify(record,null,2)+'\n');}

// One NAME=value line of a .env file, without quotes ("" when it is not there).
export function envValue(text,name){
 const m=new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=\\s*(.*?)\\s*$','m').exec(String(text||''));
 return m?m[1].replace(/^(["'])(.*)\1$/,'$2').trim():'';
}
// The key: Hermes' .env, read at the moment of speaking, so a key saved in Settings counts from the
// next voice note on without a restart; the environment only when the file has none.
export function keyFrom({keys,env=process.env}){return (keys&&envValue(read(keys),KEY_NAME))||String(env[KEY_NAME]||'').trim();}

// What ElevenLabs sends back, by the file Hermes asked for: Ogg/Opus for a voice note (Telegram
// shows only that as a voice message), MP3 for a file.
const FORMATS={ogg:'opus_48000_64',opus:'opus_48000_64',mp3:'mp3_44100_128'};
export function outputFormat(file){return FORMATS[path.extname(String(file||'')).slice(1).toLowerCase()]||null;}

// serviceStatus, not status: the server answers with an error's status, and ElevenLabs' 401 is not the
// notebook's sign-in.
export class VoiceProblem extends Error{constructor(message,serviceStatus){super(message);this.serviceStatus=serviceStatus||null;}}
const said=detail=>{
 if(Array.isArray(detail))return detail.map(d=>d?.msg||d?.message||'').filter(Boolean).join('; ');
 if(detail&&typeof detail==='object')return String(detail.message||detail.msg||'');
 return typeof detail==='string'?detail:'';
};
// ElevenLabs' refusal in the words a person acts on. Its answers look like
// {"detail":{"status":"invalid_api_key","message":"..."}}, or a list of field errors.
export function elevenLabsProblem(status,body){
 const detail=body&&typeof body==='object'?body.detail:body;
 const code=String(detail&&typeof detail==='object'&&!Array.isArray(detail)?detail.status||detail.code||'':'').toLowerCase();
 const text=said(detail).replace(/\s+/g,' ').trim().slice(0,240),words=(code+' '+text).toLowerCase();
 if(code==='invalid_api_key')return 'ElevenLabs did not accept the key. Copy it again from your ElevenLabs account.';
 if(status===402||/quota|credit|insufficient|payment/.test(words))return 'Your ElevenLabs account has no credits left for this.'+(text?' ElevenLabs says: '+text:'');
 if(code==='missing_permissions'||/permission/.test(words))return 'This ElevenLabs key may not make speech. Allow it Text to Speech on the ElevenLabs page for API keys.';
 if(code==='voice_not_found'||(status===404&&/voice/.test(words)))return 'ElevenLabs does not know this voice id. Copy it again from the voice\'s page.';
 if(/model/.test(words))return 'ElevenLabs does not offer this model here.'+(text?' ElevenLabs says: '+text:'');
 if(status===401)return 'ElevenLabs did not accept the key. Copy it again from your ElevenLabs account.';
 if(status===422||status===400)return 'ElevenLabs did not accept these voice settings.'+(text?' ElevenLabs says: '+text:'');
 if(status===429)return 'ElevenLabs is busy or your plan\'s limit is reached for the moment. Try again in a minute.';
 if(status>=500)return 'ElevenLabs had a problem of its own. Try again later.';
 return 'ElevenLabs refused it (HTTP '+status+').'+(text?' ElevenLabs says: '+text:'');
}

// The voice settings as ElevenLabs wants them: numbers from 0 to 1, each one only when it is given.
export function voiceSettings(given={}){
 const out={};
 for(const name of SETTINGS){
  const raw=given[name];if(raw===undefined||raw===null||raw==='')continue;
  const value=Number(raw);if(!Number.isFinite(value)||value<0||value>1)throw new VoiceProblem('Stability, similarity and style are numbers from 0 to 1.');
  out[name]=value;
 }
 return out;
}

// THE REQUEST. Plain HTTPS: POST /v1/text-to-speech/<voice id>?output_format=..., with the text, the
// model and the voice settings, as on the ElevenLabs voice page. The sound comes back whole.
export async function elevenLabsSpeech({key,voice,model,settings={},text,format='opus_48000_64',fetcher=fetch,api=elevenLabsApi(),timeoutMs=170000}){
 if(!key)throw new VoiceProblem('No ElevenLabs key is saved. Add it in Settings, Voice replies.');
 if(!voice)throw new VoiceProblem('No ElevenLabs voice is chosen. Choose one in Settings, Voice replies.');
 if(!String(text||'').trim())throw new VoiceProblem('There is nothing to say.');
 let response;
 try{
  response=await fetcher(String(api).replace(/\/+$/,'')+'/v1/text-to-speech/'+encodeURIComponent(voice)+'?output_format='+encodeURIComponent(format),{
   method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json',Accept:'audio/*'},
   body:JSON.stringify({text:String(text),...(model?{model_id:model}:{}),...(Object.keys(settings).length?{voice_settings:settings}:{})}),
   signal:AbortSignal.timeout(timeoutMs)});
 }catch(error){throw new VoiceProblem(error?.name==='TimeoutError'?'ElevenLabs did not answer in time.':'ElevenLabs could not be reached from here.');}
 if(!response.ok){
  const raw=await response.text().catch(()=>'');let body=raw;try{body=JSON.parse(raw);}catch{}
  throw new VoiceProblem(elevenLabsProblem(response.status,body),response.status);
 }
 const audio=Buffer.from(await response.arrayBuffer());
 if(!audio.length)throw new VoiceProblem('ElevenLabs sent no sound back.');
 if(format.startsWith('opus')&&audio.subarray(0,4).toString('latin1')!=='OggS')throw new VoiceProblem('ElevenLabs sent something else than a voice recording.');
 return audio;
}

// MAY THIS KEY TRANSCRIBE? An ElevenLabs key carries only the permissions its owner ticked, and a key
// made for speech alone may not transcribe. So the key is asked once, when it is saved, the same way
// the voice is tried with a sample: one second of sound is sent to be transcribed, and what comes
// back decides whether Hermes is set to transcribe with ElevenLabs or keeps understanding voice notes
// on the computer itself.
//
// A quiet tone, not silence: silence can come back as an empty transcript, which says nothing about
// the permission. One second of 16 kHz mono, about 32 KB, made here so nothing is read from disk.
export function oneSecondSample({rate=16000,hertz=440}={}){
 const samples=rate,data=Buffer.alloc(samples*2);
 for(let i=0;i<samples;i++)data.writeInt16LE(Math.round(Math.sin(2*Math.PI*hertz*i/rate)*6000),i*2);
 const header=Buffer.alloc(44);
 header.write('RIFF',0);header.writeUInt32LE(36+data.length,4);header.write('WAVE',8);
 header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
 header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
 header.write('data',36);header.writeUInt32LE(data.length,40);
 return Buffer.concat([header,data]);
}
// The words for a key that may not transcribe: ElevenLabs' own name for the permission, and what
// happens meanwhile.
export const transcribePermissionWords=()=>'Your ElevenLabs key may not transcribe, so your voice notes are understood on this computer: allow the key '+STT_PERMISSION+' on the ElevenLabs page for API keys and save it again to have ElevenLabs understand them, which is quicker.';
// 'yes' (ElevenLabs transcribed it), 'no' (it refused for a missing permission) or 'unknown' (anything
// else: no answer, a limit, a problem of its own), with the words for the page. It never throws: a key
// whose permission could not be read must still save the voice that was just heard.
export async function elevenLabsMayTranscribe({key,fetcher=fetch,api=elevenLabsApi(),model=STT_MODEL,timeoutMs=60000}){
 if(!key)return {may:'unknown',words:'No ElevenLabs key was given, so it could not be asked whether it may transcribe.'};
 let response;
 try{
  const form=new FormData();
  form.append('file',new Blob([oneSecondSample()],{type:'audio/wav'}),'one-second.wav');
  form.append('model_id',model);
  response=await fetcher(String(api).replace(/\/+$/,'')+'/v1/speech-to-text',
   {method:'POST',headers:{'xi-api-key':key,Accept:'application/json'},body:form,signal:AbortSignal.timeout(timeoutMs)});
 }catch(error){
  const why=error?.name==='TimeoutError'?'ElevenLabs did not answer in time':'ElevenLabs could not be reached from here';
  return {may:'unknown',words:why+', so it is not known yet whether your key may transcribe; your voice notes are understood on this computer until it is.'};
 }
 if(response.ok)return {may:'yes',words:null};
 const raw=await response.text().catch(()=>'');let body=raw;try{body=JSON.parse(raw);}catch{}
 const detail=body&&typeof body==='object'?body.detail:body;
 const code=String(detail&&typeof detail==='object'&&!Array.isArray(detail)?detail.status||detail.code||'':'').toLowerCase();
 const text=(code+' '+String(detail&&typeof detail==='object'?detail.message||detail.msg||'':typeof detail==='string'?detail:'')).toLowerCase();
 if(code==='missing_permissions'||(/permission|not authorized|unauthorized_scope/.test(text)&&(response.status===401||response.status===403)))
  return {may:'no',words:transcribePermissionWords()};
 return {may:'unknown',words:'ElevenLabs did not say whether your key may transcribe, so your voice notes are understood on this computer. '+elevenLabsProblem(response.status,body)};
}

// WHEN THE VOICE FAILS, THE TEXT STILL ARRIVES (Hermes sends the answer as text when the voice note
// cannot be made), and the person is told once why the voice note is missing: once for each stretch
// of failures, through the notices the routines deliver (core/notices.mjs), until a voice note works
// again.
export function failureWords(problem){
 return 'Your assistant could not answer with a voice note: '+String(problem||'the voice service refused it.').replace(/\s+$/,'')+' Your answers still arrive as text. To fix it, open Settings in your notebook and look at Voice replies.';
}
export function noteVoiceFailed(state,problem,now=new Date()){
 if(!state)return;
 const record=readVoiceRecord(state);record.failing_since??=now.toISOString();record.last_error=String(problem||'');record.last_failed_at=now.toISOString();
 if(record.told_for!==record.failing_since){try{queueNotice({state},{id:'voice-reply-'+record.failing_since,text:failureWords(problem)});record.told_for=record.failing_since;}catch{}}
 try{writeVoiceRecord(state,record);}catch{}
}
export function noteVoiceWorked(state){
 if(!state)return;
 const record=readVoiceRecord(state);if(!record.failing_since&&!record.last_error)return;
 delete record.failing_since;delete record.last_error;delete record.last_failed_at;
 try{writeVoiceRecord(state,record);}catch{}
}
