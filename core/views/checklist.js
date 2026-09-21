export async function mount(ctx){
const {Services,localStorage,sessionStorage,document,window,navigator,location,history,fetch,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame}=ctx;
window.SAHMT_CHECKLIST_CONTRACT=(await import('../checklist-contract.js')).checklistResponse;
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = {apiUrl:Services.configured?"central-service":"",parentOrigin:window.location.origin,parentPath:"/"};
  let session = null, stream = null, scanning = false, cameraDetector = null, current = null, report = null, prefetchStartedDay = '', prefetchStartedMonth = '', lastValidReportDay = '';
  const reportCache = new Map(), pendingReads = new Map(), REPORT_CACHE_MS = 15000;
  const MAINTENANCE_UNITS = new Set();
  const DIRECT_RECORD_USERS = new Set();
  let activatedMaintenance = new Set(), activatedMaintenanceDay = '', manualMaintenance = new Set(), resetRecords = new Set();
  const unitKey = item => String(item?.id || '').replace(/\D/g, '');
  const isMaintenance = item => item?.inactive===true;
  function syncMaintenanceDay(day = dateKey()) {
    if (activatedMaintenanceDay !== day) { activatedMaintenanceDay = day; activatedMaintenance = new Set(); manualMaintenance = new Set(); resetRecords = new Set(); }
    return activatedMaintenance;
  }
  const isInactiveMaintenance = (item, day = dateKey()) => (manualMaintenance.has(unitKey(item)) || (isMaintenance(item) && !item.record && !(day === activatedMaintenanceDay && activatedMaintenance.has(unitKey(item)))));
  const numericUnitId = item => Number(unitKey(item)) || Number.MAX_SAFE_INTEGER;
  const isIsoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  let pendingRecord = null, pendingRecordMode = 'qr', pendingSignature = null, busy = false, reportSyncTimer = null, reportSyncStartedAt = 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  const dateKey = () => {const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`;};
  const notice = message => {
    $('message').textContent = message;
    $('message').dataset.state = /identificando unidade/i.test(message) ? 'identifying' : message ? 'notice' : '';
    document.querySelectorAll('.dialog-message').forEach(node=>node.remove());
    const dialog=document.querySelector('dialog[open]');
    if(message && dialog){const node=document.createElement('p');node.className='dialog-message';node.setAttribute('role','alert');node.textContent=message;dialog.querySelector('.dialog-head').after(node);}
  };
  function syncIndicator(state, elapsed = 0) {
    const node=$('reportSyncStatus'),label=$('reportSyncLabel');if(!node||!label)return;
    node.dataset.state=state;
    label.textContent=state==='syncing'?`Sincronizando ${String(elapsed).padStart(2,'0')}s`:state==='updated'?'Atualizado':state==='error'?'Falha na atualização':'Aguardando atualização';
  }
  function startReportSync() {
    clearInterval(reportSyncTimer);reportSyncStartedAt=Date.now();syncIndicator('syncing',0);
    reportSyncTimer=setInterval(()=>syncIndicator('syncing',Math.floor((Date.now()-reportSyncStartedAt)/1000)),1000);
  }
  function finishReportSync() {const elapsed=Math.floor((Date.now()-reportSyncStartedAt)/1000);clearInterval(reportSyncTimer);reportSyncTimer=null;syncIndicator('updated',elapsed);}
  function failReportSync() {clearInterval(reportSyncTimer);reportSyncTimer=null;syncIndicator('error');}
  function shiftDay(day,delta) {const value=new Date(`${day}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+delta);return value.toISOString().slice(0,10);}
  async function authPayload() {
    session = await window.SAHMT_AUTH.requireAccess({moduleId:'CHECKLIST',pageId:'home'});
    if (session?.authenticated !== true) throw new Error('Confirme seu acesso para continuar.');
    return window.SAHMT_AUTH.withPayload();
  }
  function requestKey(action,payload){return action+':'+JSON.stringify(payload || {});}
  function rememberReport(data){if(data?.day)reportCache.set(requestKey('report',{day:data.day}),{at:Date.now(),data});return data;}
  function patchCachedReport(day,record){
    const key=requestKey('report',{day});const cached=reportCache.get(key);if(!cached?.data?.items)return;
    const data=JSON.parse(JSON.stringify(cached.data));const item=data.items.find(entry=>String(entry.id)===String(record.unitId));if(!item)return;
    item.record={id:record.id,at:record.at,condition:record.condition,occurrence:record.occurrence,email:record.email,name:record.name};data.signature=null;data.staleSignature=true;data.revision='';reportCache.set(key,{at:Date.now(),data});
  }
  async function refreshReport(day){startReportSync();try{const data=await api('report',{day},{force:true});if(report?.day===day)renderReport(data);finishReportSync();return data;}catch{failReportSync();return null;}}
  async function parseJsonResponse(response) {
    const body = await response.text();
    const contentType = response.headers.get("content-type") || "";
    try {
      return JSON.parse(body);
    } catch {
      if (body.trimStart().startsWith("<") || /text\/html/i.test(contentType)) {
        throw new Error("O serviço de dados está temporariamente indisponível. Tente atualizar em alguns segundos.");
      }
      throw new Error("O serviço de dados retornou uma resposta inválida. Tente atualizar novamente.");
    }
  }
  async function api(action,payload={},options={}){await authPayload();const result=window.SAHMT_CHECKLIST_CONTRACT(await Services.checklist(action,payload,options),action,payload);if(action==="report")rememberReport(result);return result;}
  function stopCamera(){scanning=false;stream?.getTracks().forEach(track=>track.stop());stream=null;$('video').srcObject=null;}
  function close(id){if(id==='cameraDialog')stopCamera();$(id).close();}
  function fail(error){ notice(error.message || 'Não foi possível concluir.'); }
  const displayRecord = item => resetRecords.has(unitKey(item)) ? null : item?.record;
  function closeArsenalActionBanner(){const dialog=$('arsenalActionDialog');if(dialog?.open)dialog.close();}
  function openArsenalActionBanner(item){if(!canDirectRecord()||!item)return;const dialog=$('arsenalActionDialog');if(!dialog)return;current=item;$('arsenalActionTitle').textContent=unitKey(item)||String(item.id||'');dialog.showModal();dialog.focus({preventScroll:true});}
  function openRecordForUnit(unit,{direct=false}={}){
    stopCamera();close('cameraDialog');current=unit;if(isMaintenance(current))syncMaintenanceDay(dateKey()).add(unitKey(current));pendingRecord=null;pendingRecordMode=direct?'direct':'qr';
    $('recordForm').reset();$('recordForm').querySelector('[type=submit]').hidden=true;$('occurrenceLabel').hidden=true;$('occurrence').required=false;
    $('unitName').textContent=current.name;notice('');$('recordDialog').showModal();
  }
  async function identify(raw){
    stopCamera();close('cameraDialog');notice('Identificando unidade…');
    const data=await api('resolve',{qr:String(raw)});openRecordForUnit(data.unit);
  }  function cameraCrop(width,height){
    const side=Math.max(160,Math.floor(Math.min(width,height)*0.68));
    return {sx:Math.max(0,Math.floor((width-side)/2)),sy:Math.max(0,Math.floor((height-side)/2)),sw:Math.min(side,width),sh:Math.min(side,height)};
  }
  function decode(source,width,height,crop=false){
    const region=crop?cameraCrop(width,height):{sx:0,sy:0,sw:width,sh:height};
    const ratio=Math.min(1,1200/Math.max(region.sw,region.sh));
    canvas.width=Math.max(1,Math.round(region.sw*ratio));canvas.height=Math.max(1,Math.round(region.sh*ratio));
    ctx.drawImage(source,region.sx,region.sy,region.sw,region.sh,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const gray=new Uint8ClampedArray(pixels.width*pixels.height);
    for(let i=0;i<gray.length;i++){const p=i*4;gray[i]=(pixels.data[p]+2*pixels.data[p+1]+pixels.data[p+2])/4;}
    const bitmap=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(gray,pixels.width,pixels.height)));
    try{return new ZXing.QRCodeReader().decode(bitmap).getText();}catch{return null;}
  }
  async function detectCameraFrame(video){
    if(typeof BarcodeDetector!=='undefined'){
      try{
        cameraDetector ||= new BarcodeDetector({formats:['qr_code']});
        const results=await cameraDetector.detect(video);
        const raw=results?.find(item=>item.rawValue)?.rawValue;
        if(raw)return raw;
      }catch{}
    }
    return decode(video,video.videoWidth,video.videoHeight,true);
  }
  async function startCamera(){
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('A câmera exige HTTPS e permissão do navegador. Use a leitura de uma foto.');
    if(!window.ZXing) throw new Error('Não foi possível carregar o leitor. Atualize a página.');
    stopCamera();scanning=true;
    try {
      const acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(!scanning){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;
      const track=stream.getVideoTracks()[0];
      if(track?.applyConstraints) track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
      $('video').srcObject=stream;$('cameraDialog').showModal();await $('video').play();
      let lastQr='',stableReads=0,detecting=false;
      const tick=async()=>{
        if(!scanning||detecting)return;
        try{
          const v=$('video');
          if(v.readyState>=2&&v.videoWidth>0){
            detecting=true;
            const qr=await detectCameraFrame(v);
            if(qr){
              if(qr===lastQr)stableReads+=1;else{lastQr=qr;stableReads=1;}
              if(stableReads>=2){identify(qr).catch(fail);return;}
            }else{lastQr='';stableReads=0;}
          }
        }catch(error){stopCamera();close('cameraDialog');fail(error);return;}
        finally{detecting=false;}
        if(scanning)setTimeout(tick,180);
      };
      tick();
    }catch(error){stopCamera();throw new Error(error.name==='NotAllowedError'?'Permita o acesso à câmera ou use uma foto do QR Code.':error.message);}
  }  function addText(parent,tag,text){const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;}
  function normalizedEmail(value){return String(value || '').trim().toLowerCase();}
  function signatureState(responsible,signature){
    const signer=normalizedEmail(signature && signature.email), expected=normalizedEmail(responsible && responsible.email);
    if(!signer)return 'pending';
    return expected && signer===expected ? 'responsible' : 'other';
  }
  function signatureLabel(state,signature){if(signature?.incomplete)return 'Assinado sem concluir';return state==='responsible'?'Concluído pelo responsável':state==='other'?'Concluído por outro autorizado':'Checagem final pendente';}
  function appendEmail(parent,label,email,className){
    if(label)addText(parent,'span',label).className='email-label';
    return addText(parent,'p',email || 'E-mail não disponível.').className=className;
  }
  function appendSignaturePerson(parent,label,email,className){
    const button=document.createElement('button');
    button.type='button';button.disabled=true;button.className='signature-person '+className;
    button.textContent=label ? `${label}: ${email || 'E-mail não disponível.'}` : (email || 'E-mail não disponível.');
    parent.append(button);return button;
  }
  function canDirectRecord(){return Services.permission("checklistDirect");}  function closeIncompleteSignatureBanner(){const banner=$('incompleteSignatureBanner');if(!banner)return;banner.hidden=true;$('incompleteJustification').value='';$('incompleteJustification').readOnly=false;$('confirmIncompleteSignature').hidden=false;$('cancelIncompleteSignature').textContent='Cancelar';}
  function openIncompleteSignatureBanner(signature){const banner=$('incompleteSignatureBanner');if(!banner)return;const signed=!!signature?.incomplete;$('incompleteSignatureTitle').textContent=signed?'Assinatura sem concluir':'Motivo da assinatura sem concluir';$('incompleteSignaturePrompt').textContent=signed?'Justificativa registrada para esta assinatura:':'Registre o motivo de não concluir todos os checklists antes de assinar.';$('incompleteJustification').value=signed?String(signature.justification || ''):'';$('incompleteJustification').readOnly=signed;$('confirmIncompleteSignature').hidden=signed;$('cancelIncompleteSignature').textContent=signed?'Fechar':'Cancelar';$('confirmIncompleteSignature').textContent='Assinar';banner.hidden=false;if(!signed){$('declaration').checked=true;requestAnimationFrame(()=>$('incompleteJustification').focus());}}
  function closeCompleteSignatureBanner(){const banner=$('completeSignatureBanner');if(!banner)return;banner.hidden=true;$('completeSignatureJustification').value='';$('completeSignatureJustification').hidden=true;$('confirmCompleteSignature').disabled=false;}
  function openCompleteSignatureBanner(){if(!report||!report.canSign||report.signature)return;const banner=$('completeSignatureBanner');if(!banner)return;const responsible=normalizedEmail(report.responsible?.email),signedBy=normalizedEmail(session?.email);const other=!!responsible&&responsible!==signedBy;$('completeSignaturePrompt').textContent=other?'O responsável do dia não está assinando. Informe a justificativa para esta assinatura por outro autorizado.':'Declaro que acompanhei os checklists e tomei as providências necessárias em caso de riscos do Arsenal tecnológico/estrutural da Anestesiologia.';$('completeSignatureJustification').hidden=!other;$('completeSignatureJustification').required=other;$('completeSignatureJustification').value='';$('confirmCompleteSignature').textContent='Assinar';banner.hidden=false;if(other)requestAnimationFrame(()=>$('completeSignatureJustification').focus());}
  function renderReport(data){
    data=window.SAHMT_CHECKLIST_CONTRACT(data,'report');
    if(!data.responsible && report && report.day===data.day)data.responsible=report.responsible;
    report=data;const orderedItems=[...data.items].sort((a,b)=>Number(isInactiveMaintenance(a,data.day))-Number(isInactiveMaintenance(b,data.day)) || numericUnitId(a)-numericUnitId(b));const activeItems=orderedItems.filter(item=>!isMaintenance(item));const done=activeItems.filter(item=>item.record).length;const isToday=data.day===dateKey();const state=signatureState(data.responsible,data.signature);
    $('responsible').replaceChildren();addText($('responsible'),'strong','RESPONSÁVEL DO DIA');
    const responsibleEmail=data.responsible && data.responsible.email;
    appendSignaturePerson($('responsible'),'Responsável',
      responsibleEmail || (data.responsible && data.responsible.reason) || 'Responsável indisponível.',
      'responsible-email signature-' + state);
    if(data.signature){appendSignaturePerson($('responsible'),'Assinou',data.signature.email,'signer-email signature-signed');addText($('responsible'),'span',new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(data.signature.at)).replace(',','')).className='signature-date';}
    $('responsible').className='signature responsible-compact signature-' + state;
    $('equipmentList').replaceChildren();
    if(!data.items.length)addText($('equipmentList'),'p','A relação de unidades ainda não foi cadastrada.');
    orderedItems.forEach(item=>{const maintenance=isInactiveMaintenance(item,data.day);const itemRecord=displayRecord(item);const state=maintenance?'MANUTENCAO':itemRecord?(itemRecord.condition==='SIM'?'SIM':'NAO'):'PENDENTE';const card=document.createElement('article');card.className='equipment '+state;const button=document.createElement('button');button.type='button';button.className='arsenal-icon sigla-button '+state;button.dataset.unitId=item.id;button.setAttribute('aria-label',item.name+', '+(maintenance?'Inativo':itemRecord?(itemRecord.condition==='SIM'?'Realizado':'Não apto'):'Não Realizado'));const badge=document.createElement('span');badge.className='arsenal-number';badge.textContent=item.id.replace(/^.*?(\d+)$/,'$1');button.append(badge);if(maintenance){const meta=document.createElement('span');meta.className='arsenal-status-meta';meta.textContent='(Inativo)';button.append(meta);}else if(itemRecord){const meta=document.createElement('span');meta.className='arsenal-status-meta';meta.textContent=itemRecord.email || 'E-mail não disponível';button.append(meta);}button.onclick=()=>{if(canDirectRecord()){openArsenalActionBanner(item);}else if(maintenance){showMaintenance(item);}else if(item.record?.condition==='NAO'){showRecordedIssue(item);}else if(!item.record){showStatus(item,state);}};card.append(button);const banner=document.createElement('section');banner.className='status-banner '+state;banner.hidden=true;card.append(banner);if(itemRecord){const audit=document.createElement('span');audit.className='sr-only';audit.textContent=itemRecord.email;card.append(audit);}$('equipmentList').append(card);});
    $('signatureStatus').replaceChildren();
    const mode=data.signature?(data.signature.incomplete?'signed-incomplete':'signed-complete'):!isToday?'history':data.staleSignature?'stale':!data.canSign?'locked':'ready';
  const statusText=data.signature?'':mode==='history'?'Histórico do dia — somente consulta.':mode==='stale'?'O checklist mudou após a assinatura. É necessária uma nova assinatura.':mode==='locked'?'Assinatura indisponível para esta conta.':'';
    const statusWrap=document.createElement('div');statusWrap.className='signature-status-wrap';
    if(statusText)addText(statusWrap,'p',statusText).className='signature signature-'+state;
    const incompletePending=mode==='ready';
    if(data.signature){const resultButton=addText(statusWrap,'button',data.signature.incomplete?'Assinado sem concluir':'Assinado após concluído');resultButton.type='button';resultButton.disabled=true;resultButton.className='signature-result-button '+(data.signature.incomplete?'incomplete':'complete');if(data.signature.incomplete){const justification=document.createElement('section');justification.className='incomplete-justification-display';addText(justification,'strong','JUSTIFICATIVA');addText(justification,'p',String(data.signature.justification || 'Justificativa não informada.'));statusWrap.append(justification);}}
    else if(incompletePending){const incompleteButton=addText(statusWrap,'button','Assinar sem concluir');incompleteButton.type='button';incompleteButton.className='sign-incomplete-button';incompleteButton.disabled=!data.canSign;incompleteButton.setAttribute('aria-label','Assinar relatório sem concluir todos os checklists');incompleteButton.onclick=()=>openIncompleteSignatureBanner(data.signature);}
    $('reportSignActions').className='report-sign-actions mode-'+mode;
    $('signatureStatus').append(statusWrap);
    $('signForm').hidden=mode!=='ready';$('declaration').checked=false;
    $('sign').disabled=!!data.signature || !isToday || !data.canSign || !done || done!==activeItems.length;
    closeIncompleteSignatureBanner();closeCompleteSignatureBanner();
  }
  function closeArsenalBanners(){document.querySelectorAll('.equipment').forEach(node=>node.classList.remove('has-open-status'));document.querySelectorAll('.equipment .status-banner').forEach(node=>{node.hidden=true;});}
  function directCheckButton(item){if(!canDirectRecord())return null;const action=document.createElement('button');action.type='button';action.className='status-check-button';action.setAttribute('aria-label',`Checar ${item.name} sem ler o QR Code`);action.textContent='Checar';action.onclick=()=>openRecordForUnit(item,{direct:true});return action;}
  function fitStatusBanner(card,banner){const button=card?.querySelector('[data-unit-id]');if(!button)return;const rect=button.getBoundingClientRect();banner.style.setProperty('--status-banner-width',`${Math.max(1,Math.round(rect.width))}px`);banner.style.setProperty('--status-banner-height',`${Math.max(1,Math.round(rect.height))}px`);}
  function showStatus(item,state){if(!canDirectRecord()||displayRecord(item))return;const card=[...$('equipmentList').children].find(node=>node.querySelector('[data-unit-id]')?.dataset.unitId===item.id);const banner=card?.querySelector('.status-banner');if(!banner)return;if(!banner.hidden){closeArsenalBanners();return;}closeArsenalBanners();banner.replaceChildren();addText(banner,'strong','Não Realizado');const check=directCheckButton(item);if(check)banner.append(check);fitStatusBanner(card,banner);card.classList.add('has-open-status');banner.hidden=false;}
  function showRecordedIssue(item){const card=[...$('equipmentList').children].find(node=>node.querySelector('[data-unit-id]')?.dataset.unitId===item.id);const banner=card?.querySelector('.status-banner');if(!banner)return;if(!banner.hidden){closeArsenalBanners();return;}closeArsenalBanners();banner.replaceChildren();addText(banner,'strong','Não apto');addText(banner,'p',item.record?.occurrence || 'Nenhuma anotação informada.');fitStatusBanner(card,banner);card.classList.add('has-open-status');banner.hidden=false;}
  function showMaintenance(item){if(!canDirectRecord())return;const card=[...$('equipmentList').children].find(node=>node.querySelector('[data-unit-id]')?.dataset.unitId===item.id);const banner=card?.querySelector('.status-banner');if(!banner)return;if(!banner.hidden){closeArsenalBanners();return;}closeArsenalBanners();banner.replaceChildren();addText(banner,'strong','Inativo');const activate=document.createElement('button');activate.type='button';activate.className='status-check-button';activate.textContent='Ativar';activate.setAttribute('aria-label',`Ativar ${item.name}`);activate.onclick=()=>{syncMaintenanceDay(report?.day || dateKey()).add(unitKey(item));closeArsenalBanners();if(report)renderReport(report);};banner.append(activate);fitStatusBanner(card,banner);card.classList.add('has-open-status');banner.hidden=false;}
  function openReportDialog(){closeArsenalActionBanner();const dialog=$('reportDialog');const title=dialog?.querySelector('.report-title h2');if(title)title.textContent='RELATÓRIO DIÁRIO - CHECKLIST';dialog.showModal();dialog.focus({preventScroll:true});}
  let reportRequest = 0;
  async function loadReport(){
    const day=$('reportDate').value;
    if(!isIsoDay(day)){$('reportDate').value=lastValidReportDay || dateKey();return;}
    const request=++reportRequest;lastValidReportDay=day;$('sign').disabled=true;startReportSync();
    // Never display a previous day's signature as if it belonged to the selected day.
    report=null;$('equipmentList').replaceChildren();$('responsible').replaceChildren();$('signatureStatus').replaceChildren();
    try{
      const data=await api('report',{day});
      if(request!==reportRequest)return;
      renderReport(data);pendingSignature=null;finishReportSync();
    }catch(error){if(request!==reportRequest)return;$('sign').disabled=true;failReportSync();throw error;}
  }
  async function loadMonthly(){
    const month=$('reportMonth').value;if(!month)return;$('monthlyDays').replaceChildren();$('monthlySummary').textContent='Consultando o mês…';
    try{const data=await api('monthly',{month});$('monthlySummary').textContent=data.days.filter(d=>d.status==='checked').length+' dias com checagem final assinada.';
      for(const day of data.days){
        const state=day.status==='future'||day.status==='notApplicable'?'pending':signatureState(day.responsible,day.signature);
        const card=document.createElement('article');card.className='monthly-day '+day.status+' signature-'+state;card.setAttribute('role','row');
        addText(card,'h3',day.day.split('-').reverse().join('/')).className='monthly-date';
        const people=document.createElement('div');people.className='monthly-people';
        const responsibleBox=document.createElement('div');responsibleBox.className='monthly-person';
        appendEmail(responsibleBox,'RESPONSÁVEL DO DIA',(day.responsible && day.responsible.email) || (day.responsible && day.responsible.reason) || 'Referência de e-mail pendente.','responsible-email signature-'+state);
        people.append(responsibleBox);
        if(day.signature && state==='other'){const signerBox=document.createElement('div');signerBox.className='monthly-person';appendEmail(signerBox,'ASSINADO POR',day.signature.email,'signer-email signature-signed');people.append(signerBox);}
        card.append(people);
        addText(card,'p',day.status==='future'?'Dia futuro':day.status==='notApplicable'?'Sem checklists previstos':day.staleSignature?'Alterado após assinatura. Nova checagem necessária.':signatureLabel(state,day.signature)).className='monthly-status';
        if(day.status!=='future'&&day.status!=='notApplicable'){const button=addText(card,'button','Abrir relatório diário');button.type='button';button.onclick=()=>run(async()=>{$('reportDate').value=day.day;await loadReport();close('monthlyDialog');openReportDialog();});card.append(button);}
        $('monthlyDays').append(card);
      }
    }catch(error){$('monthlySummary').textContent='Não foi possível carregar o mês.';throw error;}
  }
  async function run(action){if(busy)return;busy=true;try{await action();}catch(error){fail(error);}finally{busy=false;}}
  $('arsenalActionClose').onclick=()=>closeArsenalActionBanner();
  $('arsenalActionCheck').onclick=()=>{closeArsenalActionBanner();openRecordForUnit(current,{direct:true});};
  $('arsenalActionRelease').onclick=()=>{if(!current)return;const day=report?.day||dateKey();syncMaintenanceDay(day);manualMaintenance.delete(unitKey(current));if(isMaintenance(current))activatedMaintenance.add(unitKey(current));closeArsenalActionBanner();if(report)renderReport(report);};
  $('arsenalActionInactivate').onclick=()=>{if(!current)return;const day=report?.day||dateKey();syncMaintenanceDay(day);manualMaintenance.add(unitKey(current));activatedMaintenance.delete(unitKey(current));closeArsenalActionBanner();if(report)renderReport(report);};
  $('arsenalActionReset').onclick=()=>{if(!current)return;const day=report?.day||dateKey();syncMaintenanceDay(day);manualMaintenance.delete(unitKey(current));activatedMaintenance.delete(unitKey(current));resetRecords.add(unitKey(current));closeArsenalActionBanner();if(report)renderReport(report);};
  $('scanSymbol').onclick=()=>run(startCamera);
  $('photo').onchange=()=>run(async()=>{const file=$('photo').files[0];if(!file)return;try{const bitmap=await createImageBitmap(file);let qr;try{qr=decode(bitmap,bitmap.width,bitmap.height);}finally{bitmap.close();}if(!qr)throw new Error('QR Code não identificado. Fotografe de frente, com boa iluminação.');await identify(qr);}finally{$('photo').value='';}});
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>close(button.dataset.close));
  $('cameraDialog').addEventListener('cancel',stopCamera);document.addEventListener('visibilitychange',()=>{if(document.hidden){stopCamera();close('cameraDialog');}});
  async function saveRecord(){
    const condition=$('recordForm').elements.condition.value;const occurrence=condition==='NAO'?$('occurrence').value.trim():'';
    if(condition==='NAO'&&!occurrence)throw new Error('Descreva a ocorrência antes de salvar.');
    if(!['SIM','NAO'].includes(condition))throw new Error('Selecione SIM ou NÃO.');
    pendingRecord ||= crypto.randomUUID();const button=$('recordForm').querySelector('[type=submit]');button.disabled=true;
    try{const requestId=pendingRecord;await api('record',{unitId:current.id,condition,occurrence,requestId,direct:pendingRecordMode==='direct'});const day=dateKey();patchCachedReport(day,{unitId:current.id,id:requestId,at:new Date().toISOString(),condition,occurrence,email:session.email,name:session.name || ''});pendingRecord=null;pendingRecordMode='qr';close('recordDialog');$('reportDate').value=day;openReportDialog();await loadReport();notice('Checklist registrado na planilha com sucesso.');}finally{button.disabled=false;}
  }
  $('recordForm').onchange=()=>{const no=$('recordForm').elements.condition.value==='NAO';$('occurrenceLabel').hidden=!no;$('occurrence').required=no;$('recordForm').querySelector('[type=submit]').hidden=!no;pendingRecord=null;if(!no)run(saveRecord);};
  $('recordForm').onsubmit=event=>{event.preventDefault();if($('recordForm').elements.condition.value==='NAO')run(saveRecord);};  $('report').onclick=()=>run(async()=>{const today=dateKey();lastValidReportDay=today;$('reportDate').value=today;openReportDialog();await loadReport();});
  $('previousReportDay').onclick=()=>run(async()=>{const currentDay=isIsoDay($('reportDate').value)?$('reportDate').value:lastValidReportDay || dateKey();const previous=shiftDay(currentDay,-1);lastValidReportDay=previous;$('reportDate').value=previous;await loadReport();});$('nextReportDay').onclick=()=>run(async()=>{const currentDay=isIsoDay($('reportDate').value)?$('reportDate').value:lastValidReportDay || dateKey();const next=shiftDay(currentDay,1);lastValidReportDay=next;$('reportDate').value=next;await loadReport();});
  $('todayReportDay').onclick=()=>run(async()=>{const today=dateKey();lastValidReportDay=today;$('reportDate').value=today;await loadReport();});
  $('reportDate').oninput=()=>{};
  $('reportDate').onchange=()=>{const selected=$('reportDate').value;if(!isIsoDay(selected)){$('reportDate').value=lastValidReportDay || dateKey();return;}lastValidReportDay=selected;run(async()=>{$('sign').disabled=true;await loadReport();});};
  lastValidReportDay=dateKey();$('reportDate').value=lastValidReportDay;
  if($('monthly'))$('monthly').onclick=()=>run(async()=>{$('reportMonth').value=dateKey().slice(0,7);$('monthlyDialog').showModal();await loadMonthly();});
  $('reportMonth').onchange=()=>run(loadMonthly);
  $('sign').onclick=event=>{event.preventDefault();if(!report || !report.canSign || report.signature || $('sign').disabled)return;openCompleteSignatureBanner();};
  $('signForm').onsubmit=event=>{event.preventDefault();if(!report || $('sign').disabled)return;openCompleteSignatureBanner();};
  $('cancelCompleteSignature').onclick=()=>closeCompleteSignatureBanner();
  $('confirmCompleteSignature').onclick=()=>run(async()=>{if(!report||!report.canSign||report.signature)return;const responsible=normalizedEmail(report.responsible?.email),signedBy=normalizedEmail(session?.email),other=!!responsible&&responsible!==signedBy,justification=$('completeSignatureJustification').value.trim();if(other&&!justification)throw new Error('Informe a justificativa desta assinatura.');pendingSignature ||= crypto.randomUUID();const button=$('confirmCompleteSignature');button.disabled=true;try{const result=await api('sign',{day:report.day,revision:report.revision,accepted:true,justification,requestId:pendingSignature});rememberReport(result);renderReport(result);pendingSignature=null;notice('Relatório diário assinado e registrado na planilha.');}catch(error){await loadReport().catch(()=>{});throw error;}finally{button.disabled=false;}});
  $('cancelIncompleteSignature').onclick=()=>closeIncompleteSignatureBanner();
  $('confirmIncompleteSignature').onclick=()=>run(async()=>{
    const justification=$('incompleteJustification').value.trim();
    if(!justification)throw new Error('Informe o motivo da assinatura sem concluir.');
    if(!report || !report.canSign || report.signature)return;
    $('declaration').checked=true;pendingSignature ||= crypto.randomUUID();const button=$('confirmIncompleteSignature');button.disabled=true;
    try{const result=await api('sign',{day:report.day,revision:report.revision,accepted:true,signWithoutComplete:true,justification,requestId:pendingSignature});rememberReport(result);renderReport(result);pendingSignature=null;notice('Relatório assinado com justificativa e registrado na planilha.');}catch(error){await loadReport().catch(()=>{});throw error;}finally{button.disabled=false;}
  });  $('return').onclick=()=>{stopCamera();if(window.SAHMT_SHELL){window.SAHMT_SHELL.navigate(new URL('index.html',window.SAHMT_SHELL.base));return;}if(window.parent!==window){window.parent.postMessage({type:'sahmt-checklist-close'},cfg.parentOrigin);}else{location.href=cfg.parentOrigin+cfg.parentPath+'?skipNotice=1';}};
  function receiveSession(value){
    session=value;const slot=document.querySelector('[data-auth-user]');
    if(slot){slot.textContent=value?.email||'';slot.hidden=!value?.email;slot.dataset.authenticated=String(value?.authenticated===true);}
    const enabled=value?.authenticated===true&&!!cfg.apiUrl;
    for(const id of ['scanSymbol','photo','report','monthly'])if($(id))$(id).disabled=!enabled;
  }
  window.addEventListener('message',event=>{if(event.origin!==cfg.parentOrigin || event.source!==window.parent || event.data?.type!=='sahmt-checklist-session')return;receiveSession(event.data.session);});
  if($('today'))$('today').textContent=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date());
  lastValidReportDay=dateKey();$('reportDate').value=lastValidReportDay;
  ['reportDialog','monthlyDialog','recordDialog','cameraDialog'].forEach(id=>{const dialog=$(id);if(dialog?.open)dialog.close();dialog?.removeAttribute('open');});
  receiveSession(window.SAHMT_AUTH?.getSession());
  window.SAHMT_AUTH?.onChange(receiveSession);
  document.addEventListener('sahmt:hide',stopCamera);
  document.addEventListener('sahmt:show',()=>{
    const today = dateKey();
    lastValidReportDay = today;
    report = null;
    syncMaintenanceDay(today);
    $('reportDate').value = today;
    if ($('reportMonth')) $('reportMonth').value = today.slice(0, 7);
    ['reportDialog','monthlyDialog','recordDialog','cameraDialog'].forEach(id=>{
      const dialog=$(id);
      if(dialog?.open) dialog.close();
      dialog?.removeAttribute('open');
    });
    stopCamera();
  });
  if(window.parent!==window)window.parent.postMessage({type:'sahmt-checklist-ready'},cfg.parentOrigin);
  if(!cfg.apiUrl)notice('Cadastro das unidades e conexão com a planilha em configuração.');
  else if(!session)notice('Abra este checklist pelo app principal SAHMT-BH.');
  ;
})();

}
