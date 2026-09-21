// Memory snapshots are account-scoped and invalidated on writes/account changes.
// Only schedule screens need initial operational data; all other screens can
// open immediately and load their own authorized data without blocking routing.
const SCHEDULE_CACHE='sahmt-scale-schedule-cache-v2';
function cachedSchedule(services){
  const uid=String(services.user?.uid||'').trim();
  if(!uid||!globalThis.localStorage)return null;
  try{
    const item=JSON.parse(globalThis.localStorage.getItem(`${SCHEDULE_CACHE}:${uid}`)||'null');
    return item&&Date.now()-Number(item.savedAt||0)<=6*60*60*1000&&Array.isArray(item.value?.days)&&item.value.days.length?item.value:null;
  }catch{return null;}
}
export async function pageData(id,services){
  const [bootstrap,schedule]=await Promise.all([
    id==='home'?(services.bootstrapData||services.bootstrap()):{contacts:[]},
    ['home','eventos'].includes(id)?(services.store.peek('escala.list:{}')||cachedSchedule(services)||services.schedule()):null
  ]);
  return {bootstrap,schedule};
}
