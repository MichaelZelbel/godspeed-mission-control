// The hash a caller gave for one record it changes: expected itself when it is a hash, or its
// entry in expected by "<table>/<id>" (or by id) when expected names records, as personal_operation
// declares it and every recipe writes it ({"goals/<id>":"<hash>"}). Until 24 October 2026 a goal,
// a routine, an obligation or a coaching talk compared expected itself with the record's hash, so
// the named form, the one the tool's schema now declares, was always "changed". Nothing is looser:
// an expected that names no hash for this record still is not this record's hash.
export function expectedHash(input,table,...ids){
 const given=input?.expected;
 if(typeof given==='string')return given;
 if(!given||typeof given!=='object')return undefined;
 for(const id of ids.filter(Boolean)){const hash=given[table+'/'+id]??given[id];if(hash!==undefined)return hash;}
 return undefined;
}
