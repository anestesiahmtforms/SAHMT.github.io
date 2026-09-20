import {CONFIG} from '../config.js';
import {ApiClient} from './api.js';
import {firebaseClient} from './firebase-client.js';
import {SessionManager} from './session.js';
import {publicAuthState} from './auth-store.js';
import {Store} from './store.js';
import {Outbox,safePayload} from './outbox.js';
import {Services as ServicesClass} from './services.js';
let session,previousUid='',previousReady=false;const listeners=new Set();
const gate=document.getElementById('login-gate'),status=document.getElementById('login-status');
const login=document.getElementById('google-login-button'),retry=document.getElementById('auth-retry'),changeAccount=document.getElementById('auth-change-account');
let firebase,configurationError;
try{firebase=firebaseClient(CONFIG.firebase);}catch(error){configurationError=error;firebase={currentUser:null,subscribe(){throw error;},login(){return Promise.reject(error);},logout(){return Promise.resolve();}};}
const api=new ApiClient({url:CONFIG.apiUrl,version:CONFIG.version,timeoutMs:CONFIG.timeoutMs,session:()=>session?.snapshot(),
 getIdToken:force=>session.getIdToken(force),metadata:()=>session.requestMetadata(),
 onAccessDenied:()=>session.denyAccess(),onReauthRequired:()=>session.requireReauth(),onConfirmed:()=>session.confirmedRequest()});
session=new SessionManager({firebase,api,version:CONFIG.version,onChange:changed});
const outbox=new Outbox({api,session:()=>session.snapshot()});
export const Services=new ServicesClass({api,session,store:new Store(),outbox});
const publicSession=()=>publicAuthState(session.snapshot());
function changed(s){
 const changedAccount=previousUid!==s.uid;
 if(changedAccount){previousUid=s.uid;Services.clear();window.dispatchEvent(new Event('sahmt:account-change'));}
 if(s.memberStatus==='DENIED')Services.clear();
 const usable=s.authenticated&&!!s.user&&['ACTIVE','STALE'].includes(s.memberStatus)&&s.status!=='reauth-required';
 gate.hidden=usable;login.hidden=!s.initialized||!['anonymous','reauth-required'].includes(s.status)||!!configurationError;
 retry.hidden=!s.initialized||s.status==='anonymous'||!!configurationError;
 changeAccount.hidden=!s.authenticated;
 if(!usable)status.textContent=s.error||(s.status==='validating'?'Conta restaurada. Carregando seu acesso…':s.status==='anonymous'?'Entre com sua conta Google autorizada.':'Restaurando sua conta…');
 document.getElementById('app').inert=!usable;
 for(const fn of listeners)fn(publicSession());
 if(usable&&!previousReady){queueMicrotask(()=>window.dispatchEvent(new Event('sahmt:auth-retry')));}
 previousReady=usable;document.getElementById('account-button').hidden=true;
}
window.SAHMT_AUTH={getSession:publicSession,getUserLabel:()=>publicSession().email||'',
 requireAccess:async()=>{await session.access();return publicSession();},
 onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},withPayload:safePayload,
 chooseAnotherAccount:()=>session.logout()};
login.onclick=()=>{
 // Popup must start inside this user gesture, not after a backend request.
 const operation=session.login();login.disabled=true;status.textContent='Conectando com Google…';
 operation.then(async()=>{await session.restoring;await Services.flush();}).catch(error=>{
  const messages={'auth/popup-blocked':'Permita a janela de login e toque novamente em Entrar com Google. Não é necessário apagar os dados do app.',
   'auth/popup-closed-by-user':'Login cancelado. Toque em Entrar com Google quando desejar.',
   'auth/unauthorized-domain':'O domínio deste app precisa ser autorizado no Firebase Console.',
   'auth/network-request-failed':'Sem conexão com o Google. Tente novamente ao recuperar a internet.'};
  status.textContent=messages[error.code]||error.message;
 }).finally(()=>{login.disabled=false;});
};
retry.onclick=async()=>{retry.disabled=true;try{await session.bootstrap();window.dispatchEvent(new Event('sahmt:auth-retry'));await Services.flush();}catch(error){status.textContent=error.message;}finally{retry.disabled=false;}};
changeAccount.onclick=()=>session.logout().catch(error=>{status.textContent=error.message;});
const dialog=document.getElementById('account-dialog'),list=document.getElementById('pending-list');
function renderPending(){list.replaceChildren();document.getElementById('account-email').textContent=publicSession().email||'';const items=outbox.read();document.getElementById('pending-status').textContent=items.length?`${items.length} envio(s) PENDING_SYNC nesta conta.`:'Nenhum envio pendente.';for(const item of items){const row=document.createElement('li'),label=document.createElement('span'),discard=document.createElement('button');label.textContent=`${item.action.startsWith('etiquetas.')?'Etiqueta':'Evento'} · ${item.data.data||''} · ${item.status==='review'?'Revisar: '+item.message:'Pendente de sincronização'}`;discard.textContent='Descartar';discard.onclick=()=>{if(confirm('Descartar este envio local? Ele não será reenviado.')){outbox.discard(item.requestId);renderPending();}};row.append(label,discard);list.append(row);}}
document.getElementById('account-button').onclick=()=>{renderPending();dialog.showModal();};
document.getElementById('account-close').onclick=()=>dialog.close();
document.getElementById('account-exit').onclick=async()=>{try{await session.logout();dialog.close();}catch(error){document.getElementById('pending-status').textContent=error.message;}};
document.getElementById('pending-send').onclick=async()=>{try{await session.resume();await Services.flush();renderPending();}catch(error){document.getElementById('pending-status').textContent=error.message;}};
window.addEventListener('online',()=>session.resume().then(async()=>{await Services.flush();window.dispatchEvent(new Event('sahmt:auth-retry'));}).catch(()=>{}));
window.addEventListener('offline',()=>session.networkChanged());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)session.resume().catch(()=>{});});
export const authReady=session.start();
