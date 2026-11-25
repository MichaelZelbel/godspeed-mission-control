// Whether a written date exists on the calendar. Only writes are judged: a record already
// stored with a bad date still loads, so nothing here runs on read, sync or import.
const ISO=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2})(?::?(\d{2}))?)?)?$/;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const GERMAN=['januar','februar','maerz','april','mai','juni','juli','august','september','oktober','november','dezember'];
const empty=value=>value==null||(typeof value==='string'&&!value.trim());
const daysIn=(month,year)=>month===2?(year!==null&&(year%4===0&&year%100!==0||year%400===0)?29:year===null?29:28):[4,6,9,11].includes(month)?30:31;
const real=(year,month,day)=>month>=1&&month<=12&&day>=1&&day<=daysIn(month,year);

export function isRealDate(value){
  const m=ISO.exec(String(value).trim());
  if(!m)return false;
  const [year,month,day,hour,minute,second,,offsetHour,offsetMinute]=[m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9]].map(part=>part===undefined?undefined:Number(part));
  if(!real(year,month,day))return false;
  if(hour!==undefined&&(hour>23||minute>59||(second??0)>59))return false;
  return (offsetHour??0)<=23&&(offsetMinute??0)<=59;
}

const monthNumber=name=>{const key=name.toLowerCase().replace(/ä/g,'ae').replace(/\.$/,'');const i=MONTHS.findIndex(n=>n===key||n.slice(0,3)===key);return i>=0?i+1:GERMAN.findIndex(n=>n===key||n.slice(0,3)===key)+1;};

// A birthday is free text on the forms: besides ISO it is a year ("1990"), "--05-01",
// "1 May", "May 1, 1990", "1. Mai 1990" or "1.5.1990", with or without the year.
export function isRealBirthday(value){
  const text=String(value).trim();
  if(ISO.test(text))return isRealDate(text);
  let m;
  if(/^\d{4}$/.test(text))return true;
  if(m=/^--(\d{2})-(\d{2})$/.exec(text))return real(null,Number(m[1]),Number(m[2]));
  const check=(day,month,year)=>month>0&&real(year===undefined?null:Number(year),month,Number(day));
  if(m=/^(\d{1,2})\.?\s+([A-Za-zÄäÖöÜü.]+)(?:,?\s+(\d{4}))?$/.exec(text))return check(m[1],monthNumber(m[2]),m[3]);
  if(m=/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(text))return check(m[2],monthNumber(m[1]),m[3]);
  if(m=/^(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?$/.exec(text))return check(m[1],Number(m[2]),m[3]);
  return false;
}

const KINDS={date:['a real date',isRealDate],datetime:['a real date and time',isRealDate],birthday:['a real day of birth',isRealBirthday]};

/** Throws when a present value is not a real date of this kind; an empty value is accepted. */
export function assertRealDate(label,value,kind='date'){
  if(empty(value))return;
  const [what,ok]=KINDS[kind];
  if(typeof value!=='string'||!ok(value))throw new Error(`Expected ${what} for ${label} but got "${typeof value==='string'?value:JSON.stringify(value)}"`);
}

/** The claim's own date fields and, for a birthday, its value. `changed` filters to what this write sets. */
export function assertRealClaimDates(claim,canonical,changed=()=>true){
  for(const key of ['valid_from','valid_to'])if(changed(key))assertRealDate(key,claim[key]);
  if(canonical(claim.attribute)==='date-of-birth'&&(changed('value')||changed('attribute')))assertRealDate('value',claim.value,'birthday');
}
