import {safePayload} from './outbox.js';
const br=iso=>String(iso||'').slice(0,10).split('-').reverse().join('/');
const iso=value=>/^\d{2}\/\d{2}\/\d{4}$/.test(value)?value.split('/').reverse().join('-'):value;
export class Services {
 constructor({api,session,store,outbox}){Object.assign(this,{api,session,store,outbox});this.operations=new Map();this.uiMemory=new Map();this.bootstrapData=null;}
 clear(){this.operations.clear();this.uiMemory.clear();this.bootstrapData=null;this.store.clear();}
 get configured(){return !!this.api.url;}
 get user(){return this.session.snapshot().user;}
 get generation(){return this.session.snapshot().generation;}
 permission(key){return this.user?.permissions?.[key]===true;}
 get dcAliasesByWeekday(){return new Map([['Segunda',['CR','LH']],['Terca',['CR','AD','LH']],['Quarta',['CR','AD','LH']],['Quinta',['CR','LH']],['Sexta',['CR','LA']]]);}
 async confirmAccount(){const before=this.session.snapshot?.()?.generation;await this.session.confirm();if(before!==this.session.snapshot?.()?.generation){const e=new Error('A conta foi alterada.');e.code='ACCOUNT_CHANGED';throw e;}}
 async read(action,data={},force=false){await this.confirmAccount();const key=action+':'+JSON.stringify(data);if(force)this.store.invalidate(key);return this.store.load(key,()=>this.api.call(action,data));}
 async write(action,data={},options={}){
  await this.confirmAccount();const generation=this.session.snapshot?.()?.generation;data=safePayload(data);const signature=action+':'+JSON.stringify(data);
  const requestId=options.requestId||this.operations.get(signature)||crypto.randomUUID();this.operations.set(signature,requestId);
  try{const result=await this.api.call(action,data,{...options,requestId});this.operations.delete(signature);this.store.invalidate(action.split('.')[0]+'.');if(action.startsWith('eventos.'))this.store.invalidate('escala.');if(action.startsWith('eventos.')||action.startsWith('escala.'))this.store.invalidate('checklist.');if(action.startsWith('checklist.'))this.store.invalidate('treinamentos.');return result;}
  catch(e){if(generation!==this.session.snapshot?.()?.generation){const changed=new Error('A conta foi alterada.');changed.code='ACCOUNT_CHANGED';throw changed;}if(e.retryable&&options.queue===true){this.outbox.enqueue(action,data,requestId);return {queued:true};}if(!e.retryable&&!['INTERNAL','RECOVERY_REQUIRED'].includes(e.code))this.operations.delete(signature);throw e;}
 }
 async bootstrap(){await this.confirmAccount();this.bootstrapData=this.session.bootstrapData||this.bootstrapData||{user:this.user,contacts:[]};return this.bootstrapData;}
 async schedule(){return this.read('escala.list');}
 async highlights(){return (await this.read('escala.highlights')).highlights;}
 async mark(date,sigla,marked){return (await this.write('escala.mark',{date,sigla,marked})).highlights;}
 async labelEntries(data){const r=await this.read('etiquetas.list',data,true);return r.entries.map((r,i)=>{const edits=Array.isArray(r.editHistory)?r.editHistory:[];return {...r,rowNumber:i+2,criadoEm:r.createdAt,criadoPor:r.createdBy,editadoEm:edits.length?r.updatedAt:'',editadoPor:edits.length?r.updatedBy:'',resumoEdicao:edits.map(formatLabelEditHistoryLine).join('\n')};});}
 async saveLabel(payload,{update=false,queue=true}={}){const {action,rowNumber,userAgent,...data}=safePayload(payload);return this.write(update?'etiquetas.update':'etiquetas.save',data,{queue:!update&&queue});}
 async eventRecords(){const {records}=await this.read('eventos.list',{},true);return records.map((r,i)=>{const edits=Array.isArray(r.history)?r.history.filter(x=>x&&x.kind!=='launch'&&Array.isArray(x.fields)&&x.fields.length):[];return {...r,rowIndex:i+2,timestampRaw:r.createdAt,timestamp:r.createdAt,dataDoEvento:br(r.data),dataDoEventoKey:r.data,tipo:r.tipoEvento,multiplo:String(r.multiploAtraso),valor:Number(r.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2}),origem:r.source,history:edits.map(formatEventEditHistoryLine).join('\n\n'),registeredBy:r.createdBy};});}
 eventPayload(p){return {data:iso(p.dataDoEvento||p.data),membro:p.membroAusenteAtrasado,tipoEvento:p.tipoDeEvento,descricao:p.descricaoDoEvento,multiploAtraso:p.multiploDoAtraso,substituto:p.membroSubstituto,turno:p.turno,pagador:p.pagador,credor:p.resultadoCredor,valor:p.valorAPagar,...(p.siglaEvento?{siglaEvento:p.siglaEvento}:{}),...(p.operation==='update'?{id:p.id,version:p.version}:{})};}
 async saveEvent(p){return this.write(p.operation==='update'?'eventos.update':'eventos.save',this.eventPayload(p),{queue:p.operation!=='update'});}
 async eventLists(){const o=await this.read('eventos.options');return Array.from({length:Math.max(o.payers.length,o.creditors.length)},(_,i)=>[o.eventTypes[i]||'',o.payers[i]||'',o.creditors[i]||'',o.shifts[i]||'',o.delayMultiples[i]||'',o.dc[i]||'']);}
 async checklist(action,payload={},options={}){const {requestId,...data}=payload;const result=['record','sign'].includes(action)?await this.write('checklist.'+action,data,{requestId}):await this.read('checklist.'+action,data,options.force);return {ok:true,...result,...(result.record?{...result.record,at:result.record.createdAt}:{})};}
 async training(action,payload={}){const result=action==='catalog'?await this.read('treinamentos.list',{},true):await this.write('treinamentos.'+action,payload);return {ok:true,apiVersion:1,...result};}
 async activities(action,payload={}){return action==='interact'?this.write('activities.interact',payload):this.read('activities.'+action,payload,true);}
 pending(action){return this.outbox.read().filter(item=>item.action===action);}
 async flush(){await this.confirmAccount();const result=await this.outbox.flush();if(result.sent)this.store.invalidate();return result;}
}

const LABEL_EDIT_FIELD_NAMES=Object.freeze({data:'Data',nomePaciente:'Nome do Paciente',convenio:'Convenio',cirurgia:'Cirurgia',atendimento:'Atendimento',tipo:'Tipo',credor:'Credor',plantonistas:'Plantonista(s)',observacoes:'Observacoes',valor:'Valor',duplicateJustification:'Justificativa'});
function formatLabelEditHistoryLine(entry){
 const edit=entry&&typeof entry==='object'?entry:{};
 const at=String(edit.at||'').trim()||'Sem data registrada';
 const by=String(edit.by||'').trim()||'Sem responsavel registrado';
 const fields=Array.isArray(edit.fields)?edit.fields:[];
 const changes=fields.map((field)=>{
  if(field&&typeof field==='object'){
   const name=LABEL_EDIT_FIELD_NAMES[field.name]||field.name||'Campo';
   const before=field.before==null?'':String(field.before);const after=field.after==null?'':String(field.after);
   return `${name}: ${before} -> ${after}`;
  }
  const name=LABEL_EDIT_FIELD_NAMES[String(field)]||String(field||'').trim();
  return name;
 }).filter(Boolean).join('; ');
 return `${at} - ${by}: ${changes||'Registro editado.'}`;
}

const EVENT_EDIT_FIELD_NAMES=Object.freeze({data:'Data do Evento',membro:'Membro',tipoEvento:'Tipo de Evento',descricao:'Descricao do evento',multiploAtraso:'Multiplo do atraso',substituto:'Substituto',turno:'Turno',pagador:'Pagador',credor:'Credor',valor:'Valor a pagar',source:'Origem'});
function formatEventEditHistoryLine(entry){
 const edit=entry&&typeof entry==='object'?entry:{};
 const data=String(edit.at||'').trim()||'Data nao registrada';
 const responsible=String(edit.by||'').trim()||'Responsavel nao informado';
 const fields=Array.isArray(edit.fields)?edit.fields:[];
 const changes=fields.map((field)=>{
  if(field&&typeof field==='object'){
   const name=EVENT_EDIT_FIELD_NAMES[field.name]||field.name||'Campo';
   return `${name}: ${field.before==null?'':field.before} -> ${field.after==null?'':field.after}`;
  }
  return EVENT_EDIT_FIELD_NAMES[String(field)]||String(field||'').trim();
 }).filter(Boolean).join('; ');
 return `Data: ${data}\nResponsavel: ${responsible}\nAlteracao: ${changes||'Registro editado.'}`;
}
