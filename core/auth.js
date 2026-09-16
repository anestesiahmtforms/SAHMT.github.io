import {CONFIG} from '../config.js';
import {ApiClient} from './api.js';
import {SessionManager} from './session.js';
import {Store} from './store.js';
import {Outbox,safePayload} from './outbox.js';
import {Services as ServicesClass} from './services.js';
let session,previousEmail='';const listeners=new Set();
const api=new ApiClient({url:CONFIG.apiUrl,version:CONFIG.version,timeoutMs:CONFIG.timeoutMs,session:()=>session?.snapshot(),onUnauthorized:()=>session.clear()});
const store=new Store();
session=new SessionManager({api,onChange:changed});
const outbox=new Outbox({api,session:()=>session.snapshot()});
export const Services=new ServicesClass({api,session,store,outbox});
const gate=document.getElementById('login-gate'),status=document.getElementById('login-status');
const publicSession=()=>{const s=session.snapshot();return {...s.user,authenticated:s.status==='authenticated',expiresAt:s.expiresAt};};
function changed(s){const email=s.user?.email||'';if(previousEmail!==email){previousEmail=email;Services.clear();window.dispatchEvent(new Event('sahmt:account-change'));}for(const fn of listeners)fn(publicSession());gate.hidden=s.status==='authenticated';document.getElementById('account-button').hidden=true;}
function showGate(message){gate.hidden=false;status.textContent=message||'Entre com sua conta Google autorizada.';}
window.SAHMT_AUTH={
 getSession:publicSession,getUserLabel:()=>publicSession().email||'',
 async requireAccess(){try{await session.confirm();return publicSession();}catch(e){showGate(e.message);throw e;}},
 onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},withPayload:safePayload,
 async chooseAnotherAccount(){const result=await session.logout();googleReady?.accounts?.id?.disableAutoSelect();showGate(result.revoked?'Escolha outra conta.':'Saída local concluída. A revogação no servidor não foi confirmada.');}
};
let googleReady=null;
async function googleLogin(){
 if(!Services.configured){showGate('Ambiente de construção: a implantação única do Apps Script ainda não foi configurada.');return;}
 const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
 script.onerror=()=>showGate('Não foi possível carregar o login Google. Atualize a página.');
 script.onload=()=>{googleReady=window.google;googleReady.accounts.id.initialize({client_id:CONFIG.googleClientId,callback:async response=>{try{status.textContent='Validando acesso…';await session.login(response.credential);window.dispatchEvent(new Event('sahmt:auth-retry'));await Services.flush();}catch(e){showGate(e.message);}}});googleReady.accounts.id.renderButton(document.getElementById('google-login'),{theme:'outline',size:'large',text:'signin_with',width:280});};
 document.head.append(script);
}
const dialog=document.getElementById('account-dialog'),list=document.getElementById('pending-list');
function renderPending(){list.replaceChildren();document.getElementById('account-email').textContent=publicSession().email||'';const items=outbox.read();document.getElementById('pending-status').textContent=items.length?`${items.length} envio(s) pendente(s) nesta conta.`:'Nenhum envio pendente.';for(const item of items){const row=document.createElement('li'),label=document.createElement('span'),discard=document.createElement('button');label.textContent=`${item.action.startsWith('etiquetas.')?'Etiqueta':'Evento'} · ${item.data.data||''} · ${item.status==='review'?'Revisar: '+item.message:'Aguardando conexão'}`;discard.textContent='Descartar';discard.onclick=()=>{if(confirm('Descartar este envio local? Ele não será reenviado.')){outbox.discard(item.requestId);renderPending();}};row.append(label,discard);list.append(row);}}
document.getElementById('account-button').onclick=()=>{renderPending();dialog.showModal();};
document.getElementById('account-close').onclick=()=>dialog.close();
document.getElementById('account-exit').onclick=async()=>{dialog.close();await window.SAHMT_AUTH.chooseAnotherAccount();};
document.getElementById('pending-send').onclick=async()=>{try{await Services.flush();renderPending();}catch(e){document.getElementById('pending-status').textContent=e.message;}};
window.addEventListener('online',()=>Services.flush().catch(()=>{}));
await googleLogin();
