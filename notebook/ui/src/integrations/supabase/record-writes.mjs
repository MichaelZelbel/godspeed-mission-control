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
//
// Reads are not queued behind writes, so a read can describe a record as it
// was before a save the screen has already seen answered. On 16 October 2026
// the notes list (1,374 notes, slow after a reboot) was answered between two
// saves of the open note and arrived after the second one; the screen took
// its older version, and every later save of that note was refused. A read
// therefore never replaces what a write to the same record told the screen
// after the read was sent (`since`), and a refused write takes the record's
// current version, so the next save is stamped right instead of failing again.
export function createRecordWrites({send}) {
  const versions=new Map(),snapshots=new Map(),chains=new Map();
  // Per record: writes in flight, and the tick at which the latest one was
  // answered. `clock` advances with every answered write.
  const writing=new Map(),answered=new Map();let clock=0;
  const rowsOf=data=>Array.isArray(data)?data:data?[data]:[];
  const remember=(table,data,since)=>{
    if(!table)return;
    for(const row of rowsOf(data))if(row&&row.id&&row._hash){
      const key=table+'/'+row.id;
      if(since!==undefined&&((writing.get(key)||0)>0||(answered.get(key)??-1)>since))continue;
      // The notes list carries a preview, not the text: a narrower row of the
      // version already held adds to the copy instead of replacing it.
      const held=snapshots.get(key);
      versions.set(key,row._hash);snapshots.set(key,held&&held._hash===row._hash?{...held,...row}:row);
    }
  };
  const isRead=state=>!state.rpc&&(!state.operation||state.operation==='select');
  // The records a write may change, as far as the request says.
  const keysOf=state=>{
    if(!state.table||isRead(state)||state.rpc)return [];
    const ids=targetIds(state)||new Set();
    for(const value of rowsOf(state.values))if(typeof value?.id==='string')ids.add(value.id);
    return [...ids].map(id=>state.table+'/'+id);
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
  // A write whose records the request does not name (a bulk update by folder,
  // an insert without an id) counts for every record of its table.
  const wideWriting=new Map(),wideAnswered=new Map();
  const stale=(table,since)=>(wideWriting.get(table)||0)>0||(wideAnswered.get(table)??-1)>since;
  const read=async state=>{
    const since=clock,result=await send(stamp(state));
    if(!stale(state.table,since))remember(state.table,result?.data,since);
    return result;
  };
  const count=(map,key,step)=>{const n=(map.get(key)||0)+step;if(n>0)map.set(key,n);else map.delete(key);};
  const run=async state=>{
    if(!state.table||state.rpc)return send(stamp(state));
    if(isRead(state))return read(state);
    const keys=keysOf(state),wide=!keys.length;
    for(const key of keys)count(writing,key,1);
    if(wide)count(wideWriting,state.table,1);
    let result;
    try{result=await send(stamp(state));}
    finally{
      clock++;
      for(const key of keys){count(writing,key,-1);answered.set(key,clock);}
      if(wide){count(wideWriting,state.table,-1);wideAnswered.set(state.table,clock);}
    }
    remember(state.table,result?.data);
    // Refused because the record changed since the screen last saw it: the
    // other version is kept for review, and the screen now holds the current
    // one, so its next save of the same record is not refused again.
    if(result?.error?.code==='CONFLICT'&&keys.length===1){
      const id=keys[0].slice(state.table.length+1);
      try{await read({table:state.table,operation:'select',selection:'*',filters:[['eq','id',id]],orders:[]});}catch{}
    }
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
