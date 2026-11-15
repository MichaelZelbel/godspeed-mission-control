import {parentPort,workerData} from 'node:worker_threads';
import {Store} from './records/store.mjs';
import {backup} from './archives.mjs';
try{
 // Wait before construction, which also acquires the writer lock for recovery.
 await Store.prototype.waitForWriter.call({state:workerData.root+'/.godspeed'});
 const store=new Store(workerData.root,{device:workerData.device});
 await store.waitForWriter();
 const destination=backup(store,workerData.mediaRoot,workerData.destination);
 parentPort.postMessage({result:{path:destination}});
}catch(error){parentPort.postMessage({error:error.message});}
