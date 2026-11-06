// The two operations of Settings > Health data from your phone, and the one shape every answer to them has.
// The server (server/main.mjs) builds each answer with phoneHealthAnswer, which refuses anything else; the panel
// (ui/src/local/PhoneHealth.tsx) reads the same fields; test/phone-health.test.mjs hits every variant and checks both.
//   {available:false}                        a computer, or any door that is not the signed-in web door
//   {available:true,address:null}            a server with no https web address yet
//   {available:true,address:null,damaged:true}  the token file is unusable: uploads are off until it is renewed
//   {available:true,address:'https://.../ingest/<token>'}  the private address (status, and the answer to a renewal)
export const PHONE_HEALTH_STATUS='phone-health';
export const PHONE_HEALTH_RENEW='phone-health/renew';
export const PHONE_HEALTH_SHAPE={
  available:{type:'boolean',required:true},
  address:{type:'string',nullable:true,required:false},
  damaged:{type:'boolean',required:false},
};
export const PHONE_HEALTH_FIELDS=Object.keys(PHONE_HEALTH_SHAPE);
// Returns the answer when it has the declared shape; throws otherwise, so a drifting answer is a server error, never a wire format.
export function phoneHealthAnswer(answer){
  if(!answer||typeof answer!=='object'||Array.isArray(answer))throw new Error('A phone health answer is an object');
  for(const key of Object.keys(answer))if(!PHONE_HEALTH_SHAPE[key])throw new Error('A phone health answer has no field '+key);
  for(const [key,rule] of Object.entries(PHONE_HEALTH_SHAPE)){
    const value=answer[key];
    if(value===undefined){if(rule.required)throw new Error('A phone health answer needs '+key);continue;}
    if(value===null&&rule.nullable)continue;
    if(typeof value!==rule.type)throw new Error('A phone health answer needs '+key+' to be a '+rule.type);
  }
  return answer;
}
