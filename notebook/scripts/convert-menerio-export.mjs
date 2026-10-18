import fs from 'node:fs';
import {tables} from '../core/query.mjs';
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')),records=[],excluded=[];
const sources=input.tables||input;
for(const [type,rows] of Object.entries(sources)){
  if(!Array.isArray(rows))continue;
  if(!tables.has(type)||['world_entities','world_claims','world_events','profile_facts','v_ai_allowance_current'].includes(type)){excluded.push({type,reason:'Derived view or domain outside the personal notebook'});continue;}
  if(type.endsWith('_connections')||['mcp_api_tokens','user_roles'].includes(type)){excluded.push({type,reason:'Device credentials or cloud account administration must be configured separately'});continue;}
  for(const row of rows){if(!row.id)throw new Error('Source record lacks a stable ID: '+type);const value={...row,type};if(type==='contact_groups')value.group_type=row.type;records.push(value);}
}
fs.writeFileSync(process.argv[3],JSON.stringify({format:1,records},null,2));
console.log(JSON.stringify({converted:records.length,excluded,media:'Copy source attachment bytes separately and preserve each storage_path mapping. No source service was changed.'}));
