import path from 'node:path';
import fs from 'node:fs';
import {hermesProvider} from '../core/runtime.mjs';
const root=path.resolve(process.argv[2]),home=path.join(root,'hermes-profile');fs.mkdirSync(home,{recursive:true});fs.mkdirSync(path.join(root,'workspace'),{recursive:true});
const provider=hermesProvider({executable:process.env.GODSPEED_FIXTURE_HERMES||'hermes',home,cwd:path.join(root,'workspace'),provider:'openrouter',model:'dots-studio/dots-3-note-preview:free'});
const result=await provider({kind:'goal-work',context:{goal:'Prepare a polite conversation about borrowing a fictional book'},contract:'Write the actual short conversation draft, with no outward actions. This fixture contains no personal data.'});
if(result.length<20)throw new Error('The assistant did not produce a useful draft');
fs.writeFileSync(path.join(root,'draft.md'),result);console.log(JSON.stringify({runtime:'Hermes',isolatedHome:true,syntheticOnly:true,verified:'Saved useful draft from installed assistant',at:new Date().toISOString()}));
