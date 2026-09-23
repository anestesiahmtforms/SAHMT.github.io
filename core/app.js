import {Services} from './auth.js';
import {createPageScope} from './runtime.js';
import {pageData} from './page-data.js';
import {registerPwa} from './pwa.js';
import {renderActivities,watchActivityReturn} from './activity-ui.js';
window.SAHMT_ACTIVITIES={render:renderActivities,watchReturn:watchActivityReturn};
export const base=new URL('../',import.meta.url);
const routes={'escala-ferias-imagens.html':'offline','':'home','index.html':'home','apps/eventos/':'eventos','apps/eventos/index.html':'eventos','apps/etiquetas/':'etiquetas','apps/etiquetas/index.html':'etiquetas','apps/gestao/':'gestao','apps/gestao/index.html':'gestao','apps/checklist/':'checklist','apps/checklist/index.html':'checklist','apps/treinamentos/':'treinamentos','apps/treinamentos/index.html':'treinamentos'};
const names={offline:'Escala/Férias OFF LINE',home:'SAHMT',eventos:'Operacional',etiquetas:'Etiquetas',gestao:'Gestão',checklist:'Checklist',treinamentos:'Treinamentos'};
const pages=new Map(),pendingPages=new Map(),vendors=new Map(),definitions=new Map();let current=null,sequence=0,accountGeneration=0,lastRequested=null;
const shellState=document.getElementById('shell-state'),status=document.getElementById('shell-status'),retry=document.getElementById('shell-retry');
const root=document.getElementById('app');
const CHECKLIST_REPORT_CACHE_MS=30000;
let checklistWarmDay='',checklistWarmAt=0,checklistWarmPending=false;
function localDayKey(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const v=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;}
function warmChecklistReport(){
  if(document.visibilityState==='hidden'||navigator.onLine===false||!Services.user?.uid||checklistWarmPending)return;
  const day=localDayKey(),now=Date.now();if(checklistWarmDay===day&&now-checklistWarmAt<CHECKLIST_REPORT_CACHE_MS)return;
  checklistWarmDay=day;checklistWarmAt=now;checklistWarmPending=true;
  Services.checklist('report',{day},{timeoutMs:12000,cacheTtlMs:CHECKLIST_REPORT_CACHE_MS})
    .catch(()=>{if(checklistWarmDay===day)checklistWarmAt=0;})
    .finally(()=>{checklistWarmPending=false;});
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)warmChecklistReport();});
window.addEventListener('online',warmChecklistReport);
function routeFor(url){return url.origin===base.origin&&url.pathname.startsWith(base.pathname)?routes[url.pathname.slice(base.pathname.length)]:undefined;}
function desiredURL(){const url=new URL(base);const hash=location.hash.slice(1);if(hash.startsWith('/'))return new URL(hash.slice(1),base);return new URL('index.html'+location.search,base);}
function routeURL(url){return '#/'+url.pathname.slice(base.pathname.length)+url.search;}
async function vendor(src){const url=new URL(src,base).href;if(!vendors.has(url)){vendors.set(url,new Promise((resolve,reject)=>{const s=document.createElement('script');const fail=()=>{clearTimeout(timer);vendors.delete(url);s.remove();reject(new Error('Não foi possível carregar o recurso de PDF. Tente novamente.'));};const timer=setTimeout(fail,15000);s.src=url;s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=fail;document.head.append(s);}));}return vendors.get(url);}
async function definition(id){
  if(!definitions.has(id))definitions.set(id,Promise.all([
    fetch(new URL(`views/${id}.json`,import.meta.url)).then(r=>{if(!r.ok)throw new Error('Não foi possível carregar esta área.');return r.json();}),
    import(`./views/${id}.js`)
  ]).then(([spec,mod])=>({spec,mod})).catch(error=>{definitions.delete(id);throw error;}));
  return definitions.get(id);
}
async function prepareVendors(id){const {spec}=await definition(id);for(const src of spec.vendors)await vendor(src);}
let preloaded=false;
function preloadViews(){if(preloaded)return;preloaded=true;for(const id of Object.keys(names))definition(id).catch(()=>{});prepareVendors('etiquetas').catch(()=>{});}
function updateUser(page){const session=window.SAHMT_AUTH.getSession();page.shadow.querySelectorAll('[data-auth-user],#auth-user').forEach(el=>{el.textContent=session?.email||'';el.hidden=!session?.email;el.dataset.authenticated=String(session?.authenticated===true);el.setAttribute('role','button');el.tabIndex=0;el.title='Conta e envios';el.onclick=()=>document.getElementById('account-button').click();el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};});}
async function loadPage(id,url){
  if(pages.has(id))return pages.get(id);
  if(pendingPages.has(id))return pendingPages.get(id);
  const promise=mountPage(id,url);pendingPages.set(id,promise);
  try{return await promise;}finally{if(pendingPages.get(id)===promise)pendingPages.delete(id);}
}
async function mountPage(id,url){
  const generation=accountGeneration;
  const [{bootstrap,schedule},{spec,mod}]=await Promise.all([pageData(id,Services),definition(id)]);
  if(generation!==accountGeneration)throw new Error('A conta foi alterada. Abra esta área novamente.');
  const host=document.createElement('section');host.hidden=true;host.dataset.module=id;host.setAttribute('aria-label',names[id]);
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
  try{prepareVendors(id).catch(()=>{});await mod.mount(page.ctx);if(generation!==accountGeneration)throw new Error('A conta foi alterada. Abra esta área novamente.');pages.set(id,page);updateUser(page);return page;}
  catch(error){page.ctx.dispose();throw error;}
}
function showError(error){shellState.hidden=false;status.textContent=error?.message||'Não foi possível abrir esta área.';status.hidden=false;retry.hidden=false;}
export async function navigate(input,{replace=false,fromHistory=false}={}){
  const url=new URL(input,base),id=routeFor(url);if(!id){location.assign(url.href);return;}
  // Never carry credentials in application URLs.
  for(const key of ['authToken','deviceToken','userEmail','userName'])url.searchParams.delete(key);
  const ticket=++sequence;lastRequested=url;status.hidden=true;retry.hidden=true;
  const loading=setTimeout(()=>{if(ticket===sequence){status.textContent='Carregando dados de '+names[id]+'…';status.hidden=false;}},250);
  try{
    await window.SAHMT_AUTH.requireAccess({moduleId:id.toUpperCase(),pageId:'home'});warmChecklistReport();if(ticket!==sequence)return;
    const page=await loadPage(id,url);if(ticket!==sequence){if(current!==page)page.ctx.deactivate();return;}
    if(current&&current!==page)current.ctx.deactivate();current=page;page.ctx.activate(url);updateUser(page);
    if(!fromHistory){const target=routeURL(url);if(location.hash!==target)history[replace?'replaceState':'pushState']({},'',target);}
    document.title=names[id]+' — SAHMT';status.hidden=true;preloadViews();
  }catch(error){if(ticket===sequence)showError(error);}
  finally{clearTimeout(loading);}
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
const shell={base,navigate,youtube,ensurePdf:()=>prepareVendors('etiquetas'),services:Services,uiStorage:{getItem:k=>Services.uiMemory.get(k)??null,setItem:(k,v)=>Services.uiMemory.set(k,String(v)),removeItem:k=>Services.uiMemory.delete(k)},get activeModule(){return current?.host.dataset.module;}};window.SAHMT_SHELL=shell;
window.SAHMT_AUTH.onChange(()=>{for(const page of pages.values())updateUser(page);});
window.addEventListener('popstate',()=>navigate(desiredURL(),{fromHistory:true}));
retry.onclick=()=>navigate(lastRequested||desiredURL(),{replace:true});
window.addEventListener('sahmt:auth-retry',()=>navigate(desiredURL(),{replace:true}));
window.addEventListener('sahmt:account-change',()=>{accountGeneration++;pendingPages.clear();for(const p of pages.values())p.ctx.dispose();pages.clear();current=null;navigate(desiredURL(),{replace:true});});
registerPwa({base}).catch(()=>{});
navigate(desiredURL(),{replace:true});
