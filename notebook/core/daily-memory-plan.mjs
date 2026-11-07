const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SUBJECT_TYPES=new Set(['self','contact','entity','new-person','new-thing']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const day=value=>typeof value==='string'&&ISO_DAY.test(value)&&new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)===value;
const id=value=>typeof value==='string'&&ID.test(value)?value:null;
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const name=value=>typeof value==='string'&&value.length<=160&&value.trim()?value.trim():null;

function citation(value){
 if(!object(value))return null;
 const citationId=id(value.id),quote=typeof value.quote==='string'&&value.quote.trim()?value.quote:null;
 return citationId&&quote?{id:citationId,quote}:null;
}

function subject(value){
 if(!object(value)||!SUBJECT_TYPES.has(value.type))return null;
 if(value.type==='self')return value.id===null&&value.name==='self'?{type:'self',id:null,name:'self'}:null;
 const subjectId=id(value.id),subjectName=name(value.name);
 return subjectId&&subjectName?{type:value.type,id:subjectId,name:subjectName}:null;
}

function createdSubject(value){
 if(!object(value))return null;
 const subjectId=id(value.id),subjectName=name(value.name);
 return subjectId&&subjectName?{id:subjectId,name:subjectName}:null;
}

function effect(value){
 if(!object(value)||!['fact','event'].includes(value.type))return null;
 const evidence=citation(value.citation);
 if(value.type==='fact'){
  const factSubject=subject(value.subject),kind=text(value.kind),valueText=text(value.value),date=day(value.date)?value.date:null;
  if(!factSubject||!kind||!valueText||!date||!['one','many'].includes(value.cardinality)||!['certain','likely'].includes(value.confidence)||!evidence)return null;
  return {type:'fact',subject:factSubject,kind,value:valueText,date,cardinality:value.cardinality,confidence:value.confidence,citation:evidence};
 }
 const what=text(value.what),eventDay=day(value.day)?value.day:null,participants=Array.isArray(value.participants)?value.participants.map(subject):null;
 if(!what||!eventDay||!participants||participants.some(item=>!item)||!evidence||(value.deadline_id!==null&&id(value.deadline_id)!==value.deadline_id))return null;
 return {type:'event',what,day:eventDay,participants,citation:evidence,deadline_id:value.deadline_id??null};
}

export function decodeDailyMemoryPlan(value){
 if(!object(value)||!Array.isArray(value.people)||!Array.isArray(value.things)||!Array.isArray(value.effects))return null;
 const people=value.people.map(createdSubject),things=value.things.map(createdSubject),effects=value.effects.map(effect);
 if(people.some(item=>!item)||things.some(item=>!item)||effects.some(item=>!item))return null;
 return {people,things,effects};
}
