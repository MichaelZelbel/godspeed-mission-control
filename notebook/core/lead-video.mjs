import {visibleRows} from './visibility.mjs';

export function videoQueue(query,configuration){
 if(!configuration||configuration.enabled!==true)return null;
 if(configuration.pipeline_confirmed!==true)throw Error('Confirm the working video production pipeline before enabling scripts');
 const collection=visibleRows(query,'collections').find(c=>c.id===configuration.collection_id&&!c.is_trashed&&!c.is_archived);
 if(!collection)throw Error('Select an existing assistant-visible video idea collection');
 for(const key of ['title_field','script_field']){
  if(typeof configuration[key]!=='string'||!collection.field_schema?.some(f=>f.key===configuration[key]&&['text','longtext'].includes(f.type)))throw Error('Map the video title and script to existing text fields');
 }
 if(configuration.title_field===configuration.script_field)throw Error('Choose separate video title and script fields');
 if(collection.field_schema.some(f=>f.primary&&f.key!==configuration.title_field))throw Error('Map the video title to the collection primary field');
 if(collection.field_schema.some(f=>f.required&&!['title_field','script_field'].some(k=>configuration[k]===f.key)))throw Error('The video queue has other required fields; choose a queue that accepts title and script');
 return {collection,title_field:configuration.title_field,script_field:configuration.script_field};
}

export function checkedVideo(result,queue){
 if(result.shape!=='video')return;
 if(!queue)throw Error('Video scripts require an enabled confirmed pipeline and an existing idea queue');
 if(typeof result.script!=='string'||result.script.trim().split(/\s+/).length<100||result.script.length>30000)throw Error('Retain a complete video script between one hundred words and thirty thousand characters');
 if(!Array.isArray(result.scenes)||!result.scenes.length||result.scenes.length>30||result.scenes.some(s=>!Number.isFinite(s.start_seconds)||s.start_seconds<0||typeof s.visual!=='string'||!s.visual.trim()))throw Error('Retain timed visual directions for the complete script');
 if(result.scenes[0].start_seconds!==0||result.scenes.some((s,i)=>i&&s.start_seconds<=result.scenes[i-1].start_seconds))throw Error('Video visual directions must begin at zero and advance in time');
}
