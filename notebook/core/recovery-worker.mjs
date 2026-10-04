import {parentPort,workerData} from 'node:worker_threads';
import {restoreSeparateCopy} from './archives.mjs';
import {Store} from './records/store.mjs';
import {SearchIndex} from './index/search.mjs';
try{
 const result=restoreSeparateCopy({state:workerData.state,device:workerData.device},workerData.source);
 const restored=new Store(result.workspace),search=new SearchIndex(restored);
 try{search.rebuild();}finally{search.close();}
 parentPort.postMessage({result});
}catch(error){parentPort.postMessage({error:error.message});}
