import fs from 'node:fs';
import {modelProvider} from './runtime.mjs';

// The AI connected in Settings, as .godspeed/provider.json keeps it: null when none is saved. A file
// that is not JSON, lacks a string url, key or model, or names an address the notebook refuses
// throws, so Settings can say the saved connection could not be read (#805).
export const readSavedProvider=file=>{
  let text;try{text=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const config=JSON.parse(text);
  if(!config||typeof config!=='object'||typeof config.url!=='string'||typeof config.key!=='string'||typeof config.model!=='string'||!modelProvider(config))throw new Error('The saved AI connection is not valid. Connect it again after checking the server log.');
  return config;
};
// The same, with a file that cannot be read counting as no saved connection.
export const savedProviderOrNull=file=>{try{return readSavedProvider(file);}catch{return null;}};
