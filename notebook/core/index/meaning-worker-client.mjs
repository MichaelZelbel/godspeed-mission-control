import {Worker} from 'node:worker_threads';

export class MeaningWorker {
  constructor(file) {this.file = file; this.pending = new Map(); this.nextId = 0; this.closed = false;}
  start() {
    if (this.closed) throw new Error('Meaning search has closed');
    if (this.worker) return this.worker;
    const worker = this.worker = new Worker(new URL('./meaning-worker.mjs', import.meta.url), {workerData: {file: this.file}});
    worker.unref();
    const fail = error => {
      if (this.worker !== worker) return;
      this.worker = null;
      for (const item of this.pending.values()) {item.clean(); item.reject(error);}
      this.pending.clear();
    };
    worker.on('message', ({id, value, error}) => {
      const item = this.pending.get(id); if (!item) return;
      this.pending.delete(id); item.clean();
      if (!this.pending.size) worker.unref();
      if (error) item.reject(new Error(error)); else item.resolve(value);
    });
    worker.on('error', fail);
    worker.on('exit', code => fail(new Error('Meaning search worker stopped (' + code + ')')));
    return worker;
  }
  notify(message) {if (this.worker) this.worker.postMessage(message);}
  request(message, {signal, timeoutMs = 60000} = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('Search cancelled'));
    return new Promise((resolve, reject) => {
      const worker = this.start(), id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id); clean();
        reject(new Error('Meaning search took too long'));
        // A stuck connection or worker must not leave every later search
        // queued forever. Its next request can start with a fresh connection.
        for (const item of this.pending.values()) {item.clean(); item.reject(new Error('Meaning search worker restarted after a timeout'));}
        this.pending.clear(); this.worker = null; void worker.terminate();
      }, timeoutMs);
      const abort = () => {
        this.pending.delete(id); clean();
        if (!this.pending.size) worker.unref();
        reject(signal.reason || new Error('Search cancelled'));
      };
      const clean = () => {clearTimeout(timer); signal?.removeEventListener('abort', abort);};
      this.pending.set(id, {resolve, reject, clean});
      signal?.addEventListener('abort', abort, {once: true});
      worker.ref();
      try {worker.postMessage({...message, id});} catch (error) {this.pending.delete(id); clean(); if(!this.pending.size)worker.unref(); reject(error);}
    });
  }
  search(space, vector, {limit = 50, uids = null, signal} = {}) {return this.request({kind: 'search', space, vector, limit, allowed: uids ? [...uids] : null}, {signal});}
  close() {
    if (this.closed) return this.closing;
    this.closed = true;
    for (const item of this.pending.values()) {item.clean(); item.reject(new Error('Meaning search has closed'));}
    this.pending.clear();
    const worker = this.worker; this.worker = null;
    return this.closing = worker?.terminate();
  }
}
