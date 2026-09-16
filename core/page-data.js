// Memory snapshots are account-scoped and invalidated on writes/account changes.
// Only schedule screens need initial operational data; all other screens can
// open immediately and load their own authorized data without blocking routing.
export async function pageData(id,services){
  const [bootstrap,schedule]=await Promise.all([
    id==='home'?(services.bootstrapData||services.bootstrap()):{contacts:[]},
    ['home','eventos'].includes(id)?(services.store.peek('escala.list:{}')||services.schedule()):null
  ]);
  return {bootstrap,schedule};
}
