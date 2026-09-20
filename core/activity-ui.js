// Existing links are NON_SCORING. Evidence is a separate, explicit user action.
export function renderActivities(container,items,services,{onConfirmed=()=>{}}={}){
 const doc=container.ownerDocument;container.replaceChildren();container.hidden=!items.length;
 for(const item of items){
  const card=doc.createElement('article');card.className='activity-item';card.dataset.activityId=item.id;
  for(const key of ['sourceType','scoringCategory','completionEvidence','showInTraining'])card.dataset[key]=String(item[key]??'');
  const title=doc.createElement('strong');title.textContent=item.title;card.append(title);
  const info=doc.createElement('p');info.textContent=item.description||'';card.append(info);
  const status=doc.createElement('p');status.setAttribute('role','status');status.textContent=item.completed?'Participação confirmada.':'';
  const payload={activityId:item.id,activityVersion:item.version};
  if(/^https:\/\//.test(item.sourceRef?.url||'')){
   const link=doc.createElement('a');link.href=item.sourceRef.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Abrir recurso';
   link.onclick=()=>{services.activities('interact',{...payload,eventType:'OPENED'}).catch(()=>{});};card.append(link);
  }
  if(item.completionEvidence==='ACKNOWLEDGEMENT'&&item.canAcknowledge!==false){
   const button=doc.createElement('button');button.textContent=item.completed?'Ciência registrada':'Li e estou ciente';button.disabled=!!item.completed;
   button.onclick=async()=>{button.disabled=true;status.textContent='Enviando confirmação…';try{const result=await services.activities('interact',{...payload,eventType:'ACKNOWLEDGED',accepted:true});status.textContent=result.interaction?.status==='CONFIRMED'?'Ciência confirmada pelo servidor.':'Confirmação pendente de validação.';button.textContent='Ciência registrada';onConfirmed(result);}catch(error){status.textContent=error.message+' Confirmação ainda não registrada.';button.disabled=false;}};card.append(button);
  }else if(item.completionState==='NOT_CONFIGURED')status.textContent='A recorrência desta atividade ainda precisa ser configurada antes da confirmação.';
  else if(item.completionState==='PER_EVENT')status.textContent=`${item.confirmedInteractions||0} participação(ões) confirmada(s). Cada novo envio será validado pelo recurso.`;
  else if(!item.completed)status.textContent='A conclusão será confirmada pela evidência do recurso, não pela abertura do link.';
  card.append(status);
  const result=doc.createElement('p');result.className='activity-result';
  const labels=[`Pontuação: ${Number(item.points||0).toLocaleString('pt-BR')} ponto(s)`];
  for(const evidence of item.lastParticipation?.results||[]){
   if(evidence.quizScore!==undefined)labels.push(`Nota: ${Number(evidence.quizScore).toLocaleString('pt-BR')}/${Number(evidence.quizMaxScore).toLocaleString('pt-BR')}`);
   if(evidence.wordCount!==undefined)labels.push(`Sugestão: ${evidence.wordCount} palavras`);
   if(evidence.valid&&['FILE_RENEWED','FILE_REVISION_UPDATED'].includes(evidence.eventType))labels.push('Documento renovado');
   if(evidence.eventType==='FILE_CREATED')labels.push('Documento inicial registrado');
   if(evidence.pending)labels.push(evidence.reason==='NEEDS_REVIEW'?'Mapeamento precisa de revisão':'Evidência pendente de confirmação');
  }
  if(item.lastParticipation?.status==='PENDING_CONFIRMATION')labels.push('Participação pendente de confirmação');
  result.textContent=labels.join(' · ');card.append(result);container.append(card);
 }
}

// Coalesces focus + visibility into one read after returning from an external resource.
export function watchActivityReturn({window:win,document:doc,refresh,isActive=()=>true}){
 let away=false,pending=false,routeActive=true,disposed=false;
 const mark=()=>{away=true;};
 const resume=()=>{if(disposed||!routeActive||doc.hidden||!isActive()||!away||pending)return;away=false;pending=true;Promise.resolve().then(refresh).catch(()=>{}).finally(()=>{pending=false;if(away)resume();});};
 const visibility=()=>{if(!routeActive)return;if(doc.hidden)mark();else resume();};
 const hide=()=>{routeActive=false;away=false;};const show=()=>{routeActive=true;};
 win.addEventListener('blur',mark);win.addEventListener('focus',resume);doc.addEventListener('visibilitychange',visibility);
 doc.addEventListener('sahmt:hide',hide);doc.addEventListener('sahmt:show',show);
 return ()=>{disposed=true;win.removeEventListener('blur',mark);win.removeEventListener('focus',resume);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('sahmt:hide',hide);doc.removeEventListener('sahmt:show',show);};
}
