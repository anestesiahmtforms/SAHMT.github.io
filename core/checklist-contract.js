export function checklistResponse(result, action, payload = {}) {
  if (!result || result.ok !== true) throw new Error(result?.message || 'Não foi possível concluir a operação.');
  const value = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? {...result.data,ok:true} : result;
  if (action === 'report' || action === 'sign') {
    if (!Array.isArray(value.items) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day || '') || value.items.some(x => !x || !x.id)) {
      throw new Error('O serviço não enviou um relatório válido com a lista de unidades. A assinatura permanece bloqueada.');
    }
    if (payload.day && value.day !== payload.day) throw new Error('O serviço retornou outra data. Atualize o relatório antes de continuar.');
  }
  if (action === 'record') {
    const record = value.record;
    if (!record || !record.id || String(record.unitId) !== String(payload.unitId) || record.condition !== payload.condition) {
      throw new Error('O serviço não confirmou a gravação da checagem. A operação permanece pendente no aparelho.');
    }
    if (payload.requestId && record.requestId && record.requestId !== payload.requestId) {
      throw new Error('A confirmação pertence a outra operação. A checagem permanece pendente para revisão.');
    }
  }
  if (action === 'sign' && (!value.signature?.email || !value.signature?.at)) {
    throw new Error('O serviço não confirmou a assinatura. A operação permanece pendente no aparelho.');
  }
  if (action === 'monthly' && !Array.isArray(value.days)) throw new Error('O serviço não enviou um relatório mensal válido.');
  return value;
}
