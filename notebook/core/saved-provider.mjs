import fs from 'node:fs';
import {modelProvider} from './runtime.mjs';

// What a damaged saved connection answers with, its own sentence instead of the generic
// invalid-JSON one (#861 review D4), naming the step that recovers it.
const DAMAGED_PROVIDER='The saved AI connection could not be read. Connect your AI again in Settings, Your AI.';

// The AI connected in Settings, as .godspeed/provider.json keeps it: null when none is saved. A file
// that is not JSON, lacks a string url, key or model, or names an address the notebook refuses
// throws, so Settings can say the saved connection could not be read (#805).
export const readSavedProvider=file=>{
  let text;try{text=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  // A damaged file is one plain log line per request, never a stack trace, and never the file's own
  // text, which holds the key (#833).
  let config;try{config=JSON.parse(text);}catch{console.error('Godspeed Mission Control: the saved AI connection ('+file+') is not valid JSON. Connect your AI again in Settings, Your AI.');const error=new Error(DAMAGED_PROVIDER);error.savedProviderLogged=true;throw error;}
  if(!config||typeof config!=='object'||typeof config.url!=='string'||typeof config.key!=='string'||typeof config.model!=='string'||!modelProvider(config))throw new Error(DAMAGED_PROVIDER);
  return config;
};
// The same, with a file that cannot be read counting as no saved connection.
export const savedProviderOrNull=file=>{try{return readSavedProvider(file);}catch{return null;}};
