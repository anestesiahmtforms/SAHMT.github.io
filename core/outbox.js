const ALLOWED=new Set(['etiquetas.save','eventos.save']);
const SECRET=/^(token|authToken|deviceToken|credential|userEmail|userName|queuedAt)$/i;
export function safePayload(data){if(Array.isArray(data))return data.map(safePayload);if(data&&typeof data==='object')return Object.fromEntries(Object.entries(data).filter(([k])=>!SECRET.test(k)).map(([k,v])=>[k,safePayload(v)]));return data;}
export class Outbox {
  constructor({storage=globalThis.localStorage,session,api,now=()=>Date.now()}){Object.assign(this,{storage,session,api,now});this.pending=null;}
  key(email){return 'sahmt:outbox:v3:'+encodeURIComponent(email);}
  read(email=this.session()?.user?.email){if(!email)return [];let rows;try{rows=JSON.parse(this.storage.getItem(this.key(email))||'[]');}catch{throw new Error('Não foi possível ler os envios pendentes.');}if(!Array.isArray(rows))throw new Error('Fila de envios inválida.');return rows;}
  write(email,rows){this.storage.setItem(this.key(email),JSON.stringify(rows));}
  enqueue(action,data,requestId){const s=this.session(),email=s?.user?.email;if(!email||s.status!=='authenticated')throw new Error('Confirme sua sessão antes de guardar o envio.');if(!ALLOWED.has(action))throw new Error('Esta operação exige conexão.');const rows=this.read(email);if(rows.length>=100)throw new Error('Revise os envios pendentes antes de continuar.');if(!rows.some(r=>r.requestId===requestId))rows.push({action,data:safePayload(data),requestId,email,createdAt:this.now(),status:'pending'});this.write(email,rows);}
  async flush(){if(this.pending)return this.pending;this.pending=this.run();try{return await this.pending;}finally{this.pending=null;}}
  async run(){const s=this.session();if(s?.status!=='authenticated')return {sent:0};const email=s.user.email,generation=s.generation;let sent=0;const initial=this.read(email);for(const item of initial){if(this.session().generation!==generation||this.session().user?.email!==email)break;if(item.email!==email||!ALLOWED.has(item.action)||item.status!=='pending')continue;if(this.now()-item.createdAt>7*86400000){this.update(email,item.requestId,{status:'review',message:'Envio antigo: revisar antes de tentar novamente.'});continue;}try{await this.api.call(item.action,item.data,{requestId:item.requestId});this.write(email,this.read(email).filter(r=>r.requestId!==item.requestId));sent++;}catch(e){if(e.retryable)break;this.update(email,item.requestId,{status:'review',message:e.message});if(['UNAUTHORIZED','FORBIDDEN','ACCOUNT_CHANGED','CANCELLED'].includes(e.code))break;}}return {sent};}
  update(email,id,patch){this.write(email,this.read(email).map(r=>r.requestId===id?{...r,...patch}:r));}
  discard(id){const email=this.session()?.user?.email;if(email)this.write(email,this.read(email).filter(r=>r.requestId!==id));}
}
