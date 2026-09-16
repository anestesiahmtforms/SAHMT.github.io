import {Services} from './auth.js';
import {createPageScope} from './runtime.js';
export const base=new URL('../',import.meta.url);
const routes={'escala-ferias-imagens.html':'offline','':'home','index.html':'home','apps/eventos/':'eventos','apps/eventos/index.html':'eventos','apps/etiquetas/':'etiquetas','apps/etiquetas/index.html':'etiquetas','apps/gestao/':'gestao','apps/gestao/index.html':'gestao','apps/checklist/':'checklist','apps/checklist/index.html':'checklist','apps/treinamentos/':'treinamentos','apps/treinamentos/index.html':'treinamentos'};
const names={offline:'Escala/Férias OFF LINE',home:'SAHMT',eventos:'Operacional',etiquetas:'Etiquetas',gestao:'Gestão',checklist:'Checklist',treinamentos:'Treinamentos'};
const pages=new Map(),pendingPages=new Map(),vendors=new Map();let current=null,sequence=0,accountGeneration=0;
const status=document.getElementById('shell-status'),retry=document.getElementById('shell-retry');
const root=document.getElementById('app');
function routeFor(url){return url.origin===base.origin&&url.pathname.startsWith(base.pathname)?routes[url.pathname.slice(base.pathname.length)]:undefined;}
function desiredURL(){const url=new URL(base);const hash=location.hash.slice(1);if(hash.startsWith('/'))return new URL(hash.slice(1),base);return new URL('index.html'+location.search,base);}
function routeURL(url){return '#/'+url.pathname.slice(base.pathname.length)+url.search;}
async function vendor(src){const url=new URL(src,base).href;if(!vendors.has(url)){vendors.set(url,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>{vendors.delete(url);s.remove();reject(new Error('Não foi possível carregar um recurso desta área.'));};document.head.append(s);}));}return vendors.get(url);}
function updateUser(page){const session=window.SAHMT_AUTH.getSession();page.shadow.querySelectorAll('[data-auth-user],#auth-user').forEach(el=>{el.textContent=session?.email||'';el.hidden=!session?.email;el.dataset.authenticated=String(session?.authenticated===true);el.setAttribute('role','button');el.tabIndex=0;el.title='Conta e envios';el.onclick=()=>document.getElementById('account-button').click();el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};});}
async function loadPage(id,url){
  if(pages.has(id))return pages.get(id);
  if(pendingPages.has(id))return pendingPages.get(id);
  const promise=mountPage(id,url);pendingPages.set(id,promise);
  try{return await promise;}finally{if(pendingPages.get(id)===promise)pendingPages.delete(id);}
}
async function mountPage(id,url){
  const generation=accountGeneration;
  const bootstrap=id==="offline"?{contacts:[]}:await Services.bootstrap();
  const schedule=["home","eventos"].includes(id)?await Services.schedule():null;
  const response=await fetch(new URL(`views/${id}.json`,import.meta.url));if(!response.ok)throw new Error('Não foi possível carregar esta área.');
  const spec=await response.json();const host=document.createElement('section');host.hidden=true;host.dataset.module=id;host.setAttribute('aria-label',names[id]);
  const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');style.textContent=spec.css.replaceAll('__SAHMT_BASE__',base.href)+'\n:host{display:block} :host([hidden]){display:none!important} [hidden]{display:none!important} [data-auth-user]{font-size:.8rem;overflow-wrap:anywhere;padding-left:0!important;background-image:none!important;background-position:initial!important;background-size:initial!important} [data-auth-user]::before{content:none!important;display:none!important}';
  const body=document.createElement('div');body.dataset.moduleBody='';body.innerHTML=spec.html;
  const moduleBase=new URL(spec.base,base);
  for(const el of body.querySelectorAll('[href],[src],[poster],[action]'))for(const key of ['href','src','poster','action']){const value=el.getAttribute(key);if(value&&!value.startsWith('#')&&!value.startsWith('data:'))el.setAttribute(key,new URL(value,moduleBase).href);}
  shadow.append(style,body);root.append(host);const page={host,shadow};
  page.ctx=createPageScope(host,shadow,body,url,shell);
  page.ctx.window.SAHMT_DATA=schedule;page.ctx.window.SAHMT_CONTACTS={records:bootstrap.contacts};
  shadow.addEventListener('click',event=>{
    const a=event.composedPath().find(el=>el?.tagName==='A');if(!a||event.button!==0||event.ctrlKey||event.metaKey||a.hasAttribute('download'))return;
    if((a.getAttribute('href')||'').startsWith('#'))return;
    const dest=new URL(a.href,moduleBase);if(routeFor(dest)){event.preventDefault();event.stopPropagation();navigate(dest).catch(showError);}
  },true);
  try{for(const src of spec.vendors)await vendor(src);const mod=await import(`./views/${id}.js`);await mod.mount(page.ctx);if(generation!==accountGeneration)throw new Error('A conta foi alterada. Abra esta área novamente.');pages.set(id,page);updateUser(page);return page;}
  catch(error){page.ctx.dispose();throw error;}
}
function showError(error){status.textContent=error?.message||'Não foi possível abrir esta área.';status.hidden=false;retry.hidden=false;}
export async function navigate(input,{replace=false,fromHistory=false}={}){
  const url=new URL(input,base),id=routeFor(url);if(!id){location.assign(url.href);return;}
  // Never carry credentials in application URLs.
  for(const key of ['authToken','deviceToken','userEmail','userName'])url.searchParams.delete(key);
  const ticket=++sequence;status.textContent='Abrindo '+names[id]+'…';status.hidden=false;retry.hidden=true;
  try{
    await window.SAHMT_AUTH.requireAccess({moduleId:id.toUpperCase(),pageId:'home'});if(ticket!==sequence)return;
    const page=await loadPage(id,url);if(ticket!==sequence){if(current!==page)page.ctx.deactivate();return;}
    if(current&&current!==page)current.ctx.deactivate();current=page;page.ctx.activate(url);updateUser(page);
    if(!fromHistory){const target=routeURL(url);if(location.hash!==target)history[replace?'replaceState':'pushState']({},'',target);}
    document.title=names[id]+' — SAHMT';status.hidden=true;
  }catch(error){if(ticket===sequence)showError(error);}
}
let youtubePromise;
async function youtube(){
  if(window.YT?.Player)return window.YT;
  if(!youtubePromise)youtubePromise=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{youtubePromise=null;reject(new Error('Não foi possível carregar o player. Tente novamente.'));},15000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve(window.YT);};
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timeout);youtubePromise=null;reject(new Error('O player está indisponível.'));};document.head.append(script);
  });return youtubePromise;
}
const shell={base,navigate,youtube,services:Services,uiStorage:{getItem:k=>Services.uiMemory.get(k)??null,setItem:(k,v)=>Services.uiMemory.set(k,String(v)),removeItem:k=>Services.uiMemory.delete(k)},get activeModule(){return current?.host.dataset.module;}};window.SAHMT_SHELL=shell;
window.SAHMT_AUTH.onChange(()=>{for(const page of pages.values())updateUser(page);});
window.addEventListener('popstate',()=>navigate(desiredURL(),{fromHistory:true}));
retry.onclick=()=>navigate(desiredURL(),{replace:true});
window.addEventListener('sahmt:auth-retry',()=>navigate(desiredURL(),{replace:true}));
window.addEventListener('sahmt:account-change',()=>{accountGeneration++;pendingPages.clear();for(const p of pages.values())p.ctx.dispose();pages.clear();current=null;navigate(desiredURL(),{replace:true});});
async function registerPwa(){if(!('serviceWorker'in navigator))return;const reg=await navigator.serviceWorker.register(new URL('service-worker.js',base),{scope:base.href,updateViaCache:'none'});
  const offer=()=>{if(!reg.waiting)return;const b=document.getElementById('shell-update');b.hidden=false;b.onclick=()=>{if(!confirm('Atualizar o aplicativo agora? Conclua ou guarde os dados em edição antes de continuar.'))return;navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});reg.waiting.postMessage('ACTIVATE_UPDATE');};};offer();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',offer));}
registerPwa().catch(()=>{});
navigate(desiredURL(),{replace:true});
