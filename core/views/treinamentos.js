export async function mount(ctx){
const {Services,localStorage,sessionStorage,document,window,navigator,location,history,fetch,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame}=ctx;

(async () => {
  const $=id=>document.getElementById(id);
  let catalog=[],selected=null,accessId='',player=null,timer=null,last=0,ended=false,asked=false,busy=false,openGeneration=0;
  let watched=new Set(),lastProgressSync=0,syncingProgress=false;
function watchedIntervals(duration){const intervals=[];for(const s of [...watched].sort((a,b)=>a-b)){const last=intervals.at(-1);if(last&&last[1]>=s)last[1]=Math.min(s+1,duration);else intervals.push([s,Math.min(s+1,duration)]);}return intervals;}
function serverProgress(p){if(!p)return null;const values=[];for(const [from,to] of p.watchedRanges||[])for(let n=Math.floor(from);n<Math.floor(to);n++)values.push(n);return {position:p.position,watched:values,ended:p.status==="Concluido",asked:p.position>p.duration/2};}
  const email=()=>window.SAHMT_AUTH.getSession()?.email||'';
  const progressKey=id=>'sahmt-training-progress-v1:'+email()+':'+id;
  function saved(id){try{return JSON.parse(localStorage.getItem(progressKey(id))||'null');}catch{return null;}}
  function persist(force=false){if(!selected||!player)return;const duration=player.getDuration?.()||0,position=player.getCurrentTime?.()||0;try{localStorage.setItem(progressKey(selected.id),JSON.stringify({position,watched:[...watched],asked,ended}));}catch{}if(duration<=0||syncingProgress||(!force&&Date.now()-lastProgressSync<15000))return;lastProgressSync=Date.now();syncingProgress=true;api("progress",{trainingId:selected.id,accessId,duration,position,watchedRanges:watchedIntervals(duration)}).catch(e=>{$("player-status").textContent="Progresso ainda não sincronizado: "+e.message;lastProgressSync=0;}).finally(()=>{syncingProgress=false;});}
  async function api(action,payload={}){return Services.training(action,payload);}
  function status(text){$('training-status').textContent=text;}
  async function load(){
    $('training-retry').hidden=true;status('Carregando treinamentos…');
    try{const data=await api('catalog');if(!Array.isArray(data.trainings))throw new Error('Não foi possível ler o catálogo.');catalog=data.trainings;render(data);status(catalog.length?'':'Nenhum treinamento disponível.');}
    catch(e){status(e.message);$('training-retry').hidden=false;}
  }
  function render(data){
    $('training-score').replaceChildren(document.createTextNode(`Sua pontuação: ${data.totalPoints} / ${data.totalAvailablePoints} pontos · `));const percent=document.createElement('strong');percent.textContent=`${data.scorePercentage}%`;$('training-score').append(percent);
    $('training-catalog').replaceChildren();for(const item of catalog){const button=document.createElement('button');button.className='training-item'+(item.completed?' completed':'');const label=document.createElement('span'),title=document.createElement('strong');title.textContent=item.title;label.append(title);if(saved(item.id)&&!item.completed){const resume=document.createElement('small');resume.textContent='Continuar de onde parou';label.append(resume);}const points=document.createElement('span');points.className='points';points.textContent=`${item.completed?'✓ ':''}${item.accessPoints+item.completionPoints} Pontos`;button.append(label,points);button.onclick=()=>open(item).catch(e=>{$('player-status').textContent=e.message;status(e.message);});$('training-catalog').append(button);}
  }
  async function youtube(){return window.SAHMT_SHELL.youtube();}
  async function open(item){
    if(busy)return;busy=true;const generation=++openGeneration;
    try{const started=await api('begin',{trainingId:item.id});if(generation!==openGeneration||document.hidden)return;selected=item;accessId=started.accessId;const old=serverProgress(started.progress)||saved(item.id);lastProgressSync=0;watched=new Set(old?.watched||[]);asked=!!old?.asked;ended=!!old?.ended;
      $('training-title').textContent=item.title;$('player-status').textContent='Carregando vídeo…';$('training-complete').disabled=true;$('training-play').disabled=true;$('training-player').showModal();
      const YT=await youtube();if(generation!==openGeneration||document.hidden)return;player?.destroy();$('training-video-wrap').replaceChildren();const el=document.createElement('div');el.id='training-video';$('training-video-wrap').append(el);
      player=new YT.Player(el,{videoId:item.videoId,playerVars:{playsinline:1,autoplay:0,loop:0,controls:0,disablekb:1,cc_load_policy:0,rel:0,origin:window.location.origin},events:{onReady:()=>{if(generation!==openGeneration||!player)return;if(old?.position&&!old.ended)player.seekTo(old.position,true);last=player.getCurrentTime()||0;$('training-play').disabled=false;$('player-status').textContent=old?'Continue de onde parou.':'Assista ao vídeo para concluir.';update();},onStateChange:e=>{if(generation!==openGeneration||!player)return;clearInterval(timer);if(e.data===YT.PlayerState.PLAYING){last=player.getCurrentTime();timer=setInterval(tick,1000);$('training-play').textContent='PAUSAR';}else $('training-play').textContent='REPRODUZIR';if(e.data===YT.PlayerState.ENDED){tick();ended=true;persist();update();}},onError:()=>{$('player-status').textContent='Não foi possível reproduzir este vídeo.';}}});
    }finally{if(generation===openGeneration)busy=false;}
  }
  function tick(){if(!player||!selected)return;const pos=player.getCurrentTime(),delta=pos-last,duration=player.getDuration();if(delta>0&&delta<=2.5)for(let s=Math.floor(last);s<Math.floor(pos);s++)watched.add(s);last=pos;if(!asked&&duration>0&&pos>=duration/2){asked=true;player.pauseVideo();$('training-question').showModal();}persist();update();}
  function update(){const duration=player?.getDuration?.()||0,ratio=duration?Math.min(1,watched.size/duration):0;$('training-progress').value=Math.round(ratio*100);$('training-complete').disabled=!(ended&&ratio>=.95);}
  function pause(){player?.pauseVideo?.();persist(true);clearInterval(timer);}
  function leavePlayer(){openGeneration++;pause();player?.destroy();player=null;selected=null;busy=false;if($('training-question').open)$('training-question').close();}
  async function back(){leavePlayer();$('training-player').close();await load();}
  $('training-play').onclick=()=>{if(!player)return;player.getPlayerState()===1?player.pauseVideo():player.playVideo();};
  for(const id of ['training-yes','training-no'])$(id).onclick=()=>{$('training-question').close();player?.playVideo();};
  $('training-complete').onclick=async()=>{if(busy||$('training-complete').disabled)return;busy=true;const completedKey=progressKey(selected.id),completionGeneration=openGeneration;$('training-complete').disabled=true;try{const result=await api('complete',{trainingId:selected.id,accessId,duration:player.getDuration(),watchedSeconds:watched.size,watchedRanges:watchedIntervals(player.getDuration()),position:player.getCurrentTime(),ended});localStorage.removeItem(completedKey);if(completionGeneration!==openGeneration)return;$('player-status').textContent=result.alreadyCompleted?'Treinamento já concluído.':'Conclusão registrada com sucesso.';}catch(e){if(completionGeneration===openGeneration){$('player-status').textContent=e.message;update();}}finally{if(completionGeneration===openGeneration)busy=false;}};
  $('training-back').onclick=back;$('training-player').addEventListener('cancel',e=>{e.preventDefault();back();});$('training-retry').onclick=load;
  document.addEventListener('sahmt:hide',leavePlayer);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  let catalogReady=false;
  function openRequested(){const id=new URL(window.location.href).searchParams.get('trainingId');if(id&&catalog.some(t=>t.id===id)&&selected?.id!==id)open(catalog.find(t=>t.id===id)).catch(e=>status(e.message));}
  document.addEventListener('sahmt:show',()=>{if(catalogReady)load().then(openRequested);});
  await load();
  catalogReady=true;if(!document.hidden)openRequested();
})();

}
