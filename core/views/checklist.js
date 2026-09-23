export async function mount(ctx){
const {Services,localStorage,sessionStorage,document,window,navigator,location,history,fetch,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame}=ctx;
window.SAHMT_CHECKLIST_CONTRACT=(await import('../checklist-contract.js')).checklistResponse;
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const cfg = {apiUrl:Services.configured?"central-service":"",parentOrigin:window.location.origin,parentPath:"/"};
  let session = null, stream = null, scanning = false, cameraDetector = null, current = null, report = null, prefetchStartedDay = '', prefetchStartedMonth = '', lastValidReportDay = '';
  const reportCache = new Map(), pendingReads = new Map(), CHECKLIST_REPORT_CACHE_MS = 90000;
  const MAINTENANCE_UNITS = new Set(['100170006','100170009']);
  const DIRECT_RECORD_USERS = new Set();
  let activatedMaintenance = new Set(), activatedMaintenanceDay = '', manualMaintenance = new Set(), resetRecords = new Set();
  const unitKey = item => String(item?.id ?? '').replace(/\D/g, '');
  const isMaintenance = item => item?.inactive===true || (item?.inactive==null && MAINTENANCE_UNITS.has(unitKey(item)));
  function syncMaintenanceDay(day = dateKey()) {
    if (activatedMaintenanceDay !== day) { activatedMaintenanceDay = day; activatedMaintenance = new Set(); manualMaintenance = new Set(); resetRecords = new Set(); }
    return activatedMaintenance;
  }
  const isInactiveMaintenance = (item, day = dateKey()) => (manualMaintenance.has(unitKey(item)) || (isMaintenance(item) && !item.record && !(day === activatedMaintenanceDay && activatedMaintenance.has(unitKey(item)))));
  const numericUnitId = item => Number(unitKey(item)) || Number.MAX_SAFE_INTEGER;
  const isIsoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  let pendingRecord = null, pendingRecordMode = 'qr', pendingSignature = null, pendingSignatures = new Map(), busy = false, reportSyncTimer = null, reportSyncStartedAt = 0, reportSyncPending = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  const dateKey = () => {const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`;};
  const notice = message => {
    $('message').textContent = message;
    $('message').dataset.state = /identificando unidade/i.test(message) ? 'identifying' : message ? 'notice' : '';
    document.querySelectorAll('.dialog-message').forEach(node=>node.remove());
    document.querySelectorAll('.dialog-message').forEach(node=>node.remove());
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
  const SIGNATURE_REASONS=['A pedido','Tempo limite excedido'];
  function selectedSignatureReason(groupId){return $(groupId)?.dataset.selectedReason || '';}
  function setSignatureReason(groupId,reason=''){const group=$(groupId);if(!group)return;group.dataset.selectedReason=SIGNATURE_REASONS.includes(reason)?reason:'';group.querySelectorAll('[data-signature-reason]').forEach(button=>{const active=button.dataset.signatureReason===group.dataset.selectedReason;button.setAttribute('aria-pressed',String(active));button.disabled=group.dataset.signed==='true';});}
  function signatureReason(signature){if(SIGNATURE_REASONS.includes(signature?.reason))return signature.reason;const raw=String(signature?.justification || '');return SIGNATURE_REASONS.find(reason=>raw===reason||raw.startsWith(reason+' —')||raw.startsWith(reason+' -')) || '';}
  function signatureDescription(signature){const raw=String(signature?.description || signature?.justification || ''),reason=signatureReason(signature);if(!reason)return raw;for(const separator of [' — ',' - '])if(raw.startsWith(reason+separator))return raw.slice((reason+separator).length);return raw;}
  function composeSignatureJustification(reason,description=''){return description?reason+' — '+description:reason;}
  function rememberPendingSignature(day,signature){if(day&&signature?.email)pendingSignatures.set(String(day),{...signature});}
  function mergePendingSignature(data){
    const day=String(data?.day||''),pending=pendingSignatures.get(day);if(!pending)return data;
    if(data.signature){pendingSignatures.delete(day);return data;}
    return {...data,signature:pending,canSign:false,staleSignature:false,revision:''};
  }
  function rememberReport(data){const merged=mergePendingSignature(data);if(merged?.day)reportCache.set(requestKey('report',{day:merged.day}),{at:Date.now(),data:merged});return merged;}
  function patchCachedReport(day,record){
    const key=requestKey('report',{day});const cached=reportCache.get(key);if(!cached?.data?.items)return;
    const data=JSON.parse(JSON.stringify(cached.data));const item=data.items.find(entry=>String(entry.id)===String(record.unitId));if(!item)return;
    item.record={id:record.id,at:record.at,condition:record.condition,occurrence:record.occurrence,email:record.email,name:record.name};data.signature=null;data.staleSignature=true;data.revision='';reportCache.set(key,{at:Date.now(),data});
  }
  function applyOptimisticRecord(day,record){
    patchCachedReport(day,record);
    if(report?.day!==day||!Array.isArray(report.items))return;
    const item=report.items.find(entry=>String(entry.id)===String(record.unitId));if(!item)return;
    item.record={id:record.id,at:record.at,condition:record.condition,occurrence:record.occurrence,email:record.email,name:record.name};
    resetRecords.delete(unitKey(item));report.signature=null;report.staleSignature=true;report.revision='';
  }
  async function syncRecordInBackground(payload,day){
    try{await api('record',payload);await refreshReport(day);}
    catch(error){await refreshReport(day);notice('O registro foi enviado, mas a confirmação demorou. Atualize o relatório antes de assinar.');}
  }
  function applyOptimisticSignature(day,signature){
    if(report?.day!==day)return;
    rememberPendingSignature(day,signature);report.signature=signature;report.canSign=false;report.staleSignature=false;report.revision='';
  }
  async function syncSignatureInBackground(payload,day){
    try{const result=await api('sign',payload);rememberReport(result);await refreshReport(day);}
    catch(error){pendingSignatures.delete(String(day));await refreshReport(day);if(report?.day===day)notice('A assinatura foi iniciada, mas a confirmação demorou. Atualize o relatório antes de assinar novamente.');}
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
  async function api(action,payload={},options={}){await authPayload();const result=window.SAHMT_CHECKLIST_CONTRACT(await Services.checklist(action,payload,options),action,payload);return action==="report"?rememberReport(result):result;}
  function stopCamera(){scanning=false;stream?.getTracks().forEach(track=>track.stop());stream=null;$('video').srcObject=null;}
  function close(id){if(id==='cameraDialog')stopCamera();$(id).close();}
  function fail(error){ notice(error.message || 'Não foi possível concluir.'); }
  const displayRecord = item => resetRecords.has(unitKey(item)) ? null : item?.record;
  const redArsenalOrder = new Map([['14',0],['03',1],['10',2],['30',3],['05',4],['15',5]]);
  const finalArsenalOrder = new Map([['14',0],['03',1],['10',2],['30',3],['05',4],['15',5],['04',6],['06',7],['09',8],['11',9],['22',10]]);
  const redArsenalInfo = new Map([['14','Bloco2 sl.1'],['03','Bloco2 sl.2'],['10','Endoscopia'],['30','Hemod sl.1'],['05','Hemod sl.2'],['15','Ressonância']]);
  function reportItemGroup(item,day){const record=displayRecord(item);if(isInactiveMaintenance(item,day))return 2;if(record?.condition==='SIM')return 0;return 1;}
  function sortReportItems(a,b,day){const suffixA=unitKey(a).slice(-2),suffixB=unitKey(b).slice(-2),finalA=finalArsenalOrder.has(suffixA),finalB=finalArsenalOrder.has(suffixB);if(finalA!==finalB)return finalA?1:-1;if(finalA&&finalB){const orderA=finalArsenalOrder.get(suffixA),orderB=finalArsenalOrder.get(suffixB);if(orderA!==orderB)return orderA-orderB;return numericUnitId(a)-numericUnitId(b);}const groupA=reportItemGroup(a,day),groupB=reportItemGroup(b,day);if(groupA!==groupB)return groupA-groupB;return numericUnitId(a)-numericUnitId(b);}
  function checklistLockedForCurrentUser(){return !!(report?.lockedAfterSignature||report?.signature||report?.staleSignature)&&!canDirectRecord();}
  function activeArsenal(){const dialog=$('arsenalActionDialog'),key=dialog?.dataset.unitId||unitKey(current);const item=report?.items?.find(entry=>unitKey(entry)===key)||current;if(item)current=item;return item;}
  function arsenalActionStatus(item){
    const key=unitKey(item),day=report?.day||dateKey();syncMaintenanceDay(day);
    const record=displayRecord(item);
    if(manualMaintenance.has(key)||(isMaintenance(item)&&!record&&!activatedMaintenance.has(key)))return {label:'Inativo',className:'status-inactive'};
    if(activatedMaintenance.has(key))return {label:'Liberado',className:'status-released'};
    if(record?.condition==='NAO')return {label:'Alerta de manutenção',detail:String(record.occurrence||'Justificativa não informada.'),className:'status-maintenance'};
    if(record?.condition==='SIM')return {label:'Liberado',className:'status-released'};
    return {label:'Não checado',className:'status-pending'};
  }
  function closeArsenalActionBanner(){const dialog=$('arsenalActionDialog');if(!dialog)return;if(dialog.open)dialog.close();dialog.hidden=true;dialog.dataset.unitId='';}
  function openArsenalActionBanner(item){if(!canDirectRecord()||!item)return;const dialog=$('arsenalActionDialog');if(!dialog)return;current=item;dialog.dataset.unitId=unitKey(item);$('arsenalActionTitle').textContent=unitKey(item)||String(item.id||'');const status=arsenalActionStatus(item),statusNode=$('arsenalActionStatus');if(statusNode){statusNode.replaceChildren();const stateLine=document.createElement('strong');stateLine.textContent=status.label;statusNode.append(stateLine);if(status.detail){const detailLine=document.createElement('span');detailLine.className='arsenal-action-maintenance-detail';detailLine.textContent=status.detail;statusNode.append(detailLine);}statusNode.className='arsenal-action-status '+status.className;}dialog.hidden=false;dialog.showModal();dialog.focus({preventScroll:true});}
  async function openRecordForUnit(unit,{direct=false}={}){
    if(!canDirectRecord()&&(!report||report.day!==dateKey()))report=rememberReport(await api('report',{day:dateKey()}));
    if(checklistLockedForCurrentUser()){notice('O checklist já foi assinado. Novas ações estão reservadas aos usuários autorizados.');return;}
    stopCamera();close('cameraDialog');current=unit;if(direct)resetRecords.delete(unitKey(current));if(isMaintenance(current))syncMaintenanceDay(dateKey()).add(unitKey(current));pendingRecord=null;pendingRecordMode=direct?'direct':'qr';
    $('recordForm').reset();const conditionFieldset=$('conditionFieldset'),submitButton=$('recordForm').querySelector('[type=submit]');conditionFieldset.hidden=false;document.querySelectorAll('[data-condition-choice]').forEach(button=>button.classList.remove('selected'));submitButton.textContent='Salvar registro';submitButton.hidden=true;$('occurrenceLabel').hidden=true;$('occurrence').required=false;
    $('unitName').textContent=current.name;notice('');$('recordDialog').showModal();
  }
  async function identify(raw){
    stopCamera();close('cameraDialog');notice('Identificando unidade…');
    const data=await api('resolve',{qr:String(raw)});await openRecordForUnit(data.unit);
  }  function cameraCrop(width,height){
    const side=Math.max(160,Math.floor(Math.min(width,height)*0.68));
    return {sx:Math.max(0,Math.floor((width-side)/2)),sy:Math.max(0,Math.floor((height-side)/2)),sw:Math.min(side,width),sh:Math.min(side,height)};
  }
  function decode(source,width,height,crop=false){
    const region=crop?cameraCrop(width,height):{sx:0,sy:0,sw:width,sh:height};
    const ratio=Math.min(1,900/Math.max(region.sw,region.sh));
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
      const nativeDetector=typeof BarcodeDetector!=='undefined';
      const detectInterval=nativeDetector?80:120;
      const requiredReads=nativeDetector?1:2;
      const tick=async()=>{
        if(!scanning||detecting)return;
        try{
          const v=$('video');
          if(v.readyState>=2&&v.videoWidth>0){
            detecting=true;
            const qr=await detectCameraFrame(v);
            if(qr){
              if(qr===lastQr)stableReads+=1;else{lastQr=qr;stableReads=1;}
              if(stableReads>=requiredReads){identify(qr).catch(fail);return;}
            }else{lastQr='';stableReads=0;}
          }
        }catch(error){stopCamera();close('cameraDialog');fail(error);return;}
        finally{detecting=false;}
        if(scanning)setTimeout(tick,detectInterval);
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
  function appendSignatureResult(parent,data,state){
    const panel=document.createElement('section');panel.className='signature-result-panel';
    const title=addText(panel,'strong',data.signature?.incomplete?'ASSINATURA SEM CONCLUIR':'ASSINATURA REGISTRADA');title.className='signature-result-title';
    const signer=normalizedEmail(data.signature?.email);
    appendSignaturePerson(panel,'Assinado por',signer || data.signature?.email,'signer-email signature-signed');
    const reason=signatureReason(data.signature);
    if(reason){const reasonLine=document.createElement('p');reasonLine.className='signature-result-line';reasonLine.innerHTML='<strong>Justificativa escolhida:</strong> ';reasonLine.append(document.createTextNode(reason));panel.append(reasonLine);}
    if(data.signature.incomplete){const description=signatureDescription(data.signature),descriptionLine=document.createElement('p');descriptionLine.className='signature-result-line signature-description-line';descriptionLine.innerHTML='<strong>Motivo descrito:</strong> ';descriptionLine.append(document.createTextNode(description || 'Não informado.'));panel.append(descriptionLine);}
    const time=document.createElement('p');time.className='signature-result-time';time.textContent='Horário da assinatura: '+new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(data.signature.at)).replace(',','');panel.append(time);
    parent.append(panel);
  }
  function canDirectRecord(){return Services.permission("checklistDirect");}  function closeIncompleteSignatureBanner(){const banner=$('incompleteSignatureBanner');if(!banner)return;banner.hidden=true;$('incompleteJustification').value='';$('incompleteJustification').readOnly=false;$('confirmIncompleteSignature').hidden=true;$('confirmIncompleteSignature').disabled=false;$('cancelIncompleteSignature').textContent='Cancelar';setSignatureReason('incompleteSignatureReasonGroup');}
  function openIncompleteSignatureBanner(signature){const banner=$('incompleteSignatureBanner');if(!banner)return;const signed=!!signature?.incomplete,reason=signatureReason(signature),title=$('incompleteSignatureTitle'),prompt=$('incompleteSignaturePrompt'),label=banner.querySelector('label[for="incompleteJustification"]'),description=$('incompleteJustification'),group=$('incompleteSignatureReasonGroup'),reasonTitle=group?.querySelector('span'),options=group?.querySelector('.signature-reason-options');title?.remove();prompt?.remove();if(label&&description&&group){label.textContent='Descreva por que o checklist não foi concluído';label.after(description);description.after(group);}if(reasonTitle)reasonTitle.textContent='Justificativa de assinar para o Responsável';options?.querySelector('[data-signature-reason="Tempo limite excedido"]')?.replaceChildren(document.createTextNode('Tempo limite'));description.value=signed?signatureDescription(signature):'';description.readOnly=signed;$('confirmIncompleteSignature').hidden=true;$('confirmIncompleteSignature').disabled=false;$('cancelIncompleteSignature').textContent=signed?'Fechar':'Cancelar';group.dataset.signed=String(signed);setSignatureReason('incompleteSignatureReasonGroup',reason);banner.hidden=false;if(!signed){$('declaration').checked=true;requestAnimationFrame(()=>description.focus());}}
  function closeCompleteSignatureBanner(){const banner=$('completeSignatureBanner');if(!banner)return;banner.hidden=true;$('confirmCompleteSignature').disabled=false;$('confirmCompleteSignature').hidden=true;setSignatureReason('completeSignatureReasonGroup');}
  function openCompleteSignatureBanner(){if(!report||!report.canSign||report.signature)return;const banner=$('completeSignatureBanner');if(!banner)return;const responsible=normalizedEmail(report.responsible?.email),signedBy=normalizedEmail(session?.email),other=!!responsible&&responsible!==signedBy;$('completeSignaturePrompt').textContent=other?'O responsável do dia não está assinando. Selecione a justificativa desta assinatura.':'Declaro que acompanhei os checklists e tomei as providências necessárias em caso de riscos do Arsenal tecnológico/estrutural da Anestesiologia.';$('completeSignatureReasonGroup').hidden=false;setSignatureReason('completeSignatureReasonGroup');$('confirmCompleteSignature').hidden=true;banner.hidden=false;}
  function renderReport(data){
    document.querySelectorAll('.dialog-message').forEach(node=>node.remove());
    data=window.SAHMT_CHECKLIST_CONTRACT(data,'report');
    if(!data.responsible && report && report.day===data.day)data.responsible=report.responsible;
    report=data;const orderedItems=[...data.items].sort((a,b)=>sortReportItems(a,b,data.day));const activeItems=orderedItems.filter(item=>!isMaintenance(item));const done=activeItems.filter(item=>item.record).length;const isToday=data.day===dateKey();const state=signatureState(data.responsible,data.signature);
    $('responsible').hidden=!!data.signature;
    $('responsible').replaceChildren();addText($('responsible'),'strong','RESPONSÁVEL DO DIA');
    const responsibleEmail=data.responsible && data.responsible.email;
    appendSignaturePerson($('responsible'),'Responsável',
      responsibleEmail || (data.responsible && data.responsible.reason) || 'Responsável indisponível.',
      'responsible-email signature-' + state);
    $('responsible').className='signature responsible-compact signature-' + state;
    closeArsenalInfoBanner();$('equipmentList').replaceChildren();
    if(!data.items.length)addText($('equipmentList'),'p','A relação de unidades ainda não foi cadastrada.');
    closeRecheckPromptBanner();orderedItems.forEach(item=>{const maintenance=isInactiveMaintenance(item,data.day);const itemRecord=displayRecord(item),locked=!!(data.lockedAfterSignature||data.signature||data.staleSignature)&&!canDirectRecord();const state=maintenance?'MANUTENCAO':itemRecord?(itemRecord.condition==='SIM'?'SIM':'NAO'):'PENDENTE';const card=document.createElement('article');card.className='equipment '+state;const suffix=unitKey(item).slice(-2),specialLabel=redArsenalInfo.get(suffix);const button=document.createElement('button');button.type='button';button.className='arsenal-icon sigla-button '+state+(specialLabel?' arsenal-special-'+suffix:'');button.dataset.unitId=String(item.id ?? '');button.disabled=locked;button.setAttribute('aria-label',item.name+', '+(maintenance?'Inativo':itemRecord?(itemRecord.condition==='SIM'?'Realizado':'Não apto'):'Não Realizado')+(specialLabel?'. '+specialLabel:'')+(locked?'. Checklist assinado; novas ações apenas para usuários autorizados.':''));if(specialLabel){const label=document.createElement('span');label.className='arsenal-function-label';label.textContent=specialLabel;button.append(label);}const badge=document.createElement('span');badge.className='arsenal-number';badge.textContent=String(item.id ?? '').replace(/^.*?(\d+)$/,'$1');button.append(badge);if(maintenance){const meta=document.createElement('span');meta.className='arsenal-status-meta';meta.textContent='(Inativo)';button.append(meta);}else if(itemRecord){const meta=document.createElement('span');meta.className='arsenal-status-meta';meta.textContent=itemRecord.email || 'E-mail não disponível';button.append(meta);}button.onclick=()=>{if(checklistLockedForCurrentUser())return;if(canDirectRecord())openArsenalActionBanner(item);else if(itemRecord)openRecheckPromptBanner(item);else showArsenalInfo(item);};card.append(button);const banner=document.createElement('section');banner.className='status-banner '+state;banner.hidden=true;card.append(banner);if(itemRecord){const audit=document.createElement('span');audit.className='sr-only';audit.textContent=itemRecord.email;card.append(audit);}$('equipmentList').append(card);});
    $('signatureStatus').replaceChildren();
    const mode=data.signature?(data.signature.incomplete?'signed-incomplete':'signed-complete'):reportSyncPending?'cached':!isToday?'history':data.staleSignature?'stale':!data.canSign?'locked':'ready';
  const statusText=data.signature?'':mode==='cached'?'Mostrando dados recentes enquanto atualiza.':mode==='history'?'Histórico do dia — somente consulta.':mode==='stale'?'O checklist mudou após a assinatura. É necessária uma nova assinatura.':mode==='locked'?'Assinatura indisponível para esta conta.':'';
    const statusWrap=document.createElement('div');statusWrap.className='signature-status-wrap';
    if(statusText)addText(statusWrap,'p',statusText).className='signature signature-'+state;
    const incompletePending=mode==='ready';
    if(data.signature){appendSignatureResult(statusWrap,data,state);}
    else if(incompletePending){const incompleteButton=addText(statusWrap,'button','Assinar sem concluir');incompleteButton.type='button';incompleteButton.className='sign-incomplete-button';incompleteButton.disabled=!data.canSign||reportSyncPending;incompleteButton.setAttribute('aria-label','Assinar relatório sem concluir todos os checklists');incompleteButton.onclick=()=>openIncompleteSignatureBanner(data.signature);}
    $('reportSignActions').className='report-sign-actions mode-'+mode;
    $('signatureStatus').append(statusWrap);
    $('signForm').hidden=mode!=='ready';$('declaration').checked=false;
    $('sign').disabled=reportSyncPending||!!data.signature || (!!(data.lockedAfterSignature||data.staleSignature)&&!canDirectRecord()) || !isToday || !data.canSign || !done || done!==activeItems.length;
    closeIncompleteSignatureBanner();closeCompleteSignatureBanner();
  }
  function closeArsenalBanners(){document.querySelectorAll('.equipment').forEach(node=>node.classList.remove('has-open-status'));document.querySelectorAll('.equipment .status-banner').forEach(node=>{node.hidden=true;});}
  function closeArsenalInfoBanner(){const banner=$('arsenalInfoBanner');if(!banner)return;banner.hidden=true;banner.dataset.unitId='';banner.style.removeProperty('top');banner.style.removeProperty('left');banner.style.removeProperty('width');banner.style.removeProperty('height');$('arsenalInfoDetail').hidden=true;$('arsenalInfoDetail').textContent='';}
  function closeRecheckPromptBanner(){const banner=$('recheckPromptBanner');if(!banner)return;banner.hidden=true;banner.dataset.unitId='';}
  function openRecheckPromptBanner(item){if(!item||!report||checklistLockedForCurrentUser())return;let banner=$('recheckPromptBanner');if(!banner){banner=document.createElement('section');banner.id='recheckPromptBanner';banner.className='recheck-prompt-banner';banner.setAttribute('role','alertdialog');banner.setAttribute('aria-modal','true');banner.setAttribute('aria-labelledby','recheckPromptText');banner.hidden=true;const text=document.createElement('p');text.id='recheckPromptText';text.textContent='Este arsenal já foi checado! houve alteração?';const actions=document.createElement('div');actions.className='recheck-prompt-actions';const yes=document.createElement('button');yes.type='button';yes.className='primary-button';yes.textContent='Sim';yes.onclick=()=>{const unit=report?.items?.find(entry=>unitKey(entry)===banner.dataset.unitId);closeRecheckPromptBanner();if(!unit)return;openRecordForUnit(unit);if(!$('recordDialog').open)return;const no=$('recordForm').querySelector('input[name="condition"][value="NAO"]');if(no){no.checked=true;no.dispatchEvent(new Event('change',{bubbles:true}));$('occurrence').focus();}};const no=document.createElement('button');no.type='button';no.className='soft-button';no.textContent='Não';no.onclick=()=>closeRecheckPromptBanner();actions.append(yes,no);banner.append(text,actions);$('reportDialog').append(banner);}banner.dataset.unitId=unitKey(item);banner.hidden=false;banner.querySelector('button')?.focus({preventScroll:true});}
  function positionArsenalInfoBanner(){const banner=$('arsenalInfoBanner'),target=document.querySelector('.report-date-banner'),dialog=$('reportDialog');if(!banner||banner.hidden||!target||!dialog)return;const dialogRect=dialog.getBoundingClientRect(),targetRect=target.getBoundingClientRect(),inset=8;const dialogWidth=Math.round(dialog.clientWidth||dialogRect.width);banner.style.top=Math.max(0,Math.round(targetRect.top-dialogRect.top))+'px';banner.style.left=inset+'px';banner.style.width=Math.max(1,dialogWidth-(inset*2))+'px';banner.style.height=Math.max(1,Math.round(targetRect.height))+'px';}
  function showArsenalInfo(item){const banner=$('arsenalInfoBanner');if(!banner||!item)return;const key=unitKey(item);if(!banner.hidden&&banner.dataset.unitId===key){closeArsenalInfoBanner();return;}const status=arsenalActionStatus(item);$('arsenalInfoNumber').textContent=key||String(item.id||'Arsenal');const statusNode=$('arsenalInfoStatus');statusNode.textContent=status.label;statusNode.className='arsenal-info-status '+status.className;const detail=$('arsenalInfoDetail');detail.textContent=status.detail||'';detail.hidden=!status.detail;banner.className='arsenal-info-banner '+status.className;banner.dataset.unitId=key;banner.hidden=false;positionArsenalInfoBanner();}
  function directCheckButton(item){if(!canDirectRecord())return null;const action=document.createElement('button');action.type='button';action.className='status-check-button';action.setAttribute('aria-label',`Checar ${item.name} sem ler o QR Code`);action.textContent='Checar';action.onclick=()=>run(()=>openRecordForUnit(item,{direct:true}));return action;}
  function fitStatusBanner(card,banner){const button=card?.querySelector('[data-unit-id]');if(!button)return;const rect=button.getBoundingClientRect();banner.style.setProperty('--status-banner-width',`${Math.max(1,Math.round(rect.width))}px`);banner.style.setProperty('--status-banner-height',`${Math.max(1,Math.round(rect.height))}px`);}
  function showStatus(item,state){if(!canDirectRecord()||displayRecord(item))return;const card=[...$('equipmentList').children].find(node=>node.querySelector('[data-unit-id]')?.dataset.unitId===String(item.id ?? ''));const banner=card?.querySelector('.status-banner');if(!banner)return;if(!banner.hidden){closeArsenalBanners();return;}closeArsenalBanners();banner.replaceChildren();addText(banner,'strong','Não Realizado');const check=directCheckButton(item);if(check)banner.append(check);fitStatusBanner(card,banner);card.classList.add('has-open-status');banner.hidden=false;}
  function showRecordedIssue(item){const card=[...$('equipmentList').children].find(node=>node.querySelector('[data-unit-id]')?.dataset.unitId===String(item.id ?? ''));const banner=card?.querySelector('.status-banner');if(!banner)return;if(!banner.hidden){closeArsenalBanners();return;}closeArsenalBanners();banner.replaceChildren();addText(banner,'strong','Não apto');addText(banner,'p',item.record?.occurrence || 'Nenhuma anotação informada.');fitStatusBanner(card,banner);card.classList.add('has-open-status');banner.hidden=false;}
  function showMaintenance(item){if(!canDirectRecord())return;const card=[...$('equipmentList').children].find(node=>node.querySelector('[data-unit-id]')?.dataset.unitId===String(item.id ?? ''));const banner=card?.querySelector('.status-banner');if(!banner)return;if(!banner.hidden){closeArsenalBanners();return;}closeArsenalBanners();banner.replaceChildren();addText(banner,'strong','Inativo');const activate=document.createElement('button');activate.type='button';activate.className='status-check-button';activate.textContent='Ativar';activate.setAttribute('aria-label',`Ativar ${item.name}`);activate.onclick=()=>{syncMaintenanceDay(report?.day || dateKey()).add(unitKey(item));closeArsenalBanners();if(report)renderReport(report);};banner.append(activate);fitStatusBanner(card,banner);card.classList.add('has-open-status');banner.hidden=false;}
  function openReportDialog(){closeArsenalActionBanner();const dialog=$('reportDialog');const title=dialog?.querySelector('.report-title h2');if(title)title.textContent='RELATÓRIO DIÁRIO - CHECKLIST';dialog.showModal();dialog.focus({preventScroll:true});}
  let reportRequest = 0;
  async function loadReport(){
    const day=$('reportDate').value;
    if(!isIsoDay(day)){$('reportDate').value=lastValidReportDay || dateKey();return;}
    const request=++reportRequest,key=requestKey('report',{day}),serviceKey='checklist.report:'+JSON.stringify({day}),stored=Services.store.peek(serviceKey);
    const cached=reportCache.get(key)?.data||(stored?rememberReport(window.SAHMT_CHECKLIST_CONTRACT({ok:true,...stored},'report',{day})):null);
    lastValidReportDay=day;reportSyncPending=!!cached;startReportSync();
    if(cached){renderReport({...cached,canSign:false});}
    else{$('sign').disabled=true;report=null;$('equipmentList').replaceChildren();$('responsible').replaceChildren();$('signatureStatus').replaceChildren();}
    const refreshInBackground=async()=>{
      try{
        const alreadyRefreshing=Services.store.pending.has(serviceKey);
        const data=await api('report',{day},{force:!alreadyRefreshing,timeoutMs:15000,cacheTtlMs:CHECKLIST_REPORT_CACHE_MS});
        if(request!==reportRequest)return;
        reportSyncPending=false;renderReport(data);pendingSignature=null;finishReportSync();
      }catch(error){
        if(request!==reportRequest)return;
        $('sign').disabled=true;failReportSync();
        if(cached){reportSyncPending=true;renderReport({...cached,canSign:false});return;}
        throw error;
      }
    };
    if(cached){void refreshInBackground().catch(()=>{});return cached;}
    try{
      const data=await api('report',{day},{timeoutMs:15000,cacheTtlMs:CHECKLIST_REPORT_CACHE_MS});
      if(request!==reportRequest)return;
      reportSyncPending=false;renderReport(data);pendingSignature=null;finishReportSync();
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
  $('arsenalActionClose').onclick=event=>{event.preventDefault();closeArsenalActionBanner();};
  $('arsenalInfoClose').onclick=event=>{event.preventDefault();closeArsenalInfoBanner();};
  window.addEventListener('resize',positionArsenalInfoBanner);
  $('arsenalActionCheck').onclick=event=>{event.preventDefault();const unit=activeArsenal();if(!unit)return;const key=unitKey(unit);resetRecords.delete(key);closeArsenalActionBanner();run(()=>openRecordForUnit(unit,{direct:true}));};
  $('arsenalActionRelease').onclick=event=>{event.preventDefault();const unit=activeArsenal();if(!unit)return;const day=report?.day||dateKey();syncMaintenanceDay(day);manualMaintenance.delete(unitKey(unit));if(isMaintenance(unit))activatedMaintenance.add(unitKey(unit));closeArsenalActionBanner();if(report)renderReport(report);};
  $('arsenalActionInactivate').onclick=event=>{event.preventDefault();const unit=activeArsenal();if(!unit)return;const day=report?.day||dateKey();syncMaintenanceDay(day);manualMaintenance.add(unitKey(unit));activatedMaintenance.delete(unitKey(unit));closeArsenalActionBanner();if(report)renderReport(report);};
  $('arsenalActionReset').onclick=event=>{event.preventDefault();const unit=activeArsenal();if(!unit)return;const day=report?.day||dateKey();syncMaintenanceDay(day);manualMaintenance.delete(unitKey(unit));activatedMaintenance.delete(unitKey(unit));resetRecords.add(unitKey(unit));closeArsenalActionBanner();if(report)renderReport(report);};
  $('scanSymbol').onclick=()=>run(startCamera);
  $('photo').onchange=()=>run(async()=>{const file=$('photo').files[0];if(!file)return;try{const bitmap=await createImageBitmap(file);let qr;try{qr=decode(bitmap,bitmap.width,bitmap.height);}finally{bitmap.close();}if(!qr)throw new Error('QR Code não identificado. Fotografe de frente, com boa iluminação.');await identify(qr);}finally{$('photo').value='';}});
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>close(button.dataset.close));
  document.querySelectorAll('[data-signature-reason]').forEach(button=>button.onclick=()=>{const group=button.closest('.signature-reason-group');if(group?.dataset.signed==='true')return;setSignatureReason(group.id,button.dataset.signatureReason);if(group.id==='incompleteSignatureReasonGroup')run(()=>submitIncompleteSignature(button.dataset.signatureReason));else if(group.id==='completeSignatureReasonGroup')run(()=>submitCompleteSignature(button.dataset.signatureReason));});
  $('cameraDialog').addEventListener('cancel',stopCamera);document.addEventListener('visibilitychange',()=>{if(document.hidden){stopCamera();close('cameraDialog');}});
  async function saveRecord(){
    const condition=$('recordForm').elements.condition.value;const occurrence=condition==='NAO'?$('occurrence').value.trim():'';
    if(condition==='NAO'&&!occurrence)throw new Error('Descreva a ocorrência antes de salvar.');
    if(!['SIM','NAO'].includes(condition))throw new Error('Selecione SIM ou NÃO.');
    pendingRecord ||= crypto.randomUUID();const button=$('recordForm').querySelector('[type=submit]');button.disabled=true;
    const requestId=pendingRecord,day=dateKey(),payload={unitId:current.id,condition,occurrence,requestId,direct:pendingRecordMode==='direct'},record={unitId:current.id,id:requestId,at:new Date().toISOString(),condition,occurrence,email:session.email,name:session.name || ''};
    if(condition==='SIM'||condition==='NAO'){
      applyOptimisticRecord(day,record);pendingRecord=null;pendingRecordMode='qr';close('recordDialog');$('reportDate').value=day;openReportDialog();if(report)renderReport(report);notice(condition==='NAO'?'Manutenção solicitada. Sincronizando em segundo plano.':'Arsenal registrado. Sincronizando em segundo plano.');button.disabled=false;void syncRecordInBackground(payload,day);return;
    }
  }
  document.querySelectorAll('[data-condition-choice]').forEach(button=>button.onclick=()=>{const value=button.dataset.conditionChoice,input=$('recordForm').querySelector('input[name="condition"][value="'+value+'"]');if(!input)return;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});
  $('recordForm').onchange=()=>{const value=$('recordForm').elements.condition.value,no=value==='NAO',conditionFieldset=$('conditionFieldset'),submitButton=$('recordForm').querySelector('[type=submit]');document.querySelectorAll('[data-condition-choice]').forEach(button=>button.classList.toggle('selected',button.dataset.conditionChoice===value));conditionFieldset.hidden=no;$('occurrenceLabel').hidden=!no;$('occurrence').required=no;submitButton.textContent=no?'Comprometo-me a solicitar manutenção e avisar a equipe pelo WhatsApp de imediato!':'Salvar registro';submitButton.hidden=!no;pendingRecord=null;if(!no)run(saveRecord);};
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
  async function submitCompleteSignature(chosenReason=selectedSignatureReason('completeSignatureReasonGroup')){
    if(!report||!report.canSign||report.signature)return;
    const reason=SIGNATURE_REASONS.includes(chosenReason)?chosenReason:'';
    if(!reason)throw new Error('Escolha “A pedido” ou “Tempo limite excedido”.');
    const responsible=normalizedEmail(report.responsible?.email),signedBy=normalizedEmail(session?.email),other=!!responsible&&responsible!==signedBy;
    pendingSignature ||= crypto.randomUUID();
    const day=report.day,at=new Date().toISOString(),justification=other?reason:'',payload={day,revision:report.revision,accepted:true,justification,signatureReason:reason,signedAt:at,requestId:pendingSignature},signature={email:session?.email || '',at,incomplete:false,justification,reason};
    document.querySelectorAll('#completeSignatureReasonGroup [data-signature-reason]').forEach(button=>button.disabled=true);applyOptimisticSignature(day,signature);pendingSignature=null;closeCompleteSignatureBanner();renderReport(report);void syncSignatureInBackground(payload,day);
  }
  $('confirmCompleteSignature').onclick=()=>run(()=>submitCompleteSignature());
  $('cancelIncompleteSignature').onclick=()=>closeIncompleteSignatureBanner();
  async function submitIncompleteSignature(chosenReason=selectedSignatureReason('incompleteSignatureReasonGroup')){
    const reason=SIGNATURE_REASONS.includes(chosenReason)?chosenReason:'',description=$('incompleteJustification').value.trim();
    if(!reason)throw new Error('Escolha “A pedido” ou “Tempo limite”.');
    if(!description)throw new Error('Descreva por que o checklist não foi concluído.');
    if(!report || !report.canSign || report.signature)return;
    const justification=composeSignatureJustification(reason,description);$('declaration').checked=true;pendingSignature ||= crypto.randomUUID();const day=report.day,at=new Date().toISOString(),payload={day,revision:report.revision,accepted:true,signWithoutComplete:true,justification,signatureReason:reason,signatureDescription:description,signedAt:at,requestId:pendingSignature},signature={email:session?.email || '',at,incomplete:true,justification,reason,description};
    document.querySelectorAll('#incompleteSignatureReasonGroup [data-signature-reason]').forEach(button=>button.disabled=true);applyOptimisticSignature(day,signature);pendingSignature=null;closeIncompleteSignatureBanner();renderReport(report);void syncSignatureInBackground(payload,day);
  }
  $('confirmIncompleteSignature').onclick=()=>run(()=>submitIncompleteSignature());  $('return').onclick=()=>{stopCamera();if(window.SAHMT_SHELL){window.SAHMT_SHELL.navigate(new URL('index.html',window.SAHMT_SHELL.base));return;}if(window.parent!==window){window.parent.postMessage({type:'sahmt-checklist-close'},cfg.parentOrigin);}else{location.href=cfg.parentOrigin+cfg.parentPath+'?skipNotice=1';}};
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

