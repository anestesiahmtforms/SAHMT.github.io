export class Store {
  constructor(){this.values=new Map();this.pending=new Map();this.listeners=new Set();this.generation=0;this.revisions=new Map();}
  clear(){this.generation++;this.values.clear();this.pending.clear();this.revisions.clear();this.emit('clear');}
  emit(key){for(const fn of this.listeners)fn(key);}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  invalidate(prefix=''){for(const k of new Set([...this.values.keys(),...this.pending.keys()]))if(k.startsWith(prefix)){this.values.delete(k);this.pending.delete(k);this.revisions.set(k,(this.revisions.get(k)||0)+1);}this.emit(prefix);}
  async load(key,loader,ttl=5000){const hit=this.values.get(key);if(hit&&Date.now()-hit.at<ttl)return structuredClone(hit.value);if(this.pending.has(key))return structuredClone(await this.pending.get(key));const generation=this.generation,revision=this.revisions.get(key)||0;const promise=(async()=>{const value=await loader();if(generation!==this.generation)throw new Error('A conta foi alterada.');if(revision!==(this.revisions.get(key)||0))throw new Error('Os dados mudaram durante a consulta. Atualize novamente.');this.values.set(key,{at:Date.now(),value:structuredClone(value)});return value;})();this.pending.set(key,promise);try{return structuredClone(await promise);}finally{if(this.pending.get(key)===promise)this.pending.delete(key);}}
}
