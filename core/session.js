import {AuthStore} from './auth-store.js';
import {DeviceTrust} from './device-trust.js';
import {ApiError} from './api.js';

// Firebase owns credential persistence. Never store ID/refresh/custom tokens here.
export class SessionManager {
  constructor({firebase,api,storage=globalThis.localStorage,onChange=()=>{},version='',online=()=>globalThis.navigator?.onLine!==false,now=()=>Date.now()}) {
    Object.assign(this,{firebase,api,storage,onChange,online});
    this.store=new AuthStore();this.generation=0;this.started=false;this.pending=null;
    this.trust=new DeviceTrust({storage,version,now});
    this.ready=new Promise(resolve=>{this.resolveReady=resolve;});
    this.store.subscribe(()=>this.onChange(this.snapshot()));
  }
  snapshot(){return {...this.store.snapshot(),generation:this.generation};}
  update(patch){this.store.update(patch);}
  start(){
    if(this.started)return this.ready;
    this.started=true;
    // A restauração pode aguardar rede, IndexedDB ou outra aba. Nunca deixe
    // o shell preso indefinidamente em "Carregando seu acesso…".
    this.restoreWatchdog=setTimeout(()=>{
      const s=this.snapshot();
      if(!s.initialized||s.status!=='validating')return;
      const fallback=s.user
        ? {status:'authenticated',memberStatus:'STALE',error:'O serviço demorou a responder. Sua conta continua conectada. Toque em Tentar novamente.'}
        : {status:'unavailable',error:'O serviço demorou a responder. Tente novamente sem sair da conta.'};
      this.update({...fallback,offline:!this.online()});
      this.resolveReady();
    },15000);
    try {this.unsubscribe=this.firebase.subscribe(user=>{this.restoring=this.restoreUser(user);this.restoring.catch(()=>{});},()=>{
      this.update({initialized:true,status:'unavailable',error:'Não foi possível restaurar a conta. Tente novamente sem sair.'});this.resolveReady();
    });}catch(error){this.update({initialized:true,status:'unavailable',error:error.message});this.resolveReady();}
    return this.ready;
  }
  cachedProfile(uid){try{const p=JSON.parse(this.storage.getItem('sahmt:profile:v4:'+uid)||'null');return p?.uid===uid?p:null;}catch{return null;}}
  async restoreUser(identity){
    const previous=this.snapshot().uid,uid=identity?.uid||'';
    if(this.snapshot().initialized&&uid===previous)return;
    this.generation++;this.api.cancelAll();this.pending=null;this.bootstrapData=null;
    const generation=this.generation;
    if(!identity){this.store.reset({initialized:true,status:'anonymous',offline:!this.online()});this.resolveReady();return;}
    const cached=this.cachedProfile(uid);
    this.store.reset({initialized:true,authenticated:true,status:'validating',uid,email:identity.email||'',displayName:identity.displayName||'',
      user:cached,roles:cached?.roles||[],permissions:cached?.permissions||{},memberStatus:cached?'STALE':'PENDING',offline:!this.online(),
      ...this.trust.inspect(identity,!this.online())});
    if(cached){
      // A identidade Firebase e o perfil já confirmados neste aparelho bastam
      // para abrir a interface. A autorização de cada operação continua no backend.
      this.update({status:'authenticated',authenticated:true,user:cached,uid,email:cached.email||identity.email||'',
        displayName:cached.name||identity.displayName||'',roles:cached.roles||[],permissions:cached.permissions||{},
        memberStatus:'STALE',offline:!this.online(),error:''});
      clearTimeout(this.restoreWatchdog);
      this.resolveReady();
      this.bootstrap().catch(()=>{});
      return;
    }
    try {await this.bootstrap();} catch(error) {if(generation===this.generation&&cached&&!['ACCESS_DENIED','AUTH_REAUTH_REQUIRED'].includes(error.code))this.update({status:'authenticated',memberStatus:'STALE',error:error.message});}
    finally{if(generation===this.generation){clearTimeout(this.restoreWatchdog);this.resolveReady();}}
  }
  async bootstrap(){
    if(this.pending)return this.pending;
    const identity=this.firebase.currentUser;if(!identity)throw new ApiError('AUTH_REQUIRED','Entre com sua conta Google.');
    const generation=this.generation;
    const operation=(async()=>{
      try {
        const result=await this.api.call('app.bootstrap');
        if(generation!==this.generation)throw new ApiError('ACCOUNT_CHANGED','A conta foi alterada.');
        if(!result?.user||result.user.uid!==identity.uid)throw new ApiError('INVALID_RESPONSE','O serviço não confirmou a identidade esperada.');
        this.bootstrapData=result;
        try{this.storage.setItem('sahmt:profile:v4:'+identity.uid,JSON.stringify(result.user));this.storage.removeItem('sahmt:session:v3');}catch{}
        this.update({status:'authenticated',authenticated:true,user:result.user,uid:identity.uid,email:result.user.email,displayName:result.user.name,
          roles:result.user.roles||[],permissions:result.user.permissions||{},memberStatus:'ACTIVE',offline:!this.online(),error:'',...this.trust.confirm(identity)});
        return this.snapshot();
      } catch(error){
        if(generation===this.generation){
          if(error.code==='ACCESS_DENIED')this.denyAccess();
          else if(error.code==='AUTH_REAUTH_REQUIRED')this.requireReauth();
          else this.update({status:this.snapshot().user?'authenticated':'unavailable',offline:!this.online(),error:error.message});
        }
        throw error;
      }
    })();
    this.pending=operation;
    try{return await operation;}finally{if(this.pending===operation)this.pending=null;}
  }
  // Shared compatibility interface: entirely local, no HTTP or auth discovery on routes.
  async access(){await this.ready;const s=this.snapshot();if(s.status==='reauth-required')throw new ApiError('AUTH_REAUTH_REQUIRED','Confirme novamente sua conta Google.');if(!s.authenticated)throw new ApiError(s.status==='unavailable'?'AUTH_UNAVAILABLE':'AUTH_REQUIRED',s.error||'Entre com sua conta Google.');if(s.memberStatus==='DENIED')throw new ApiError('ACCESS_DENIED','Sua conta não tem acesso ao SAHMT.');if(!s.user)throw new ApiError('PROFILE_PENDING','A conta está conectada. Aguarde a confirmação do serviço ou tente novamente.');return s;}
  confirm(){return this.access();}
  login(){const operation=this.firebase.login();return operation.then(async()=>{if(this.snapshot().status==='reauth-required')await this.bootstrap();return this.restoring;});} // popup directly from the gesture
  async getIdToken(force=false){const u=this.firebase.currentUser;if(!u||u.uid!==this.snapshot().uid)throw new ApiError('AUTH_REQUIRED','Entre com sua conta Google.');return u.getIdToken(force);}
  requestMetadata(){return {deviceId:this.trust.deviceId};}
  confirmedRequest(){const u=this.firebase.currentUser;if(u&&u.uid===this.snapshot().uid)this.update({...this.trust.confirm(u),offline:false});}
  denyAccess(){const s=this.snapshot();try{this.storage.removeItem('sahmt:profile:v4:'+s.uid);}catch{}this.update({status:'access-denied',memberStatus:'DENIED',user:null,roles:[],permissions:{},error:'Sua conta não está autorizada em USUARIOS.'});}
  requireReauth(){this.update({status:'reauth-required',error:'Sua credencial precisa ser renovada. Confirme sua conta Google.'});}
  networkChanged(){const u=this.firebase.currentUser;this.update({offline:!this.online(),...(u?this.trust.inspect(u,!this.online()):{})});}
  async resume(){this.networkChanged();if(!this.online()||!this.firebase.currentUser)return;if(this.snapshot().memberStatus!=='ACTIVE'||['TRUST_RENEWAL_PENDING','RENEWAL_DUE'].includes(this.snapshot().trustStatus))await this.bootstrap();}
  async logout(){await this.firebase.logout();return {revoked:true};}
}

