import {hash} from './records/store.mjs';

export const dailyMemorySubjectId=(type,name)=>'memory-'+hash([type==='contact'?'person':'thing',name]).slice(0,20);
export const normalName=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
