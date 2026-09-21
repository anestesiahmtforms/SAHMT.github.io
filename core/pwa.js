// Updates never clear sessions, drafts or the outbox. Reload only after consent
// and an actual controller change; first installation must not reload the page.
export async function registerPwa({base,sw=globalThis.navigator?.serviceWorker,document=globalThis.document,reload=()=>globalThis.location.reload(),timeoutMs=20000}={}){
  if(!sw)return;
  const button=document.getElementById('shell-update'),dialog=document.getElementById('update-dialog');
  const apply=document.getElementById('update-apply'),later=document.getElementById('update-later'),status=document.getElementById('update-status');
  let loadedController=sw.controller,appReady=Boolean(globalThis.SAHMT_APP_READY);
  let reg,busy=false,changed=false,reloaded=false,finishActivation=null,offered=false;
  const reloadOnce=()=>{if(!reloaded){reloaded=true;reload();}};
  const offer=()=>{
    if(!reg||busy||!appReady)return;
    const available=Boolean(reg.waiting||changed);
    button.hidden=true;
    if(available&&!offered){
      offered=true;
      status.textContent='Uma nova versão do aplicativo está disponível.';
      dialog.showModal();
    }
  };
  sw.addEventListener('controllerchange',()=>{
    if(!loadedController)loadedController=sw.controller;
    else if(sw.controller!==loadedController)changed=true;
    finishActivation?.();
    offer();
  });
  globalThis.SAHMT_PWA_READY=()=>{appReady=true;offer();};
  reg=await sw.register(new URL('service-worker.js',base),{scope:base.href,updateViaCache:'none'});
  const watch=worker=>worker?.addEventListener('statechange',offer);
  watch(reg.installing);reg.addEventListener('updatefound',()=>watch(reg.installing));offer();
  button.onclick=()=>{};
  later.onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  apply.onclick=async()=>{
    if(busy)return;
    busy=true;apply.disabled=true;later.disabled=true;button.disabled=true;
    status.textContent='Aplicando atualização…';
    try{
      if(changed){reloadOnce();return;}
      // The waiting worker may have activated in another tab since the offer.
      const waiting=reg.waiting;
      if(!waiting){
        if(sw.controller!==loadedController&&sw.controller){reloadOnce();return;}
        status.textContent='Não há atualização pendente. Você pode continuar usando o aplicativo.';
        return;
      }
      const controllerBefore=sw.controller;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>settle(new Error('A atualização não terminou. Feche as outras abas do SAHMT e tente novamente. Seus dados foram preservados.')),timeoutMs);
        function settle(error){clearTimeout(timer);waiting.removeEventListener('statechange',check);finishActivation=null;error?reject(error):resolve();}
        function check(){
          if(waiting.state==='redundant')settle(new Error('A atualização foi substituída. Tente novamente.'));
          else if(sw.controller&&sw.controller!==controllerBefore)settle();
        }
        finishActivation=check;waiting.addEventListener('statechange',check);
        try{waiting.postMessage('ACTIVATE_UPDATE');check();}catch(error){settle(error);}
      });
      reloadOnce();
    }catch(error){status.textContent=error.message||'Não foi possível atualizar. Tente novamente.';}
    finally{busy=false;apply.disabled=false;later.disabled=false;button.disabled=false;offer();}
  };
  return reg;
}
