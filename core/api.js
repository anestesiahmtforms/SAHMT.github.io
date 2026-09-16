export class ApiError extends Error {
  constructor(code,message,{retryable=false}={}){super(message);this.name='ApiError';this.code=code;this.retryable=retryable;}
}
export class ApiClient {
  constructor({url,version,session,transport=(...args)=>globalThis.fetch(...args),timeoutMs=25000,onUnauthorized=()=>{}}){Object.assign(this,{url,version,session,transport,timeoutMs,onUnauthorized});this.controllers=new Set();}
  cancelAll(){for(const c of this.controllers)c.abort();this.controllers.clear();}
  async call(action,data={},options={}){
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(this.url))throw new ApiError('NOT_CONFIGURED','O serviço central ainda não foi configurado.');
    const state=this.session?.(),token=options.token??state?.token??'',generation=state?.generation;
    const c=new AbortController();this.controllers.add(c);let timedOut=false;
    const abort=()=>c.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)c.abort();
    const timer=setTimeout(()=>{timedOut=true;c.abort();},options.timeoutMs??this.timeoutMs);
    try{
      const r=await this.transport(this.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},cache:'no-store',redirect:'follow',signal:c.signal,body:JSON.stringify({action,data,token,requestId:options.requestId||'',appVersion:this.version})});
      const body=await r.text();let value;try{value=JSON.parse(body);}catch{throw new ApiError('INVALID_RESPONSE','O serviço retornou uma resposta inválida.');}
      if(!value||typeof value.success!=='boolean'||!('data'in value)||!('error'in value))throw new ApiError('INVALID_RESPONSE','Resposta incompatível com o SAHMT.');
      if(generation!==undefined&&generation!==this.session?.()?.generation)throw new ApiError('ACCOUNT_CHANGED','A conta foi alterada.');
      if(!r.ok||!value.success){const code=value.error?.code||'SERVER_ERROR';if(code==='UNAUTHORIZED'&&!action.startsWith('auth.'))this.onUnauthorized(code);throw new ApiError(code,value.message||'Não foi possível concluir a operação.');}
      return value.data;
    }catch(e){if(e instanceof ApiError)throw e;if(timedOut)throw new ApiError('TIMEOUT','O serviço demorou a responder. Tente novamente.',{retryable:true});if(c.signal.aborted)throw new ApiError('CANCELLED','Operação cancelada.');throw new ApiError('NETWORK','Não foi possível conectar ao serviço.',{retryable:true});}
    finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);this.controllers.delete(c);}
  }
}
