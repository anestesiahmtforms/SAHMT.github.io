export function checklistResponse(result, action, payload = {}) {
  if (!result || result.ok !== true) throw new Error(result?.message || 'Não foi possível concluir a operação.');
  const value = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? {...result.data,ok:true} : result;
  if (action === 'report' || action === 'sign') {
    if (!Array.isArray(value.items) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day || '') || value.items.some(x => !x || !x.id)) {
      throw new Error('O serviço não enviou um relatório válido com a lista de unidades. A assinatura permanece bloqueada.');
    }
    if (payload.day && value.day !== payload.day) throw new Error('O serviço retornou outra data. Atualize o relatório antes de continuar.');
  }
  if (action === 'monthly' && !Array.isArray(value.days)) throw new Error('O serviço não enviou um relatório mensal válido.');
  return value;
}
