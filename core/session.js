const KEY='sahmt:session:v3';
export class SessionManager {
  constructor({storage=globalThis.localStorage,api,onChange=()=>{}}){Object.assign(this,{storage,api,onChange});this.generation=0;this.pending=null;this.state={status:'anonymous',user:null,token:'',expiresAt:0};this.restore();}
  snapshot(){return {...this.state,generation:this.generation};}
  restore(){try{const s=JSON.parse(this.storage.getItem(KEY)||'null');if(s?.token&&s.user?.email&&s.expiresAt>Date.now()){this.state={...s,status:'validating'};return;}this.storage.removeItem(KEY);}catch{} }
  emit(){this.onChange(this.snapshot());}
  async login(credential){
    let result;
    let lastError;
    for(let attempt=0;attempt<2;attempt++){
      try{result=await this.api.call('auth.login',{credential},{timeoutMs:45000});break;}
      catch(error){lastError=error;if(!error?.retryable||attempt===1)throw error;await new Promise(resolve=>setTimeout(resolve,700));}
    }
    if(!result)throw lastError||new Error('Não foi possível autenticar.');
    this.generation++;this.state={...result,status:'authenticated'};this.confirmedAt=Date.now();this.persist();this.emit();return this.snapshot();
  }
  // Navigation reuses a verified, unexpired session. API reads/writes still
  // call confirm(), and the server checks authorization on every request.
  async access(){if(this.state.status==='authenticated'&&this.state.expiresAt>Date.now())return this.snapshot();return this.confirm();}
  persist(){try{this.storage.setItem(KEY,JSON.stringify(this.state));}catch{/* memória continua disponível */}}
  async confirm(){if(this.state.status==='authenticated'&&this.state.expiresAt>Date.now()&&Date.now()-(this.confirmedAt||0)<60000)return this.snapshot();if(!this.state.token||this.state.expiresAt<=Date.now()){this.clear();throw new Error('Entre com sua conta Google.');}if(this.pending)return this.pending;const generation=this.generation;this.pending=(async()=>{try{const r=await this.api.call('auth.session');if(generation!==this.generation)throw new Error('A conta foi alterada.');this.state={...this.state,...r,status:'authenticated'};this.confirmedAt=Date.now();this.persist();this.emit();return this.snapshot();}catch(e){if(generation===this.generation){if(['UNAUTHORIZED','FORBIDDEN'].includes(e.code))this.clear();else{this.state.status='unverified';this.emit();}}throw e;}finally{this.pending=null;}})();return this.pending;}
  clear(){this.generation++;this.state={status:'anonymous',user:null,token:'',expiresAt:0};this.confirmedAt=0;this.api.cancelAll();try{this.storage.removeItem(KEY);}catch{}this.emit();}
  async logout(){const token=this.state.token;this.clear();try{await this.api.call('auth.logout',{}, {token});return {revoked:true};}catch{return {revoked:false};}}
}
