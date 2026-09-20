import {safePayload} from './outbox.js';
export class ApiError extends Error {
  constructor(code,message,{retryable=false}={}){super(message);this.name='ApiError';this.code=code;this.retryable=retryable;}
}
const REFRESHABLE=new Set(['AUTH_TOKEN_INVALID','AUTH_TOKEN_EXPIRED']);
const SDK_REAUTH=new Set(['auth/user-token-expired','auth/invalid-user-token','auth/user-disabled','auth/user-not-found']);
export class ApiClient {
  constructor({url,version,session,getIdToken,metadata=()=>({}),transport=(...args)=>globalThis.fetch(...args),timeoutMs=25000,onAccessDenied=()=>{},onReauthRequired=()=>{},onConfirmed=()=>{}}){
    Object.assign(this,{url,version,session,getIdToken,metadata,transport,timeoutMs,onAccessDenied,onReauthRequired,onConfirmed});this.controllers=new Set();this.refreshing=null;
  }
  cancelAll(){for(const c of this.controllers)c.abort();this.controllers.clear();}
  async token(force,generation){
    if(generation!==this.session?.()?.generation)throw new ApiError('ACCOUNT_CHANGED','A conta foi alterada.');
    if(!force)return this.getIdToken(false);
    if(!this.refreshing||this.refreshing.generation!==generation){const promise=Promise.resolve().then(()=>this.getIdToken(true));this.refreshing={generation,promise};promise.finally(()=>{if(this.refreshing?.promise===promise)this.refreshing=null;}).catch(()=>{});}
    return this.refreshing.promise;
  }
  async call(action,data={},options={}){
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(this.url))throw new ApiError('NOT_CONFIGURED','Configure a URL do serviço central.');
    const generation=this.session?.()?.generation,uid=this.session?.()?.uid;
    const c=new AbortController();this.controllers.add(c);let timedOut=false;
    const abort=()=>c.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)c.abort();
    let abortReject;const cancelled=new Promise((_,reject)=>{abortReject=()=>reject(new ApiError(timedOut?'TIMEOUT':'CANCELLED',timedOut?'O serviço demorou a responder. Sua conta continua conectada.':'Operação cancelada.',{retryable:timedOut}));c.signal.addEventListener('abort',abortReject,{once:true});if(c.signal.aborted)abortReject();});
    const timer=setTimeout(()=>{timedOut=true;c.abort();},options.timeoutMs??this.timeoutMs);
    const current=()=>{if(generation!==this.session?.()?.generation||uid!==this.session?.()?.uid)throw new ApiError('ACCOUNT_CHANGED','A conta foi alterada.');};
    try{
      // Only the SDK token changes on retry, never the requestId/data/device metadata.
      const payload={action,data:safePayload(data),requestId:options.requestId||'',appVersion:this.version,deviceId:this.metadata().deviceId||''};
      for(let attempt=0;attempt<2;attempt++){
        const idToken=await Promise.race([this.token(attempt===1,generation),cancelled]);current();
        const r=await Promise.race([this.transport(this.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},cache:'no-store',redirect:'follow',signal:c.signal,body:JSON.stringify({...payload,idToken})}),cancelled]);
        const body=await Promise.race([r.text(),cancelled]);current();
        if(!r.ok)throw new ApiError('SERVER_ERROR','O serviço está indisponível. Sua conta continua conectada.',{retryable:r.status>=500||r.status===429});
        let value;try{value=JSON.parse(body);}catch{throw new ApiError('INVALID_RESPONSE','O serviço retornou uma resposta inválida. Sua conta continua conectada.');}
        if(!value||typeof value.success!=='boolean'||!('data'in value)||!('error'in value))throw new ApiError('INVALID_RESPONSE','Resposta incompatível com o SAHMT.');
        if(!value.success){const code=value.error?.code||'SERVER_ERROR';if(REFRESHABLE.has(code)&&attempt===0)continue;
          if(code==='ACCESS_DENIED')this.onAccessDenied();
          if(code==='AUTH_REAUTH_REQUIRED'||REFRESHABLE.has(code)){this.onReauthRequired();throw new ApiError('AUTH_REAUTH_REQUIRED','Confirme novamente sua conta Google.');}
          throw new ApiError(code,value.message||'Não foi possível concluir a operação.',{retryable:['AUTH_SERVICE_UNAVAILABLE','SERVER_ERROR'].includes(code)});
        }
        this.onConfirmed();return value.data;
      }
    }catch(error){
      if(generation!==this.session?.()?.generation)throw new ApiError('ACCOUNT_CHANGED','A conta foi alterada.');
      if(error instanceof ApiError)throw error;
      if(SDK_REAUTH.has(error.code)){this.onReauthRequired();throw new ApiError('AUTH_REAUTH_REQUIRED','Confirme novamente sua conta Google.');}
      if(error.code&&error.code!=='auth/network-request-failed')throw new ApiError('AUTH_UNAVAILABLE','Não foi possível obter a credencial. Tente novamente sem sair da conta.');
      if(timedOut)throw new ApiError('TIMEOUT','O serviço demorou a responder. Sua conta continua conectada.',{retryable:true});
      if(c.signal.aborted)throw new ApiError('CANCELLED','Operação cancelada.');
      throw new ApiError('NETWORK','Sem conexão com o serviço. Sua conta continua conectada.',{retryable:true});
    }finally{clearTimeout(timer);c.signal.removeEventListener('abort',abortReject);options.signal?.removeEventListener('abort',abort);this.controllers.delete(c);}
  }
}
