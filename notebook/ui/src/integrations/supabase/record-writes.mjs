// The dashboard's record write pipeline, kept out of the compatibility shim so
// it can be tested on its own. It remembers the version hash and the snapshot
// of every row the screen has seen, and stamps them onto the next write to the
// same table, which is what gives an edit optimistic concurrency.
//
// Writes to ONE record are also run one at a time. Two saves of the same note
// in flight together both carried the version hash from before either of them,
// so the server was right to refuse the second one and keep both versions for
// review: one person typing in one note produced a conflict record and the
// screen said "Could not save N note changes". A queued save waits for the one
// in flight and is then stamped with the version that save returned.
export function createRecordWrites({send}) {
  const versions=new Map(),snapshots=new Map(),chains=new Map();
  const remember=(table,data)=>{
    if(!table)return;
    for(const row of Array.isArray(data)?data:data?[data]:[])if(row&&row.id&&row._hash){const key=table+'/'+row.id;versions.set(key,row._hash);snapshots.set(key,row);}
  };
  // Only the records a write can touch. The server reads the version of the
  // records it changes and nothing else, so stamping every row the screen had
  // ever seen only made the request enormous: with the notes list loaded, one
  // note's save carried all 317 notes with their full text, 2.1MB on the test
  // server, and a request that size is refused outright. The vault's size must
  // not decide whether an edit saves.
  const stamp=state=>{
    const expected={},baselines={};
    if(state.operation==='update'||state.operation==='delete'){
      const targets=targetIds(state);
      for(const [key,value] of versions)if(key.startsWith(state.table+'/')){
        const id=key.slice(state.table.length+1);
        if(targets&&!targets.has(id))continue;
        expected[id]=value;baselines[id]=snapshots.get(key);
      }
    }
    return {...state,expected,baselines};
  };
  const run=async state=>{
    const result=await send(stamp(state));
    remember(state.table,result?.data);
    return result;
  };
  // Serialising is per record, so an edit in one note never waits on another
  // note, a person or a collection item.
  const perform=state=>{
    const key=recordKey(state);
    if(!key)return Promise.resolve().then(()=>run(state));
    const queued=(chains.get(key)||Promise.resolve()).then(()=>run(state));
    const settled=queued.then(()=>{},()=>{});
    chains.set(key,settled);
    // Keep the map to the records actually being written right now.
    void settled.then(()=>{if(chains.get(key)===settled)chains.delete(key);});
    return queued;
  };
  return {perform,versions,snapshots};
}

// The records a write names, or nothing when its filters do not say which ones
// (then every remembered version still goes, as it always did).
export function targetIds(state) {
  const ids=new Set();
  for(const filter of state.filters||[]){
    const [operator,column,value]=filter;
    if(column!=='id')continue;
    if(operator==='eq'&&typeof value==='string')ids.add(value);
    else if(operator==='in'&&Array.isArray(value))for(const item of value)if(typeof item==='string')ids.add(item);
    else return null;
  }
  return ids.size?ids:null;
}

// Which single record a write targets, or nothing when it is a read or touches
// a set of records at once (a bulk action, which carries no one version).
export function recordKey(state) {
  if(!state.table||!state.operation||state.operation==='select')return null;
  if(state.operation==='insert')return null;
  if(state.operation==='upsert')return typeof state.values?.id==='string'?state.table+'/'+state.values.id:null;
  const ids=targetIds(state);
  return ids?.size===1?state.table+'/'+[...ids][0]:null;
}
