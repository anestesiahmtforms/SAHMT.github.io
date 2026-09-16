// Native page scopes: each screen has isolated DOM/styles, but one real window and session.
// Existing business rules run as ES modules; no iframe, eval or duplicate Google login.
import {scopeServices} from './scope-services.js';
export function createPageScope(host, root, body, moduleUrl, shell) {
  const state={active:true,values:Object.create(null),events:[],intervals:new Set(),timeouts:new Set(),frames:new Set()};
  const scoped=scopeServices(shell.services,()=>state.disposed);
  const localURL=new URL(moduleUrl);
  const locationView=new Proxy(localURL,{
    get(target,key){if(key==='assign'||key==='replace')return value=>shell.navigate(new URL(value,target));if(key==='reload')return ()=>shell.navigate(target); const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},
    set(target,key,value){if(key==='href'){shell.navigate(new URL(value,target));return true;}const next=new URL(target);next[key]=value;shell.navigate(next);return true;}
  });
  const add=(target,type,listener,options)=>{
    if(type==='load'){queueMicrotask(()=>listener(new Event('load')));return;}
    if(type==='popstate')return;
    const wrapped=event=>{if(state.active || ['beforeunload','sahmt:hide','visibilitychange'].includes(type))typeof listener==='function'?listener(event):listener.handleEvent(event);};
    state.events.push({target,type,listener,wrapped,options});target.addEventListener(type,wrapped,options);
  };
  const remove=(target,type,listener)=>{for(const e of state.events)if(e.target===target&&e.type===type&&e.listener===listener)target.removeEventListener(type,e.wrapped,e.options);};
  const visibility=()=>root.dispatchEvent(new Event('visibilitychange'));
  document.addEventListener('visibilitychange',visibility);
  state.events.push({unsubscribe:()=>document.removeEventListener('visibilitychange',visibility)});
  const doc=new Proxy(document,{
    get(target,key){
      if(key==='body')return body;if(key==='head')return root;if(key==='documentElement')return host;
      if(key==='activeElement')return root.activeElement;if(key==='hidden')return !state.active||document.hidden;
      if(key==='visibilityState')return state.active?document.visibilityState:'hidden';
      if(key==='baseURI'||key==='URL')return localURL.href;
      if(key==='dispatchEvent')return event=>root.dispatchEvent(event);
      if(key==='getElementById')return id=>root.getElementById(id);
      if(key==='querySelector')return selector=>root.querySelector(selector);
      if(key==='querySelectorAll')return selector=>root.querySelectorAll(selector);
      if(key==='addEventListener')return (type,fn,opts)=>add(root,type,fn,opts);
      if(key==='removeEventListener')return (type,fn)=>remove(root,type,fn);
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },set(target,key,value){if(key==='title'){state.title=value;return true;}return Reflect.set(target,key,value);}
  });
  const historyView={state:{},pushState(){},replaceState(){},back:()=>history.back(),forward:()=>history.forward()};
  const timer=(fn,ms,...args)=>{const id=window.setTimeout(()=>{state.timeouts.delete(id);fn(...args);},ms);state.timeouts.add(id);return id;};
  const interval=(fn,ms,...args)=>{const id=window.setInterval(()=>{if(state.active)fn(...args);},ms);state.intervals.add(id);return id;};
  const raf=fn=>{const id=window.requestAnimationFrame(t=>{state.frames.delete(id);if(state.active)fn(t);});state.frames.add(id);return id;};
  const sharedAuth={...window.SAHMT_AUTH,onChange(fn){const unsub=window.SAHMT_AUTH.onChange(fn);state.events.push({unsubscribe:unsub});return unsub;}};
  const nav=new Proxy(navigator,{get(t,k){if(k==='serviceWorker')return undefined;const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;},has(t,k){return k!=='serviceWorker'&&k in t;}});
  let win;
  win=new Proxy(window,{
    get(target,key){
      if(key==='window'||key==='self'||key==='parent'||key==='top')return win;
      if(key==='fetch')return fetchLocal;if(key==='localStorage'||key==='sessionStorage')return scoped.storage;if(key==='document')return doc;if(key==='location')return locationView;if(key==='history')return historyView;
      if(key==='navigator')return nav;if(key==='SAHMT_AUTH')return sharedAuth;
      if(key==='SAHMT_SHELL')return shell;if(key==='openArsenalChecklist')return ()=>shell.navigate(new URL('apps/checklist/',shell.base));
      if(key==='setTimeout')return timer;if(key==='setInterval')return interval;if(key==='requestAnimationFrame')return raf;
      if(key==='addEventListener')return (type,fn,opts)=>add(window,type,fn,opts);
      if(key==='removeEventListener')return (type,fn)=>remove(window,type,fn);
      if(Object.hasOwn(state.values,key))return state.values[key];
      const value=Reflect.get(target,key,target);
      return typeof value==='function'&&!/^[A-Z]/.test(String(key))?value.bind(target):value;
    },set(target,key,value){if(key==='location'){shell.navigate(new URL(value,localURL));return true;}state.values[key]=value;return true;}
  });
  const fetchLocal=()=>{throw new Error('As views não podem realizar requisições próprias.');};
  return {localStorage:scoped.storage,sessionStorage:scoped.storage,Services:scoped.services,document:doc,window:win,navigator:nav,location:locationView,history:historyView,fetch:fetchLocal,
    setTimeout:timer,clearTimeout:window.clearTimeout.bind(window),setInterval:interval,clearInterval:window.clearInterval.bind(window),requestAnimationFrame:raf,cancelAnimationFrame:window.cancelAnimationFrame.bind(window),
    activate(url){localURL.href=url.href;state.active=true;host.hidden=false;root.dispatchEvent(new Event('sahmt:show'));root.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('resize'));},
    deactivate(){state.active=false;root.dispatchEvent(new Event('sahmt:hide'));root.dispatchEvent(new Event('visibilitychange'));body.querySelectorAll('video').forEach(v=>{v.pause();v.srcObject?.getTracks().forEach(t=>t.stop());v.srcObject=null;});root.querySelectorAll('dialog[open]').forEach(d=>d.close());host.hidden=true;},
    dispose(){state.disposed=true;this.deactivate();state.events.forEach(e=>e.unsubscribe?e.unsubscribe():e.target.removeEventListener(e.type,e.wrapped,e.options));state.intervals.forEach(clearInterval);state.timeouts.forEach(clearTimeout);state.frames.forEach(cancelAnimationFrame);host.remove();}
  };
}

