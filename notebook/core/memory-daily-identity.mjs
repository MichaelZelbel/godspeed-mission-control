import {hash} from './records/store.mjs';

export const dailyMemorySubjectId=(type,name)=>'memory-'+hash([type==='contact'?'person':'thing',name]).slice(0,20);
