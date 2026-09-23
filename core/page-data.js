// Memory snapshots are account-scoped and invalidated on writes/account changes.
// Only schedule screens need initial operational data; all other screens can
// open immediately and load their own authorized data without blocking routing.
const SCHEDULE_CACHE='sahmt-scale-schedule-cache-v2';
function cachedSchedule(services){
  const uid=String(services.user?.uid||'').trim();
  if(!uid||!globalThis.localStorage)return null;
  try{
    const item=JSON.parse(globalThis.localStorage.getItem(`${SCHEDULE_CACHE}:${uid}`)||'null');
    return item&&Array.isArray(item.value?.days)&&item.value.days.length?item.value:null;
  }catch{return null;}
}
export async function pageData(id,services){
  const needsSchedule=['home','eventos'].includes(id);
  const schedule=needsSchedule?(services.store.peek('escala.list:{}')||cachedSchedule(services)):null;
  const bootstrapPromise=id==='home'?(services.bootstrapData?Promise.resolve(services.bootstrapData):services.bootstrap()):Promise.resolve({contacts:[]});
  // The screen paints from its local snapshot first. Its own refresh path updates
  // the schedule after mount, so a slow Apps Script call never holds navigation.
  if(needsSchedule&&!schedule)services.schedule().catch(()=>{});
  const bootstrap=await bootstrapPromise;
  return {bootstrap,schedule};
}
