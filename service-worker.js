const ROOT=new URL('./',self.location.href);
const PREFIX='sahmt-v3:'+ROOT.pathname+':';
const CACHE=PREFIX+'treinamentos-autor-azul-20260921-33';
const ASSETS=["./apps/checklist/assets/carrinho-anestesia-checklist.png","./apps/checklist/icons/icon.svg","./apps/checklist/premium-icons.css","./apps/checklist/report-layout.css","./apps/checklist/styles.css","./apps/checklist/vendor/LICENSE-zxing.txt","./apps/checklist/vendor/zxing.min.js","./apps/etiquetas/styles.css","./apps/eventos/escala-ferias-imagens.css","./apps/eventos/gestao_operacional.png","./apps/eventos/icons/icon-192.png","./apps/eventos/icons/icon-512.png","./apps/eventos/logo_administrativo.png","./apps/eventos/logo_equipe.png","./apps/eventos/logo_gestao.png","./apps/eventos/sahmt_option1.png","./apps/eventos/sahmt_option1_clean.png","./apps/eventos/styles.css","./apps/gestao/assets/icon-192.svg","./apps/gestao/assets/icon-512.svg","./apps/gestao/assets/sahmt-logo.png","./apps/gestao/assets/selo-qga-accredited-qmentum-diamond.png","./apps/gestao/styles.css","./apps/treinamentos/styles.css","./config.js","./core/activity-ui.js","./core/api.js","./core/app.js","./core/auth-store.js","./core/auth.js","./core/checklist-contract.js","./core/device-trust.js","./core/firebase-client.js","./core/outbox.js","./core/page-data.js","./core/pwa.js","./core/runtime.js","./core/scope-services.js","./core/services.js","./core/session.js","./core/store.js","./core/views/checklist.js","./core/views/checklist.json","./core/views/etiquetas.js","./core/views/etiquetas.json","./core/views/eventos.js","./core/views/eventos.json","./core/views/gestao.js","./core/views/gestao.json","./core/views/home.js","./core/views/home.json","./core/views/offline.js","./core/views/offline.json","./core/views/treinamentos.js","./core/views/treinamentos.json","./escala-ferias-imagens.css","./escala-imagens/ferias-2026.jpg","./escala-imagens/quarta-2026.jpg","./escala-imagens/quinta-2026.jpg","./escala-imagens/sabado-2026.jpg","./escala-imagens/segunda-2026.jpg","./escala-imagens/sexta-2026.jpg","./escala-imagens/terca-2026.jpg","./gestao_operacional.png","./icons/icon-192.png","./icons/icon-512.png","./index.html","./logo_administrativo.png","./logo_equipe.png","./logo_gestao.png","./manifest.webmanifest","./modal-98.css","./sahmt_option1.png","./sahmt_option1_clean.png","./shell.css","./siglas-layout.css","./styles.css"];
const KNOWN=new Set(ASSETS.map(p=>new URL(p,ROOT).href));
self.addEventListener('install',event=>{
  // Bypass HTTP caches as well: a new worker must not cache the previous JS.
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(
    ASSETS.map(p=>new Request(new URL(p,ROOT),{cache:'reload'}))
  )));
});
self.addEventListener('message',event=>{
  if(event.data==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);url.search='';url.hash='';
  if(url.origin!==ROOT.origin||!url.href.startsWith(ROOT.href))return;
  const known=KNOWN.has(url.href);
  const entry=event.request.mode==='navigate'&&(url.href===ROOT.href||url.href===new URL('index.html',ROOT).href);
  if(!known&&!entry)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // The HTML and scripts belong to the same installed release.
    return await cache.match(entry?new URL('index.html',ROOT).href:url.href)||fetch(event.request);
  })());
});
