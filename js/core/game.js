(()=>{'use strict';
const $=id=>document.getElementById(id), TEST_MODE=new URLSearchParams(location.search).get('test')==='1' && ['localhost','127.0.0.1'].includes(location.hostname), AUTO=TEST_MODE?'chainquest_test_auto_v1':'chainquest_auto_v1',MANUAL=TEST_MODE?'chainquest_test_manual_v1':'chainquest_manual_v1';
const TYPES={equipment:'装備',items:'アイテム',guests:'ゲスト',skills:'スキル'};

// Resolve site-root asset paths under the GitHub Pages project prefix.
// Local editor/server paths remain relative to the game directory.
const cqAssetUrl=path=>{
 if(typeof path!=='string'||!path)return path;
 if(/^(?:https?:|data:|blob:|\/\/)/i.test(path))return path;
 const clean=path.replace(/^\/+/, '');
 if(!/^(?:assets|data|css|js)\//i.test(clean))return path;
 return new URL(clean,document.baseURI).href;
};
// The editor can store common image paths with a leading slash.
const cqImageUrl=path=>cqAssetUrl(path);
const cqClampVolume=n=>Math.max(0,Math.min(1,Number(n)||0));
let voiceVolume=cqClampVolume(Number(localStorage.getItem('cq-voice-volume')??100)/100);
const cqVoiceLevel=individual=>cqClampVolume(voiceVolume*cqClampVolume(individual));
const cqVoicePlayers=new Map();
function cqPlayVoice(audio,individual=1){
 const level=cqClampVolume(individual);
 audio.volume=cqVoiceLevel(level);
 cqVoicePlayers.set(audio,level);
 const cleanup=()=>cqVoicePlayers.delete(audio);
 audio.addEventListener('ended',cleanup,{once:true});
 audio.addEventListener('error',cleanup,{once:true});
 audio.play().catch(cleanup);
 return audio;
}
function cqSetVoiceVolume(percent){
 voiceVolume=cqClampVolume(Number(percent)/100);
 localStorage.setItem('cq-voice-volume',String(Math.round(voiceVolume*100)));
 for(const [audio,individual] of cqVoicePlayers){if(audio.ended){cqVoicePlayers.delete(audio);continue}audio.volume=cqVoiceLevel(individual)}
}

let state=null,screen='title',busy=false,bubbleTimer=null,voice=null,previous=-1,shopType='items',pickType=null;
let catalog={equipment:[],items:[],guests:[],skills:[],enemies:[],scenarios:[],events:[]};let collectionConfig={portrait:'',background:'',requests:[],voices:{},shopSE:{},shopRandomVoices:{}};let collectionTab='all',collectionSelected=null;let characterRows=[];
// Stage 58: music controller; retains playback position for each track across battles.
const music={settings:{home:'',adventure:'',battle:''},volume:0.5,muted:false,active:null,tracks:new Map(),fadeToken:0,unlocked:false,eventOverride:null,fadeMs:500,keepAfterEvent:false,eventVolume:1};
try{const saved=JSON.parse(localStorage.getItem('chainquest_bgm_settings')||'{}');music.volume=Math.max(0,Math.min(1,Number(saved.volume??0.5)));music.muted=!!saved.muted}catch{}
// Resolve common BGM volume by the currently playing scene, not by file path.
// Multiple slots may reference the same MP3 but have different volumes.
function musicCommonSlot(){
 if(!state||['title','select'].includes(screen))return null;
 if(screen==='battle')return battle?.ended||!battle||battle?.enemy?.bgm?null:'battle';
 if(music.eventOverride!==null)return null;
 if(['novel','adventure'].includes(screen)||state.adventure&&screen!=='home'&&screen!=='shop'&&screen!=='status'&&screen!=='items-page'){
  const scenario=item('scenarios',state.adventure?.scenarioId);
  return musicPath(scenario?.bgm)?null:'adventure';
 }
 return 'home';
}
function musicOutputVolume(path){
 if(screen!=='battle'&&music.eventOverride!==null)return (music.muted?0:music.volume)*music.eventVolume;
 if(screen==='battle'&&!battle?.ended&&path&&path===musicPath(battle?.enemy?.bgm))return (music.muted?0:music.volume)*Math.max(0,Math.min(1,Number(battle.enemy.bgmVolume??100)/100));
 let specific=1;
 const slot=musicCommonSlot();
 if(slot&&path===musicPath(music.settings[slot])){
  specific=Math.max(0,Math.min(1,Number(commonAssets.bgmVolume?.[slot]??100)/100));
 }else if(state?.adventure){
  const scenario=item('scenarios',state.adventure.scenarioId);
  if(path&&path===musicPath(scenario?.bgm))specific=Math.max(0,Math.min(1,Number(scenario?.bgmVolume??100)/100));
 }
 return (music.muted?0:music.volume)*specific;
}
const musicPath=p=>typeof p==='string'&&/^assets\/audio\/bgm\/[a-zA-Z0-9_-]+\.mp3$/.test(p)?p:'';
function musicSave(){try{localStorage.setItem('chainquest_bgm_settings',JSON.stringify({volume:music.volume,muted:music.muted}))}catch{}}
function musicTarget(){if(!state||['title','select'].includes(screen))return '';if(screen==='battle'){if(!battle||battle.ended)return ''; // 勝敗時はBGMを停止し、共通SEのみ再生
return musicPath(battle?.enemy?.bgm)||musicPath(music.settings.battle)}if(music.eventOverride!==null)return music.eventOverride;if(['novel','adventure'].includes(screen)||state.adventure&&screen!=='home'&&screen!=='shop'&&screen!=='status'&&screen!=='items-page'){const scenario=item('scenarios',state.adventure?.scenarioId);return musicPath(scenario?.bgm)||musicPath(music.settings.adventure)}return musicPath(music.settings.home)}
function musicSync(){
 const target=musicTarget(),previous=music.active;
 if(previous===target){const active=music.tracks.get(target);if(active){if(music.unlocked&&active.paused)active.play().catch(e=>console.warn('BGM再開失敗',target,e));if(!music.fading)active.volume=musicOutputVolume(target)}return}
 const token=++music.fadeToken;music.active=target;music.fading=true;
 let next=target?music.tracks.get(target):null;
 if(target&&!next){next=new Audio(target);next.loop=true;next.preload='auto';music.tracks.set(target,next)}
 const old=previous?music.tracks.get(previous):null;
 const oldVolume=old?.volume||0;
 // A track that was fading out can become the next target again before its pause.
 if(next)next.volume=0;
 if(next&&music.unlocked)next.play().catch(e=>console.error('[ChainQuest BGM] 再生失敗',target,e));
 const duration=Math.max(0,Math.min(10000,Number(music.fadeMs??500))),started=performance.now();
 function step(now){if(token!==music.fadeToken)return;const ratio=duration===0?1:Math.max(0,Math.min(1,(now-started)/duration));
  if(old&&old!==next)old.volume=Math.max(0,oldVolume*(1-ratio));
  if(next)next.volume=musicOutputVolume(target)*ratio;
  if(ratio<1){requestAnimationFrame(step);return}
  if(old&&old!==next)old.pause();
  // Prevent canceled crossfades from leaving extra tracks playing or the target paused.
  for(const [path,track] of music.tracks)if(path!==target&&!track.paused)track.pause();
  music.fading=false;
  if(next){next.volume=musicOutputVolume(target);if(music.unlocked&&next.paused)next.play().catch(e=>console.warn('BGM復帰失敗',target,e))}
 }
 requestAnimationFrame(step);
}
// Event music must take precedence over the scenario track for the entire event.
function eventBgmStep(step){
 const action=String(step.action||'play').toLowerCase();
 const fade=Number(step.fadeMs??500);
 music.fadeMs=Number.isFinite(fade)?Math.max(0,Math.min(10000,fade)):500;
 if(action==='restore'){
  music.eventOverride=null;music.keepAfterEvent=false;music.eventVolume=1;
 }else if(action==='stop'){
  music.eventOverride='';music.keepAfterEvent=!!step.keepAfterEvent;
 }else{
  const path=musicPath(step.path);
  if(!path){console.warn('イベントBGMのパスが不正です',step.path);return}
  music.eventOverride=path;music.keepAfterEvent=!!step.keepAfterEvent;
  music.eventVolume=Math.max(0,Math.min(1,Number(step.volume??100)/100));
 }
 // Event BGM is triggered while the user is already playing; start it immediately.
 music.unlocked=true;
 console.info('[ChainQuest BGM] イベント切替', {action,target:music.eventOverride,volume:music.eventVolume,fadeMs:music.fadeMs});
 musicSync();
}
function restoreEventBgm(force=false){
 if(music.eventOverride===null)return;
 // Scenario events always return to the scenario music, even if keepAfterEvent was checked.
 if(music.keepAfterEvent&&!force&&!state?.adventure)return;
 music.eventOverride=null;music.keepAfterEvent=false;music.eventVolume=1;
 music.fadeMs=0;musicSync();
 console.info('[ChainQuest BGM] イベント終了・シナリオ復帰', {target:musicTarget(),scenarioId:state?.adventure?.scenarioId});
 music.fadeMs=500;
}
function eventSeStep(step){const path=String(step.path||'');if(!/^assets\/(?:audio\/)?se\/[\w.-]+\.mp3$/.test(path)){console.warn('イベントSEのパスが不正です',path);return}try{const audio=new Audio(path);audio.volume=Math.max(0,Math.min(1,seVolume*Number(step.volume??100)/100));audio.play().catch(()=>{})}catch(e){console.warn('イベントSEの再生失敗',e)}}
function musicUnlock(){music.unlocked=true;musicSync()}
document.addEventListener('pointerdown',musicUnlock,{once:true});document.addEventListener('keydown',musicUnlock,{once:true});
fetch('data/bgm.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(v=>{music.settings={...(v||{}),...Object.fromEntries(Object.entries(commonAssets.bgm||{}).filter(([,p])=>!!p))};musicSync()}).catch(e=>console.warn('BGM設定読込失敗',e));
// Stage 65: common visual/audio configuration. Individual scenario/enemy BGM takes precedence.
const commonAssets={images:{},bgm:{},bgmVolume:{},se:{},seMaster:70};let counterDefinitions=[];fetch('data/counters.json',{cache:'no-store'}).then(r=>r.ok?r.json():[]).then(rows=>{counterDefinitions=Array.isArray(rows)?rows:[]}).catch(()=>{});let seVolume=Math.max(0,Math.min(1,Number(localStorage.getItem('cq-se-volume')??70)/100));
const commonImg=(key,fallback)=>commonAssets.images?.[key]||fallback;
function commonSE(key){const row=commonAssets.se?.[key];if(!row?.path)return;try{const audio=new Audio(row.path);audio.volume=Math.max(0,Math.min(1,seVolume*(Number(commonAssets.seMaster??70)/100)*Number(row.volume??100)/100));audio.play().catch(e=>console.warn('共通SE再生失敗',key,row.path,e))}catch(e){console.warn('共通SE再生失敗',key,e)}}
// Common random voices play concurrently with existing SE (B setting).
// An active voice is not interrupted by a subsequent trigger.
let randomVoiceAudio=null;
function randomVoice(key){
 const setting=commonAssets.randomVoices?.[key];
 if(!setting||!Array.isArray(setting.paths)||!setting.paths.length)return;
 const chance=Math.max(0,Math.min(100,Number(setting.chance??100)));
 if(Math.random()*100>=chance)return;
 if(randomVoiceAudio&&!randomVoiceAudio.paused&&!randomVoiceAudio.ended){
  // 結果ボイスは直前の攻撃・スキルボイスに妨げられないよう優先する。
  if(key==='victory'||key==='defeat'){
   randomVoiceAudio.pause();randomVoiceAudio.currentTime=0;randomVoiceAudio=null;
  }else return;
 }
 const paths=setting.paths.filter(p=>/^assets\/(?:voices|audio\/se)\/[\w.-]+\.mp3$/i.test(p));
 if(!paths.length)return;
 try{
  const audio=new Audio(paths[Math.floor(Math.random()*paths.length)]);
  randomVoiceAudio=audio;
  cqPlayVoice(audio,Number(setting.volume??100)/100);
  const release=()=>{if(randomVoiceAudio===audio)randomVoiceAudio=null};
  audio.addEventListener('ended',release,{once:true});
  audio.addEventListener('error',release,{once:true});
  
 }catch(e){console.warn('ランダムボイス再生失敗',key,e)}
}
// 共通の決定・キャンセル音。戦闘コマンドには専用SEがあるため重複させない。
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||screen==='battle'||button.disabled)return;const key=/戻る|閉じる|キャンセル|CANCEL|BACK/i.test(button.textContent||'')?'cancel':'confirm';commonSE(key)},true);
// Backgrounds: explicit Editor settings take priority; a missing file falls back
// to the next candidate. Probe the real image, not merely the presence of a path.
let discoveredBackgrounds={scenarios:{},enemies:{}};
const backgroundProbeCache=new Map();
function backgroundCandidates(...paths){return [...new Set(paths.filter(p=>typeof p==='string'&&p.trim()).map(p=>p.trim()))]}
function scenarioBackground(row,kind){return row?.[kind]||discoveredBackgrounds.scenarios[row?.id]?.[kind]||''}
function enemyBattleBackground(row){return row?.battleBackground||discoveredBackgrounds.enemies[row?.id]?.battleBackground||''}
function probeBackground(path){
 if(backgroundProbeCache.has(path))return backgroundProbeCache.get(path);
 const result=new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src=new URL(path,location.href).href});
 backgroundProbeCache.set(path,result);return result;
}
const backgroundRequestTokens={adventure:0,battle:0};
async function setVerifiedBackground(id,paths){
 const node=$(id);if(!node)return;
 const token=++backgroundRequestTokens[id];
 for(const path of backgroundCandidates(...paths)){
  if(!await probeBackground(path)){
   console.warn('[ChainQuest 背景] 画像を読み込めません:',id,path);
   continue;
  }
  if(token!==backgroundRequestTokens[id])return;
  node.style.backgroundImage=`url("${path.replaceAll('"','%22')}")`;
  node.style.backgroundPosition='center';node.style.backgroundSize='cover';
  node.classList.remove('scenario-blurred-backdrop');
  if(id==='adventure')node.classList.remove('scenario-run-backdrop');
  console.info('[ChainQuest 背景] 表示:',id,path);return;
 }
 if(token!==backgroundRequestTokens[id])return;
 node.style.removeProperty('background-image');
 node.classList.remove('scenario-blurred-backdrop','scenario-run-backdrop');
 console.warn('[ChainQuest 背景] 表示可能な画像がありません:',id,paths);
}
// GitHub Pages serves static files only. Keep the local Editor API when available.
const chainQuestStaticHosting=location.hostname.endsWith('.github.io');
async function refreshScenarioBackgrounds(){
 if(chainQuestStaticHosting){
  // GitHub Pages: do not scan for optional ID-named background files.
  // Explicit backgrounds from the JSON data are used by applyCommonImages();
  // missing individual backgrounds fall back to the configured common image.
  discoveredBackgrounds={scenarios:{},enemies:{}};
  return;
 }
 try{const r=await fetch('/api/scenario-backgrounds',{cache:'no-store'});if(!r.ok)return;
 discoveredBackgrounds=await r.json();if(state){renderAdventure();applyCommonImages()}
 }catch(e){console.warn('背景画像の自動検出に失敗',e)}
}
if(!chainQuestStaticHosting)refreshScenarioBackgrounds();
function activeEventBackground(){
 const eventId=state?.eventProgress?.id;
 const ev=eventId?item('events',eventId):null;
 const scenario=state?.adventure?item('scenarios',state.adventure.scenarioId):null;
 return ev?.eventBackground||scenarioBackground(scenario,'adventureBackground')||scenario?.image||'';
}
function applyEventBackground(){
 const node=$('novel');if(!node)return;
 // Keep the final event backdrop visible until the transition away from the novel screen completes.
 // Clearing eventProgress before go('home') previously exposed the shared novel background for a frame.
 if(screen==='novel'&&!state?.eventProgress)return;
 const path=state?.eventProgress?activeEventBackground():'';
 if(path){node.style.backgroundImage=`url("${path.replaceAll('"','%22')}")`;node.style.backgroundPosition='center';node.style.backgroundSize='cover'}
 else if(commonAssets.images?.novel){node.style.backgroundImage=`url("${commonAssets.images.novel.replaceAll('"','%22')}")`}
 else node.style.removeProperty('background-image');
}
function applyCommonImages(){
 const scenario=state?.adventure?item('scenarios',state.adventure.scenarioId):null;
 const adventureNode=$('adventure');
 if(adventureNode){
  if(state?.adventure){
   setVerifiedBackground('adventure',[
    scenario?.adventureBackground,
    discoveredBackgrounds.scenarios[scenario?.id]?.adventureBackground,
    commonAssets.images?.['select-scenario']
   ]);
  }else{
   ++backgroundRequestTokens.adventure;
   adventureNode.classList.remove('scenario-run-backdrop');
   const path=commonAssets.images?.['select-scenario']||'';
   adventureNode.style.backgroundImage=path?`url("${path.replaceAll('"','%22')}")`:'';
  }
 }
 const enemy=battle?.enemy;
 setVerifiedBackground('battle',[
  enemy?.battleBackground,
  discoveredBackgrounds.enemies[enemy?.id]?.battleBackground,
  scenario?.battleBackground,
  discoveredBackgrounds.scenarios[scenario?.id]?.battleBackground,
  commonAssets.images?.battle
 ]);
 // Novel background is exclusively managed by applyEventBackground().
 // Do not reset it to the common image while leaving an OP/event.
 for(const key of ['title','select','home','status','shop','items-page']){
  const node=$(key);if(!node)continue;
  const path=commonAssets.images?.[key]||'';
  if(path){node.style.backgroundImage=`url("${path.replaceAll('"','%22')}")`;node.style.backgroundPosition='center';node.style.backgroundSize='cover'}
  else node.style.removeProperty('background-image');
 }
 applyEventBackground();
 applyCollectionBackground();
 const homeButtons={save:document.getElementById('save'),shop:document.querySelector('#home [data-go=shop]'),adventure:document.querySelector('#home [data-go=adventure]'),status:document.querySelector('#home [data-go=status]'),items:document.querySelector('#home [data-go=items-page]'),collection:document.querySelector('#home [data-go=collection]')};
 for(const [key,node] of Object.entries(homeButtons)){if(!node)continue;node.querySelector('.custom-button-art')?.remove();node.classList.remove('has-button-image');const src=commonAssets.images?.['homeButton_'+key];if(src){const im=document.createElement('img');im.className='custom-button-art';im.alt='';im.src=src;im.onload=()=>node.classList.add('has-button-image');im.onerror=()=>{im.remove();node.classList.remove('has-button-image')};node.append(im)}}
 const noka=document.querySelector('#status .status-art img');if(noka&&commonAssets.images?.noka){const frame=noka.closest('.status-art');frame?.classList.remove('missing-art');noka.hidden=false;noka.onerror=()=>{noka.hidden=true;frame?.classList.add('missing-art')};noka.onload=()=>{noka.hidden=false;frame?.classList.remove('missing-art')};noka.src=commonAssets.images.noka}
 const mini=$('hero'),miniSrc=commonAssets.images?.homeMiniNoka;if(mini){mini.querySelector('img')?.remove();mini.classList.toggle('mini-noka',!!miniSrc);if(miniSrc){const im=document.createElement('img');im.src=miniSrc;im.alt='前田ノカ';im.onerror=()=>{im.remove();mini.classList.remove('mini-noka')};mini.append(im)}}
 const shopNode=document.querySelector('#shop .shop-npc');
 if(shopNode){const src=shopPortraitType==='B'?(shopExpression||commonAssets.images?.shopNpcB||commonAssets.images?.shopNpc):commonAssets.images?.shopNpc;const pos=collectionConfig.shopPortraitSettings||{};const settings=pos[shopPortraitType]||{};shopNode.style.setProperty('--portrait-x',`${Number(settings.x)||0}px`);shopNode.style.setProperty('--portrait-scale',`${Math.max(25,Math.min(250,Number(settings.scale)||100))/100}`);swapPortraitImage(shopNode,src,'shop-portrait-layer');}
 for(const [selector,key] of [['#gacha-art-equipment','shopGachaEquipment'],['#gacha-art-skills','shopGachaSkills']]){const node=document.querySelector(selector);if(!node)continue;node.querySelector('.common-custom-art')?.remove();const src=commonAssets.images?.[key];if(src){const im=document.createElement('img');im.className='common-custom-art';im.alt='';im.src=src;im.onload=()=>node.classList.add('custom-art-ready');im.onerror=()=>{im.remove();node.classList.remove('custom-art-ready')};node.append(im)}else node.classList.remove('custom-art-ready')}

}
function swapPortraitImage(node,src,cls){
 const wanted=String(src||'');
 if(node.dataset.portraitWanted===wanted)return;
 node.dataset.portraitWanted=wanted;
 const token=String((Number(node.dataset.portraitGeneration)||0)+1);
 node.dataset.portraitGeneration=token;
 const clear=()=>node.querySelectorAll('.'+cls).forEach(im=>im.remove());
 if(!wanted){clear();node.classList.remove('custom-art-ready');return}
 const incoming=new Image();
 incoming.className=cls;incoming.dataset.src=wanted;incoming.alt='';
 const show=()=>{
  if(node.dataset.portraitGeneration!==token)return;
  // Do not retain the preceding portrait beneath the new one.
  clear();
  incoming.style.transition='none';incoming.style.opacity='0';
  node.append(incoming);node.classList.add('custom-art-ready');
  requestAnimationFrame(()=>{
   if(node.dataset.portraitGeneration!==token)return;
   // Force the initial opacity to be committed before the 0.1s fade.
   void incoming.offsetWidth;
   incoming.style.transition='opacity .1s linear';incoming.style.opacity='1';
  });
 };
 incoming.onload=show;
 incoming.onerror=()=>{if(node.dataset.portraitGeneration===token)node.dataset.portraitWanted=''};
 incoming.src=wanted;
 if(incoming.complete&&incoming.naturalWidth>0)show();
}
function prepareShopPortraitEntry(){
 const node=document.querySelector('#shop .shop-npc');
 if(!node)return;
 // Clear previous visit's layers while the outgoing screen is still visible.
 node.querySelectorAll('.shop-portrait-layer').forEach(im=>im.remove());
 node.dataset.portraitWanted='';
 node.dataset.portraitGeneration=String((Number(node.dataset.portraitGeneration)||0)+1);
 node.classList.remove('custom-art-ready');
}
function commonImgSrc(path){if(path==='assets/ui/coin.png')return cqImageUrl(commonImg('coin',path));if(path==='assets/ui/medicine.png')return cqImageUrl(commonImg('medicine',path));return cqImageUrl(path)}
document.getElementById('voice-volume')?.addEventListener('input',e=>cqSetVoiceVolume(e.target.value));if(document.getElementById('voice-volume'))document.getElementById('voice-volume').value=Math.round(voiceVolume*100);
document.getElementById('se-volume')?.addEventListener('input',e=>{seVolume=Number(e.target.value)/100;localStorage.setItem('cq-se-volume',e.target.value)});if(document.getElementById('se-volume'))document.getElementById('se-volume').value=Math.round(seVolume*100);
fetch('data/common_assets.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>{if(!v)return;Object.assign(commonAssets,v);for(const key of ['home','adventure','battle','victory','defeat'])if(v.bgm?.[key])music.settings[key]=v.bgm[key];applyCommonImages();refreshSharedBackButtons();if(state)renderAdventure();musicSync()}).catch(()=>{});
let collectionExpression=null,collectionExpressionTimer=null,collectionExpressionAudio=null,collectionExpressionSerial=0;
let shopExpression=null,shopExpressionTimer=null,shopExpressionAudio=null,shopExpressionSerial=0;
function resetShopExpression(){shopExpressionSerial++;if(shopExpressionTimer!==null){clearTimeout(shopExpressionTimer);shopExpressionTimer=null}if(shopExpressionAudio){shopExpressionAudio.pause();shopExpressionAudio=null}shopExpression=null;if(screen==='shop')applyCommonImages()}
let shopPortraitType='A';
function playShopAudio(path,onFinish){
 if(!/^assets\/(?:voices|audio\/se)\/[\w.-]+\.mp3$/i.test(path||''))return null;
 try{const audio=new Audio(path);audio.addEventListener('ended',onFinish,{once:true});if(/^assets\/voices\//i.test(path))cqPlayVoice(audio);else{audio.volume=seVolume;audio.play().catch(()=>onFinish())}return audio}catch{return null}
}
function shopExpressionVoice(key){
 if(screen!=='shop')return;
 resetShopExpression();const serial=shopExpressionSerial;
 shopExpression=shopPortraitType==='B'?(collectionConfig.shopExpressions?.[key]||null):null;
 if(shopExpression)applyCommonImages();
 const finish=()=>{if(serial!==shopExpressionSerial)return;shopExpression=null;shopExpressionAudio=null;if(shopExpressionTimer!==null){clearTimeout(shopExpressionTimer);shopExpressionTimer=null}if(screen==='shop')applyCommonImages()};
 const choose=arr=>Array.isArray(arr)&&arr.length?arr[Math.floor(Math.random()*arr.length)]:'';
 const fixed=collectionConfig.shopSE?.[key]||(key==='shopEnter'?choose(collectionConfig.voices?.[key]):(collectionConfig.voices?.[key]||[])[0]||'');
 const voice=key==='shopEnter'?'':choose(collectionConfig.shopRandomVoices?.[key]);
 // Both audio tracks start together; expression waits for the voice if available.
 const se=playShopAudio(fixed,()=>{});
 const spoken=playShopAudio(voice,finish);
 shopExpressionAudio=spoken||se;
 if(!spoken){if(se){se.addEventListener('ended',finish,{once:true})}else shopExpressionTimer=setTimeout(finish,2000)}
}
function resetCollectionExpression(){
 collectionExpressionSerial++;
 if(collectionExpressionTimer!==null){clearTimeout(collectionExpressionTimer);collectionExpressionTimer=null}
 if(collectionExpressionAudio){collectionExpressionAudio.pause();collectionExpressionAudio=null}
 collectionExpression=null;
 if(screen==='collection')renderCollection();
}
function collectionExpressionVoice(key){
 if(screen!=='collection')return;
 resetCollectionExpression();
 const serial=collectionExpressionSerial;
 const configured=collectionConfig.expressions?.[key]||'';
 if(configured){collectionExpression=configured;renderCollection()}
 const paths=collectionConfig.voices?.[key]||[];
 const path=Array.isArray(paths)&&paths.length?paths[Math.floor(Math.random()*paths.length)]:'';
 const finish=()=>{if(serial!==collectionExpressionSerial)return;collectionExpressionAudio=null;collectionExpression=null;if(collectionExpressionTimer!==null){clearTimeout(collectionExpressionTimer);collectionExpressionTimer=null}if(screen==='collection')renderCollection()};
 // SEがない場合・再生できない場合は2秒後に通常表情へ戻す。
 if(!/^assets\/(?:voices|audio\/se)\/[\w.-]+\.mp3$/i.test(path)){collectionExpressionTimer=setTimeout(finish,2000);return}
 try{
  const audio=new Audio(path);collectionExpressionAudio=audio;if(/^assets\/voices\//i.test(path))cqPlayVoice(audio);else audio.volume=seVolume;
  audio.addEventListener('ended',finish,{once:true});
  audio.addEventListener('error',()=>{if(serial===collectionExpressionSerial){collectionExpressionTimer=setTimeout(finish,2000)}},{once:true});
  if(!/^assets\/voices\//i.test(path))audio.play().catch(()=>{if(serial===collectionExpressionSerial){collectionExpressionTimer=setTimeout(finish,2000)}});
 }catch(e){collectionExpressionTimer=setTimeout(finish,2000)}
}
// Collection voices are handled separately by the collection expression player.
fetch('data/characters.json',{cache:'no-store'}).then(r=>r.ok?r.json():[]).then(rows=>{characterRows=Array.isArray(rows)?rows:[];if(state&&screen==='collection')renderCollection()}).catch(console.warn);
fetch('data/collection.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(v=>{collectionConfig=v||collectionConfig;applyCollectionBackground();if(state)renderCollection()}).catch(()=>{});
let battle=null;
let battleLocked=false;const BATTLE_DELAY={startup:530,result:820,between:620,guestSupport:900,guestLead:550,victory:850};const sleep=ms=>new Promise(r=>setTimeout(r,ms));const battleAudio=new Audio();
let bookSelected=null;const DIFFICULTIES=['EASY','NORMAL','HARD'];const DIFF_STATS={EASY:{hp:.75,atk:.75,def:.75,spd:1},NORMAL:{hp:1,atk:1,def:1,spd:1},HARD:{hp:1.5,atk:1.3,def:1.3,spd:1.2}};
const lines=[{text:'今日も冒険する？'},{text:'準備はできてるよ。'},{text:'何か用？'}];
function fit(){const s=Math.min(innerWidth/1920,innerHeight/1080);$('stage').style.transform=`scale(${s})`;}addEventListener('resize',fit);fit();
const SLOT_UNLOCK_COST={equipment:20,item:20,guest:20};
function slotCost(kind){return Math.max(0,Math.floor(Number(commonAssets.slotUnlockCosts?.[kind]??SLOT_UNLOCK_COST[kind])||0))}
function fresh(){return {version:1,player:{level:1,hp:10,maxHp:10,atk:1,def:1,spd:1,coins:0,medicine:0},inventory:{equipment:[],items:[],guests:[],skills:[]},equipped:{equipment:null,item:null,guest:null,equipment2:null,item2:null,guest2:null,skills:[null,null,null]},flags:{},counters:{save:{},scenario:{}},eventDrawPools:{save:{},scenario:{}},scenarios:{},homeDialogue:{pending:null},adventure:null,battle:null,novel:null,upgrades:{hp:0,atk:0,def:0,spd:0},slotUnlocks:{equipment:false,item:false,guest:false},redeemedCodes:[],shopUnlocks:{},collectionReports:{},collectionBook:{equipment:[],items:[],skills:[]},itemLevels:{},bookmarksUnlocked:{},guestAffection:{},guestEventsDone:{},pendingGuestEvent:null,pendingGuestEvents:[],eventProgress:null,eventBattlePending:false}}
// Stage 41: defensive save validation and last-known-good backup per slot.
const saveBackupKey=key=>key+'_backup';
const safeRecord=o=>o&&typeof o==='object'&&!Array.isArray(o);
const safeCount=(n,fallback=0)=>Number.isFinite(Number(n))?Math.max(0,Math.floor(Number(n))):fallback;
function normalize(s){
 if(!safeRecord(s)||s.version!==1||!safeRecord(s.player)||!Number.isFinite(s.player.level)||s.player.level<1)return null;
 const defaults=fresh();
 for(const k of ['level','maxHp','hp','atk','def','spd','coins','medicine'])s.player[k]=safeCount(s.player[k],defaults.player[k]);
 s.player.level=Math.max(1,s.player.level);s.player.maxHp=Math.max(1,s.player.maxHp);s.player.hp=Math.min(s.player.maxHp,s.player.hp);
 s.inventory=safeRecord(s.inventory)?s.inventory:{};
 for(const k of Object.keys(TYPES))s.inventory[k]=Array.isArray(s.inventory[k])?[...new Set(s.inventory[k].filter(x=>typeof x==='string'))]:[];
 s.collectionBook=safeRecord(s.collectionBook)?s.collectionBook:{};
 for(const k of ['equipment','items','skills'])s.collectionBook[k]=Array.isArray(s.collectionBook[k])?[...new Set(s.collectionBook[k].filter(id=>typeof id==='string'))]:[];
 s.equipped=safeRecord(s.equipped)?s.equipped:{};
 for(const k of ['equipment','item','guest','equipment2','item2','guest2'])if(typeof s.equipped[k]!=='string')s.equipped[k]=null;
 s.slotUnlocks=safeRecord(s.slotUnlocks)?s.slotUnlocks:{};for(const k of ['equipment','item','guest'])s.slotUnlocks[k]=s.slotUnlocks[k]===true;
 s.equipped.skills=Array.isArray(s.equipped.skills)?s.equipped.skills.slice(0,3).map(x=>typeof x==='string'?x:null):[];
 while(s.equipped.skills.length<3)s.equipped.skills.push(null);
 for(const k of ['flags','scenarios','homeDialogue','upgrades','itemLevels','bookmarksUnlocked','guestAffection','guestEventsDone','shopUnlocks','collectionReports'])if(!safeRecord(s[k]))s[k]=structuredClone(defaults[k]);
 s.counters=safeRecord(s.counters)?s.counters:{save:{},scenario:{}};for(const scope of ['save','scenario']){if(!safeRecord(s.counters[scope]))s.counters[scope]={};for(const [id,value] of Object.entries(s.counters[scope])){if(!id.trim()||!Number.isFinite(Number(value)))delete s.counters[scope][id];else s.counters[scope][id]=Math.max(0,Math.floor(Number(value)))}}
 s.redeemedCodes=Array.isArray(s.redeemedCodes)?[...new Set(s.redeemedCodes.filter(x=>typeof x==='string'))]:[];for(const k of ['hp','atk','def','spd'])s.upgrades[k]=safeCount(s.upgrades[k]);
 for(const [k,v] of Object.entries(s.guestAffection))s.guestAffection[k]=Math.min(20,safeCount(v));
 if(!safeRecord(s.adventure))s.adventure=null;
 if(s.adventure){s.adventure.uses=safeRecord(s.adventure.uses)?s.adventure.uses:{};s.adventure.coins=safeCount(s.adventure.coins);s.adventure.area=safeCount(s.adventure.area);s.adventure.pendingTrapDamage=safeCount(s.adventure.pendingTrapDamage);}
 if(!safeRecord(s.eventProgress))s.eventProgress=null;
 s.eventBattlePending=!!s.eventBattlePending;
 return s;
}
function parseSave(raw){if(!raw)return null;try{return normalize(JSON.parse(raw))}catch{return null}}
function load(key){
 try{const primary=parseSave(localStorage.getItem(key));if(primary)return primary;
 const backup=parseSave(localStorage.getItem(saveBackupKey(key)));if(backup){backup.recoveredFromBackup=true;return backup}
 return null}catch{return null}
}
function write(key){
 if(!state||!saveSafe())return false;
 try{
  const old=localStorage.getItem(key);
  // Never overwrite a valid backup with a damaged primary save.
  if(parseSave(old))localStorage.setItem(saveBackupKey(key),old);
  const snapshot=JSON.stringify({...state,adventure:null,battle:null,novel:null,eventProgress:null,eventBattlePending:false,eventBattlePendingPortrait:false,pendingGuestEvent:null,pendingGuestEvents:[],recoveredFromBackup:false,savedAt:new Date().toISOString(),location:'ホーム'});
  if(!parseSave(snapshot))throw Error('invalid save');
  localStorage.setItem(key,snapshot);return true;
 }catch(e){notice('保存に失敗しました。ブラウザの保存領域をご確認ください。');return false}
}
function syncCollectionBook(){
 if(!state)return false;
 if(!safeRecord(state.collectionBook))state.collectionBook={};
 let changed=false;
 for(const kind of ['equipment','items','skills']){
  const existing=Array.isArray(state.collectionBook[kind])?state.collectionBook[kind]:[];
  const known=new Set(existing);
  for(const id of state.inventory?.[kind]||[])if(typeof id==='string'&&!known.has(id)){known.add(id);changed=true}
  state.collectionBook[kind]=[...known];
 }
 // Weapon-exclusive skills enter the encyclopedia as soon as the weapon
 // reaches the level that unlocks them. This does not grant the skill.
 const skillKnown=new Set(state.collectionBook.skills);
 for(const weaponId of state.inventory?.equipment||[]){
  const weapon=item('equipment',weaponId);
  if(!weapon)continue;
  const weaponLv=ownedLevel('equipment',weaponId);
  for(const spec of weapon.weaponSkills||[]){
   if(!spec?.skillId||!catalog.skills?.some(skill=>skill.id===spec.skillId))continue;
   if(weaponSkillLevel(spec,weaponLv)>0&&!skillKnown.has(spec.skillId)){
    skillKnown.add(spec.skillId);
    changed=true;
   }
  }
 }
 state.collectionBook.skills=[...skillKnown];
 return changed;
}
// Only stable home/base state may be persisted. Never capture in-flight events or battles.
function saveSafe(){return !!state&&!state.adventure&&!state.eventProgress&&!state.eventBattlePending&&!battle&&!state.battle&&screen!=='battle'&&screen!=='novel'&&['home','shop','status','items-page','collection','adventure','select'].includes(screen)}
function auto(){if(saveSafe()){syncCollectionBook();write(AUTO)}}
// Portable backup includes both normal save slots and their recovery snapshots.
async function exportSaves(){
 const slots={};for(const [name,key] of [['auto',AUTO],['manual',MANUAL]]){
  const main=load(key),backup=parseSave(localStorage.getItem(saveBackupKey(key)));
  if(main)slots[name]={save:main,backup:backup||null};
 }
 if(!Object.keys(slots).length){notice('バックアップできるセーブデータがありません。');return}
 const data={format:'chainquest-save-backup',version:1,exportedAt:new Date().toISOString(),testMode:TEST_MODE,slots};
 if(!crypto?.subtle){notice('この環境では暗号化できません（localhost または HTTPS で起動してください）。');return}
 // Password-free encrypted container. The bundled key is not a tamper-proof secret.
 let envelope;
 try{const iv=crypto.getRandomValues(new Uint8Array(12));const key=await portableBackupKey();const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(data)));envelope={format:'chainquest-obfuscated-backup',version:2,cipher:'AES-256-GCM',iv:toB64(iv),data:toB64(new Uint8Array(cipher))}}catch{notice('バックアップの暗号化に失敗しました。');return}
 const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='ChainQuest_backup_'+new Date().toISOString().slice(0,10)+'.cqsave';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function toB64(bytes){let s='';for(const x of bytes)s+=String.fromCharCode(x);return btoa(s)}
function fromB64(str){return Uint8Array.from(atob(str),c=>c.charCodeAt(0))}
async function portableBackupKey(){const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ChainQuest|portable|backup|v2|client-side'));return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt'])}
async function backupKey(password,salt){const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function importSaves(file){
 if(!file)return;
 try{
  if(file.size>5*1024*1024)throw Error('ファイルが大きすぎます。');
  let data=JSON.parse(await file.text());
  if(data?.format==='chainquest-obfuscated-backup'){
   if(!crypto?.subtle)throw Error('読み込みにはlocalhostまたはHTTPSが必要です。');
   if(data.version!==2||data.cipher!=='AES-256-GCM')throw Error('未対応のバックアップ形式です。');
   try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(data.iv)},await portableBackupKey(),fromB64(data.data));data=JSON.parse(new TextDecoder().decode(plain))}catch{throw Error('バックアップが破損しているか、形式が正しくありません。')}
  }
  if(data?.format==='chainquest-encrypted-backup'){
   if(!crypto?.subtle)throw Error('暗号化バックアップの読み込みにはlocalhostまたはHTTPSが必要です。');
   if(data.version!==1||data.iterations!==250000||data.cipher!=='AES-256-GCM')throw Error('未対応の暗号化形式です。');
   const password=prompt('バックアップのパスワードを入力してください');if(password===null)return;
   try{const key=await backupKey(password,fromB64(data.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(data.iv)},key,fromB64(data.data));data=JSON.parse(new TextDecoder().decode(plain))}catch{throw Error('パスワードが違うか、ファイルが破損しています。')}
  }
  if(data?.format!=='chainquest-save-backup'||data.version!==1||!safeRecord(data.slots))throw Error('ChainQuestのバックアップファイルではありません。');
  if(!!data.testMode!==TEST_MODE)throw Error('通常データとテストデータは相互に読み込めません。');
  const imports=[];
  for(const [name,key] of [['auto',AUTO],['manual',MANUAL]]){
   const entry=data.slots[name];if(!entry)continue;
   const restored=parseSave(JSON.stringify(entry.save));
   if(!restored)throw Error(name+'のセーブデータが不正です。');
   const backup=entry.backup==null?null:parseSave(JSON.stringify(entry.backup));
   if(entry.backup!=null&&!backup)throw Error(name+'の予備データが不正です。');
   imports.push({name,key,restored,backup});
  }
  if(!imports.length)throw Error('読み込めるセーブデータがありません。');
  modal('バックアップを読み込みますか？ 現在の同じセーブ枠は上書きされます。',()=>{
   try{
    // Stage all data before modifying storage, so a quota failure does not silently erase old saves.
    const old=new Map();for(const {key} of imports)for(const k of [key,saveBackupKey(key)])old.set(k,localStorage.getItem(k));
    try{for(const {key,restored,backup} of imports){localStorage.setItem(key,JSON.stringify({...restored,recoveredFromBackup:false}));if(backup)localStorage.setItem(saveBackupKey(key),JSON.stringify(backup));else localStorage.removeItem(saveBackupKey(key))}}
    catch(e){for(const [k,v] of old){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}throw e}
    state=null;renderSaves();notice('バックアップを読み込みました。セーブ枠を選択してください。',3000);
   }catch{notice('読み込みに失敗しました。保存領域を確認してください。',3500)}
  });
 }catch(e){notice('読み込み不可：'+e.message,3500)}
}
$('save-export').onclick=exportSaves;
$('save-import').onclick=()=>$('save-import-file').click();
$('save-import-file').onchange=e=>{const file=e.target.files?.[0];e.target.value='';importSaves(file)};

function escape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function item(k,id){const raw=catalog[k]?.find(x=>x.id===id);if(!raw||!['equipment','guests','skills'].includes(k))return raw;const lv=state?.itemLevels?.[k+':'+id]||1;const override=raw.levels?.[lv]||raw.levels?.[String(lv)]||{};return {...raw,...override,id:raw.id,name:raw.name,rank:raw.rank,levels:raw.levels}}
const UPGRADE_COST={C:[3,5],B:[5,8],A:[8,12],S:[12,18]};
let itemCategory='equipment',itemSelected=null;
function ownedLevel(k,id){return state.itemLevels?.[k+':'+id]||1}
function renderItemPage(){if(!state)return;const tabs=$('item-tabs'),list=$('item-owned-list'),detail=$('item-detail');if(!tabs)return;tabs.replaceChildren();list.replaceChildren();for(const [kind,label] of Object.entries(TYPES)){const b=document.createElement('button');b.className='small-btn'+(kind===itemCategory?' selected':'');b.textContent=label;b.onclick=()=>{itemCategory=kind;itemSelected=null;renderItemPage()};tabs.append(b)}const ids=state.inventory[itemCategory]||[];if(!ids.length){list.textContent='所持アイテムがありません';detail.textContent='';return}if(!ids.includes(itemSelected))itemSelected=ids[0];for(const id of ids){const row=item(itemCategory,id);if(!row)continue;const b=document.createElement('button');b.className='pick-entry'+(id===itemSelected?' selected':'');b.textContent=(row.name||id)+(['equipment','guests','skills'].includes(itemCategory)?'  Lv.'+ownedLevel(itemCategory,id):'');b.onclick=()=>{itemSelected=id;renderItemPage()};list.append(b)}const row=item(itemCategory,itemSelected);if(!row){detail.textContent='';return}detail.replaceChildren();if(itemCategory!=='skills'){const art=document.createElement('div');art.className='item-detail-art';art.innerHTML=imgHTML(itemCategory,row);detail.append(art)}const title=document.createElement('h3');const canUpgrade=itemCategory!=='items';const lv=canUpgrade?ownedLevel(itemCategory,row.id):0;title.textContent=(itemCategory==='equipment'?'['+(row.rank||'C')+'] ':'')+(row.name||row.id)+(canUpgrade?'  Lv.'+lv:'');detail.append(title);if(itemCategory==='equipment'&&row.cvEnabled&&String(row.cvText||'').trim()){const cv=document.createElement('div');cv.className='equipment-cv';cv.textContent='CV:'+row.cvText;detail.append(cv)}const desc=document.createElement('p');desc.className='item-description';desc.textContent=itemCategory==='skills'?skillLevelDescription(row):row.description||'';detail.append(desc);for(const line of compactDetailLines(itemCategory,row)){const p=document.createElement('p');p.textContent=line;detail.append(p)}if(itemCategory==='guests'){const h=document.createElement('div');h.innerHTML=affectionHearts(row.id);detail.append(h)}const equip=document.createElement('button');equip.className='btn';equip.textContent='装備する';equip.onclick=()=>{if(itemCategory==='skills'){const root=$('picker-list');root.replaceChildren();$('picker-detail').replaceChildren();$('picker-detail').hidden=true;$('picker-confirm').hidden=true;$('picker-title').textContent='装備するスキル枠を選択';$('picker-close').onclick=()=>{$('picker').classList.remove('open')};for(let i=0;i<3;i++){const b=document.createElement('button');b.className='pick-entry';b.textContent=`スキル${i+1}：${item('skills',state.equipped.skills[i])?.name||'未設定'}`;b.onclick=()=>{if(state.equipped.skills.some((x,j)=>j!==i&&x===row.id)){notice('同じスキルは複数枠に設定できません');return}state.equipped.skills[i]=row.id;$('picker').classList.remove('open');auto();update();notice('装備しました',325)};root.append(b)}$('picker').classList.add('open');return}const slots=pickerSlotDefs(itemCategory);
 const applyItemSlot=(index)=>{for(const slot of slots){if(slot.index!==index&&pickerSlotId(itemCategory,slot.index)===row.id)setPickerSlot(itemCategory,slot.index,null)}setPickerSlot(itemCategory,index,row.id);$('picker').classList.remove('open');auto();update();notice('装備しました',325)};
 if(slots.length===1){applyItemSlot(slots[0].index);return}
 const root=$('picker-list'),detailPanel=$('picker-detail');root.replaceChildren();detailPanel.replaceChildren();
 $('picker-title').textContent='装備する枠を選択';
 for(const slot of slots){const b=document.createElement('button');b.className='pick-entry';const current=item(itemCategory,pickerSlotId(itemCategory,slot.index));b.textContent=`${slot.label}：${current?.name||'未装備'}`;b.onclick=()=>applyItemSlot(slot.index);root.append(b)}
 $('picker-confirm').hidden=true;detailPanel.hidden=true;
 $('picker-close').onclick=()=>{$('picker').classList.remove('open')};$('picker').classList.add('open')};detail.append(equip);if(canUpgrade){const rank=String(row.rank||'C').toUpperCase(),cost=(UPGRADE_COST[rank]||UPGRADE_COST.C)[lv-1];const up=document.createElement('button');up.className='btn';if(lv>=3)up.textContent='Lv.3';else{up.textContent='強化 ';const med=commonAssets.images?.medicine;if(med){const icon=document.createElement('img');icon.src=cqImageUrl(med);icon.alt='おくすり';icon.className='upgrade-medicine-icon';up.append(icon)}else up.append(' 💊');up.append(' ×'+cost)};up.disabled=lv>=3||state.player.medicine<cost||!!state.adventure;up.onclick=()=>modal(`${row.name}を
Lv.${lv+1}に強化しますか？
（おくすり×${cost}）`,()=>{if(state.player.medicine<cost||ownedLevel(itemCategory,row.id)!==lv)return;state.player.medicine-=cost;state.itemLevels[itemCategory+':'+row.id]=lv+1;auto();update();renderItemPage();const eventId=itemCategory==='equipment'&&lv+1===3?row.level3EventId:null;const eventKey='equipmentLv3:'+row.id;if(eventId&&!state.flags[eventKey]&&catalog.events.some(e=>e.id===eventId)){state.flags[eventKey]=true;auto();notifyDialog('強化成功',`${row.name} Lv.${lv+1}`,null,()=>runEvent(eventId,{returnTo:'items-page'}))}else notifyDialog('強化成功',`${row.name} Lv.${lv+1}`)});detail.append(up);if(state.adventure){const hint=document.createElement('p');hint.textContent='冒険中は強化できません';detail.append(hint)}}}

function affectionHearts(id){const count=Math.min(10,Math.floor((state.guestAffection?.[id]||0)/2));return `<div class="affection-hearts" aria-label="好感度"><span>好感度</span>${Array.from({length:5},(_,i)=>{const n=Math.max(0,Math.min(2,count-i*2));const f=n===2?'heart_full.png':n===1?'heart_half.png':'heart_empty.png';const src=commonImg(n===2?'heartFull':n===1?'heartHalf':'heartEmpty','assets/ui/'+f);return `<span class="heart-image"><img src="${src}" alt="" onerror="this.style.display='none'">${n===2?'♥':n===1?'◐':'♡'}</span>`}).join('')}</div>`}
let guestAffectionAudio=null;
function playGuestAffectionVoice(guestId){
 if(guestAffectionAudio){guestAffectionAudio.pause();guestAffectionAudio=null}
 const cfg=item('guests',guestId)?.affectionVoice;
 if(!cfg||!Array.isArray(cfg.paths)||!cfg.paths.length)return;
 if(Math.random()*100>=Math.max(0,Math.min(100,Number(cfg.chance??100))))return;
 const paths=cfg.paths.filter(p=>/^assets\/(?:voices|audio\/se)\/[\w.-]+\.mp3$/i.test(p));
 if(!paths.length)return;
 const audio=new Audio(paths[Math.floor(Math.random()*paths.length)]);
 guestAffectionAudio=audio;cqPlayVoice(audio,Number(cfg.volume??100)/100);
 audio.onended=()=>{if(guestAffectionAudio===audio)guestAffectionAudio=null};
 
}
// ゲストスキルの専用ボイスは、ノカの共通ランダムボイスとは別チャンネルで再生。
const guestSkillVoiceAudio={auto:null,manual:null};
function playGuestSkillVoice(guestId,kind){
 const cfg=item('guests',guestId)?.[kind==='auto'?'autoSkillVoice':'manualSkillVoice'];
 if(!cfg||!Array.isArray(cfg.paths))return;
 const paths=cfg.paths.filter(p=>/^assets\/(?:voices|audio\/se)\/[\w.-]+\.mp3$/i.test(p));
 if(!paths.length||Math.random()*100>=Math.max(0,Math.min(100,Number(cfg.chance??100))))return;
 const prior=guestSkillVoiceAudio[kind];if(prior&&!prior.paused&&!prior.ended)return;
 try{const audio=new Audio(paths[Math.floor(Math.random()*paths.length)]);guestSkillVoiceAudio[kind]=audio;
 cqPlayVoice(audio,Number(cfg.volume??100)/100);
 const release=()=>{if(guestSkillVoiceAudio[kind]===audio)guestSkillVoiceAudio[kind]=null};
 audio.onended=release;audio.onerror=release;
 }catch(err){console.warn('ゲストスキルボイス再生失敗',guestId,kind,err)}
}
function grantAffection(){const gains=[];state.pendingGuestEvents??=[];for(const id of equippedGuestIds()){const old=state.guestAffection[id]||0;if(old>=20)continue;const next=Math.min(20,old+1);state.guestAffection[id]=next;const guest=item('guests',id);if(next===20&&!state.guestEventsDone[id]){state.guestEventsDone[id]=true;state.pendingGuestEvents.push({guestId:id,eventId:guest?.affectionEventId||null,name:guest?.name||'ゲスト'})}gains.push({id,name:guest?.name||'ゲスト',level:next,bonus:old<10&&next>=10,hearts:affectionHearts(id)})}return gains}
function nextGuestAffectionEvent(){const pending=state?.pendingGuestEvents?.shift();if(!pending)return false;auto();if(pending.eventId&&runEvent(pending.eventId,{returnTo:'adventure',guestChain:true}))return true;notifyDialog('ゲスト専用イベント解放',`${pending.name}の専用イベントが解放されました。`,null,()=>nextGuestAffectionEvent());return true}
function equippedIds(key){return [state?.equipped?.[key],state?.slotUnlocks?.[key]?state?.equipped?.[key+'2']:null].filter(Boolean)}
function equippedGuestIds(){return equippedIds('guest')}
function equippedEquipmentIds(){return equippedIds('equipment')}
function equippedItemIds(){return equippedIds('item')}
function guestBondUnlocked(){return equippedGuestIds().some(id=>Number(state.guestAffection?.[id]||0)>=10)}
function guestBondData(){return equippedGuestIds().filter(id=>Number(state.guestAffection?.[id]||0)>=10).map(id=>item('guests',id)?.affectionBonus||{})}
function bonus(stat){const field=(stat==='maxHp'?'hp':stat)+'Bonus';return [...equippedEquipmentIds().map(id=>item('equipment',id)),...equippedGuestIds().map(id=>item('guests',id)),...guestBondData()].reduce((sum,row)=>sum+(Number(row?.[field])||0),0)}
function effective(stat){return Number(state.player[stat]||0)+bonus(stat)}
function upgradeCost(stat){const n=stat==='hp'?state.upgrades.hp:state.player.level-1;return Math.max(1,Math.floor(n/5)+1)}
function update(){if(!state){$('continue').disabled=!load(AUTO)&&!load(MANUAL);return}$('coin').innerHTML=currencyHTML();renderStatus();renderShop();renderGacha();renderItemPage();renderEnemyPicker();renderAdventure();renderCollection();refreshSharedBackButtons();$('continue').disabled=!load(AUTO)&&!load(MANUAL)}
function coinIconHTML(n){return `<span class="inline-coin"><img src="${commonImgSrc('assets/ui/coin.png')}" alt="" onerror="this.style.display='none'">${n}</span>`}
function currencyHTML(){const p=state.player;const fmt=n=>String(Math.max(0,Math.floor(Number(n)||0))).padStart(3,'0');return `<span class="currency-entry"><img src="${commonImgSrc('assets/ui/coin.png')}" onerror="this.style.display='none'" alt="">×${fmt(p.coins)}</span><span class="currency-entry"><img src="${commonImgSrc('assets/ui/medicine.png')}" onerror="this.style.display='none'" alt="">×${fmt(p.medicine)}</span>`}
// Stage 60: reward SE. S-rank equipment uses the special sound; other rewards use normal.
const rewardSE={normal:'',sRank:''};
fetch('data/reward_se.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(v=>{rewardSE.normal=v.normal||'';rewardSE.sRank=v.sRank||''}).catch(()=>{});
function playRewardSE(row){randomVoice('reward');if(commonAssets.se?.rewardNormal?.path||commonAssets.se?.rewardS?.path){commonSE(String(row?.rank||'').toUpperCase()==='S'?'rewardS':'rewardNormal');return}const rank=String(row?.rank||'').toUpperCase();const path=rank==='S'?rewardSE.sRank:rewardSE.normal;if(!/^assets\/audio\/se\/[a-zA-Z0-9_-]+\.mp3$/.test(path||''))return;const audio=new Audio(path);audio.volume=0.8;audio.play().catch(()=>{});}
let rewardAfterClose=null;function notifyDialog(title,message,artPath,onClose=null){rewardAfterClose=onClose;const box=$('reward-modal');$('reward-kind').textContent=title;$('reward-name').textContent=message;const art=$('reward-art');art.replaceChildren();art.classList.remove('reward-small-icon');art.hidden=!artPath;if(artPath){const img=document.createElement('img');img.src=artPath;img.alt='';img.onerror=()=>{art.textContent='画像未登録'};art.append(img)}box.classList.add('open');if(/獲得/.test(title))playRewardSE(null);$('reward-close').focus()}
function hideBubble(){clearTimeout(bubbleTimer);$('bubble').hidden=true;if(voice){voice.pause();voice.currentTime=0;voice=null}}
let queuedScreen=null;function go(id){if(!$(id))return;if(!state?.eventProgress)clearEventDarkWait();if(!state?.eventProgress)clearEventStepImage();if(busy){queuedScreen=id;return}busy=true;if(id==='shop'){document.activeElement?.blur?.();shopPortraitType=Math.random()<0.5?'A':'B';shopExpression=null;prepareShopPortraitEntry()}hideBubble();$('fade').classList.add('on');setTimeout(()=>{if(id==='shop')applyCommonImages();document.querySelectorAll('.screen').forEach(e=>e.classList.toggle('active',e.id===id));screen=id;if(id==='shop')shopExpressionVoice('shopEnter');else if(shopExpression!==null||shopExpressionAudio)resetShopExpression();if(id==='collection')collectionExpressionVoice('collectionEnter');else if(collectionExpression!==null||collectionExpressionAudio)resetCollectionExpression();$('bgm-settings').hidden=true;update();musicSync();if(state&&id!=='title'&&id!=='select')auto();applyCommonImages();refreshSharedBackButtons();$('fade').classList.remove('on');setTimeout(()=>{busy=false;if(queuedScreen){const next=queuedScreen;queuedScreen=null;if(next!==screen)go(next)}},250)},250)}
function notice(message,duration=1400){const box=$('notice');box.textContent=message;box.classList.add('open');clearTimeout(notice.timer);notice.timer=setTimeout(()=>box.classList.remove('open'),duration)}
function showReward(kind,row){const box=$('reward-modal');$('reward-kind').textContent=kind==='equipment'?'装備を獲得！':'スキルを獲得！';$('reward-name').textContent=row.name||'名称未設定';const art=$('reward-art');art.replaceChildren();art.classList.remove('reward-small-icon');art.hidden=kind!=='equipment';if(kind==='equipment'){const p=row.image||row.asset;if(typeof p==='string'&&/^assets\/(items|equipment)\/[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(p)){const img=document.createElement('img');img.src=p;img.alt=row.name||'獲得した装備';img.onerror=()=>{art.textContent='画像未登録'};art.append(img)}else art.textContent='画像未登録'}box.classList.add('open');playRewardSE(row);$('reward-close').focus()}
$('reward-close').onclick=e=>{e.stopPropagation();$('reward-modal').classList.remove('open');const next=rewardAfterClose;rewardAfterClose=null;if(next)next()};
// Stage 59: story reward presentation, reusing the gacha reward dialog.
function eventRewardPopup(type,st,done){
 if(st.showReward===false){done();return}
 const kind={GIVE_ITEM:'items',GIVE_GUEST:'guests',GIVE_SKILL:'skills',GIVE_EQUIPMENT:'equipment'}[type];
 const row=kind?item(kind,st.id||st.itemId):null;
 const count=Math.max(0,Math.floor(Number(st.amount)||0));
 const title={GIVE_ITEM:'アイテムを獲得！',GIVE_GUEST:'ゲストを獲得！',GIVE_SKILL:'スキルを獲得！',GIVE_EQUIPMENT:'装備を獲得！',GIVE_COIN:'コインを獲得！',GIVE_MEDICINE:'おくすりを獲得！'}[type];
 if(!title||(!row&&kind)||(!kind&&!count)){done();return}
 rewardAfterClose=done;
 $('reward-kind').textContent=title;
 $('reward-name').textContent=kind?(type==='GIVE_GUEST'?`${row.name||row.id}がアンロックされた。`:(row.name||row.id)):`× ${count}`;
 const art=$('reward-art');art.replaceChildren();art.hidden=type==='GIVE_SKILL';art.classList.toggle('reward-small-icon',!kind);
 if(kind&&type!=='GIVE_SKILL')art.innerHTML=imgHTML(kind,row);
 else if(!kind){const icon=document.createElement('img');icon.src=commonImgSrc(type==='GIVE_COIN'?'assets/ui/coin.png':'assets/ui/medicine.png');icon.alt='';icon.onerror=()=>{art.textContent=type==='GIVE_COIN'?'コイン':'おくすり'};art.append(icon)}
 $('reward-modal').classList.add('open');playRewardSE(row);$('reward-close').focus();
}
function modal(message,fn){$('modal-text').textContent=message;$('modal').classList.add('open');$('confirm').onclick=()=>{$('modal').classList.remove('open');fn()};$('cancel').onclick=()=>{$('modal').classList.remove('open')}}
$('new').onclick=()=>{const start=()=>{localStorage.removeItem(AUTO);localStorage.removeItem(MANUAL);localStorage.removeItem(saveBackupKey(AUTO));localStorage.removeItem(saveBackupKey(MANUAL));state=fresh();applyInitialLoadout();const intro=commonAssets.openingEventId;if(intro&&item('events',intro)){if(!runEvent(intro,{returnTo:'home'}))go('home')}else go('home')};if(load(AUTO)||load(MANUAL))modal('オート・手動セーブを両方削除して、新しいゲームを開始しますか？',start);else start()};
$('continue').onclick=()=>{renderSaves();go('select')};
function renderSaves(){const root=$('save-list');root.replaceChildren();for(const [label,key] of [['AUTO SAVE',AUTO],['MANUAL SAVE',MANUAL]]){const s=load(key),b=document.createElement('button');b.className='btn save-entry';b.disabled=!s;if(s){const date=s.savedAt?new Date(s.savedAt).toLocaleString('ja-JP'):'日時不明';b.replaceChildren();const line=document.createElement('span');line.className='save-entry-line';const level=document.createElement('span');level.textContent=`${label}　Lv.${s.player.level}`;line.append(level);for(const [icon,count,name] of [['coin.png',s.player.coins,'コイン'],['medicine.png',s.player.medicine,'おくすり']]){const currency=document.createElement('span');currency.className='save-entry-currency';const pic=document.createElement('img');pic.src=commonImgSrc('assets/ui/'+icon);pic.alt=name;pic.onerror=()=>{pic.style.display='none';currency.setAttribute('aria-label',name+' '+count)};const value=document.createElement('span');value.textContent='×'+String(Math.max(0,Math.floor(Number(count)||0))).padStart(3,'0');currency.append(pic,value);line.append(currency)}b.append(line);const info=document.createElement('span');info.className='save-entry-info';info.textContent=`${s.location||'ホーム'}　|　${date}${s.recoveredFromBackup?'　【バックアップから復旧】':''}`;b.append(info);b.onclick=()=>{state=s;state.adventure=null;state.battle=null;state.novel=null;state.eventProgress=null;state.eventBattlePending=false;state.eventBattlePendingPortrait=false;state.pendingGuestEvent=null;state.pendingGuestEvents=[];battle=null;go('home');}}else b.textContent=`${label}　―　データなし`;root.append(b)}}
$('save').onclick=()=>{if(!saveSafe()||screen!=='home'){notice('手動セーブはホーム画面で行ってください。');return}modal('現在のデータを手動セーブ枠に保存しますか？',()=>{if(write(MANUAL))notice('手動セーブしました。')})};
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('hero').onclick=()=>{if(!state)return;hideBubble();let choices=lines.map((_,i)=>i).filter(i=>i!==previous);if(!choices.length)choices=lines.map((_,i)=>i);const index=choices[Math.floor(Math.random()*choices.length)];previous=index;const line=lines[index];$('bubble').textContent=line.text;$('bubble').hidden=false;if(line.voice){voice=new Audio('assets/voices/'+line.voice);cqPlayVoice(voice);voice.onended=hideBubble;voice.onerror=()=>bubbleTimer=setTimeout(hideBubble,3000);}else bubbleTimer=setTimeout(hideBubble,3000)};
async function refreshCatalog(){
 const results=await Promise.all([...Object.keys(TYPES),'enemies','scenarios','events'].map(async k=>{
  const useApi=!chainQuestStaticHosting&&['scenarios','enemies'].includes(k);
  const urls=useApi?[`/api/data/${k}`,`data/${k}.json`]:[`data/${k}.json`];
  for(const url of urls){
   try{
    const r=await fetch(`${url}?t=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    const rows=await r.json();
    if(!Array.isArray(rows))throw Error('JSON配列ではありません');
    return [k,rows];
   }catch(e){
    if(url===urls[urls.length-1])console.warn('データ読込失敗',k,url,e);
    else console.warn('ローカルAPIが利用できないためJSONへ切り替え',k,e);
   }
  }
  return [k,[]];
 }));
 catalog=Object.fromEntries(results);
 await refreshScenarioBackgrounds();
 if(state)update();
 musicSync();
}
function imgHTML(k,row){
 const folder=k==='equipment'||k==='items'?'items':k==='guests'?'guests':'ui';
 const explicit=String(row.image||row.asset||'').replace(/^\/+/, '');
 const paths=[];
 if(explicit){paths.push(explicit);if(!explicit.startsWith('assets/'))paths.push('assets/'+explicit);}
 if(row.id)for(const ext of ['png','jpg','webp'])paths.push(`assets/${folder}/${row.id}.${ext}`);
 if(!paths.length)return '<span class="no-image">NO IMAGE</span>';
 const img=document.createElement('img');img.alt='';img.src=paths[0];
 // Images saved by the Editor can use either an explicit asset path or the conventional ID filename.
 const escaped=paths.map(x=>JSON.stringify(x)).join(',');
 return `<img src="${escape(paths[0])}" alt="" data-fallbacks="${escape(JSON.stringify(paths))}" onerror="cqImageFallback(this)">`;
}
window.cqImageFallback=function(img){
 let paths=[];try{paths=JSON.parse(img.dataset.fallbacks||'[]')}catch(_){return}
 const index=Number(img.dataset.fallbackIndex||0)+1;
 if(index>=paths.length){img.replaceWith(document.createTextNode('NO IMAGE'));return}
 img.dataset.fallbackIndex=String(index);img.src=paths[index];
}
// Stage 76: persistent unlocks. Legacy records remain available unless explicitly gated.
function collectionUnlocked(){return Number(state?.scenarios?.C001?.difficulties?.NORMAL?.clears||0)>0}
function collectionAvailable(r){const id=r.unlockScenario||'C001';return Number(state?.scenarios?.[id]?.difficulties?.NORMAL?.clears||0)>0}
function collectionTargets(r){return (Array.isArray(r.equipmentIds)?r.equipmentIds:[r.equipmentId]).filter(Boolean)}
function collectionOwned(r){const ids=collectionTargets(r);return ids.length>0&&ids.every(id=>!!state?.flags?.['obtained:'+id]||!!state?.inventory?.equipment?.includes(id))}
function collectionRows(){return (collectionConfig.requests||[]).filter(r=>r.enabled!==false&&collectionAvailable(r)).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||String(a.id).localeCompare(String(b.id)))}
function applyCollectionBackground(){const node=$('collection');if(!node)return;const path=collectionConfig.background||'';if(path){node.style.backgroundImage=`url("${path.replaceAll('\"','%22')}")`;node.style.backgroundPosition='center';node.style.backgroundSize='cover'}else node.style.removeProperty('background-image')}
function renderCollectionPortrait(){const portrait=$('collection-portrait');if(portrait){const path=collectionExpression||collectionConfig.portrait||'';portrait.style.backgroundImage='none';swapPortraitImage(portrait,path,'collection-portrait-layer');const height=Math.max(30,Math.min(200,Number(collectionConfig.portraitHeight)||100));const x=Math.max(-500,Math.min(500,Number(collectionConfig.portraitX)||0));const bottom=Math.max(-300,Math.min(300,Number(collectionConfig.portraitBottom)||0));portrait.style.backgroundSize=`auto ${height}%`;portrait.style.left=`calc(3% + ${x}px)`;portrait.style.bottom=`${bottom}px`}}
function renderCollection(){if(!state)return;syncCollectionBook();renderCollectionPortrait();if(collectionPage==='book'){renderCollectionBook();return}const bookPane=$('collection-book-pane'),requestsPane=$('collection-requests-pane');if(bookPane)bookPane.hidden=true;if(requestsPane)requestsPane.hidden=false;syncCollectionModeButtons();applyCollectionBackground();const homeButton=$('collection-home-button');if(homeButton)homeButton.hidden=!collectionUnlocked();const list=$('collection-list');if(!list)return;const rows=collectionRows(),reported=rows.filter(r=>state.collectionReports?.[r.id]).length;$('collection-progress').textContent=`達成状況 ${reported} / ${(collectionConfig.requests||[]).filter(r=>r.enabled!==false).length}`;document.querySelectorAll('[data-collection-tab]').forEach(b=>b.classList.toggle('active',b.dataset.collectionTab===collectionTab));const filtered=rows.filter(r=>collectionTab==='all'||(collectionTab==='done'?!!state.collectionReports?.[r.id]:!state.collectionReports?.[r.id]));if(!filtered.some(r=>r.id===collectionSelected))collectionSelected=filtered[0]?.id||null;list.replaceChildren();for(const r of filtered){const b=document.createElement('button');b.classList.toggle('active',r.id===collectionSelected);b.textContent=(state.collectionReports?.[r.id]?'✓ ':collectionOwned(r)?'！ ':'○ ')+(r.title||r.name||r.id);b.onclick=()=>{collectionSelected=r.id;renderCollection()};list.append(b)}if(!filtered.length)list.textContent='表示する依頼はありません。';const row=rows.find(r=>r.id===collectionSelected);const detail=$('collection-detail');detail.replaceChildren();if(row){const title=document.createElement('h3');title.textContent=row.title||row.name;const desc=document.createElement('p');desc.textContent=String(row.description||'').replace(/^(?:[\t ]*\r?\n)+|(?:\r?\n[\t ]*)+$/g,'');const target=document.createElement('p');const targets=collectionTargets(row);target.textContent='対象装備：'+(targets.length?targets.map(id=>{const owned=!!state?.flags?.['obtained:'+id]||!!state?.inventory?.equipment?.includes(id);return (owned?'✓ ':'○ ')+(row.hideItemName&&!owned?'？？？':item('equipment',id)?.name||id)}).join(' ／ '):'未設定');const reward=document.createElement('p');reward.textContent='報酬：'+(Number(row.rewardCoins)||0)+'コイン';const status=document.createElement('p');status.textContent=state.collectionReports?.[row.id]?'達成済み':collectionOwned(row)?'報告待ち！':'未達成';detail.append(desc,target,reward,status)}else detail.textContent='依頼を選択してください。';const possible=rows.filter(r=>!state.collectionReports?.[r.id]&&collectionOwned(r));$('collection-report').disabled=!possible.length;$('collection-report').textContent=possible.length?`まとめて報告（${possible.length}件）`:'まとめて報告'}
let collectionPage='requests',collectionBookKind='equipment',collectionBookSelected=null;
function syncCollectionModeButtons(){document.querySelectorAll('[data-collection-mode]').forEach(b=>b.classList.toggle('active',b.dataset.collectionMode===collectionPage))}
function characterUnlocked(row){return row.unlockMode==='initial'||(row.unlockMode==='event'&&!!row.eventId&&!!state?.flags?.['event-viewed:'+row.eventId])}
function renderCollectionBook(){if(syncCollectionBook())write(AUTO);
 const requests=$('collection-requests-pane'),pane=$('collection-book-pane');if(!pane)return;
 requests.hidden=true;pane.hidden=false;syncCollectionModeButtons();
 const kinds={equipment:'装備',items:'アイテム',skills:'スキル',characters:'人物'};
 const progress=$('collection-book-progress');progress.replaceChildren();
 let total=0,owned=0;
 for(const [kind,label] of Object.entries(kinds)){
  const rows=kind==='characters'?characterRows:(kind==='skills'?(catalog.skills||[]).filter(r=>!/^K(?:[2-9]\d{2}|\d{4,})$/i.test(String(r.id||''))):(catalog[kind]||[])),known=new Set(kind==='characters'?characterRows.filter(characterUnlocked).map(r=>r.id):(state.collectionBook?.[kind]||[]));
  const count=rows.filter(r=>known.has(r.id)).length;total+=rows.length;owned+=count;
  const button=document.createElement('button');button.className='collection-book-category'+(collectionBookKind===kind?' active':'');
  button.textContent=`${label} ${count} / ${rows.length}`;button.onclick=()=>{collectionBookKind=kind;collectionBookSelected=null;renderCollectionBook()};progress.append(button);
 }
 $('collection-book-total').textContent=`総合収集率 ${total?((owned/total)*100).toFixed(1):'0.0'}%（${owned} / ${total}）`;
 const list=$('collection-book-list'),detail=$('collection-book-detail');list.replaceChildren();detail.replaceChildren();
 const rows=[...(collectionBookKind==='characters'?characterRows:(collectionBookKind==='skills'?(catalog.skills||[]).filter(r=>!/^K(?:[2-9]\d{2}|\d{4,})$/i.test(String(r.id||''))):(catalog[collectionBookKind]||[])))].sort((a,b)=>{const idA=String(a.id||''),idB=String(b.id||'');const nA=/^[A-Za-z]+(\d+)$/.exec(idA),nB=/^[A-Za-z]+(\d+)$/.exec(idB);return nA&&nB?Number(nA[1])-Number(nB[1])||idA.localeCompare(idB):idA.localeCompare(idB,undefined,{numeric:true})}),known=new Set(collectionBookKind==='characters'?characterRows.filter(characterUnlocked).map(r=>r.id):(state.collectionBook?.[collectionBookKind]||[]));
 if(!rows.some(r=>r.id===collectionBookSelected))collectionBookSelected=rows[0]?.id||null;
 rows.forEach((row,i)=>{const got=known.has(row.id),b=document.createElement('button');b.className='collection-book-entry'+(row.id===collectionBookSelected?' active':'');b.textContent=`No.${(/^[ISK](\d+)$/i.exec(String(row.id||''))?.[1] || String(row.id||'').replace(/^[A-Za-z]+/,'') || String(i+1)).padStart(3,'0')}  ${got?(row.name||row.id):'？？？'}`;b.onclick=()=>{collectionBookSelected=row.id;renderCollectionBook()};list.append(b)});
 if(!rows.length){list.textContent='登録データがありません';detail.textContent='Editorで登録すると図鑑に追加されます。';return}
 const row=rows.find(r=>r.id===collectionBookSelected);if(!row)return;
 if(!known.has(row.id)){detail.textContent='？？？\n未解放';return}
 const layout=document.createElement('div');layout.className='collection-book-layout';
 const info=document.createElement('div');info.className='collection-book-info';
 const title=document.createElement('h3');title.textContent=row.name||row.id;info.append(title);
 if(collectionBookKind==='characters'){const cv=document.createElement('p');cv.textContent='CV：'+(row.cv||'未設定');info.append(cv)}
 const description=document.createElement('p');description.className='collection-book-description';description.textContent=row.description||'説明なし';info.append(description);
 const fields=[['rank','ランク'],['hpBonus','HP'],['atkBonus','攻撃'],['defBonus','防御'],['spdBonus','素早さ'],['power','威力'],['cost','コスト'],['price','価格'],['successRate','成功率']];
 for(const [key,label] of fields){const value=row[key];if(value===undefined||value===null||value==='')continue;if(typeof value==='number'&&value===0)continue;if(typeof value==='string'&&value.trim()!==''&&Number(value)===0)continue;const line=document.createElement('p');line.className='collection-book-stat';line.textContent=`${label}：${value}`;info.append(line)}
 if(collectionBookKind==='skills'){layout.classList.add('collection-book-layout--no-art');layout.append(info)}
 else{const art=document.createElement('div');art.className='collection-book-art';if(collectionBookKind==='characters'){if(row.image){const pic=document.createElement('img');pic.src=row.image;pic.alt=row.name||'';art.append(pic)}}else art.innerHTML=imgHTML(collectionBookKind,row);layout.append(info,art)}
 detail.append(layout);
}
document.querySelectorAll('[data-collection-mode]').forEach(b=>b.onclick=()=>{collectionPage=b.dataset.collectionMode;renderCollection()});
document.querySelectorAll('[data-collection-tab]').forEach(b=>b.onclick=()=>{collectionTab=b.dataset.collectionTab;collectionSelected=null;renderCollection()});
$('collection-report').onclick=()=>{if(!state||!collectionUnlocked())return;const rows=collectionRows().filter(r=>!state.collectionReports?.[r.id]&&collectionOwned(r));if(!rows.length)return;let coins=0;for(const r of rows){state.collectionReports[r.id]=true;coins+=Math.max(0,Math.floor(Number(r.rewardCoins)||0))}state.player.coins+=coins;collectionExpressionVoice('report');auto();update();notice(`${rows.length}件を報告！ ${coins}コイン獲得`)};
function rewardUnlocked(row,channel){for(const ids of Object.values(state.inventory||{}))if(Array.isArray(ids))for(const id of ids)state.flags['obtained:'+id]=true;const rule=row.availability?.[channel];if(!rule||rule.type==='always')return true;if(rule.type==='none')return false;const key=row.id+':'+channel;state.shopUnlocks??={};if(state.shopUnlocks[key])return true;let yes=false;if(rule.type==='event')yes=!!state.flags?.[rule.eventId]||!!state.flags?.['event:'+rule.eventId];if(rule.type==='scenario_clear')yes=Number(state.scenarios?.[rule.scenarioId]?.difficulties?.[rule.difficulty||'EASY']?.clears||0)>0;if(rule.type==='item')yes=!!state.flags?.['obtained:'+rule.itemId]||Object.values(state.inventory).some(a=>Array.isArray(a)&&a.includes(rule.itemId));if(yes)state.shopUnlocks[key]=true;return yes}
function renderShop(){if(!state)return;$('shop-coin').innerHTML=currencyHTML();const root=$('shop-list');root.replaceChildren();const rows=[...catalog.items].filter(row=>!state.inventory.items.includes(row.id)&&rewardUnlocked(row,'shop'));if(!rows.length){root.innerHTML='<p class="empty">売り切れ</p>';return}for(const row of rows){const owned=state.inventory.items.includes(row.id),price=Math.max(0,Number(row.price)||0);const wrap=document.createElement('article');wrap.className='shop-row';const detail=document.createElement('div');detail.className='product-detail';detail.innerHTML=`<div class="product-heading"><strong>${escape(row.name||'名称未設定')}</strong><span class="product-price">${coinIconHTML(price)}</span></div><p class="product-description">${escape(row.description||'')}</p>`;const art=document.createElement('div');art.className='product-art';art.innerHTML=imgHTML('items',row);wrap.append(art,detail);const b=document.createElement('button');b.className='small-btn';b.textContent=owned?'所持済み':price>state.player.coins?'コイン不足':'購入';b.disabled=owned||price>state.player.coins;b.onclick=()=>{if(state.inventory.items.includes(row.id))return;if(state.player.coins<price){notice('コインが不足しています');return}state.player.coins-=price;shopExpressionVoice('purchase');if(row.bookmark||catalog.scenarios.some(c=>c.unlock?.type==='bookmark'&&c.unlock.itemId===row.id)){grantBookmark(row)}else{state.inventory.items.push(row.id);auto()}update()};wrap.append(b);root.append(wrap)}}
function gachaCandidates(kind){return catalog[kind].filter(row=>!state.inventory[kind].includes(row.id)&&Number(row.gachaWeight??10)>0&&rewardUnlocked(row,'gacha')&&(kind!=='skills'||row.excludeFromGacha!==true))}
const RANK_BASE={C:35,B:15,A:8,S:2},MEDICINE_BASE=40;
function equipGachaPool(){const groups={C:[],B:[],A:[],S:[]};for(const row of gachaCandidates('equipment')){const rank=String(row.rank||'C').toUpperCase();groups[groups[rank]?rank:'C'].push(row)}const missing=Object.keys(groups).filter(r=>!groups[r].length).reduce((sum,r)=>sum+RANK_BASE[r],0);const present=Object.keys(groups).filter(r=>groups[r].length);const extra=missing*.3;const denominator=present.reduce((sum,r)=>sum+RANK_BASE[r],0);const chances={medicine:MEDICINE_BASE+missing*.7};for(const r of Object.keys(groups))chances[r]=groups[r].length?RANK_BASE[r]+(denominator?extra*RANK_BASE[r]/denominator:0):0;if(!present.length)chances.medicine=100;return {groups,chances}}
function weightedPick(rows){const sum=rows.reduce((a,x)=>a+Math.max(0,Number(x.gachaWeight??10)),0);let r=Math.random()*sum;for(const row of rows){r-=Math.max(0,Number(row.gachaWeight??10));if(r<0)return row}return rows[rows.length-1]}
function renderGacha(){if(!state)return;for(const kind of ['equipment','skills']){const left=gachaCandidates(kind).length,button=$('gacha-'+kind);button.disabled=state.player.coins<2||(kind==='skills'&&left===0);$('gacha-'+kind+'-status').textContent=kind==='equipment'?`装備候補：${left}種類${state.player.coins<2?' ／ コイン不足':''}`:left?`排出候補：${left}種類${state.player.coins<2?' ／ コイン不足':''}`:'在庫なし'}}
function rollGacha(kind){if(!state||state.player.coins<2)return;if(kind==='equipment'){const {groups,chances}=equipGachaPool();let roll=Math.random()*100,rank='medicine';for(const key of ['medicine','C','B','A','S']){roll-=chances[key];if(roll<0){rank=key;break}}state.player.coins-=2;shopExpressionVoice('gacha');if(rank==='medicine'){state.player.medicine++;auto();update();notifyDialog('おくすりを獲得！','おくすり ×1',commonImgSrc('assets/ui/medicine.png'));return}const selected=weightedPick(groups[rank]);if(!selected){state.player.medicine++;auto();update();notifyDialog('おくすりを獲得！','おくすり ×1',commonImgSrc('assets/ui/medicine.png'));return}state.inventory.equipment.push(selected.id);auto();update();showReward(kind,selected);return}const choices=gachaCandidates(kind);if(!choices.length){renderGacha();return}const selected=weightedPick(choices);state.player.coins-=2;shopExpressionVoice('gacha');state.inventory[kind].push(selected.id);auto();update();showReward(kind,selected)}
$('gacha-equipment').onclick=()=>rollGacha('equipment');$('gacha-skills').onclick=()=>rollGacha('skills');
function renderStatus(){if(!state)return;const p=state.player;$('status-level').innerHTML=`<span>Lv.${p.level}</span><span class="status-coin-balance">${coinIconHTML(String(p.coins).padStart(3,'0'))}</span>`;const stats=$('stats');stats.replaceChildren();for(const [k,label] of [['hp','最大HP'],['atk','攻撃'],['def','防御'],['spd','素早さ']]){const cost=upgradeCost(k),row=document.createElement('div');row.className='stat-row';const val=k==='hp'?`${effective('maxHp')} / ${effective('maxHp')}`:`${effective(k)}${bonus(k)?`（装備補正 ${bonus(k)>0?'+':''}${bonus(k)}）`:''}`;row.innerHTML=`<span>${label}</span><strong>${val}</strong><span class="cost">${coinIconHTML(cost)}</span>`;const b=document.createElement('button');b.className='small-btn';b.textContent='＋';b.disabled=p.coins<cost;b.classList.toggle('unaffordable',p.coins<cost);b.onclick=()=>{if(p.coins<cost)return;p.coins-=cost;p.level++;if(k==='hp'){p.maxHp+=3;p.hp+=3;state.upgrades.hp++}else{p[k]++ ;state.upgrades[k]++}auto();update()};row.append(b);stats.append(row)}
const slots=$('slots');slots.replaceChildren();for(const [kind,label,index] of [['equipment','装備①',-1],['equipment','装備②',-2],['items','アイテム①',-1],['items','アイテム②',-2],['guests','ゲスト①',-1],['guests','ゲスト②',-2],['skills','スキル①',0],['skills','スキル②',1],['skills','スキル③',2]]){const key=kind==='items'?'item':kind==='guests'?'guest':kind;const second=index===-2,unlocked=!second||state.slotUnlocks[key],id=index>=0?state.equipped.skills[index]:(unlocked?state.equipped[key+(second?'2':'')]:null),record=item(kind,id);const b=document.createElement('button');b.className='slot';b.innerHTML=second&&!unlocked?`<span>${label}</span>${commonAssets.images?.slotLocked?`<img class="locked-slot-art" alt="" src="${escape(commonAssets.images.slotLocked)}">`:''}<strong>解放 ${slotCost(key)}コイン</strong>`:index<0?(record?`<div class="slot-image">${imgHTML(kind,record)}</div>`:`<span>${label}</span><strong>未設定</strong>`):`<span>${label}</span><strong>${escape(record?.name||'未設定')}${record&&kind==='skills'?'  Lv.'+ownedLevel(kind,id):''}</strong>`;b.onclick=()=>{if(second&&!unlocked){const cost=slotCost(key);if(state.player.coins<cost){notice('コインが不足しています');return}modal(`${label}を${cost}コインで解放しますか？`,()=>{if(state.player.coins<cost)return;state.player.coins-=cost;state.slotUnlocks[key]=true;auto();update()});return}openPicker(kind,index)};slots.append(b)}}
// Editorの効果タイプと同じ表示名を使用する（内部IDは表示しない）。
const DETAIL_EFFECT_NAMES={heal:'HP回復',regen_heal:'継続HP回復',damage:'ダメージ',attack_multiplier:'攻撃力倍率ダメージ',stat_up:'能力値上昇',stat_down:'能力値低下',damage_multiplier:'与ダメージ増加率',damage_reduction:'被ダメージ軽減率',crit:'クリティカル',extra_attack:'追加攻撃',extra_turn:'追加行動',accuracy:'命中率補正',poison:'毒',paralysis:'麻痺',burn:'火傷',blind:'暗闇',silence:'沈黙',curse:'呪い',sleep:'眠り',cleanse:'状態異常解除',dispel_buff:'強化効果解除',dispel_debuff:'弱体効果解除',dispel_all:'能力変化解除',armor_pierce:'防御貫通',lifesteal:'吸収',action_immunity:'攻撃・スキル無効化',bonus_coins:'勝利時追加コイン',restore_item_uses:'アイテム使用回数回復',steal_coins:'コイン強奪',steal_item:'アイテム窃盗'};
const DETAIL_STATUS_NAMES={poison:'毒',paralysis:'麻痺',burn:'火傷',blind:'暗闇',silence:'沈黙',curse:'呪い',sleep:'眠り'};
function detailEffectText(e){
 if(typeof e==='string')return DETAIL_EFFECT_NAMES[e]||e;
 if(!e||typeof e!=='object')return '';
 if(e.description||e.name||e.label)return e.description||e.name||e.label;
 const name=DETAIL_EFFECT_NAMES[e.type]||e.type||'効果';
 const amount=Number(e.amount),chance=Number(e.chance),duration=Number(e.duration);
 const amountTypes=new Set(['heal','regen_heal','damage','attack_multiplier','stat_up','stat_down','damage_multiplier','damage_reduction','crit','extra_attack','accuracy','poison','paralysis','burn','blind','silence','curse','sleep','armor_pierce','lifesteal','bonus_coins','restore_item_uses']);
 let result=name;
 if(['stat_up','stat_down'].includes(e.type))result+=`（${{hp:'HP',atk:'攻撃',def:'防御',spd:'素早さ'}[e.stat]||e.stat||'能力'}）`;
 if(e.type==='cleanse'&&e.cleanseType)result+=`（${DETAIL_STATUS_NAMES[e.cleanseType]|| (e.cleanseType==='all'?'すべて':e.cleanseType)}）`;
 if(e.type==='extra_turn'&&Number.isFinite(amount)&&amount>0)result+=` +${Math.floor(amount)}回`;
 if(amountTypes.has(e.type)&&Number.isFinite(amount)&&amount!==0)result+=`${amount}${e.amountMode==='percent'||['damage_multiplier','damage_reduction','crit','accuracy'].includes(e.type)?'％':''}`;
 if(Object.hasOwn(DETAIL_STATUS_NAMES,e.type)){
  const inflict=Number(e.inflictChance??100);
  if(Number.isFinite(inflict))result+=`（付与率${Math.max(0,Math.min(100,inflict))}％）`;
 }else if(Number.isFinite(chance)&&chance>=0&&chance<=100)result+=`（発動${chance}％）`;
 if(e.type!=='extra_turn'&&Number.isFinite(duration)&&duration>0)result+=`・${duration}ターン`;
 return result;
}
function compactDetailLines(kind,row){
 if(!row)return [];
 const lines=[],stats=[];
 for(const [key,label] of [['hpBonus','HP'],['atkBonus','攻撃'],['defBonus','防御'],['spdBonus','素早さ'],['accuracyBonus','命中率'],...(kind==='equipment'?[['criticalRateBonus','クリティカル率']]:[])]){
  const n=Number(row[key]);if(Number.isFinite(n)&&n!==0)stats.push(`${label}${n>0?'+':''}${n}${['accuracyBonus','criticalRateBonus'].includes(key)?'%':''}`);
 }
 if(stats.length)lines.push(stats.join('、'));
 const bonuses=[];
 for(const [key,label] of [['trapDisarm','罠解除'],['trapResist','罠耐性'],['dropRateBonus','ドロップ率'],['chestRateBonus','宝箱率']]){
  const n=Number(row[key]);if(Number.isFinite(n)&&n!==0)bonuses.push(`${label}${n>0?'+':''}${n}%`);
 }
 if(bonuses.length)lines.push(bonuses.join('、'));
 const resistances=[];
 for(const [key,value] of Object.entries(row.statusResistances||{})){
  const n=Number(value);if(Number.isFinite(n)&&n!==0)resistances.push(`${DETAIL_STATUS_NAMES[key]||key}${n>0?'+':''}${n}%`);
 }
 for(let i=0;i<resistances.length;i+=4)lines.push((i===0?'耐性：':'　　　')+resistances.slice(i,i+4).join('、'));
 const skills=[];
 if(kind==='equipment')for(const spec of row.weaponSkills||[]){
  const lv=ownedLevel('equipment',row.id),skill=item('skills',spec.skillId);
  const skillLv=weaponSkillLevel(spec,lv);skills.push(skillLv?`${skill?.name||spec.skillId||'スキル'} Lv.${skillLv}`:`🔒 ${skill?.name||spec.skillId||'スキル'}（未解放）`);
 }
 if(kind==='guests')for(const skill of [row.activeSkill,row.manualSkill,row.passiveSkill]){
  if(skill?.name&&!skills.includes(skill.name))skills.push(skill.name);
 }
 if(skills.length)lines.push('スキル：'+skills.join('、'));
 const effects=(Array.isArray(row.effects)?row.effects:[]).map(detailEffectText).filter(Boolean);
 if(effects.length)lines.push((kind==='guests'?'特性：':'効果：')+effects.join('、'));
 if(kind==='skills')lines.push(`成功率：${row.successRate??100}%、冒険中：${row.usesPerAdventure??1}回`);
 return lines;
}
// Skill description tokens refer to the EFFECT ORDER at the currently equipped skill level.
// Missing effects remain visible as tokens to make authoring mistakes discoverable.
function expandSkillDescriptionTokens(description,row){
 const effects=Array.isArray(row?.effects)?row.effects:[];
 return String(description||'').replace(/\{(効果|確率|ターン)([1-9]\d*)\}|\{(使用回数|命中率)\}/g,(token,kind,index,stat)=>{
  if(stat==='使用回数')return String(row?.usesPerAdventure??0);
  if(stat==='命中率')return String(row?.accuracyBonus??0);
  const effect=effects[Number(index)-1];
  if(!effect)return token;
  const value=kind==='効果'?(String(effect.amount??'')+(effect.amountMode==='percent'?'％':'')):kind==='確率'?effect.chance:(effect.duration??effect.turns);
  return value===undefined||value===null||value===''?token:String(value);
 });
}
function skillLevelDescription(row){
 if(/\{(?:効果|確率|ターン)[1-9]\d*\}|\{(?:使用回数|命中率)\}/.test(String(row?.description||'')))return expandSkillDescriptionTokens(row.description,row);

 const description=String(row?.description||'');
 if(!description||!row?.id)return description;
 const base=catalog.skills?.find(x=>x.id===row.id);
 if(!base)return description;
 const original=(base.effects||[]).filter(e=>e.type==='heal'&&(e.trigger||'on_use')==='on_use');
 const current=(row.effects||[]).filter(e=>e.type==='heal'&&(e.trigger||'on_use')==='on_use');
 if(original.length!==1||current.length!==1)return description;
 const before=Number(original[0].amount),after=Number(current[0].amount);
 if(!Number.isFinite(before)||!Number.isFinite(after)||before===after)return description;
 // Only replace the healing amount in a recognized HP recovery phrase, not unrelated numbers.
 return description.replace(new RegExp('(HP(?:を|が|\\s*)\\s*)'+before+'(\\s*(?:回復|ポイント回復))'),(_,prefix,suffix)=>prefix+after+suffix);
}
function detailLines(kind,row){
 if(!row)return ['装備を外します。'];
 return [kind==='skills'?skillLevelDescription(row):row.description||'',...compactDetailLines(kind,row)].filter(Boolean);
}
function pickerSlotDefs(kind){
 if(kind==='skills')return [0,1,2].map(i=>({index:i,label:`スキル${'①②③'[i]}`,key:null}));
 const key=kind==='items'?'item':kind==='guests'?'guest':kind;
 return [{index:-1,label:TYPES[kind]+'①',key},{index:-2,label:TYPES[kind]+'②',key}].filter(x=>x.index===-1||state.slotUnlocks[key]);
}
function pickerSlotId(kind,index){
 if(kind==='skills')return state.equipped.skills[index]||null;
 const key=kind==='items'?'item':kind==='guests'?'guest':kind;
 return state.equipped[key+(index===-2?'2':'')]||null;
}
function setPickerSlot(kind,index,id){
 if(kind==='skills')state.equipped.skills[index]=id;
 else {const key=kind==='items'?'item':kind==='guests'?'guest':kind;state.equipped[key+(index===-2?'2':'')]=id;}
}
function pickerComparison(kind,oldId,newId){
 if(!['equipment','guests'].includes(kind)||oldId===newId)return [];
 const before=item(kind,oldId),after=item(kind,newId),result=[];
 for(const [field,label] of [['hpBonus','最大HP'],['atkBonus','攻撃'],['defBonus','防御'],['spdBonus','素早さ'],['accuracyBonus','命中率'],...(kind==='equipment'?[['criticalRateBonus','クリティカル率']]:[])]){
  const oldVal=Number(before?.[field])||0,newVal=Number(after?.[field])||0,diff=newVal-oldVal;
  if(diff)result.push(`${label}：${oldVal>=0?'+':''}${oldVal} → ${newVal>=0?'+':''}${newVal}（${diff>0?'+':''}${diff}）`);
 }
 return result;
}
function openPicker(kind,index){
 pickType={kind,index};$('picker-title').textContent=`${TYPES[kind]}を選択`;
 $('picker').classList.add('open');
 const root=$('picker-list'),detail=$('picker-detail');root.replaceChildren();detail.replaceChildren();detail.hidden=false;$('picker-confirm').hidden=false;
 let chosen=pickerSlotId(kind,index),target=index,step='choose';
 // Match the collection book: sort by internal ID, not acquisition order.
 const sortedIds=[...new Set(state.inventory[kind]||[])].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'}));
 const choices=[null,...sortedIds];
 const buttons=[];
 const show=(id)=>{
  const row=item(kind,id);detail.replaceChildren();
  if(row&&kind!=='skills'){const art=document.createElement('div');art.className='picker-art';art.innerHTML=imgHTML(kind,row);detail.append(art)}
  const title=document.createElement('h3');title.textContent=row?row.name+(['equipment','guests','skills'].includes(kind)?'  Lv.'+ownedLevel(kind,id):''):'外す／未設定';detail.append(title);
  for(const line of detailLines(kind,row)){const p=document.createElement('p');p.textContent=line;detail.append(p)}
 };
 for(const id of choices){const row=item(kind,id);if(id&&!row)continue;
  const b=document.createElement('button');b.className='pick-entry';b.textContent=id?(row.name||id)+(['equipment','guests','skills'].includes(kind)?'  Lv.'+ownedLevel(kind,id):''):'外す／未設定';
  b.onmouseenter=()=>{if(step==='choose')show(id)};
  b.onclick=()=>{if(step!=='choose')return;chosen=id;buttons.forEach(x=>x.classList.toggle('selected',x===b));show(id)};
  buttons.push(b);root.append(b);
 }
 const initial=choices.indexOf(chosen);if(buttons[Math.max(0,initial)])buttons[Math.max(0,initial)].classList.add('selected');show(chosen);
 const confirm=$('picker-confirm');confirm.textContent='この装備に変更';
 const apply=()=>{
  if(chosen){for(const slot of pickerSlotDefs(kind))if(slot.index!==index&&pickerSlotId(kind,slot.index)===chosen)setPickerSlot(kind,slot.index,null)}
  setPickerSlot(kind,index,chosen);$('picker').classList.remove('open');auto();update();
 };
 // The clicked status slot is the destination; no extra slot selection or replacement confirmation.
 for(const b of buttons){const original=b.onclick;b.onclick=()=>{original();apply()}}
 confirm.onclick=apply;
 $('picker-close').onclick=()=>{$('picker').classList.remove('open')};
}


/* Stage 10: basic scenario/area loop (FIXED battles only; full event engine later). */
function scenarioUnlocked(c){const u=c.unlock||{};if(u.type==='always'||!u.type)return true;if(u.type==='bookmark')return !!state.bookmarksUnlocked[c.id]||state.inventory.items.includes(u.itemId);return false}
function bookmarkWorlds(row){return catalog.scenarios.filter(c=>c.unlock?.type==='bookmark'&&c.unlock.itemId===row?.id)}
function bookmarkShopItems(){return catalog.items.filter(row=>row.bookmark||bookmarkWorlds(row).length)}
function grantBookmark(row){if(!row||state.inventory.items.includes(row.id))return false;const worlds=bookmarkWorlds(row).filter(c=>!scenarioUnlocked(c));state.inventory.items.push(row.id);for(const c of bookmarkWorlds(row))state.bookmarksUnlocked[c.id]=true;auto();if(worlds.length)notifyDialog('新しい冒険の書が解放！',worlds.map(c=>`「${c.name||c.id}」`).join('、')+'が冒険の書に追加されました。',row.image||'assets/ui/bookmark_icon.png');return true}
function bookProgress(c){const r=state.scenarios[c.id]||{};return r.difficulties||{EASY:{clears:r.clears||0}}}
function scenarioAreas(c,d){let areas=(c.areas||[]).map(a=>({...a}));for(const difficulty of DIFFICULTIES){const direct=c.difficultyAreas?.[difficulty];if(Array.isArray(direct)&&direct.length)areas=direct.map(a=>({...a}));const patch=c.difficultyAreaOverrides?.[difficulty]||{};for(const [idx,override] of Object.entries(patch)){const n=Number(idx)-1;if(Number.isInteger(n)&&n>=0&&n<areas.length)areas[n]={...areas[n],...override}}if(difficulty===d)break}return areas}
// Difficulty coefficients are absolute per difficulty, not cumulative. Invalid values fall back safely.
function scenarioStats(c,d){
 const difficulty=DIFFICULTIES.includes(d)?d:'EASY';
 const defaults=DIFF_STATS[difficulty];
 const overrides=c?.difficultyStats?.[difficulty]||{};
 const scale={};
 for(const key of ['hp','atk','def','spd']){
  const value=Number(overrides[key]);
  scale[key]=overrides[key]!==undefined&&overrides[key]!==null&&overrides[key]!==''&&Number.isFinite(value)&&value>0?Math.min(20,value):defaults[key];
 }
 return scale;
}
function scaledEnemyStats(enemy,scale){
 const hp=Math.max(1,Math.ceil(enemyNumber(enemy,['hp','maxHp'],10)*scale.hp));
 return {hp,atk:Math.max(1,Math.ceil(enemyNumber(enemy,['atk','attack'],2)*scale.atk)),def:Math.max(0,Math.floor(enemyNumber(enemy,['def','defense'],0)*scale.def)),spd:Math.max(1,Math.ceil(enemyNumber(enemy,['spd','speed'],1)*scale.spd))};
}
const bookDifficultyChoice={};
// Keep the adventure-start button alive across stage/difficulty redraws.
let persistentAdventureStart=null;
// Shared visual buttons retain their original click handlers and accessible labels.
function applySharedButtonArt(button,key){
 if(!button)return;
 const path=commonAssets.images?.[key];
 const old=button.querySelector(':scope > .cq-shared-button-image');
 if(!path){old?.remove();button.classList.remove('cq-shared-button');if(button.classList.contains('book-start'))button.textContent=button.dataset.cqButtonLabel||'冒険開始';return}
 if(old?.dataset.path===path){button.classList.add('cq-shared-button');return;}
 // Apply sizing/positioning before insertion so the native image cannot flash at full size.
 old?.remove();button.classList.add('cq-shared-button');
 if(button.classList.contains('book-start')){button.setAttribute('aria-label',button.dataset.cqButtonLabel||'冒険開始');button.replaceChildren()}
 const img=document.createElement('img');img.className='cq-shared-button-image';img.dataset.path=path;img.alt='';
 img.style.visibility='hidden';
 img.onload=()=>{if(img.isConnected)img.style.visibility='visible'};
 img.onerror=()=>{if(img.isConnected){img.remove();button.classList.remove('cq-shared-button');if(button.classList.contains('book-start'))button.textContent=button.dataset.cqButtonLabel||'冒険開始'}};
 button.append(img);
 img.src=cqImageUrl(path);
}
function refreshSharedBackButtons(){
 document.querySelectorAll('.screen button').forEach(b=>{
  if(b.classList.contains('book-start'))return;
  const label=(b.dataset.cqButtonLabel||b.textContent||'').trim();
  if(!b.dataset.cqButtonLabel)b.dataset.cqButtonLabel=label;
  if(/^(戻る|← 戻る|◀ 戻る|戻る ◀|もどる)$/.test(label))applySharedButtonArt(b,'buttonBack');
 });
}
function renderAdventure(){if(!state)return;const root=$('scenario-list'),active=$('run-panel'),select=$('scenario-panel');if(!root||!active)return;
 const run=state.adventure;active.hidden=!run;select.hidden=!!run;$('adventure-back').hidden=!!run;
 // The background is selected by applyCommonImages(), including load-error fallback.
 applyCommonImages();
 if(run){const c=item('scenarios',run.scenarioId);$('run-title').textContent=(c?.name||run.scenarioId)+' / '+(run.difficulty||'EASY');$('run-area').textContent=`AREA ${Math.min(run.area+1,run.areaCount)} / ${run.areaCount}`;$('run-coins').replaceChildren(document.createTextNode('獲得 '));const coinImage=document.createElement('img');coinImage.src=commonImgSrc('assets/ui/coin.png');coinImage.alt='コイン';coinImage.className='run-coin-image';coinImage.onerror=()=>{coinImage.replaceWith(document.createTextNode('コイン'))};$('run-coins').append(coinImage,document.createTextNode(` ×${run.coins}`));$('run-notice').textContent=c?.adventurePrompts?.[run.difficulty]??'エリアを進めて戦闘に挑戦しましょう。';$('run-next').disabled=false;$('run-next').textContent=run.areaResolved?(run.area+1>=run.areaCount?'クリア処理中':'次へ進む'):'先に進む';return}
 const worlds=catalog.scenarios.filter(scenarioUnlocked).sort((a,b)=>String(a.id??'').localeCompare(String(b.id??''),undefined,{numeric:true,sensitivity:'base'}));if(!worlds.some(c=>c.id===bookSelected))bookSelected=worlds[0]?.id||null;
 // Detach before clearing the book, then reattach the SAME button and loaded image.
 // This prevents a fresh image-load/visibility cycle on every selection.
 if(persistentAdventureStart?.isConnected)persistentAdventureStart.remove();
 root.replaceChildren();const list=document.createElement('div');list.className='book-world-list';for(const c of worlds){const b=document.createElement('button');b.className='book-world'+(c.id===bookSelected?' selected':'');b.textContent=c.name||c.id;b.onclick=()=>{bookSelected=c.id;renderAdventure()};list.append(b)}root.append(list);
 const c=worlds.find(c=>c.id===bookSelected);const book=document.createElement('div');book.className='adventure-book';if(commonAssets.images?.['select-scenario'])book.style.setProperty('background-image',`url("${commonAssets.images['select-scenario']}")`,'important');root.append(book);if(!c){book.innerHTML='<p>冒険の書にはまだページがありません。</p>';return}
 const left=document.createElement('div');left.className='book-left-page';const right=document.createElement('div');right.className='book-right-page';book.append(left,right);
 const progress=bookProgress(c);left.innerHTML='<h3>難易度選択</h3>';let chosen=bookDifficultyChoice[c.id]||'EASY';
 const start=persistentAdventureStart||(persistentAdventureStart=document.createElement('button'));
 start.classList.add('book-start');
 if(!start.dataset.cqButtonLabel){start.textContent='冒険開始';start.dataset.cqButtonLabel='冒険開始'}
 // Updates artwork only if the configured image path has actually changed.
 applySharedButtonArt(start,'buttonAdventureStart');
 for(let i=0;i<3;i++){const d=DIFFICULTIES[i],cleared=!!progress[d]?.clears,available=i===0||!!progress[DIFFICULTIES[i-1]]?.clears;const b=document.createElement('button');b.className='book-difficulty'+(d===chosen?' selected':'');b.disabled=!available;b.textContent=d+(cleared?'  ✓':'');if(!available){const lock=commonAssets.images?.slotLocked;if(lock){const im=document.createElement('img');im.src=cqImageUrl(lock);im.alt='未解放';im.className='difficulty-lock-image';b.append(im)}else b.append('  🔒')}b.onclick=()=>{bookDifficultyChoice[c.id]=d;renderAdventure()};left.append(b)}
 start.onclick=()=>{const d=bookDifficultyChoice[c.id]||'EASY';const index=DIFFICULTIES.indexOf(d);if(index>0&&!progress[DIFFICULTIES[index-1]]?.clears)return;const count=Math.max(1,Math.floor(scenarioAreas(c,d).length||Number(c.areaCount)||1));state.flags??={};state.flags['scenario-viewed:'+c.id]=true;state.adventure={scenarioId:c.id,difficulty:d,area:0,areaCount:count,areaResolved:false,hp:effective('maxHp'),coins:0,pendingTrapDamage:0,uses:{}};counterStore('scenario');state.counters.scenario={};for(const row of counterDefinitions.filter(x=>x.scope==='scenario'))state.counters.scenario[row.id]=row.initial||0;if(state.eventDrawPools)state.eventDrawPools.scenario={};auto();restoreEventBgm(true);music.unlocked=true;const previousFade=music.fadeMs;music.fadeMs=0;musicSync();music.fadeMs=previousFade;renderAdventure();randomVoice('departure')};left.append(start);
 if(DIFFICULTIES.every(d=>progress[d]?.clears)){const badge=document.createElement('p');badge.className='book-allclear';badge.textContent='ALL CLEAR';left.append(badge)}
 const art=document.createElement('div');art.className='book-world-art';const image=c.worldImage||c.asset||`assets/backgrounds/world${String(c.id).replace(/\D/g,'').padStart(3,'0')}.png`;const im=document.createElement('img');im.src=image;im.alt=c.name||'';im.style.transform=`translate(${Number(c.illustrationX)||0}px,${Number(c.illustrationY)||0}px) scale(${Math.max(.3,Math.min(4,(Number(c.illustrationScale)||100)/100))})`;im.onerror=()=>{im.remove();art.textContent='挿絵未設定'};art.append(im);right.append(art);const title=document.createElement('h3');title.textContent=c.name||c.id;title.classList.add('book-centered-text');right.append(title);const desc=document.createElement('p');desc.className='book-centered-text book-world-description';desc.textContent=c.description||'';desc.style.whiteSpace='pre-wrap';desc.style.color='#17253c';desc.style.fontWeight='700';desc.style.webkitTextStroke='0.35px rgba(255,255,255,.95)';desc.style.textShadow='0 1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff, 0 -1px 0 #fff, 0 2px 3px rgba(255,255,255,.85)';desc.style.background='none';desc.style.border='none';desc.style.borderRadius='0';desc.style.padding='4px 10px';desc.style.boxSizing='border-box';desc.style.maxWidth='calc(100% - 20px)';desc.style.margin='12px auto';desc.style.lineHeight='1.8';desc.style.fontSize='clamp(14px, 1.3vw, 17px)';desc.style.overflowWrap='anywhere';right.append(desc)

}
// Stage 40: reward grants are idempotent for unique inventory entries.
function applyScenarioRewards(rewards){
 const summary=[];if(!rewards||typeof rewards!=='object')return summary;
 for(const [key,label] of [['coins','コイン'],['medicine','おくすり']]){
  const count=Math.max(0,Math.floor(Number(rewards[key])||0));
  if(count){if(key==='coins')state.player.coins+=count;else state.player.medicine+=count;summary.push(`${label}×${count}`)}
 }
 for(const [key,label] of [['items','アイテム'],['equipment','装備'],['guests','ゲスト'],['skills','スキル']]){
  for(const id of Array.isArray(rewards[key])?rewards[key]:[]){
   const row=item(key,id);if(!row||state.inventory[key].includes(id))continue;
   if(key==='items'&&(row.bookmark||catalog.scenarios.some(w=>w.unlock?.type==='bookmark'&&w.unlock.itemId===id))){
    // Unlock immediately, but show the bookmark notification after the clear message.
    state.inventory.items.push(id);
    for(const world of catalog.scenarios.filter(w=>w.unlock?.type==='bookmark'&&w.unlock.itemId===id))state.bookmarksUnlocked[world.id]=true;
    summary.push(`${row.name||label}（冒険の書を解放）`);
   }else{state.inventory[key].push(id);summary.push(row.name||label)}
  }
 }
 return summary;
}
function finishAdventure(clear){const run=state.adventure;if(!run)return;
 if(clear){
  const bookmarkShopBefore=new Set(bookmarkShopItems().filter(row=>!state.inventory.items.includes(row.id)&&rewardUnlocked(row,'shop')).map(row=>row.id));
  state.player.coins+=run.coins;
  const record=state.scenarios[run.scenarioId]||{clears:0};record.clears=(record.clears||0)+1;record.difficulties??={};
  const diff=DIFFICULTIES.includes(run.difficulty)?run.difficulty:'EASY';record.difficulties[diff]??={clears:0};
  const first=record.difficulties[diff].clears===0;record.difficulties[diff].clears++;state.scenarios[run.scenarioId]=record;
  const c=item('scenarios',run.scenarioId);
  const rewards=first?c?.firstClearRewards?.[diff]:c?.repeatClearRewards?.[diff];
  const summary=applyScenarioRewards(rewards);commonSE('scenarioClear');randomVoice('clear');const affections=grantAffection();
  const unlocked=summary.some(x=>x.includes('冒険の書を解放'));
  const newlyAvailableBookmarks=bookmarkShopItems().filter(row=>!state.inventory.items.includes(row.id)&&!bookmarkShopBefore.has(row.id)&&rewardUnlocked(row,'shop'));
  const guestNext=()=>{const show=(index)=>{if(index>=affections.length){nextGuestAffectionEvent();return}const affection=affections[index];playGuestAffectionVoice(affection.id);notifyDialog(affection.bonus?'好感度ボーナス解放':'好感度アップ',affection.bonus?`${affection.name}の好感度ボーナスが解放されました。`:`${affection.name}との絆が深まりました。`,null,()=>show(index+1))};show(0)};
  const afterClear=()=>{
   const afterBookmarkAnnouncement=()=>{if(affections.length)commonSE('affectionUp');if(unlocked)notifyDialog('冒険の書','冒険の書に新たなページが解放されました。',null,guestNext);else guestNext()};
   if(newlyAvailableBookmarks.length){
    const show=(index)=>{if(index>=newlyAvailableBookmarks.length){afterBookmarkAnnouncement();return}const row=newlyAvailableBookmarks[index];notifyDialog('ショップに新しい栞が追加！',`「${row.name||row.id}」がショップに追加されました。`,row.image||row.asset||'assets/ui/bookmark_icon.png',()=>show(index+1))};
    show(0);
   }else afterBookmarkAnnouncement();
  };
  const message=[...(run.coins>0?[`${run.coins}コインを獲得しました。`]:[]),...(summary.length?['クリア報酬：'+summary.join('、')]:[])].join('\n')||'シナリオをクリアしました！';
  setTimeout(()=>notifyDialog('シナリオクリア！',message,null,afterClear),550);
 }else{notice('敗北……冒険中に獲得したコインを失った。');}
 state.adventure=null;state.player.hp=effective('maxHp');battle=null;go('home');
}
// Stage 63: exploration modifiers and gated drops.
function explorationBonus(key){let sum=0;for(const [kind,ids] of [['equipment',equippedEquipmentIds()],['items',equippedItemIds()],['guests',equippedGuestIds()]])for(const id of ids){const row=item(kind,id);sum+=Math.max(0,Number(row?.[key])||0)}return Math.min(200,sum)}
function dropCondition(rule){if(!rule||!rule.id)return false;switch(rule.type){case 'equipment':return equippedEquipmentIds().includes(rule.id);case 'item':return equippedItemIds().includes(rule.id);case 'guest':return equippedGuestIds().includes(rule.id);case 'skill':return (state.equipped.skills||[]).includes(rule.id)||weaponSkillChoices().some(x=>x.id===rule.id);case 'flag':return !!state.flags?.[rule.id];default:return false}}
function dropUnlocked(conditions){if(!conditions||!Array.isArray(conditions.rules)||!conditions.rules.length)return true;return conditions.operator==='OR'?conditions.rules.some(dropCondition):conditions.rules.every(dropCondition)}
function bonusVictoryCoins(){
 let bonus=0;const rows=[...equippedEquipmentIds().map(id=>item('equipment',id)),...equippedItemIds().map(id=>item('items',id)),...equippedGuestIds().map(id=>item('guests',id)),...equippedSkillChoices()];
 for(const row of rows)for(const effect of row?.effects||[]){if(effect.type!=='bonus_coins'||!['passive','always','on_battle_start','battle_start'].includes(effect.trigger||'passive'))continue;if(Math.random()*100<Math.max(0,Math.min(100,Number(effect.chance??100))))bonus+=Math.max(0,Math.floor(Number(effect.amount)||0))}
 return bonus;
}
// Stage 124: one successful theft per enemy instance; failure permits another attempt.
// Each drop retains its original chance. Owned uniques are misses, never rerolled.
function stealEnemyDrop(){
 if(!battle||battle.ended)return '盗める敵がいない。';
 if(battle.stealSucceeded)return 'この敵からはもう盗めない！';
 const enemy=battle.enemy;
 // Distinguish an unsuccessful steal roll from an enemy with no obtainable drops.
 const hasStealableDrop=(enemy.drops||[]).some(d=>{
  if(!dropUnlocked(d.conditions))return false;
  if(d.kind==='medicine')return true;
  if(!['equipment','items','guests','skills'].includes(d.kind))return false;
  return !!item(d.kind,d.id)&&!state.inventory[d.kind].includes(d.id);
 });
 if(!hasStealableDrop)return '何も持っていなかった。';
 for(const d of enemy.drops||[]){
  if(!dropUnlocked(d.conditions))continue;
  const chance=Math.max(0,Math.min(100,Number(d.chance)||0));
  if(Math.random()*100>=chance)continue;
  if(d.kind==='medicine'){
   state.player.medicine++;battle.stealSucceeded=true;auto();
   return `${enemy.name||'敵'}からおくすりを盗んだ！`;
  }
  if(!['equipment','items','guests','skills'].includes(d.kind))continue;
  const row=item(d.kind,d.id);
  if(!row||state.inventory[d.kind].includes(d.id))continue;
  state.inventory[d.kind].push(d.id);battle.stealSucceeded=true;auto();
  return `${enemy.name||'敵'}から${row.name||d.id}を盗んだ！`;
 }
 return '盗めなかった！';
}
function battleDrops(enemy){const gained=[];for(const d of enemy.drops||[]){if(!dropUnlocked(d.conditions))continue;const chance=Math.min(100,Math.max(0,Number(d.chance)||0)*(1+explorationBonus('dropRateBonus')/100));if(Math.random()*100>=chance)continue;if(d.kind==='coins'){const amount=Math.max(0,Math.floor(Number(d.amount)||0));if(amount){run.coins+=amount;gained.push(`${amount}コイン`)}continue}if(d.kind==='medicine'){state.player.medicine++;gained.push('おくすり');battle.rewardDrops??=[];battle.rewardDrops.push({name:'おくすり',image:commonImgSrc('assets/ui/medicine.png')});continue}const row=item(d.kind,d.id);if(!row)continue;if(!state.inventory[d.kind].includes(d.id)){state.inventory[d.kind].push(d.id);gained.push(row.name||d.id);battle.rewardDrops??=[];battle.rewardDrops.push({name:row.name||d.id,image:row.image||row.asset||'',rank:row.rank||''})}}return gained}
// Stage 120: a single source of truth for repeat restrictions, including scenario picks.
function eventAvailable(eventId){
 const ev=item('events',eventId);
 if(!ev||!Array.isArray(ev.steps)||!ev.steps.length)return false;
 if(ev.repeatMode==='once')return !state.flags?.['event:'+eventId];
 if(ev.repeatMode==='until_complete')return !state.flags?.['event-complete:'+eventId];
 return true;
}
function randomChestEvent(scenario,area){
 const difficulty=state.adventure?.difficulty;
 const chests=(scenario?.chestEvents||[]).filter(x=>!Array.isArray(x.difficulties)||x.difficulties.includes(difficulty));
 const entries=[...chests,...(area?.randomCandidates||[])];
 const candidates=entries.filter(x=>Number(x.weight)>0&&(x.enemyId?item('enemies',x.enemyId):eventAvailable(x.eventId)));
 const normal=Math.max(0,Number(area.normalWeight??90));
 const bonus=Math.max(0,1+explorationBonus('chestRateBonus')/100);
 const chestIds=new Set(chests.map(x=>x.eventId));
 const weighted=x=>Number(x.weight)*(chestIds.has(x.eventId)?bonus:1);
 const total=normal+candidates.reduce((a,x)=>a+weighted(x),0);
 if(total<=0)return null;
 let roll=Math.random()*total;
 if(roll<normal)return null;
 roll-=normal;
 for(const row of candidates){roll-=weighted(row);if(roll<0)return row.enemyId?{kind:'enemy',id:row.enemyId}:{kind:'event',id:row.eventId}}
 return null;
}
function pickAreaBattle(area){
 const candidates=Array.isArray(area?.battleCandidates)&&area.battleCandidates.length?area.battleCandidates:(area?.enemyId?[{enemyId:area.enemyId,chance:area.mode==='FIXED'?100:area.battleChance??90}]:[]);
 let roll=Math.random()*100;
 for(const row of candidates){const chance=Math.max(0,Number(row.chance)||0);roll-=chance;if(roll<0)return item('enemies',row.enemyId)}
 return null;
}
// A consumed one-time fixed event can fall back to the area's normal encounter draw.
// Replacement events must be available; never recurse into another consumed event.
function resolvedAreaEvent(eventId){
 const seen=new Set();let id=eventId;
 while(id&&!seen.has(id)){
  seen.add(id);
  if(eventAvailable(id))return {kind:'event',id};
  const ev=item('events',id);
  if(!ev||!['once','until_complete'].includes(ev.repeatMode)||!(ev.repeatMode==='until_complete'?state.flags?.['event-complete:'+id]:state.flags?.['event:'+id]))return {kind:'skip'};
  const mode=ev.afterOnceMode||'random';
  if(mode==='skip')return {kind:'skip'};
  if(mode==='event'){id=ev.afterOnceEventId;continue}
  return {kind:'random'};
 }
 return {kind:'skip'};
}
// Difficulty-specific shared event draw, independent of each area's random exploration table.
function drawCommonEvent(scenario,difficulty){
 const pool=scenario?.commonEventPools?.[difficulty]||{};
 const manual=(pool.candidates||[]).filter(x=>Number(x.weight)>0&&(x.enemyId?item('enemies',x.enemyId):eventAvailable(x.eventId)));
 // Treasure events configured in the scenario's Reward/Chest tab also participate in common draws.
 // A manually listed event is not entered twice; its chest configuration takes precedence.
 const chestEntries=(scenario?.chestEvents||[]).filter(x=>Number(x.weight)>0&&(!Array.isArray(x.difficulties)||x.difficulties.includes(difficulty))&&eventAvailable(x.eventId));
 const chestIds=new Set(chestEntries.map(x=>x.eventId));
 const candidates=[...manual.filter(x=>!chestIds.has(x.eventId)),...chestEntries];
 const bonus=Math.max(0,1+explorationBonus('chestRateBonus')/100);
 const weighted=x=>Number(x.weight)*(chestIds.has(x.eventId)?bonus:1);
 const empty=Math.max(0,Number(pool.emptyWeight)||0);
 const total=empty+candidates.reduce((n,x)=>n+weighted(x),0);
 if(total<=0)return null;
 let roll=Math.random()*total;
 if(roll<empty)return null;
 roll-=empty;
 for(const row of candidates){roll-=weighted(row);if(roll<0)return row.enemyId?{kind:'enemy',id:row.enemyId}:{kind:'event',id:row.eventId}}
 return null;
}
function runCommonEventArea(scenario,difficulty){
 const selected=drawCommonEvent(scenario,difficulty);
 if(selected?.kind==='enemy'){const enemy=item('enemies',selected.id);if(enemy){auto();startBattle(enemy,true);return}}
 if(selected?.kind==='event'&&runEvent(selected.id,{returnTo:'adventure',areaEvent:true}))return;
 const run=state.adventure;if(!run)return;
 run.areaResolved=true;auto();renderAdventure();
 $('run-notice').textContent='何事もなく先に進んだ！';
}
function drawConsumedAreaEvent(scenario,area){
 runCommonEventArea(scenario,state.adventure?.difficulty);
}
function skipUnavailableAreaEvent(){
 const run=state.adventure;if(!run)return;
 run.areaResolved=true;auto();renderAdventure();
 notice('発生可能なイベントがないため、このエリアを通過しました。');
}
$('run-next').onclick=()=>{const run=state?.adventure;if(!run||battleLocked)return;if(run.areaResolved){if(run.area+1>=run.areaCount){finishAdventure(true);return}run.area++;run.areaResolved=false}if(state.eventProgress){advanceEvent();return}const c=item('scenarios',run.scenarioId);const area=scenarioAreas(c,run.difficulty)[run.area];const enemy=item('enemies',area?.enemyId);if(area?.mode==='CHANCE_BATTLE'||area?.mode==='FIXED'){const picked=pickAreaBattle(area);if(picked){auto();startBattle(picked,true);return}run.areaResolved=true;auto();renderAdventure();$('run-notice').textContent='何事もなく先に進んだ！';return}if(area?.mode==='COMMON_EVENT'){auto();runCommonEventArea(c,run.difficulty);return}if(area?.mode==='RANDOM'){const chest=randomChestEvent(c,area);if(chest){auto();if(chest.kind==='enemy'){const picked=item('enemies',chest.id);if(picked)startBattle(picked,true);else skipUnavailableAreaEvent()}else if(!runEvent(chest.id,{returnTo:'adventure',areaEvent:true}))skipUnavailableAreaEvent();return}if(area.enemyId){auto();startBattle(enemy,true);return}if(area.eventId&&eventAvailable(area.eventId)){auto();runEvent(area.eventId,{returnTo:'adventure',areaEvent:true});return}run.areaResolved=true;auto();renderAdventure();return}auto();if(area?.mode==='EVENT'||area?.eventId){const next=resolvedAreaEvent(area.eventId);if(next.kind==='event'){if(!runEvent(next.id,{returnTo:'adventure',areaEvent:true}))skipUnavailableAreaEvent()}else if(next.kind==='random')drawConsumedAreaEvent(c,area);else skipUnavailableAreaEvent();return}if(enemy){startBattle(enemy,true)}else{run.areaResolved=true;auto();renderAdventure();$('run-notice').textContent='このエリアには戦闘がありません。'}};
$('run-return').onclick=()=>modal('帰還しますか？\n冒険中に獲得したコインの半分を失います。',()=>{const run=state.adventure;if(!run)return;state.player.coins+=Math.max(0,run.coins-Math.floor(run.coins/2));state.adventure=null;state.player.hp=effective('maxHp');auto();go('home');randomVoice('return')});
/* Stage 6: isolated battle test. No rewards or adventure progress are changed. */
function renderEnemyPicker(){const root=$('enemy-picker');if(!root)return;root.replaceChildren();if(!catalog.enemies.length){root.textContent='敵が未登録です。Editorの「敵」で登録してください。';return}for(const e of catalog.enemies){const b=document.createElement('button');b.className='btn';b.textContent=e.name||e.id;b.onclick=()=>startBattle(e,false);root.append(b)}}
function enemyNumber(e,keys,fallback){for(const k of keys){if(e[k]!==undefined&&Number.isFinite(Number(e[k])))return Math.max(0,Number(e[k]))}return fallback}
function flashEnemy(){const art=$('battle-enemy-art');if(!art)return;art.classList.remove('enemy-hit-flash');void art.offsetWidth;art.classList.add('enemy-hit-flash');setTimeout(()=>art.classList.remove('enemy-hit-flash'),440)}
function guestMessage(template,guest,skill,effects=""){return String(template||'').replaceAll('{guest}',guest||'ゲスト').replaceAll('{skill}',skill||'スキル').replaceAll('{effects}',effects)}
// Display battle messages sequentially without delaying damage calculation or rescue logic.
const LOG_WAIT=620, LOG_FINAL_WAIT=1100;
function battleLogIdle(b){return new Promise(resolve=>{const poll=()=>{if(b!==battle||(!b.logBusy&&!b.logQueue.length))resolve();else setTimeout(poll,80)};poll()})}
// Keep the original one-line layout. Mouse wheel navigates the latest six messages.
function renderBattleLog(b,msg){
 const root=$('battle-log');if(!root||b!==battle)return;
 b.visibleLogs??=[];b.visibleLogs.push(msg);
 if(b.visibleLogs.length>6)b.visibleLogs.shift();
 // Preserve the user's position while reading earlier messages.
 if(b.logHistoryOffset>0)b.logHistoryOffset=Math.min(b.logHistoryOffset+1,b.visibleLogs.length-1);
 showBattleLogLine(b);
}
function showBattleLogLine(b){
 const root=$('battle-log');if(!root||b!==battle)return;
 const history=b.visibleLogs||[];
 const offset=Math.min(b.logHistoryOffset||0,Math.max(0,history.length-1));
 root.textContent=history[history.length-1-offset]||'';
 root.title=offset?`過去のログ (${offset}件前) — ホイール下で最新に戻る`:'ホイール上で過去5件のログを表示';
}
async function drainBattleLog(b){
 if(b.logBusy)return;b.logBusy=true;drawBattle();
 while(b===battle&&b.logQueue.length){
  const msg=b.logQueue.shift();renderBattleLog(b,msg);
  await sleep(b.ended?LOG_FINAL_WAIT:LOG_WAIT);
 }
 b.logBusy=false;
 if(b===battle){drawBattle();if(b.ended)showBattleContinue(b)}
}
function logBattle(msg){
 if(!battle)return;
 // Multiple effect messages must not disappear in the same frame.
 const lines=String(msg).split(/\n/).filter(Boolean);
 for(const line of lines){battle.log.push(line);battle.logQueue.push(line)}
 battle.log=battle.log.slice(-30);drainBattleLog(battle);
}
$('battle-log').addEventListener('wheel',event=>{
 if(!battle?.visibleLogs?.length)return;
 event.preventDefault();
 const max=Math.min(5,battle.visibleLogs.length-1);
 battle.logHistoryOffset=Math.max(0,Math.min(max,(battle.logHistoryOffset||0)+(event.deltaY<0?1:-1)));
 showBattleLogLine(battle);
},{passive:false});
function showBattleContinue(b){
 if(b!==battle||!b.ended||b.logBusy||b.logQueue.length)return;
 const btn=$('battle-return');btn.hidden=false;btn.textContent=(state?.eventBattlePending&&state?.eventProgress)?'イベントの続きへ':b.inAdventure?'結果を確認して次へ':'テスト選択へ戻る';
 btn.disabled=false;
}
function battleDamage(atk,def){return def>=atk*3?0:Math.max(1,Math.floor(atk-def))}
function startBattle(e,inAdventure=false){if(!state)return;if(state.eventBattlePending&&state.eventProgress)state.eventBattlePendingPortrait=true;const difficulty=inAdventure?(state.adventure?.difficulty||'EASY'):'NORMAL';const scenario=inAdventure?item('scenarios',state.adventure?.scenarioId):null;const scale=scenario?scenarioStats(scenario,difficulty):DIFF_STATS.NORMAL;const scaled=scaledEnemyStats(e,scale);const hp=scaled.hp;battleLocked=false;$('battle-log').replaceChildren();$('battle-return').hidden=true;battle={visibleLogs:[],logHistoryOffset:0,logQueue:[],logBusy:false,inAdventure,uses:inAdventure?state.adventure.uses:{},buffs:[],statuses:[],regens:[],selection:null,enemy:e,enemyHP:hp,enemyMaxHP:hp,enemyATK:scaled.atk,enemyDEF:scaled.def,enemySPD:scaled.spd,playerHP:effective('maxHp'),playerMaxHP:effective('maxHp'),guard:false,enemyGuard:false,enemyTurn:0,round:0,stolenCoins:{wallet:0,run:0},stealSucceeded:false,ended:false,log:[]};if(inAdventure&&state.adventure){const pending=safeCount(state.adventure.pendingTrapDamage);battle.playerHP=Math.max(1,battle.playerMaxHP-pending);state.adventure.pendingTrapDamage=0;auto()}musicSync();$('battle-enemy-art').style.setProperty('--cq-enemy-offset-y',`${Math.max(-300,Math.min(300,Number(e.imageOffsetY)||0))}px`);$('battle-enemy-art').style.setProperty('--cq-enemy-scale',`${Math.max(25,Math.min(250,Number(e.imageScale)||100))/100}`);$('battle-enemy-art').classList.remove('enemy-defeated','enemy-hit-flash');$('battle-enemy-art').innerHTML=imgHTML('enemies',e);$('battle-enemy-art').style.removeProperty('--enemy-status-mask');const enemyImage=$('battle-enemy-art').querySelector('img');if(enemyImage){const maskPath=enemyImage.getAttribute('src');if(maskPath)$('battle-enemy-art').style.setProperty('--enemy-status-mask',`url("${maskPath.replaceAll('\"','%22')}")`)}logBattle(`${e.name||e.id} が現れた！`);for(const row of [...equippedSkillChoices(),...weaponSkillChoices()].filter(x=>x.skillType==='passive')){const msgs=[...processEffects(row,'passive',row.name),...processEffects(row,'battle_start',row.name)];if(msgs.length)msgs.forEach(msg=>logBattle(`${row.name}：${msg}`))}for(const [kind,ids] of [['equipment',equippedEquipmentIds()],['items',equippedItemIds()]])for(const id of ids){const row=item(kind,id);if(row){const msgs=processEffects(row,'battle_start',row.name);if(msgs.length)msgs.forEach(logBattle)}}for(const id of equippedGuestIds()){const guest=item('guests',id);if(!guest)continue;const start=[...processEffects(guest,'battle_start',guest.name)];if(Number(state.guestAffection?.[id]||0)>=10)start.push(...processEffects(guest.affectionBonus,'battle_start',guest.name+'の絆'));if(start.length)start.forEach(logBattle)}if(!endCheck()){drawBattle();go('battle')}}
function renderHP(id,label,current,max){const pct=Math.max(0,Math.min(100,Math.round(current/Math.max(1,max)*100)));$(id).innerHTML=`<div class="hp-caption">${id==='battle-player-hp'?'<strong>前田ノカ</strong>':''}<span>${current} / ${max}</span></div><div class="hp-track"><div class="hp-fill" style="width:${pct}%"></div></div>`}
function drawBattle(){if(!battle)return;const enemyArt=$('battle-enemy-art');enemyArt.classList.toggle('enemy-defeated',battle.enemyHP<=0&&battle.koHideReady===true);enemyArt.classList.toggle('enemy-poisoned',battle.statuses.some(x=>x.target==='enemy'&&x.type==='poison'));for(const kind of ['burn','blind','silence','curse','sleep'])enemyArt.classList.toggle('enemy-'+kind,statusOn('enemy',kind));enemyArt.classList.toggle('enemy-paralyzed',battle.statuses.some(x=>x.target==='enemy'&&x.type==='paralysis'));$('battle-enemy-name').textContent=battle.enemy.name||battle.enemy.id;renderHP('battle-enemy-hp','敵 HP',battle.enemyHP,battle.enemyMaxHP);renderHP('battle-player-hp','前田ノカ HP',battle.playerHP,battle.playerMaxHP);for(const id of ['battle-attack','battle-defend','battle-item','battle-skill'])$(id).disabled=battle.ended;$('battle-return').hidden=!battle.ended||battle.logBusy||battle.logQueue.length;const locked=battleLocked||battle.ended||battle.logBusy||battle.logQueue.length;for(const id of ['battle-attack','battle-defend','battle-item','battle-skill'])$(id).disabled=locked}
function playSE(path,volume=100){if(typeof path!=='string'||!/^assets\/(?:audio\/)?se\/[\w.-]+\.mp3$/i.test(path))return;try{battleAudio.pause();battleAudio.currentTime=0;battleAudio.src=path;battleAudio.volume=Math.max(0,Math.min(1,seVolume*Number(volume??100)/100));battleAudio.play().catch(e=>console.warn('SE再生失敗',path,e));}catch(e){console.warn('SE再生失敗',path,e)}}
function actionSE(kind,row,action){if(kind==='attack'){for(const id of equippedEquipmentIds()){const weapon=item('equipment',id);const se=weapon?.attackSe||weapon?.se;if(se)return se;}return '';}if(kind==='enemy')return action?.se||row?.attackSe||row?.se||'';return row?.useSe||row?.se||''}
function scaledEffectAmount(e,side,stat){
 const raw=Number(e?.amount)||0;
 if(e?.amountMode!=='percent'||!['heal','damage','stat_up','stat_down','poison','burn'].includes(e?.type))return raw;
 const base=stat?Math.max(0,side==='enemy'?Number(battle?.['enemy'+stat.toUpperCase()])||0:Number(effective(stat))||0):Math.max(0,side==='enemy'?Number(battle?.enemyMaxHP)||0:Number(battle?.playerMaxHP)||0);
 const value=Math.floor(base*Math.abs(raw)/100);
 return Math.sign(raw)*(raw!==0?Math.max(1,value):0);
}
function numberEffect(e,defaultValue=0){const n=Number(e?.amount);return Number.isFinite(n)?n:defaultValue}
const STATUS_NAMES={poison:'毒',paralysis:'麻痺',burn:'火傷',blind:'暗闇',silence:'沈黙',curse:'呪い',sleep:'眠り'};
function statusOn(side,type){return !!battle?.statuses?.some(x=>x.target===side&&x.type===type)}
function statusResist(side,type){const rows=side==='enemy'?[battle.enemy]:[...equippedEquipmentIds().map(id=>item('equipment',id)),...equippedItemIds().map(id=>item('items',id)),...equippedGuestIds().map(id=>item('guests',id))];return Math.max(0,Math.min(100,rows.reduce((sum,row)=>sum+Number(row?.statusResistances?.[type]||0),0)))}
function statusApply(side,type,e){const failed=`${side==='enemy'?'敵への':''}${STATUS_NAMES[type]}の付与に失敗した！`;if(!(Number(e.amount)>0))return failed;if(Math.random()*100>=Math.max(0,Math.min(100,Number(e.inflictChance??100))))return failed;if(Math.random()*100<statusResist(side,type))return `${side==='enemy'?'敵は':''}${STATUS_NAMES[type]}を防いだ！`;const duration=Math.max(1,Math.floor(Number(e.duration)||3));const old=battle.statuses.find(x=>x.target===side&&x.type===type);if(old){old.duration=Math.max(old.duration,duration);old.fresh=true;if(type==='paralysis')old.skipChance=Math.max(0,Math.min(100,Number(e.skipChance??50)));if(type==='poison'||type==='burn'){old.amount=Math.max(1,Math.floor(scaledEffectAmount(e,side)));old.amountMode=e.amountMode||'fixed';old.rawAmount=Number(e.amount)||1}}else battle.statuses.push({fresh:true,target:side,type,amount:type==='poison'||type==='burn'?Math.max(1,Math.floor(scaledEffectAmount(e,side))):Math.max(1,Number(e.amount)||1),amountMode:e.amountMode||'fixed',rawAmount:Number(e.amount)||1,skipChance:Number(e.skipChance??50),duration});return `${side==='enemy'?'敵は':''}${STATUS_NAMES[type]}状態になった！`}
function wakeOnDamage(side,amount){if(!(Number(amount)>0)||!battle?.statuses)return '';const before=battle.statuses.length;battle.statuses=battle.statuses.filter(x=>!(x.target===side&&x.type==='sleep'));return before!==battle.statuses.length?`${side==='enemy'?(battle.enemy?.name||'敵')+'は':''}目を覚ました！`:''}
function cleanseStatus(side,e){const kinds=e.cleanseType==='all'?Object.keys(STATUS_NAMES):[e.cleanseType||'poison'];const removed=battle.statuses.filter(x=>x.target===side&&kinds.includes(x.type));battle.statuses=battle.statuses.filter(x=>!removed.includes(x));return removed.length?`${side==='enemy'?'敵の':''}${removed.map(x=>STATUS_NAMES[x.type]).join('・')}が治った！`:'解除する状態異常がない。'}
function statusDamageMultiplier(side){return statusOn(side,'burn')?.8:1}
function statusHitPenalty(side){return statusOn(side,'blind')?-30:0}
function statusHealAmount(side,amount){return statusOn(side,'curse')?Math.floor(amount/2):amount}
function hasExtraTurnEffect(row){return [...(row?.effects||[]),...(row?.randomEffectGroups||[]).flatMap(g=>(g.options||[]).map(o=>o.effect))].some(e=>e?.type==='extra_turn'&&(e.trigger||'on_use')==='on_use')}
function onlyExtraTurn(row){const effects=[...(row?.effects||[]).filter(e=>(e.trigger||'on_use')==='on_use'),...(row?.randomEffectGroups||[]).flatMap(g=>(g.options||[]).map(o=>o.effect)).filter(Boolean)];return effects.length>0&&effects.every(e=>e.type==='extra_turn')}
function grantExtraTurns(target,amount){if(!battle||battle.ended)return null;const who=target==='enemy'?'e':'p';if(battle.extraTurnGranted?.[who])return 'このターンは追加行動を再発動できない！';const n=Math.min(3,Math.max(1,Math.floor(Number(amount)||1)));battle.extraTurnGranted??={p:false,e:false};battle.extraTurnGranted[who]=true;const order=battle.pendingOrder||[];if(who==='p')battle.pendingOrder=order.filter(x=>x!=='p');else battle.pendingOrder=order.filter(x=>x!=='e');battle.pendingOrder.unshift(...Array(n).fill(who));return `${who==='p'?'前田ノカ':'敵'}は直後に${n}回追加行動できる！`}
function buffOwner(side){return side==='enemy'?'敵':''}
function buffSubject(side){return side==='enemy'?'敵の':''}
function buffLabel(stat){return ({atk:'攻撃力',def:'防御力',spd:'素早さ',accuracy:'命中率',damage_multiplier:'与えるダメージ',damage_reduction:'受けるダメージ',crit:'会心率',armor_pierce:'防御貫通',action_immunity:'攻撃無効化'})[stat]||stat}
function buffStartMessage(side,stat,amount){
 const owner=buffOwner(side),subject=buffSubject(side),n=Number(amount)||0;
 if(stat==='damage_multiplier'){const multiplier=Math.max(0,1+n/100);return `${subject}与えるダメージが${Number(multiplier.toFixed(2))}倍になった！`;}
 if(stat==='damage_reduction')return `${subject}受けるダメージが${n}%軽減された！`;
 if(stat==='accuracy'||stat==='crit')return `${subject}${buffLabel(stat)}が${Math.abs(n)}%${n<0?'低下':'上昇'}した！`;
 if(stat==='armor_pierce')return `${subject}防御貫通効果が付与された！`;
 if(stat==='action_immunity')return `${owner?owner+'は':''}無効化バリアを展開した！`;
 return `${subject}${buffLabel(stat)}が${Math.abs(n)}${n<0?'低下':'上昇'}した！`;
}
function buffEndMessage(side,stat){
 const subject=buffSubject(side);
 if(stat==='action_immunity')return `${subject}無効化バリアが消えた！`;
 return `${subject}${buffLabel(stat)}が元に戻った！`;
}
function applyEffect(e,source){if(!e||Math.random()*100>=Math.max(0,Math.min(100,Number(e.chance??100))))return null;const target=e.target==='enemy'?'enemy':'self';const type=e.type;const amount=type==='accuracy'?Number(e.amount||0):Math.max(0,scaledEffectAmount(e,target,['stat_up','stat_down'].includes(type)?(e.stat||'atk'):null));if(type==='restore_item_uses'){
 if(!battle.inAdventure)return 'アイテム使用回数増加はシナリオ中のみ有効です。';
 const id=battle.selection?.restoreItemId,selected=id?item('items',id):null;
 if(!selected||!equippedItemIds().includes(id))return '対象アイテムが選択されていません。';
 const count=Math.max(0,Math.floor(Number(e.amount)||0));
 const key='item:'+id;battle.uses[key]=remainingUses(selected,'item')+count;
 return `${selected.name||id}の残り使用回数が${count}回増えた！`;
 }if(type==='steal_item')return stealEnemyDrop();if(type==='bonus_coins')return null;
 if(type==='action_immunity'){const duration=Math.max(1,Math.floor(Number(e.duration)||1));const charges=Math.max(0,Math.floor(Number(e.charges??e.amount??0)));battle.buffs.push({fresh:true,target,stat:'action_immunity',immunityKind:['attack','skill','both'].includes(e.immunityKind)?e.immunityKind:'both',charges:charges||null,duration});return buffStartMessage(target,'action_immunity',0);}if(type==='extra_turn')return grantExtraTurns(target,amount);if(['dispel_buff','dispel_debuff','dispel_all'].includes(type)){const old=battle.buffs.length;battle.buffs=battle.buffs.filter(b=>b.target!==target||type==='dispel_buff'&&b.amount<=0||type==='dispel_debuff'&&b.amount>=0);return `${target==='enemy'?'敵の':''}能力変化を${old-battle.buffs.length}件解除した！`}if(type==='cleanse'){const msg=cleanseStatus(target,e);if(!msg.includes('解除する'))commonSE('cleanse');return msg}if(STATUS_NAMES[type]){const msg=statusApply(target,type,e);if(msg?.includes('状態になった'))commonSE(type);return msg}if(type==='regen_heal'){
  // 使用ターンを1回目とし、残りは次のプレイヤー行動開始時に回復する。
  const turns=Math.max(1,Math.floor(Number(e.duration)||1));
  const heal=Math.max(0,Math.floor(scaledEffectAmount({...e,type:'heal'},target)));
  if(target==='enemy'){
   const before=battle.enemyHP;battle.enemyHP=Math.min(battle.enemyMaxHP,battle.enemyHP+statusHealAmount('enemy',heal));
   if(turns>1)battle.regens.push({target,amount:Number(e.amount)||0,amountMode:e.amountMode||'fixed',remaining:turns-1});
   commonSE('heal');return `敵のHPが${battle.enemyHP-before}回復した。`;
  }
  const before=battle.playerHP;battle.playerHP=Math.min(battle.playerMaxHP,battle.playerHP+statusHealAmount('self',heal));
  if(turns>1)battle.regens.push({target,amount:Number(e.amount)||0,amountMode:e.amountMode||'fixed',remaining:turns-1});
  commonSE('heal');return `HPが${battle.playerHP-before}回復した。`;
 }if(type==='attack_multiplier'){
 const multiplier=Math.max(0,Number(e.amount)||0);
 const attacker=target==='enemy'?'self':'enemy',defender=target;
 const atk=combatStat(attacker,'atk')*multiplier;
 const def=Math.max(0,combatStat(defender,'def')-battleBonus(attacker,'armor_pierce'));
 let damage=adjustedDamage(battleDamage(atk,def),attacker,defender);
 damage=skillCriticalDamage(damage,attacker);
 if(target==='enemy'){
  if(battle.enemyGuard)damage=Math.ceil(damage/2);
  battle.enemyGuard=false;battle.enemyHP=Math.max(0,battle.enemyHP-damage);
  if(damage>0){commonSE('damage');flashEnemy();const wake=wakeOnDamage('enemy',damage);if(wake)logBattle(wake)}
  return `敵に${damage}ダメージ！`;
 }
 if(battle.guard)damage=Math.ceil(damage/2);
 battle.playerHP=Math.max(0,battle.playerHP-damage);
 if(damage>0){commonSE('damage');const wake=wakeOnDamage('self',damage);if(wake)logBattle(wake)}
 return `前田ノカに${damage}ダメージ！`;
}if(type==='heal'){commonSE('heal');if(target==='enemy'){const before=battle.enemyHP;battle.enemyHP=Math.min(battle.enemyMaxHP,battle.enemyHP+statusHealAmount('enemy',amount));return `敵のHPが${battle.enemyHP-before}回復した。`}const before=battle.playerHP;battle.playerHP=Math.min(battle.playerMaxHP,battle.playerHP+statusHealAmount('self',amount));return `HPが${battle.playerHP-before}回復した。`;}if(type==='damage'){const d=skillCriticalDamage(amount,target==='enemy'?'self':'enemy');if(d>0)commonSE('damage');if(target==='enemy'){flashEnemy();battle.enemyHP=Math.max(0,battle.enemyHP-d);const wake=wakeOnDamage('enemy',d);return `敵に${d}ダメージ！${wake?' '+wake:''}`;}battle.playerHP=Math.max(0,battle.playerHP-d);const wake=wakeOnDamage('self',d);return `前田ノカに${d}ダメージ！${wake?' '+wake:''}`;}if(type==='accuracy'){battle.buffs.push({fresh:true,target,stat:'accuracy',amount,duration:Math.max(1,Math.floor(Number(e.duration)||1))});return buffStartMessage(target,'accuracy',amount);}if(type==='damage_reduction'||type==='damage_multiplier'||type==='crit'||type==='armor_pierce'){const stat=type,duration=Math.max(1,Math.floor(Number(e.duration)||1));battle.buffs.push({fresh:true,target,stat,amount,duration});return buffStartMessage(target,type,amount);}if(type==='lifesteal'){flashEnemy();const dealt=Math.min(battle.enemyHP,skillCriticalDamage(amount));battle.enemyHP-=dealt;const wake=wakeOnDamage('enemy',dealt);if(wake)logBattle(wake);const before=battle.playerHP;battle.playerHP=Math.min(battle.playerMaxHP,battle.playerHP+dealt);return `敵に${dealt}ダメージ、HPを${battle.playerHP-before}吸収！`;}if(type==='extra_attack'){
 const count=Math.max(1,Math.min(20,Math.floor(Number(e.attackCount??1)||1)));
 const percent=Math.max(0,Number(e.amount??100));
 const hits=[];
 for(let i=0;i<count&&battle.enemyHP>0;i++){
  const normal=adjustedDamage(battleDamage(combatStat('self','atk'),combatStat('enemy','def')),'self','enemy');
  const d=skillCriticalDamage(Math.max(0,Math.floor(normal*percent/100)));
  battle.enemyHP=Math.max(0,battle.enemyHP-d);
  if(d>0){flashEnemy();commonSE('damage')}
  const wake=wakeOnDamage('enemy',d);if(wake)logBattle(wake);
  hits.push(`${d}ダメージ`);
 }
 return `追加攻撃！ ${hits.join('、')}！`;
 }if(type==='stat_down'){const stat=e.stat||'atk',duration=Math.max(1,Math.floor(Number(e.duration)||1));if(!['atk','def','spd'].includes(stat))return 'この能力低下は未対応です。';battle.buffs.push({fresh:true,target,stat,amount:-amount,duration});return buffStartMessage(target,stat,-amount);}if(type==='stat_up'){const stat=e.stat||'atk',duration=Math.max(1,Math.floor(Number(e.duration)||1));if(!['atk','def','spd'].includes(stat))return 'この能力上昇はまだ未対応です。';battle.buffs.push({fresh:true,target,stat,amount,duration});return buffStartMessage(target,stat,amount);}return `${source}の「${type}」は今後の拡張対象です。`}
function randomSkillEffects(row,source,executor){const messages=[];for(const group of row?.randomEffectGroups||[]){let roll=Math.random()*100;for(const option of group.options||[]){roll-=Math.max(0,Number(option.probability)||0);if(roll<0){const e=option.effect;if(e&&(e.trigger||'on_use')==='on_use'&&!battle?.preemptiveEffects?.has(e)){const message=executor?executor(e):applyEffect(e,source);if(message)messages.push(message)}break}}}return messages}
function processEffects(row,trigger,source){let messages=[];for(const e of row?.effects||[]){if((e.trigger||'on_use')!==trigger||battle?.preemptiveEffects?.has(e))continue;const result=applyEffect(e,source);if(result)messages.push(result)}return messages}
function guestManualChoices(){return equippedGuestIds().flatMap(id=>{const guest=item('guests',id);if(!guest)return[];const base=guest.activeSkill||guest.manualSkill;const lv=ownedLevel('guests',id);if(!base||lv<Number(base.unlockLevel??1))return[];let active={...base};for(let n=2;n<=Math.min(3,lv);n++){const override=base.levels?.[n]||base.levels?.[String(n)]||{};active={...active,...override,effects:Array.isArray(override.effects)?override.effects:active.effects}}if(!Array.isArray(active.effects)||!active.effects.some(e=>(e.trigger||'on_use')==='on_use'))return[];return [{...active,guestId:id,id:'guest-'+id,name:active.name||'ゲストスキル',guestName:guest.name||id,usesPerAdventure:active.usesPerAdventure??1,guestManual:true}]})}
function weaponSkillLevel(spec,weaponLv){
 if(spec?.skillLevels){const value=Number(spec.skillLevels[weaponLv]??spec.skillLevels[String(weaponLv)]??0);return Number.isInteger(value)?Math.max(0,Math.min(3,value)):0;}
 return weaponLv>=Number(spec?.unlockLevel||1)?1:0; // 旧データとの互換性
}
function weaponSkillChoices(){return equippedEquipmentIds().flatMap(id=>{const weapon=item('equipment',id),lv=ownedLevel('equipment',id);return (weapon?.weaponSkills||[]).map(x=>{const skillLv=weaponSkillLevel(x,lv);if(!skillLv)return null;const raw=catalog.skills?.find(s=>s.id===x.skillId);if(!raw)return null;const level=raw.levels?.[skillLv]||raw.levels?.[String(skillLv)]||{};return {...raw,...level,effects:Array.isArray(level.effects)?level.effects:raw.effects,id:'weapon-'+id+'-'+raw.id,name:raw.name,rank:raw.rank,weaponSkill:true,weaponName:weapon.name,skillLevel:skillLv}}).filter(Boolean)})}
function equippedSkillChoices(){return state.equipped.skills.map(id=>item('skills',id)).filter(Boolean)}
function skillIsAttack(row){return [...(row?.effects||[]),...(row?.randomEffectGroups||[]).flatMap(g=>(g.options||[]).map(o=>o.effect).filter(Boolean))].some(e=>(e.trigger||'on_use')==='on_use'&&['damage','attack_multiplier','extra_attack','lifesteal'].includes(e.type)&&e.target!=='self')}
function skillCriticalDamage(damage,side='self'){
 const rate=Math.max(0,Math.min(1,.05+((side==='self'?equipmentCriticalRateBonus():0)+battleBonus(side,'crit'))/100));
 if(damage>0&&Math.random()<rate){logBattle(side==='enemy'?'敵の会心の一撃！':'会心の一撃！');return Math.ceil(damage*1.5)}
 return damage;
}
function equipmentCriticalRateBonus(){return equippedEquipmentIds().reduce((sum,id)=>sum+(Number(item('equipment',id)?.criticalRateBonus)||0),0)}
function accuracyBonus(side){if(side==='enemy')return Number(battle.enemy.accuracyBonus||0)+battleBonus('enemy','accuracy');return [...equippedEquipmentIds().map(id=>item('equipment',id)),...equippedItemIds().map(id=>item('items',id)),...equippedGuestIds().map(id=>item('guests',id)),...equippedSkillChoices(),...guestBondData()].reduce((sum,row)=>sum+(Number(row?.accuracyBonus)||0),0)+battleBonus('self','accuracy')}
function hitCheck(rate){return Math.random()*100<Math.max(0,Math.min(100,rate))}
function remainingUses(row,kind){const key=kind+':'+row.id;return battle.uses[key]??Math.max(0,Math.floor(Number(row.usesPerAdventure??1)))}
function consumeUse(row,kind){const key=kind+':'+row.id;battle.uses[key]=remainingUses(row,kind)-1}
function combatStat(side,stat){const base=side==='enemy'?battle['enemy'+stat.toUpperCase()]:effective(stat);return Math.max(0,base+battle.buffs.filter(b=>b.target===side&&b.stat===stat).reduce((sum,b)=>sum+b.amount,0))}
function battleBonus(side,stat){return battle.buffs.filter(b=>b.target===side&&b.stat===stat).reduce((sum,b)=>sum+b.amount,0)}
// Stage 77 continuation: action-type immunity. Charges are consumed per incoming action,
// not per turn, so speed-based double actions and turn order are handled consistently.
function immunityKind(type){return type==='attack'?'attack':'skill'}
function blockIncoming(target,type){
 const kind=immunityKind(type);
 const buff=battle.buffs.find(b=>b.target===target&&b.stat==='action_immunity'&&(!b.immunityKind||b.immunityKind==='both'||b.immunityKind===kind));
 if(!buff)return false;
 if(Number.isFinite(buff.charges)&&buff.charges>0){buff.charges--;if(buff.charges<=0)battle.buffs.splice(battle.buffs.indexOf(buff),1)}
 logBattle(`${target==='enemy'?'敵は':''}${kind==='attack'?'通常攻撃':'スキル'}を無効化した！`);
 return true;
}
function adjustedDamage(raw,attacker,defender){let d=Math.max(0,Number(raw)||0);d*=statusDamageMultiplier(attacker);const mult=battleBonus(attacker,'damage_multiplier');if(mult)d*=Math.max(0,1+mult/100);const reduction=battleBonus(defender,'damage_reduction');if(reduction)d*=Math.max(0,1-reduction/100);return Math.max(0,Math.floor(d))}
// HP0で発動する装備中アイテム。冒険内の使用回数を消費する（所持品は消えない）。
function tryAutoRescue(){
 if(!battle||battle.ended||battle.playerHP>0)return false;
 const rows=equippedItemIds().map(id=>item('items',id)).filter(Boolean);
 for(const kind of ['substitute','revive']){
  for(const row of rows){if(row.autoRescue!==kind||remainingUses(row,'item')<=0)continue;
   consumeUse(row,'item');
   const heal=Math.max(1,Math.floor(Number(row.rescueHp)||1));
   battle.playerHP=Math.min(battle.playerMaxHP,kind==='substitute'?heal:heal);
   logBattle(kind==='substitute'?`${row.name}が身代わりになった！ HP${battle.playerHP}で踏みとどまった！`:`${row.name}が自動発動！ HP${battle.playerHP}で復活した！`);
   return true;
  }
 }
 return false;
}
// Resolve player KO first, including automatic revive/substitute items. A simultaneous KO
// counts as defeat only if the player is still at 0 HP after rescue opportunities.
function endCheck(){
 if(!battle||battle.ended)return !!battle?.ended;
 if(battle.playerHP<=0){
  if(!tryAutoRescue()){endBattle(false);return true}
 }
 if(battle.enemyHP<=0){endBattle(true);return true}
 return false;
}
function tickRegens(target){
 const messages=[];
 for(const regen of [...(battle.regens||[])]){
  if(regen.target!==target)continue;
  const max=target==='enemy'?battle.enemyMaxHP:battle.playerMaxHP;
  const amount=Math.max(0,Math.floor(regen.amountMode==='percent'?max*regen.amount/100:regen.amount));
  if(target==='enemy'){
   const before=battle.enemyHP;battle.enemyHP=Math.min(max,before+statusHealAmount('enemy',amount));
   messages.push(`敵のHPが${battle.enemyHP-before}回復した。`);
  }else{
   const before=battle.playerHP;battle.playerHP=Math.min(max,before+statusHealAmount('self',amount));
   messages.push(`HPが${battle.playerHP-before}回復した。`);
  }
  commonSE('heal');
  regen.remaining--;
  if(regen.remaining<=0){battle.regens.splice(battle.regens.indexOf(regen),1);messages.push(`${target==='enemy'?'敵の':''}継続回復の効果が終了した。`)}
 }
 return messages;
}
function tickStatuses(target){const msg=[];for(const x of [...battle.statuses]){if(x.target!==target)continue;if(x.type==='poison'||x.type==='burn'){const tickAmount=x.amountMode==='percent'?Math.max(1,Math.floor((target==='enemy'?battle.enemyMaxHP:battle.playerMaxHP)*Math.max(0,Number(x.rawAmount)||0)/100)):x.amount;if(target==='enemy')battle.enemyHP=Math.max(0,battle.enemyHP-tickAmount);else battle.playerHP=Math.max(0,battle.playerHP-tickAmount);commonSE(x.type==='poison'?'poisonTick':'burnTick');msg.push(`${target==='enemy'?'敵は':''}${STATUS_NAMES[x.type]}で${tickAmount}ダメージ。`)}if(x.fresh){x.fresh=false;continue}x.duration--;if(x.duration<=0){battle.statuses.splice(battle.statuses.indexOf(x),1);msg.push(`${target==='enemy'?'敵の':''}${STATUS_NAMES[x.type]}が切れた。`)}}for(const b of [...battle.buffs]){if(b.target!==target)continue;if(b.fresh){b.fresh=false;continue}b.duration--;if(b.duration<=0){battle.buffs.splice(battle.buffs.indexOf(b),1);msg.push(buffEndMessage(target,b.stat))}}return msg}
async function pauseBattle(ms){drawBattle();await sleep(ms)}
async function doPlayerAction(action,first){if(action==='defend'){commonSE('defend');battle.guard=true;logBattle('防御した。');return}if(action==='item'||action==='skill'||action==='guest_skill'||action==='weapon_skill'){const row=battle.selection;if(!row)return;if(battle.extraTurnGranted?.p&&onlyExtraTurn(row)){logBattle('このターンは追加行動を再発動できない！');return}if(action!=='item'&&statusOn('self','silence')){logBattle('沈黙していてスキルを使えない！');return}commonSE('skill');randomVoice(action==='item'?'item':'skill');if(action==='guest_skill')playGuestSkillVoice(row.guestId,'manual');playSE(actionSE(action,row),row.seVolume??100);logBattle(`${row.name||row.id}を使用！`);await pauseBattle(BATTLE_DELAY.startup);const successRate=Math.max(0,Math.min(100,Number(row.successRate??100)+(skillIsAttack(row)?accuracyBonus('self')+statusHitPenalty('self')+(row.weaponSkill?Number(row.accuracyBonus||0):0):0)));const succeeded=battle.preemptiveEffects?battle.preemptiveSuccess:Math.random()*100<successRate;const blocked=succeeded&&skillIsAttack(row)&&blockIncoming('enemy','skill');const msgs=succeeded&&!blocked?[...processEffects(row,'on_use',row.name||row.id),...randomSkillEffects(row,row.name||row.id)]:[];consumeUse(row,action);battle.preemptiveEffects=null;delete battle.preemptiveSuccess;const successText=blocked?'敵はスキルを無効化した！':action==='guest_skill'&&row.successMessage?guestMessage(row.successMessage,row.guestName,row.name,msgs.join(' ')):(msgs.join(' ')||'効果が発動した。');const failText=action==='guest_skill'&&row.failureMessage?guestMessage(row.failureMessage,row.guestName,row.name):`${row.name||row.id}は失敗した！`;if(!succeeded)commonSE('skillFail');logBattle(succeeded?successText:failText);endCheck();return}commonSE('attack');randomVoice('attack');playSE(actionSE('attack'),item('equipment',equippedEquipmentIds().find(id=>{const w=item('equipment',id);return w?.attackSe||w?.se}))?.seVolume??100);logBattle('攻撃！');await pauseBattle(BATTLE_DELAY.startup);playerAttack();if(battle.ended)return;for(const id of equippedEquipmentIds()){const effects=processEffects(item('equipment',id),'on_attack','装備');if(effects.length)logBattle(effects.join(' '));}endCheck()}
// Stage 57: fixed / periodic enemy action scheduler. One enemy action = one turn.
function scheduledEnemyMove(){
 const turn=++battle.enemyTurn;
 const patterns=Array.isArray(battle.enemy.actionPatterns)?battle.enemy.actionPatterns:[];
 const valid=patterns.filter(p=>p&&['fixed','periodic'].includes(p.schedule)&&Number.isInteger(Number(p.turn))&&Number(p.turn)>=1);
 const firing=p=>p.schedule==='fixed'?turn===Number(p.turn):(turn>=Number(p.turn)&&(turn-Number(p.turn))%Math.max(1,Number(p.interval)||1)===0);
 const preparing=p=>p.warning&&p.warning.trim()&&Number(p.prepareTurns||0)>0&&(p.schedule==='fixed'?turn===Number(p.turn)-Number(p.prepareTurns):(turn>=Number(p.turn)-Number(p.prepareTurns)&&(turn-(Number(p.turn)-Number(p.prepareTurns)))%Math.max(1,Number(p.interval)||1)===0));
 // A preparation occupies the action; priority: fixed > periodic > random.
 for(const group of ['fixed','periodic']){
  for(const p of valid.filter(x=>x.schedule===group)){
   if(firing(p))return {move:p,preparing:false};
   if(preparing(p))return {move:p,preparing:true};
  }
 }
 return {move:enemyMove(),preparing:false};
}
function enemyMove(){const moves=Array.isArray(battle.enemy.actions)?battle.enemy.actions.filter(x=>x&&['attack','guard','heal','poison','paralysis','burn','blind','silence','curse','sleep','skill','steal_coins','escape','force_end'].includes(x.type)&&Number(x.weight??1)>0):[];if(!moves.length)return {type:'attack'};const total=moves.reduce((n,x)=>n+Number(x.weight??1),0);let roll=Math.random()*total;for(const move of moves){roll-=Number(move.weight??1);if(roll<0)return move}return moves[moves.length-1]}
async function enemySkill(move,name){
 const skill=item('skills',move.skillId);if(!skill){logBattle(`${name}は技を繰り出そうとしたが失敗した！`);return}
 const attack=skillIsAttack(skill),chance=Math.max(0,Math.min(100,Number(skill.successRate??100)+(attack?accuracyBonus('enemy')+statusHitPenalty('enemy'):0)));
 if(statusOn('enemy','silence')){logBattle(`${name}は沈黙していてスキルを使えない！`);return}if(Math.random()*100>=chance){logBattle(skill.failureMessage||`${skill.name}は失敗した！`);return}
 const messages=[];
 if(attack&&blockIncoming('self','skill'))return;
 function executeEnemyEffect(effect){if((effect.trigger||'on_use')!=='on_use'||Math.random()*100>=Number(effect.chance??100))return null;
 const before=messages.length;
  const target=effect.target==='enemy'?'enemy':'self'; // enemy skill: self=player, enemy=enemy
  if(effect.type==='armor_pierce'){
   // 防御貫通は攻撃者に付く効果。敵スキルの対象がノカでも、敵自身に付与する。
   const amount=Math.max(0,Number(effect.amount)||0);
   battle.buffs.push({fresh:true,target:'enemy',stat:'armor_pierce',amount,duration:Math.max(1,Math.floor(Number(effect.duration)||1))});
   messages.push(buffStartMessage('enemy','armor_pierce',amount));
  }else if(effect.type==='attack_multiplier'){
   const multiplier=Math.max(0,Number(effect.amount)||0);
   const defender=target==='enemy'?'enemy':'self';
   const attacker=defender==='self'?'enemy':'self';
   const atk=combatStat(attacker,'atk')*multiplier;
   const def=Math.max(0,combatStat(defender,'def')-battleBonus(attacker,'armor_pierce'));
   let damage=adjustedDamage(battleDamage(atk,def),attacker,defender);
   damage=skillCriticalDamage(damage,attacker);
   if(defender==='self'){
    if(battle.guard)damage=Math.ceil(damage/2);
    battle.playerHP=Math.max(0,battle.playerHP-damage);
    if(damage>0)commonSE('damage');
    const wake=wakeOnDamage('self',damage);if(wake)messages.push(wake);
    messages.push(`前田ノカに${damage}ダメージ！`);
   }else{
    if(battle.enemyGuard)damage=Math.ceil(damage/2);
    battle.enemyGuard=false;battle.enemyHP=Math.max(0,battle.enemyHP-damage);
    if(damage>0){commonSE('damage');flashEnemy()}
    const wake=wakeOnDamage('enemy',damage);if(wake)messages.push(wake);
    messages.push(`敵に${damage}ダメージ！`);
   }
  }else if(effect.type==='steal_coins'){messages.push(stealBattleCoins(effect))}else if(effect.type==='action_immunity'){const side=target==='enemy'?'enemy':'self';battle.buffs.push({fresh:true,target:side,stat:'action_immunity',immunityKind:['attack','skill','both'].includes(effect.immunityKind)?effect.immunityKind:'both',charges:Math.max(0,Math.floor(Number(effect.charges??effect.amount)||0))||null,duration:Math.max(1,Math.floor(Number(effect.duration)||1))});messages.push(buffStartMessage(side,'action_immunity',0))}else if(effect.type==='extra_turn'){messages.push(grantExtraTurns(target==='enemy'?'enemy':'self',effect.amount));}
  else if(effect.type==='damage'||effect.type==='extra_attack'||effect.type==='lifesteal'){
   const base=Math.max(0,scaledEffectAmount(effect,target==='enemy'?'enemy':'self'));let damage=effect.type==='extra_attack'?battleDamage(combatStat('enemy','atk'),combatStat('self','def')):base;
   damage=adjustedDamage(Math.floor(damage),'enemy','self');damage=skillCriticalDamage(damage,'enemy');if(battle.guard)damage=Math.ceil(damage/2);
   battle.playerHP=Math.max(0,battle.playerHP-damage);const wake=wakeOnDamage('self',damage);if(wake)messages.push(wake);messages.push(`前田ノカに${damage}ダメージ！`);
   if(effect.type==='lifesteal')battle.enemyHP=Math.min(battle.enemyMaxHP,battle.enemyHP+damage);
  }else if(effect.type==='heal'){const n=Math.max(0,scaledEffectAmount(effect,'enemy'));battle.enemyHP=Math.min(battle.enemyMaxHP,battle.enemyHP+statusHealAmount('enemy',n));messages.push(`${name}はHPを回復した！`)}
  else if(STATUS_NAMES[effect.type]){{const statusMessage=statusApply(target==='enemy'?'enemy':'self',effect.type,effect);if(statusMessage)messages.push(statusMessage)}}else if(effect.type==='cleanse'){messages.push(cleanseStatus(target==='enemy'?'enemy':'self',effect))}
  else if(effect.type==='stat_up'||effect.type==='stat_down'||effect.type==='accuracy'){const stat=effect.type==='accuracy'?'accuracy':effect.stat||'atk';if(!['atk','def','spd','accuracy'].includes(stat))return null;const direction=effect.type==='stat_down'?-1:1;const amount=direction*Math.abs(scaledEffectAmount(effect,target==='enemy'?'enemy':'self',stat));battle.buffs.push({fresh:true,target:target==='enemy'?'enemy':'self',stat,amount,duration:Math.max(1,Number(effect.duration)||1)});messages.push(buffStartMessage(target,stat,amount))}
 return messages.length>before?messages.slice(before).join(' '):null;
 }
 for(const effect of skill.effects||[])executeEnemyEffect(effect);
 randomSkillEffects(skill,name,executeEnemyEffect);
 const template=skill.successMessage||'';logBattle(template?template.replaceAll('{skill}',skill.name).replaceAll('{effects}',messages.join(' ')).replaceAll('{guest}',name):`${name}の${skill.name}！ ${messages.join(' ')||'効果が発動した。'}`);
}
async function doEnemyAction(){const {move,preparing}=scheduledEnemyMove();const name=battle.enemy.name||'敵';if(checkSpecialBattleEnd('enemy'))return;if(preparing){logBattle(move.warning);await pauseBattle(Math.max(700,BATTLE_DELAY.result));return}const enemyUsedSkill=move.type==='skill'?item('skills',move.skillId):null;const enemyActionSe=enemyUsedSkill?(enemyUsedSkill.useSe||enemyUsedSkill.se||actionSE('enemy',battle.enemy,move)):actionSE('enemy',battle.enemy,move);const enemyActionSeVolume=enemyUsedSkill&&((enemyUsedSkill.useSe||enemyUsedSkill.se))?enemyUsedSkill.seVolume??100:move?.seVolume??battle.enemy?.seVolume??100;playSE(enemyActionSe,enemyActionSeVolume);logBattle(`${name}の行動！`);await pauseBattle(BATTLE_DELAY.startup);if(move.type==='skill')await enemySkill(move,name);else if(move.type==='steal_coins'){logBattle(stealBattleCoins(move))}else if(move.type==='escape'){specialBattleEnd('escape',move)}else if(move.type==='force_end'){specialBattleEnd('special',move)}else if(move.type==='guard'){battle.enemyGuard=true;logBattle(`${name}は身を守った！`)}else if(move.type==='heal'){const n=Math.max(0,Math.floor(Number(move.amount)||0));const before=battle.enemyHP;battle.enemyHP=Math.min(battle.enemyMaxHP,battle.enemyHP+statusHealAmount('enemy',n));logBattle(`${name}はHPを${battle.enemyHP-before}回復した！`)}else if(STATUS_NAMES[move.type]){const msg=applyEffect({type:move.type,target:'self',amount:move.amount??1,duration:move.duration??3,chance:100,skipChance:move.skipChance??50},name);if(msg)logBattle(`${name}の特殊攻撃！ ${msg}`)}else{enemyAttack();if(!battle.ended){for(const id of equippedEquipmentIds()){const armor=item('equipment',id);const msgs=processEffects(armor,'on_hit',armor?.name||'装備');if(msgs.length)msgs.forEach(logBattle);}endCheck()}}endCheck()}
// ゲストのターン開始時自動効果。Lv別の効果は item() で解決済み。
function doGuestTurnStart(){
 if(!battle||battle.ended)return;
 for(const id of equippedGuestIds()){
  const guest=item('guests',id);
  if(!guest)continue;
  const source=guest.name||'ゲスト';
  const effects=[...processEffects(guest,'turn_start',source),
   ...(Number(state.guestAffection?.[id]||0)>=10?processEffects(guest.affectionBonus,'turn_start',source+'の絆'):[])];
  if(!effects.length)continue;
  playGuestSkillVoice(id,'auto');
  playSE(actionSE('guest',guest));
  logBattle(guest.supportMessage?guestMessage(guest.supportMessage,source,'支援',effects.join(' ')):`${source}の支援！ ${effects.join(' ')}`);
  if(endCheck())break;
 }
}
async function doGuestSupport(){if(battle.ended)return;for(const id of equippedGuestIds()){const guest=item('guests',id);if(!guest)continue;await pauseBattle(BATTLE_DELAY.guestLead);if(battle.ended)return;const effects=[...processEffects(guest,'after_player_action',guest.name||'ゲスト'),...(Number(state.guestAffection?.[id]||0)>=10?processEffects(guest.affectionBonus,'after_player_action',(guest.name||'ゲスト')+'の絆'):[])];if(effects.length){playGuestSkillVoice(id,'auto');playSE(actionSE('guest',guest));logBattle(guest.supportMessage?guestMessage(guest.supportMessage,guest.name,'支援',effects.join(' ')):`${guest.name||'ゲスト'}の支援！ ${effects.join(' ')}`);endCheck();await pauseBattle(BATTLE_DELAY.guestSupport)}}}
async function selectAction(kind){if(!battle||battle.ended||battleLocked)return;if(kind==='attack'||kind==='defend'){battle.selection=null;await takeTurn(kind);return}const rows=kind==='item'?equippedItemIds().map(id=>item('items',id)).filter(x=>x&&x.useContext!=='event'&&Array.isArray(x.effects)&&x.effects.some(e=>(e.trigger||'on_use')==='on_use')):[...equippedSkillChoices().filter(x=>x.skillType!=='passive'&&Array.isArray(x.effects)&&x.effects.some(e=>(e.trigger||'on_use')==='on_use')),...weaponSkillChoices().filter(x=>x.skillType!=='passive'&&Array.isArray(x.effects)&&x.effects.some(e=>(e.trigger||'on_use')==='on_use')),...guestManualChoices()];const available=rows.filter(row=>remainingUses(row,row.guestManual?'guest_skill':row.weaponSkill?'weapon_skill':kind)>0&&!(battle.extraTurnGranted?.p&&onlyExtraTurn(row)));if(!available.length){logBattle(kind==='item'?'使用できるアイテムがありません。':'使用できるスキルがありません。');return}const root=$('combat-choice-list');root.replaceChildren();$('combat-choice-title').textContent=kind==='item'?'アイテムを選択':'スキルを選択';for(const row of available){const b=document.createElement('button');b.className='pick-entry';b.textContent=row.weaponSkill?`${row.name} Lv.${row.skillLevel} / 残り${remainingUses(row,'weapon_skill')}回`:row.guestManual?`${row.name} / ${row.guestName} / 残り${remainingUses(row,'guest_skill')}回`:`${row.name}（残り${remainingUses(row,kind)}回）`;b.onclick=()=>{if(row.guestManual&&(row.effects||[]).some(effect=>effect.type==='restore_item_uses')){
 const options=equippedItemIds().map(id=>item('items',id)).filter(x=>x&&x.useContext!=='event');
 if(!options.length){logBattle('使用回数を増やせる戦闘アイテムがありません。');return}
 const chosen=window.prompt('使用回数を増やすアイテムの番号を選んでください（キャンセルで戻る）\n'+options.map((x,i)=>`${i+1}. ${x.name}（残り${remainingUses(x,'item')}回）`).join('\n'));
 if(chosen===null)return;const target=options[Number(chosen)-1];if(!target){logBattle('正しいアイテム番号を選択してください。');return}row.restoreItemId=target.id;
 }$('combat-choice').classList.remove('open');battle.selection=row;takeTurn(row.guestManual?'guest_skill':row.weaponSkill?'weapon_skill':kind)};root.append(b)}$('combat-choice').classList.add('open')}
$('combat-choice-close').onclick=()=>$('combat-choice').classList.remove('open');
function stealBattleCoins(effect){
 const wallet=Math.max(0,Math.floor(Number(state.player.coins)||0));
 const run=battle.inAdventure&&state.adventure?Math.max(0,Math.floor(Number(state.adventure.coins)||0)):0;
 const total=wallet+run;const rate=Math.max(0,Math.min(100,Number(effect.percent??effect.amount??0)));
 const requested=effect.stealMode==='percent'?Math.floor(total*rate/100):Math.max(0,Math.floor(Number(effect.amount)||0));
 let left=Math.min(total,requested);const fromRun=Math.min(run,left);left-=fromRun;const fromWallet=Math.min(wallet,left);
 if(fromRun)state.adventure.coins-=fromRun;state.player.coins-=fromWallet;
 if(effect.stealMode!=='instant'){battle.stolenCoins.run+=fromRun;battle.stolenCoins.wallet+=fromWallet;}
 auto();return `${battle.enemy.name||'敵'}は${fromRun+fromWallet}コインを奪った！${effect.stealMode==='instant'?'（返還なし）':''}`;
}
function returnStolenCoins(){const held=battle?.stolenCoins;if(!held)return 0;const sum=held.wallet+held.run;state.player.coins+=held.wallet;if(state.adventure)state.adventure.coins+=held.run;else state.player.coins+=held.run;held.wallet=0;held.run=0;return sum;}
function specialBattleEnd(kind,config={}){
 if(!battle||battle.ended)return;
 battle.ended=true;const stolen=(battle.stolenCoins?.wallet||0)+(battle.stolenCoins?.run||0);
 if(config.returnStolen===true)returnStolenCoins();
 const coins=Math.max(0,Math.floor(Number(config.rewardCoins)||0));
 if(coins){if(battle.inAdventure&&state.adventure)state.adventure.coins+=coins;else state.player.coins+=coins;}
 const message=config.message|| (kind==='escape'?`${battle.enemy.name||'敵'}は逃走した！`:'戦闘が終了した。');
 logBattle(`${message}${stolen&&config.returnStolen!==true?` 奪われた${stolen}コインは戻らなかった。`:''}${coins?` 報酬：${coins}コイン。`:''}`);
 battle.pendingOrder=null;auto();drawBattle();
 if(battle.inAdventure&&state.adventure){
  state.adventure.uses=battle.uses;
  setTimeout(()=>{if(!battle?.ended)return;const pending=!!state.eventBattlePending;const event=state.eventProgress;
   battle=null;state.eventBattlePending=false;musicSync();
   if(pending&&event){const st=item('events',event.id)?.steps?.[event.index];const branch=kind==='escape'?st?.onEscape:st?.onSpecial;
    if(Number.isInteger(branch))event.index=branch;else event.index++;
    auto();advanceEvent();return;
   }
   state.adventure.areaResolved=true;auto();go('adventure');
  },1100);
 }else{setTimeout(()=>{if(!battle?.ended)return;const pending=!!state.eventBattlePending;const event=state.eventProgress;battle=null;state.eventBattlePending=false;musicSync();if(pending&&event){const st=item('events',event.id)?.steps?.[event.index];const branch=kind==='escape'?st?.onEscape:st?.onSpecial;event.index=Number.isInteger(branch)?branch:event.index+1;auto();advanceEvent();}else go('home')},1100);}
}
function checkSpecialBattleEnd(phase){
 if(!battle||battle.ended)return false;const cfg=battle.enemy.specialEnd;
 // An absent/empty specialEnd must never end an ordinary battle.
 if(!cfg||cfg.enabled!==true)return false;
 const turn=Math.max(1,Math.floor(Number(cfg.turn)||1));
 let matches=false;
 if(cfg.condition==='enemy_hp')matches=battle.enemyHP<=battle.enemyMaxHP*Math.max(0,Number(cfg.threshold)||0)/100;
 else if(cfg.condition==='player_hp')matches=battle.playerHP<=battle.playerMaxHP*Math.max(0,Number(cfg.threshold)||0)/100;
 else matches=phase==='enemy'&&battle.enemyTurn>=turn;
 if(!matches)return false;
 if(cfg.condition!=='enemy_hp'&&cfg.condition!=='player_hp'&&phase!=='enemy')return false;
 if(Math.random()*100>=Math.max(0,Math.min(100,Number(cfg.chance??100))))return false;
 if(cfg.result==='victory'){endBattle(true);return true}
 if(cfg.result==='defeat'){endBattle(false);return true}
 specialBattleEnd(cfg.result==='escape'?'escape':'special',cfg);return true;
}
function endBattle(win){
 if(battle.ended)return;
 battle.ended=true;battle.victory=win;if(win){const finishedBattle=battle;setTimeout(()=>{if(battle===finishedBattle){battle.koHideReady=true;$('battle-enemy-art').classList.remove('enemy-hit-flash');$('battle-enemy-art').classList.add('enemy-defeated');}},760);}commonSE(win?'victory':'defeat');randomVoice(win?'victory':'defeat');musicSync();
 const returned=win?returnStolenCoins():0;
 if(battle.inAdventure && state.adventure){
  const run=state.adventure;run.hp=effective('maxHp');run.uses=battle.uses;
  if(win){const hasCoinDrop=(battle.enemy.drops||[]).some(d=>d.kind==='coins');const coinChance=hasCoinDrop?0:Math.max(0,Math.min(100,Number(battle.enemy.coinDropChance??100)));const coinDropped=Math.random()*100<coinChance;const reward=coinDropped?Math.max(0,Math.floor(Number(battle.enemy.coinReward??1)||0)):0;const extra=bonusVictoryCoins();run.coins+=reward+extra;if(!state.eventBattlePending)run.areaResolved=true;const drop=Math.max(0,Math.min(100,Number(battle.enemy.medicineDropChance??3)));const gotMedicine=Math.random()*100<Math.min(100,drop*(1+explorationBonus('dropRateBonus')/100));if(gotMedicine){state.player.medicine++;battle.rewardDrops??=[];battle.rewardDrops.push({name:'おくすり',image:commonImgSrc('assets/ui/medicine.png')});}const drops=battleDrops(battle.enemy);logBattle(`勝利！ ${coinDropped?`${reward}コインを獲得！`:(hasCoinDrop?"":"コインのドロップなし。")}${extra?` 追加報酬＋${extra}コイン！`:''}${gotMedicine?' おくすり×1を入手！':''}${drops.length?' ドロップ：'+drops.join('、'):''}`)}
  else logBattle('敗北… 冒険中に獲得したコインを失った。');
  auto();drawBattle();
 }else{logBattle(win?'勝利！ （単独戦闘テスト）':'敗北… （単独戦闘テスト）');drawBattle()}
}
function playerAttack(){if(blockIncoming('enemy','attack'))return;if(!hitCheck(100+accuracyBonus('self')+statusHitPenalty('self'))){logBattle('攻撃は外れた！');return}let d=battleDamage(combatStat('self','atk'),Math.max(0,combatStat('enemy','def')-battleBonus('self','armor_pierce')));d=adjustedDamage(d,'self','enemy');if(Math.random()<Math.max(0,Math.min(1,.05+(equipmentCriticalRateBonus()+battleBonus('self','crit'))/100))&&d>0){d=Math.ceil(d*1.5);logBattle('会心の一撃！')}if(battle.enemyGuard)d=Math.ceil(d/2);battle.enemyGuard=false;battle.enemyHP=Math.max(0,battle.enemyHP-d);if(d>0){const wake=wakeOnDamage('enemy',d);if(wake)logBattle(wake)}// 武器の攻撃SEとは別チャンネルで、命中してダメージを与えた際の共通SEも再生する。
if(d>0)commonSE('damage');flashEnemy();logBattle(`攻撃！ ${d}ダメージ。`);if(battle.enemyHP===0)endBattle(true)}
function enemyAttack(){if(blockIncoming('self','attack'))return;if(!hitCheck(Number(battle.enemy.accuracy??100)+accuracyBonus('enemy')+statusHitPenalty('enemy'))){logBattle(`${battle.enemy.name||'敵'}の攻撃は外れた！`);return}let d=battleDamage(combatStat('enemy','atk'),Math.max(0,combatStat('self','def')-battleBonus('enemy','armor_pierce')));d=adjustedDamage(d,'enemy','self');if(Math.random()<(.05+battleBonus('enemy','crit')/100)&&d>0){d=Math.ceil(d*1.5);logBattle('敵の会心の一撃！')}if(battle.guard)d=Math.ceil(d/2);battle.playerHP=Math.max(0,battle.playerHP-d);if(d>0){const wake=wakeOnDamage('self',d);if(wake)logBattle(wake)}if(d>0)commonSE('damage');logBattle(`${battle.enemy.name||'敵'}の攻撃！ ${d}ダメージ。`);if(battle.playerHP===0&&!tryAutoRescue())endBattle(false)}
// コマンド選択時点で受け身系効果を有効化する（後攻でも先攻の攻撃に間に合う）。
// 攻撃など他の効果は従来どおり本人の行動順に実行する。
const PREEMPTIVE_DEFENSE=new Set(['action_immunity','damage_reduction','stat_up']);
function prepareDefensiveEffects(action){
 battle.preemptiveEffects=null;
 if(!['item','skill','guest_skill','weapon_skill'].includes(action))return;
 const row=battle.selection;
 if(!row||action!=='item'&&statusOn('self','silence'))return;
 if(battle.extraTurnGranted?.p&&onlyExtraTurn(row))return;
 const candidates=(row.effects||[]).filter(e=>(e.trigger||'on_use')==='on_use'&&e.target!=='enemy'&&(e.type==='action_immunity'||e.type==='damage_reduction'||e.type==='stat_up'&&e.stat==='def'));
 if(!candidates.length)return;
 // 行動自体の成功判定を先に一度だけ行い、後から再抽選しない。
 const successRate=Math.max(0,Math.min(100,Number(row.successRate??100)+(skillIsAttack(row)?accuracyBonus('self')+statusHitPenalty('self')+(row.weaponSkill?Number(row.accuracyBonus||0):0):0)));
 battle.preemptiveSuccess=Math.random()*100<successRate;
 battle.preemptiveEffects=new Set(candidates);
 if(battle.preemptiveSuccess){for(const effect of candidates){const msg=applyEffect(effect,row.name||row.id);if(msg)logBattle(`${row.name||row.id}：${msg}`)}}
}
// 装備中の状態異常解除アイテムは、状態異常を受けた次の自分の行動開始時に自動使用する。
// 眠り・麻痺中でも使用でき、通常の行動回数は消費しない。
function autoCleanseEquippedItems(){
 if(!battle||battle.ended||!battle.statuses.some(s=>s.target==='self'))return;
 const rows=equippedItemIds().map(id=>item('items',id)).filter(Boolean);
 for(const row of rows){
  if(row.useContext==='event'||remainingUses(row,'item')<=0)continue;
  const effects=(row.effects||[]).filter(e=>e.trigger==='auto_status'&&e.type==='cleanse'&&e.target!=='enemy');
  const applicable=effects.some(e=>battle.statuses.some(s=>s.target==='self'&&(e.cleanseType==='all'||(e.cleanseType||'poison')===s.type)));
  if(!applicable)continue;
  // 発動判定に失敗した場合も使用回数を消費する（通常使用と同じ）。
  consumeUse(row,'item');
  commonSE('skill');randomVoice('item');playSE(actionSE('item',row),row.seVolume??100);
  logBattle(`${row.name||row.id}が自動発動！`);
  const messages=[...processEffects(row,'auto_status',row.name||row.id),...processEffects(row,'on_use',row.name||row.id)];
  if(messages.length)messages.forEach(logBattle);
  else logBattle(`${row.name||row.id}は発動しなかった！`);
  if(battle.ended||!battle.statuses.some(s=>s.target==='self'))break;
 }
}
// A fast protagonist receives another independent command before the enemy can act.
async function takeTurn(action){
 if(!battle||battle.ended||battleLocked)return;
 battleLocked=true;
 // 防御は素早さに関係なくコマンド確定時から有効。
 if(action==='defend')battle.guard=true;
 prepareDefensiveEffects(action);
 if(!battle.pendingOrder){
  const pspd=combatStat('self','spd'),espd=combatStat('enemy','spd');
  const pfirst=pspd===espd?Math.random()<.5:pspd>espd;
  const pcount=pspd>=espd*2&&pspd>0?2:1,ecount=espd>=pspd*2&&espd>0?2:1;
  battle.pendingOrder=pfirst?[...Array(pcount).fill('p'),...Array(ecount).fill('e')]:[...Array(ecount).fill('e'),...Array(pcount).fill('p')];
  battle.extraTurnGranted={p:false,e:false};
 }
 try{
  let acted=false;
  while(battle?.pendingOrder?.length&&!battle.ended){
   const who=battle.pendingOrder.shift();
   if(who==='p'){autoCleanseEquippedItems();for(const msg of tickRegens('self'))logBattle(msg);if(endCheck())break;for(const row of [...equippedSkillChoices(),...weaponSkillChoices()].filter(x=>x.skillType==='passive')){const msgs=processEffects(row,'turn_start',row.name);if(msgs.length)msgs.forEach(logBattle)}if(endCheck())break;doGuestTurnStart();if(endCheck())break;}
   await pauseBattle(BATTLE_DELAY.between);
   const sleeping=statusOn(who==='p'?'self':'enemy','sleep');
   const paralysis=battle.statuses.find(x=>x.target===(who==='p'?'self':'enemy')&&x.type==='paralysis');
   if(sleeping){logBattle(`${who==='p'?'前田ノカ':(battle.enemy?.name||'敵')}は眠っていて動けない！`);if(who==='p')acted=true;}
   else if(paralysis&&Math.random()*100<paralysis.skipChance){logBattle(`${who==='p'?'前田ノカ':'敵'}は麻痺で動けない！`);if(who==='p')acted=true;}
   else if(who==='p'){
    if(acted){battle.pendingOrder.unshift('p');break;}
    acted=true;
    await doPlayerAction(action);
    if(!battle.ended)await doGuestSupport();
   }else await doEnemyAction();
   if(battle.ended)break;
   if(checkSpecialBattleEnd('hp'))break;
   await pauseBattle(BATTLE_DELAY.result);
   if(who==='e')for(const msg of tickRegens('enemy'))logBattle(msg);const msgs=tickStatuses(who==='p'?'self':'enemy');
   if(msgs.length)msgs.forEach(logBattle);
   endCheck();
   // Do not auto-attack on a second action: return to command selection.
   if(who==='p'&&action==='defend'){battle.pendingOrder=battle.pendingOrder.filter(x=>x!=='p')}
   if(who==='p'&&battle.pendingOrder[0]==='p'&&!battle.ended){
    logBattle('追加行動！ コマンドを選択してください。');
    break;
   }
  }
  if(battle&&!battle.ended&&!battle.pendingOrder.length){battle.preemptiveEffects=null;delete battle.preemptiveSuccess;battle.guard=false;battle.enemyGuard=false;battle.pendingOrder=null;battle.extraTurnGranted={p:false,e:false}}
 }finally{
  if(battle){battle.preemptiveEffects=null;delete battle.preemptiveSuccess;}
  battleLocked=false;
  if(battle?.inAdventure&&state.adventure){state.adventure.hp=effective('maxHp');state.adventure.uses=battle.uses;auto()}
  drawBattle();
 }
}

/* Stage 18: data-driven event sequence. Step JSON is edited in Editor. */
// Stage 77: initial loadout and repeatable events, kept independent from existing saves.
function applyInitialLoadout(){const initial=commonAssets.initialLoadout||{};for(const key of ['coins','medicine'])state.player[key]=Math.max(0,Math.floor(Number(initial[key])||0));for(const kind of ['equipment','items','guests','skills'])for(const id of (initial[kind]||[])){if(item(kind,id)&&!state.inventory[kind].includes(id))state.inventory[kind].push(id)}for(const [slot,id] of Object.entries(initial.equipped||{})){if(slot in state.equipped&&typeof state.equipped[slot]!=='object'&&state.inventory[{equipment:'equipment',equipment2:'equipment',item:'items',item2:'items',guest:'guests',guest2:'guests'}[slot]]?.includes(id))state.equipped[slot]=id}auto()}
function eventUses(){if(!state.adventure)return state.eventUses??={};return state.adventure.uses??={}}
function eventItemRemaining(row){const uses=eventUses();return uses['item:'+row.id]??Math.max(0,Math.floor(Number(row.usesPerAdventure??1)))}
function spendEventItem(row){const uses=eventUses();uses['item:'+row.id]=eventItemRemaining(row)-1;auto()}
function eventPayment(cost){if(!cost)return true;const coins=Math.max(0,Math.floor(Number(cost.coins)||0)),medicine=Math.max(0,Math.floor(Number(cost.medicine)||0));if(state.player.coins<coins||state.player.medicine<medicine)return false;const row=cost.itemId?item('items',cost.itemId):null;if(cost.itemId&&(!row||!equippedItemIds().includes(row.id)||eventItemRemaining(row)<Math.max(1,Number(cost.itemUses)||1)))return false;state.player.coins-=coins;state.player.medicine-=medicine;if(row)for(let i=0;i<Math.max(1,Number(cost.itemUses)||1);i++)spendEventItem(row);auto();update();return true}
function eventRandomReward(step,done){
 const candidates=(Array.isArray(step.rewards)?step.rewards:[]).filter(r=>{
  if(!Number.isFinite(Number(r.weight))||Number(r.weight)<=0)return false;
  if(r.kind==='coin')return Number(r.amount)>0;
  if(!['items','equipment'].includes(r.kind)||!item(r.kind,r.id))return false;
  return !state.inventory[r.kind]?.includes(r.id);
 });
 let total=candidates.reduce((n,r)=>n+Number(r.weight),0);
 if(!total){notice(step.emptyText||'何も見つからなかった……。',2400);done();return}
 let roll=Math.random()*total,selected=candidates[candidates.length-1];for(const r of candidates){roll-=Number(r.weight);if(roll<0){selected=r;break}}
 if(selected.kind==='coin'){
  const amount=Math.max(1,Math.floor(Number(selected.amount)||1));state.player.coins+=amount;auto();update();eventRewardPopup('GIVE_COIN',{amount},done);return;
 }
 const type=selected.kind==='items'?'GIVE_ITEM':'GIVE_EQUIPMENT';
 if(eventStepGrant(selected.kind,selected.id)){auto();update();eventRewardPopup(type,{id:selected.id},done)}else{notice(step.emptyText||'何も見つからなかった……。',2400);done()}
}
function treasureEvent(step,progress){
 const rank=Math.max(0,Math.min(4,Math.floor(Number(step.keyRank)||0)));
 const artKey=['chestNoKey','chestC','chestB','chestA','chestS'][rank];
 const keys=rank?equippedItemIds().map(id=>item('items',id)).filter(x=>x&&Number(x.keyRank)>=rank&&eventItemRemaining(x)>0):[];
 const shade=document.createElement('div');shade.className='cq-treasure-overlay';
 const card=document.createElement('div');card.className='cq-treasure-card';shade.append(card);
 const heading=document.createElement('h3');heading.textContent=step.foundText||'宝箱を発見した！';card.append(heading);
 const src=commonAssets.images?.[artKey];if(src){const img=document.createElement('img');img.src=cqImageUrl(src);img.alt='宝箱';img.className='cq-treasure-image';card.append(img)}
 const info=document.createElement('p');info.textContent=rank&&!keys.length?'対応する鍵を持っていない。':'開けますか？';card.append(info);
 const buttons=document.createElement('div');buttons.className='cq-treasure-buttons';card.append(buttons);
 const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.onclick=fn;buttons.append(b);return b};
 const close=()=>shade.remove();
 const skip=()=>{close();progress.skippedTreasure=true;progress.index=item('events',progress.id)?.steps?.length||0;notice('宝箱を開けずに先へ進んだ。',1800);auto();advanceEvent()};
 const open=(key)=>{close();if(key)spendEventItem(key);commonSE('chestOpen');notice(step.openText||'宝箱を開けた！',1300);
  const sources=[['equipment',equippedEquipmentIds()],['items',equippedItemIds()],['guests',equippedGuestIds()]];let disarm=0,resist=0;for(const [kind,ids] of sources)for(const id of ids){const row=item(kind,id);disarm+=Number(row?.trapDisarm)||0;resist+=Number(row?.trapResist)||0}
  const chance=Math.max(0,Math.min(100,disarm-Math.max(0,Number(step.trapDifficulty)||0)));
  const trap=Number(step.trapChance)>0;
  if(trap&&Math.random()*100<chance)notice('宝箱の罠を解除した！');else if(trap&&Math.random()*100<Math.max(0,Math.min(100,Number(step.trapChance)||0))){commonSE('chestTrap');if(Math.random()*100<Math.min(100,resist))notice('罠耐性で被害を防いだ！');else{const damage=Math.max(0,Math.floor(Number(step.trapDamage)||0));if(state.adventure){state.adventure.pendingTrapDamage=safeCount(state.adventure.pendingTrapDamage)+damage;notice(`罠が発動！ 次の戦闘開始時に${damage}ダメージを受けた状態になる。`)}else{notice('罠が発動！！　ダメージ！')}}}
  const proceed=()=>{if(Number.isInteger(step.onSuccess))progress.index=step.onSuccess;auto();advanceEvent()};if(Array.isArray(step.rewards)&&step.rewards.length)eventRandomReward(step,proceed);else proceed()};
 if(!rank)button('開ける',()=>open(null));else if(keys.length===1)button('鍵を使って開ける',()=>open(keys[0]));else for(const key of keys)button(key.name+'で開ける',()=>open(key));
 button('見送る',skip);document.body.append(shade);commonSE('chestFound');randomVoice('chest');return false;
}
function eventStepGrant(kind,id){const row=item(kind,id);if(!row||state.inventory[kind]?.includes(id))return false;if(kind==='items'&&(row.bookmark||catalog.scenarios.some(c=>c.unlock?.type==='bookmark'&&c.unlock.itemId===id)))return grantBookmark(row);state.inventory[kind].push(id);return true}
function runEvent(eventId,opts={}){if(state?.eventProgress)return false;novelResetHistory();$('novel-stage-art').replaceChildren();novelRestoreStandsAfterBattle=false;if(state)state.eventBattlePendingPortrait=false;clearEventStepImage();restoreEventBgm(true);const ev=item('events',eventId);if(!ev||!Array.isArray(ev.steps)||!ev.steps.length)return false;if(!eventAvailable(eventId))return false;state.flags??={};state.flags['event-viewed:'+eventId]=true;state.eventProgress={id:eventId,index:0,returnTo:opts.returnTo||'adventure',areaEvent:!!opts.areaEvent,guestChain:!!opts.guestChain,scenarioId:opts.areaEvent?state.adventure?.scenarioId:null,areaIndex:opts.areaEvent?state.adventure?.area:null};auto();advanceEvent();return true}
// Stage 34: typed flag comparisons; old equals:true/false remains compatible.
function flagMatches(actual,step){
 const expected=step.equals??true,operator=step.operator||'eq';
 if(operator==='exists')return actual!==undefined;
 if(operator==='not_exists')return actual===undefined;
 if(operator==='eq')return actual===expected;
 if(operator==='ne')return actual!==expected;
 if(!['gt','gte','lt','lte'].includes(operator))return false;
 if(actual===undefined||actual===null||typeof actual==='boolean'||typeof expected==='boolean')return false;
 if(String(actual).trim()===''||String(expected).trim()==='')return false;
 const a=Number(actual),b=Number(expected);
 if(!Number.isFinite(a)||!Number.isFinite(b))return false;
 return operator==='gt'?a>b:operator==='gte'?a>=b:operator==='lt'?a<b:a<=b;
}
// Stage 79: named event counters. Scenario values are reset on each new adventure.
function counterStore(scope){
 state.counters??={save:{},scenario:{}};
 state.counters.save??={};state.counters.scenario??={};
 return scope==='scenario'?state.counters.scenario:state.counters.save;
}
function counterValue(id,scope){return Number(counterStore(scope)[id]??(typeof counterDefinitions!=='undefined'?counterDefinitions:[]).find(x=>x.id===id&&x.scope===(scope==='scenario'?'scenario':'save'))?.initial??0)}
function changeCounter(step){
 const id=String(step.counterId||'').trim();if(!id)return;
 const store=counterStore(step.scope);
 const amount=Number(step.amount??1);if(!Number.isFinite(amount))return;
 const current=counterValue(id,step.scope);
 const op=step.operation||'add';
 const next=op==='set'?amount:op==='subtract'?current-amount:current+amount;
 store[id]=Math.max(0,Math.floor(next));auto();
}
function checkCounter(step){
 const actual=counterValue(String(step.counterId||''),step.scope);
 return flagMatches(actual,{operator:step.operator||'gte',equals:Number(step.value??1)});
}
// Stage 85: independent weighted draws and persistent without-replacement draws.
// Draw pools are stored separately from event counters, so re-encountering an event
// does not silently reset a partially used deck.
function eventDrawStore(scope){
 state.eventDrawPools??={save:{},scenario:{}};
 state.eventDrawPools.save??={};state.eventDrawPools.scenario??={};
 return scope==='scenario'?state.eventDrawPools.scenario:state.eventDrawPools.save;
}
function eventRandomBranch(step,progress){
 const outcomes=Array.isArray(step.outcomes)?step.outcomes:[];
 const valid=outcomes.filter(x=>Number.isSafeInteger(Number(x.weight))&&Number(x.weight)>0&&Number.isInteger(x.next));
 const total=valid.reduce((n,x)=>n+Number(x.weight),0);
 if(!total||!Number.isSafeInteger(total)){notice('乱数分岐の設定が不正です。');return false}
 let roll=Math.floor(Math.random()*total),chosen=valid[valid.length-1];
 for(const row of valid){roll-=Number(row.weight);if(roll<0){chosen=row;break}}
 progress.index=chosen.next;auto();return true;
}
function eventDrawBranch(step,progress){
 const id=String(step.poolId||'').trim();
 const outcomes=Array.isArray(step.outcomes)?step.outcomes:[];
 const valid=outcomes.filter(x=>Number.isSafeInteger(Number(x.weight))&&Number(x.weight)>0&&Number.isInteger(x.next));
 const total=valid.reduce((n,x)=>n+Number(x.weight),0);
 if(!id||!total||!Number.isSafeInteger(total)){notice('くじ引きの設定が不正です。');return false}
 const store=eventDrawStore(step.scope),key=progress.id+':'+id;
 const signature=JSON.stringify(valid.map(x=>[x.weight,x.next]));
 let pool=store[key];
 if(!pool||pool.signature!==signature||!Array.isArray(pool.remaining)||pool.remaining.length!==valid.length){pool={signature,remaining:valid.map(x=>Number(x.weight))};store[key]=pool}
 let left=pool.remaining.reduce((n,x)=>n+x,0);
 if(left<=0){
  if(step.onEmpty==='stop'){if(Number.isInteger(step.emptyNext)){progress.index=step.emptyNext;return true}notice('くじはすべて引き終えました。');return false}
  pool.remaining=valid.map(x=>Number(x.weight));left=total;
 }
 let roll=Math.floor(Math.random()*left),selected=valid.length-1;
 for(let i=0;i<valid.length;i++){roll-=pool.remaining[i];if(roll<0){selected=i;break}}
 pool.remaining[selected]--;progress.index=valid[selected].next;auto();return true;
}
function highLowCardLabel(value){return ['','A','2','3','4','5','6','7','8','9','10','J','Q','K'][value]||'?'}
function highLowCardImage(value){const key='highLowCard'+value;const path=commonAssets.images?.[key];return path?cqImageUrl(path):''}
function playHighLow(step,progress){
 const stepIndex=progress.index-1,key='highlow:'+progress.id+':'+stepIndex;
 progress.highLowPlayed??={};
 if(progress.highLowPlayed[key]){notice('このハイ＆ローは挑戦済みです。');if(Number.isInteger(step.onPlayed))progress.index=step.onPlayed;return true}
 // Keep the event paused while the player interacts with the card table.
 const layer=document.createElement('div');layer.className='highlow-overlay';layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');layer.setAttribute('aria-label','ハイ＆ロー');
 const panel=document.createElement('section');panel.className='highlow-panel';layer.append(panel);
 const heading=document.createElement('h2');heading.textContent='ハイ＆ロー';panel.append(heading);
 const balance=document.createElement('p');balance.textContent='所持コイン：'+state.player.coins;panel.append(balance);
 const table=document.createElement('div');table.className='highlow-table';panel.append(table);
 const info=document.createElement('p');info.className='highlow-message';info.setAttribute('aria-live','polite');panel.append(info);
 const controls=document.createElement('div');controls.className='highlow-controls';panel.append(controls);
 const wagerLabel=document.createElement('label');wagerLabel.textContent='賭け金 ';const wager=document.createElement('input');wager.type='number';wager.min='1';wager.max=String(state.player.coins);wager.step='1';wager.value=String(Math.min(10,state.player.coins));wagerLabel.append(wager);controls.append(wagerLabel);
 const start=document.createElement('button');start.type='button';start.textContent='勝負開始';controls.append(start);
 const high=document.createElement('button');high.type='button';high.textContent='HIGH ▲';high.disabled=true;controls.append(high);
 const low=document.createElement('button');low.type='button';low.textContent='LOW ▼';low.disabled=true;controls.append(low);
 const leave=document.createElement('button');leave.type='button';leave.textContent='戻る';controls.append(leave);
 document.body.append(layer);
 let first=0,amount=0,finished=false;
 function card(value,hidden=false){const el=document.createElement('div');el.className='highlow-card';if(hidden){el.textContent='？';return el}const src=highLowCardImage(value);if(src){const im=document.createElement('img');im.src=src;im.alt=highLowCardLabel(value);im.onerror=()=>{im.remove();el.textContent=highLowCardLabel(value)};el.append(im)}else el.textContent=highLowCardLabel(value);return el}
 function show(left,right){table.replaceChildren(card(left),right?card(right):card(0,true))}
 function close(resume){layer.remove();if(resume){auto();update();advanceEvent()}}
 leave.onclick=()=>{if(finished){close(true)}else{close(false)}};
 start.onclick=()=>{const raw=wager.value.trim(),n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<1||n>state.player.coins){info.textContent='賭け金は1以上、所持コイン以内の整数で指定してください。';return}amount=n;first=2+Math.floor(Math.random()*11);show(first);info.textContent='次のカードは HIGH？ LOW？（同じ数字は引き直し）';wager.disabled=true;start.disabled=true;high.disabled=false;low.disabled=false;high.focus()};
 function decide(pick){if(finished||!first)return;finished=true;let second;do{second=1+Math.floor(Math.random()*13)}while(second===first);const win=pick==='H'?second>first:second<first;const multiplier=Math.max(1,Number(step.multiplier)||2);const profit=win?Math.floor(amount*(multiplier-1)):-amount;state.player.coins=Math.max(0,state.player.coins+profit);progress.highLowPlayed[key]=true;show(first,second);info.textContent=(win?'勝利！ ':'敗北… ')+(profit>=0?'+':'')+profit+'コイン';balance.textContent='所持コイン：'+state.player.coins;high.disabled=true;low.disabled=true;leave.textContent='結果を確認して進む';const counter=win?step.winCounterId:step.loseCounterId;if(counter)changeCounter({counterId:counter,scope:win?step.winCounterScope:step.loseCounterScope,operation:'add',amount:1});const jump=win?step.onWin:step.onLose;progress.index=Number.isInteger(jump)?jump:stepIndex+1;auto()}
 high.onclick=()=>decide('H');low.onclick=()=>decide('L');
 if(state.player.coins<1){info.textContent='コインがありません。';start.disabled=true}
 else info.textContent='賭け金を入力して勝負開始を押してください。';
 wager.focus();return false;
}

// イベント画像は背景と立ち絵の間に表示し、手順をまたいで保持する。
function clearEventStepImage(immediate=false){
 const layers=[...document.querySelectorAll('.event-step-image-overlay')];
 $('stage')?.classList.remove('event-image-visible');
 for(const layer of layers){
  if(immediate){layer.remove();continue}
  layer.classList.add('event-step-image-leaving');
  layer.style.pointerEvents='none';layer.removeAttribute('tabindex');
  setTimeout(()=>layer.remove(),650);
 }
}
// Remove event novel stands by their displayed position. Noka's portrait is separate.
function clearEventNovelStands(target){
 const stage=$('novel-stage-art');if(!stage)return;
 const positions=target==='stands'?['left','center','right']:[target];
 for(const slot of [...stage.querySelectorAll('.novel-stand')]){
  if(positions.includes(slot.dataset.position))slot.remove();
 }
}
function showEventStepImage(step,progress){
 if((step.imageAction||'show')==='hide'){clearEventStepImage(true);return false}
 clearEventStepImage(true);
 // 画像だけの手順でもノベル画面を開く。以前は非表示画面内に
 // 画像が生成され、クリック後にイベントが終わるとホームへ戻っていた。
 if(screen!=='novel'){
  $('novel-stage-art').replaceChildren();
  applyEventBackground();
  go('novel');
 }
 const stage=$('stage'),novel=$('novel');
 const overlay=document.createElement('div');overlay.className='event-step-image-overlay';overlay.setAttribute('aria-label','イベント画像');
 const picture=document.createElement('img');picture.className='event-step-image';picture.alt='イベント画像';picture.src=String(step.path||'');picture.style.transform=`translate(calc(-50% + ${Number(step.x)||0}px),calc(-50% + ${Number(step.y)||0}px)) scale(${Math.max(.25,Math.min(2.5,(Number(step.scale)||100)/100))})`;
 overlay.append(picture);novel.append(overlay);stage.classList.add('event-image-visible');
 requestAnimationFrame(()=>requestAnimationFrame(()=>overlay.classList.add('event-step-image-shown')));
 let finished=false,timer=null,hint=null;
  // The image is deliberately behind dialogue/portraits. Their click handlers
  // would otherwise advance the PREVIOUS NOVEL (and finish the event) instead
  // of advancing this image step. Intercept the click in capture phase.
  const interceptImageInput=e=>{
   if(finished||state?.eventProgress!==progress||!overlay.isConnected){removeImageInput();return}
   if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;
   e.preventDefault();e.stopImmediatePropagation();
   if((step.advance||'click')!=='auto')done();
  };
  novel.addEventListener('click',interceptImageInput,true);
  novel.addEventListener('keydown',interceptImageInput,true);
  const removeImageInput=()=>{
   novel.removeEventListener('click',interceptImageInput,true);
   novel.removeEventListener('keydown',interceptImageInput,true);
  };
 // Screen transitions are asynchronous. Never consume the image click while the
 // novel screen is still queued: otherwise the next NOVEL step can be skipped.
 const done=()=>{
  if(finished||state?.eventProgress!==progress||screen!=='novel'||busy)return;
  finished=true;if(timer!==null)clearTimeout(timer);
   removeImageInput();
  overlay.style.pointerEvents='none';overlay.removeAttribute('tabindex');hint?.remove();
  // Advance on the next task, after the image's click/keydown dispatch has ended.
  setTimeout(()=>{if(state?.eventProgress===progress){auto();advanceEvent()}},0);
 };
 const activate=()=>{
  if(finished||state?.eventProgress!==progress||!overlay.isConnected)return;
  if(screen!=='novel'||busy){setTimeout(activate,50);return}
  if((step.advance||'click')==='auto')timer=setTimeout(done,Math.max(100,Math.min(3600000,Number(step.seconds||3)*1000)));
  else{
   overlay.tabIndex=0;
   hint=document.createElement('span');hint.className='event-step-image-hint';hint.textContent='クリックして次へ ▼';overlay.append(hint);
   overlay.focus({preventScroll:true});
  }
 };
 overlay.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if((step.advance||'click')!=='auto')done()});
 overlay.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if((step.advance||'click')!=='auto')done()}});
 activate();
 picture.onerror=()=>{notice('イベント画像を読み込めませんでした');done();clearEventStepImage(true)};
 return true;
}
// Event-only full-screen fade. A separate overlay avoids changing the screen transition fade.
let eventDarkWaitToken=0;
function clearEventDarkWait(){
 eventDarkWaitToken++;
 document.querySelectorAll('.event-dark-wait-overlay').forEach(layer=>layer.remove());
}
function runEventDarkWait(step,progress){
 clearEventDarkWait();
 const token=eventDarkWaitToken;
 const seconds=(value,fallback)=>Math.max(0,Math.min(60,Number.isFinite(Number(value))?Number(value):fallback));
 const fadeOut=seconds(step.fadeOutSeconds,0.5)*1000;
 const hold=seconds(step.holdSeconds,2)*1000;
 const fadeIn=seconds(step.fadeInSeconds,0.5)*1000;
 const overlay=document.createElement('div');
 overlay.className='event-dark-wait-overlay';
 overlay.style.opacity='0';
 overlay.style.transition='none';
 overlay.setAttribute('aria-hidden','true');
 document.getElementById('stage').append(overlay);
 const valid=()=>eventDarkWaitToken===token&&state?.eventProgress===progress;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 (async()=>{
  // Commit the initial transparent state before animating.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(!valid())return;
  overlay.style.transition=`opacity ${fadeOut}ms linear`;
  overlay.style.opacity='1';
  await wait(fadeOut);
  if(!valid())return;
  await wait(hold);
  if(!valid())return;
  overlay.style.transition=`opacity ${fadeIn}ms linear`;
  overlay.style.opacity='0';
  await wait(fadeIn);
  if(!valid())return;
  overlay.remove();
  advanceEvent();
 })();
}
// Event visual effects: isolated from scene transition effects.
let eventVisualFxToken=0;
function runEventVisualFx(step,progress){
 const token=++eventVisualFxToken,stage=document.getElementById('stage');
 if(!stage){advanceEvent();return}
 const clamp=(v,f,max)=>Math.max(0,Math.min(max,Number.isFinite(Number(v))?Number(v):f));
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const valid=()=>eventVisualFxToken===token&&state?.eventProgress===progress;
 const flashes=[];let animation=null;
 const flash=async(prefix='')=>{
  const color=String(step[prefix+'Color']||'#ffffff');
  const safeColor=/^#[0-9a-fA-F]{6}$/.test(color)?color:'#ffffff';
  const opacity=clamp(step[prefix+'Opacity'],80,100)/100;
  const on=clamp(step[prefix+'OnSeconds'],0.1,60)*1000;
  const off=clamp(step[prefix+'OffSeconds'],0.3,60)*1000;
  const count=Math.floor(clamp(step[prefix+'Count'],1,10));
  const overlay=document.createElement('div');overlay.className='event-color-flash-overlay';overlay.style.backgroundColor=safeColor;stage.append(overlay);flashes.push(overlay);
  for(let i=0;i<count&&valid();i++){
   overlay.style.opacity=String(opacity);await sleep(on);if(!valid())break;
   overlay.style.transition=`opacity ${off}ms linear`;overlay.style.opacity='0';await sleep(off);
   overlay.style.transition='none';
  }
 };
 (async()=>{
  try{
   if(step.type==='COLOR_FLASH')await flash();
   else{
    const duration=clamp(step.seconds,0.5,60)*1000;
    const strength=clamp(step.strength,10,40);
    const direction=['horizontal','vertical','all'].includes(step.direction)?step.direction:'all';
    const interval=step.speed==='slow'?100:step.speed==='normal'?65:35;
    const frames=[];
    for(let t=0;t<duration;t+=interval){const a=(t/interval)*2.399963;const decay=1-t/Math.max(1,duration);const x=direction==='vertical'?0:Math.cos(a)*strength*decay;const y=direction==='horizontal'?0:Math.sin(a)*strength*decay;frames.push({transform:`translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`,offset:t/Math.max(1,duration)})}
    frames.push({transform:'translate(0px,0px)',offset:1});
    animation=stage.animate(frames,{duration:Math.max(1,duration),iterations:1,easing:'linear'});
    if(step.flashEnabled)await Promise.all([animation.finished.catch(()=>{}),flash('flash')]);
    else await animation.finished.catch(()=>{});
   }
  }finally{
   flashes.forEach(el=>el.remove());if(animation)animation.cancel();
   if(valid())advanceEvent();
  }
 })();
}
function advanceEvent(){const progress=state?.eventProgress;if(!progress)return;const ev=item('events',progress.id);if(!ev){clearEventStepImage();state.eventProgress=null;restoreEventBgm();auto();return}const steps=ev.steps||[];let safety=0;while(state.eventProgress&&progress.index<steps.length&&safety++<200){const st=steps[progress.index++],type=String(st.type||'').toUpperCase();auto();if(type==='JUMP_EVENT'){const destination=Number(st.next);if(!Number.isInteger(st.next)||destination<0||destination>=steps.length){notice('ジャンプ先の手順が見つかりません。');progress.index--;auto();return}progress.jumpCount=(progress.jumpCount||0)+1;if(progress.jumpCount>50){notice('イベント内ジャンプ回数の上限に達しました。');state.eventProgress=null;restoreEventBgm();auto();go(progress.returnTo||'adventure');return}progress.index=destination;auto();continue}else if(type==='RANDOM_BRANCH'||type==='DRAW_BRANCH'){const ok=type==='RANDOM_BRANCH'?eventRandomBranch(st,progress):eventDrawBranch(st,progress);if(!ok){progress.index--;auto();return}}else if(type==='PLAY_SE'){eventSeStep(st)}else if(type==='CHANGE_BGM'){eventBgmStep(st)}else if(type==='DARK_WAIT'){novelInputSuspended=true;runEventDarkWait(st,progress);return}else if(type==='COLOR_FLASH'||type==='SCREEN_SHAKE'){novelInputSuspended=true;runEventVisualFx(st,progress);return}else if(type==='WAIT'){novelInputSuspended=true;const ms=Math.max(0,Math.min(60000,Number(st.seconds??1)*1000||0));setTimeout(()=>{if(state?.eventProgress===progress)advanceEvent()},ms);return}else if(type==='SHOW_IMAGE'){novelInputSuspended=true;auto();if((st.imageAction||'show')==='hide'){if(['left','center','right','stands'].includes(st.hideTarget))clearEventNovelStands(st.hideTarget);else clearEventStepImage(true);const ms=Math.max(0,Math.min(60000,Number(st.hideWaitSeconds??0)*1000||0));if(ms>0){setTimeout(()=>{if(state?.eventProgress===progress)advanceEvent()},ms);return}}else if(showEventStepImage(st,progress))return}else if(type==='TREASURE'){if(!treasureEvent(st,progress)){auto();return}}else if(type==='RANDOM_REWARD'){eventRandomReward(st,()=>{auto();advanceEvent()});return}else if(type==='HIGH_LOW'){if(!playHighLow(st,progress)){progress.index--;auto();return}}else if(type==='PAY'){if(!eventPayment(st)){if(Number.isInteger(st.onFailure))progress.index=st.onFailure;else{notice('支払いに必要なものが足りません。');progress.index--;auto();return}}else if(Number.isInteger(st.onSuccess))progress.index=st.onSuccess}else if(type==='NOVEL'){progress.index--;auto();const lines=Array.isArray(st.lines)?st.lines:(st.text?[{speaker:st.speaker??'',text:st.text,expression:st.expression,standImage:st.standImage,voice:st.voice}]:[]);if(lines.length){novelPlay(lines,{returnTo:progress.returnTo,onComplete:()=>{if(Number.isInteger(novelChoiceEventNext)){progress.index=novelChoiceEventNext;novelChoiceEventNext=null}else progress.index++;auto();advanceEvent()}});return}else{progress.index++;auto()}}else if(type==='GIVE_COIN'||type==='GIVE_MEDICINE'){
 const count=Math.max(0,Math.floor(Number(st.amount)||0));state.player[type==='GIVE_COIN'?'coins':'medicine']+=count;auto();update();
 if(count&&st.showReward!==false){eventRewardPopup(type,st,()=>setTimeout(advanceEvent,280));return}
 }else if(['GIVE_ITEM','GIVE_GUEST','GIVE_SKILL','GIVE_EQUIPMENT'].includes(type)){
 const kind={GIVE_ITEM:'items',GIVE_GUEST:'guests',GIVE_SKILL:'skills',GIVE_EQUIPMENT:'equipment'}[type];
 const granted=eventStepGrant(kind,st.id||st.itemId);auto();update();
 if(granted&&st.showReward!==false){eventRewardPopup(type,st,()=>setTimeout(advanceEvent,280));return}
 }else if(type==='EVENT_COMPLETE'){state.flags['event-complete:'+progress.id]=true;auto()}else if(type==='CHANGE_AFFECTION'){const id=String(st.guestId||'');if(item('guests',id)){state.guestAffection??={};const old=Math.max(0,Math.min(20,Number(state.guestAffection[id])||0));const amount=Math.max(0,Math.floor(Number(st.amount)||0));const value=st.operation==='set'?amount:st.operation==='subtract'?old-amount:old+amount;state.guestAffection[id]=Math.max(0,Math.min(20,value));auto();update()}}else if(type==='CHANGE_HP'){state.player.hp=Math.min(effective('maxHp'),Math.max(0,(state.player.hp||0)+(Number(st.amount)||0)))}else if(type==='SET_FLAG'){if(st.key)state.flags[st.key]=st.value??true}else if(type==='COUNTER_CHANGE'){changeCounter(st)}else if(type==='COUNTER_CHECK'){const ok=checkCounter(st);if(ok&&Number.isInteger(st.onTrue))progress.index=st.onTrue;else if(!ok&&Number.isInteger(st.onFalse))progress.index=st.onFalse}else if(type==='CHECK_CONDITION'){const ok=st.flag?flagMatches(state.flags[st.flag],st):false;if(!ok&&Number.isInteger(st.onFalse))progress.index=st.onFalse;else if(ok&&Number.isInteger(st.onTrue))progress.index=st.onTrue}else if(type==='EVENT_END'||type==='SCENARIO_CLEAR'){if(type==='EVENT_END'&&st.complete===true)state.flags['event-complete:'+progress.id]=true;if(type==='SCENARIO_CLEAR'&&state.adventure){state.eventProgress=null;restoreEventBgm();auto();finishAdventure(true);return}break}else if(type==='BATTLE'){progress.index--;auto();const enemy=item('enemies',st.enemyId);if(enemy){state.eventBattlePending=true;auto();startBattle(enemy,!!state.adventure);return}else{notice('イベントで指定された敵が見つかりません。');progress.index--;auto();return}}}clearEventStepImage();const completed=state.eventProgress;if(completed&&(ev.repeatMode!=='until_complete'||state.flags['event-complete:'+completed.id]))state.flags['event:'+completed.id]=true;state.eventProgress=null;if(completed?.areaEvent&&(ev.repeatMode!=='until_complete'||state.flags['event-complete:'+completed.id])&&state.adventure?.scenarioId===completed.scenarioId&&state.adventure.area===completed.areaIndex){state.adventure.areaResolved=true;auto();if(state.adventure.area+1>=state.adventure.areaCount){finishAdventure(true);return}state.adventure.area++;state.adventure.areaResolved=false;auto();}if(completed?.skippedTreasure&&completed.areaEvent&&ev.repeatMode==='until_complete'&&!state.flags['event-complete:'+completed.id]&&state.adventure?.scenarioId===completed.scenarioId&&state.adventure.area===completed.areaIndex){state.adventure.areaResolved=true;auto();if(state.adventure.area+1>=state.adventure.areaCount){finishAdventure(true);return}state.adventure.area++;state.adventure.areaResolved=false;auto();}restoreEventBgm();auto();go(completed?.returnTo||'adventure');update();if(completed?.guestChain)setTimeout(()=>nextGuestAffectionEvent(),200)}

// Stage 17: standalone novel renderer. Event integration will call ChainQuestNovel.play(steps, options).
let novelLastRenderedAt=0;const NOVEL_MIN_READ_MS=420;
let novelSteps=[],novelIndex=0,novelReturn='adventure',novelExpression=0,novelVoice=null,novelOnComplete=null,novelChoiceEventNext=null;
function novelStopVoice(){if(novelVoice){novelVoice.pause();novelVoice.currentTime=0;novelVoice=null}}
// Dialogue backlog is session-only: never saved into the game state.
let novelHistory=[],novelHistoryOpen=false,novelHistoryAudio=null,novelHistoryLastKey='';
function novelStopHistoryAudio(){if(novelHistoryAudio){novelHistoryAudio.pause();novelHistoryAudio.currentTime=0;novelHistoryAudio=null}}
function novelResetHistory(){novelStopHistoryAudio();novelHistory=[];novelHistoryLastKey='';novelToggleHistory(false)}
function novelToggleHistory(open){novelHistoryOpen=!!open;const pane=$('novel-history');if(!pane)return;pane.hidden=!novelHistoryOpen;if(novelHistoryOpen){novelRenderHistory();pane.focus()}else novelStopHistoryAudio()}
function novelRenderHistory(){const list=$('novel-history-list');if(!list)return;list.replaceChildren();for(const entry of novelHistory){const row=document.createElement('div');row.className='novel-history-entry';const speaker=document.createElement('strong');speaker.textContent=entry.speaker||' ';const body=document.createElement('span');body.textContent=entry.text;row.append(speaker,body);if(entry.voice&&/^assets\/voices\/[\w./-]+\.mp3$/i.test(entry.voice)){const play=document.createElement('button');play.type='button';play.className='novel-history-play';play.textContent='▶ 音声を再生';play.onclick=()=>{novelStopHistoryAudio();novelStopVoice();novelHistoryAudio=new Audio(entry.voice);cqPlayVoice(novelHistoryAudio,entry.volume)};row.append(play)}list.append(row)}list.scrollTop=list.scrollHeight}

function novelArt(node,path,fallback){node.replaceChildren();if(!path){node.textContent=fallback||'';return}const img=document.createElement('img');img.alt='';img.src=path;img.onerror=()=>{node.replaceChildren();node.textContent=fallback||'NO IMAGE'};node.append(img)}
// Crossfade expression changes without removing the standing portrait or its placement.
function novelFadeStandExpression(slot,img,newPath){
 const oldPath=img.getAttribute('src')||'';
 if(!newPath||newPath===oldPath)return;
 const token=String((Number(slot.dataset.expressionFadeToken)||0)+1);
 slot.dataset.expressionFadeToken=token;
 slot.querySelectorAll('.novel-expression-fade-overlay').forEach(el=>el.remove());
 const overlay=img.cloneNode(false);
 overlay.classList.add('novel-expression-fade-overlay');
 overlay.removeAttribute('id');
 overlay.style.position='absolute';overlay.style.pointerEvents='none';
 overlay.style.opacity='1';overlay.style.transition='opacity 50ms ease-in-out';
 const parent=img.parentElement;
 if(getComputedStyle(parent).position==='static')parent.style.position='relative';
 // Preserve the original image's layout box and CSS transform exactly.
 // Copying the transformed bounding rect and then disabling transform causes
 // object-fit/zoom to reflow visibly during the fade.
 overlay.style.inset='auto';
 overlay.style.left=`${img.offsetLeft}px`;
 overlay.style.top=`${img.offsetTop}px`;
 overlay.style.width=`${img.offsetWidth}px`;
 overlay.style.height=`${img.offsetHeight}px`;
 overlay.style.maxWidth=getComputedStyle(img).maxWidth;
 overlay.style.maxHeight=getComputedStyle(img).maxHeight;
 overlay.style.transform=getComputedStyle(img).transform;
 overlay.style.transformOrigin=getComputedStyle(img).transformOrigin;
 overlay.style.objectFit=getComputedStyle(img).objectFit;
 overlay.style.objectPosition=getComputedStyle(img).objectPosition;
 overlay.style.animation='none';
 const next=new Image();
 next.onload=()=>{
  if(slot.dataset.expressionFadeToken!==token||!img.isConnected)return;
  img.onerror=null;img.src=newPath;
  parent.append(overlay);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(slot.dataset.expressionFadeToken===token)overlay.style.opacity='0'}));
  setTimeout(()=>overlay.remove(),90);
 };
 next.onerror=()=>{};
 next.src=newPath;
}
// Crossfade Noka's equal-size expression images without changing the displayed image layout.
function novelFadeNokaExpression(face,img,newPath){
 const oldPath=img.getAttribute('src')||'';
 if(!newPath||newPath===oldPath)return;
 const token=String((Number(face.dataset.expressionFadeToken)||0)+1);
 face.dataset.expressionFadeToken=token;
 face.querySelectorAll('.novel-expression-fade-overlay').forEach(el=>el.remove());
 const next=new Image();
 next.onload=()=>{
  if(face.dataset.expressionFadeToken!==token||!img.isConnected)return;
  const parent=img.parentElement;
  const computed=getComputedStyle(img);
  const parentComputed=getComputedStyle(parent);
  if(parentComputed.position==='static')parent.style.position='relative';
  // Overlay the NEW expression on the existing image; never animate geometry.
  const overlay=img.cloneNode(false);
  overlay.classList.add('novel-expression-fade-overlay');
  overlay.removeAttribute('id');
  overlay.src=newPath;
  overlay.onerror=null;
  overlay.style.position='absolute';
  overlay.style.inset='auto';
  overlay.style.left=`${img.offsetLeft}px`;
  overlay.style.top=`${img.offsetTop}px`;
  overlay.style.width=`${img.offsetWidth}px`;
  overlay.style.height=`${img.offsetHeight}px`;
  overlay.style.maxWidth='none';
  overlay.style.maxHeight='none';
  overlay.style.margin='0';
  overlay.style.boxSizing='border-box';
  overlay.style.transform=computed.transform;
  overlay.style.transformOrigin=computed.transformOrigin;
  overlay.style.objectFit=computed.objectFit;
  overlay.style.objectPosition=computed.objectPosition;
  overlay.style.animation='none';
  overlay.style.transition='none';
  overlay.style.opacity='0';
  overlay.style.pointerEvents='none';
  parent.append(overlay);
  requestAnimationFrame(()=>{
   if(face.dataset.expressionFadeToken!==token){overlay.remove();return}
   overlay.style.transition='opacity 50ms ease-in-out';
   requestAnimationFrame(()=>{if(face.dataset.expressionFadeToken===token)overlay.style.opacity='1'});
  });
  setTimeout(()=>{
   if(face.dataset.expressionFadeToken===token&&img.isConnected){img.onerror=null;img.src=newPath}
   overlay.remove();
  },90);
 };
 next.onerror=()=>{};
 next.src=newPath;
}
function novelApplySpeakerHighlight(step){
 const selected=Array.isArray(step?.speakerPositions)?step.speakerPositions.filter(p=>['left','center','right'].includes(p)):[];
 const stage=$('novel-stage-art');if(!stage)return;
 for(const slot of stage.querySelectorAll('.novel-stand')){
  // Filter the portrait image, not the slot: the slot's entrance/exit animations use opacity.
  const img=slot.querySelector('img');if(!img)continue;
  const speaking=selected.length>0&&selected.includes(slot.dataset.position)&&!slot.classList.contains('stand-exiting');
  slot.style.zIndex=speaking?'2':'1';
  img.style.filter=!selected.length||selected.includes(slot.dataset.position)?'brightness(1)':'brightness(.5)';
 }
}
function novelRender(){
 novelLastRenderedAt=Date.now();
 const step=novelSteps[novelIndex];if(!step){novelEnd();return}
 novelStopVoice();if(step.expression!==undefined&&step.expression!==null){const n=Number(step.expression);if(Number.isInteger(n)&&n>=0)novelExpression=n}
 const shared=step.genericDialogueId?(commonAssets.genericDialogues||[]).find(x=>x.id===step.genericDialogueId):null;
 $('novel-speaker').textContent=shared ? (shared.speaker??'') : (step.speaker??'');$('novel-text').textContent=shared?.text||step.text||'';
 const historyKey=String(state?.eventProgress?.id||'standalone')+':'+String(state?.eventProgress?.index??'')+':'+novelIndex;
 if(historyKey!==novelHistoryLastKey){novelHistoryLastKey=historyKey;novelHistory.push({speaker:$('novel-speaker').textContent,text:$('novel-text').textContent,voice:shared?.voice||step.voice||'',volume:Math.max(0,Math.min(1,Number(shared?.voiceVolume??step.voiceVolume??100)/100))})} 
 const face=$('novel-face');
 const facePath=step.hidePortrait?'':`assets/characters/noka${String(novelExpression).padStart(2,'0')}.png`;
 const currentFace=face.querySelector('img:not(.novel-expression-fade-overlay)');
 if(facePath&&currentFace&&currentFace.getAttribute('src')!==facePath){
  novelFadeNokaExpression(face,currentFace,facePath);
 }else if(!currentFace||!facePath){
  face.dataset.expressionFadeToken=String((Number(face.dataset.expressionFadeToken)||0)+1);
  novelArt(face,facePath,step.hidePortrait?'':'NO IMAGE');
 }

 // Optional event-stand expression: guest001_00.png + standExpression:2 -> guest001_02.png.
 let standPath=step.standImage||step.image||'';
 if(standPath&&step.standExpression!==undefined&&step.standExpression!==null&&Number.isInteger(Number(step.standExpression))){
  const suffix=String(Math.max(0,Number(step.standExpression))).padStart(2,'0');
  standPath=standPath.replace(/_\d{2}(?=\.png$)/i,'_'+suffix);
 }
 const stageArt=$('novel-stage-art');
 // Stage 30: retain existing stands, replace a specific position, or dismiss a stand.
 // Legacy keepStands=true without new stand data keeps the entire composition.
 const retained=!!step.keepStands||(Array.isArray(step.standExpressionChanges)&&step.standExpressionChanges.length>0)||(!!novelRestoreStandsAfterBattle&&!step.hidePortrait&&!step.standImage&&!step.image&&!(Array.isArray(step.stands)&&step.stands.length)&&!(Array.isArray(step.exitStands)&&step.exitStands.length));
 novelRestoreStandsAfterBattle=false;
 const standAnimation=step.standAnimation==='none'?'none':'fade';
 const exits=Array.isArray(step.exitStands)?step.exitStands:[];
 const validPos=p=>['left','center','right'].includes(p);
 if(!retained){
   // Keep outgoing portraits in the DOM long enough for the exit fade.
   for(const slot of [...stageArt.querySelectorAll('.novel-stand')]){
    if(standAnimation==='none'){slot.remove();continue}
    slot.classList.add('stand-exiting');
    setTimeout(()=>slot.remove(),650);
   }
  }
 for(const pos of exits){
  if(!validPos(pos))continue;
  for(const slot of [...stageArt.querySelectorAll('.novel-stand')]){
   if(slot.dataset.position===pos){if(standAnimation==='none'){slot.remove()}else{slot.classList.add('stand-exiting');setTimeout(()=>slot.remove(),650)}}
  }
 }
 const stands=Array.isArray(step.stands)?step.stands:(standPath?[{image:standPath,position:step.standPosition||'center'}]:[]);
 for(const stand of stands.slice(0,3)){
  if(!stand||typeof stand.image!=='string'||!stand.image)continue;
  const pos=validPos(stand.position)?stand.position:'center';
  let path=stand.image;
  if(stand.expression!==undefined&&stand.expression!==null&&Number.isInteger(Number(stand.expression))){
   path=path.replace(/_\d{2}(?=\.png$)/i,'_'+String(Math.max(0,Number(stand.expression))).padStart(2,'0'));
  }
  const current=[...stageArt.querySelectorAll('.novel-stand')].find(old=>old.dataset.position===pos);
  // Identical image in the same position: keep it without replaying its entrance animation.
  if(current&&current.querySelector('img')?.getAttribute('src')===path&&!current.classList.contains('stand-exiting')&&Number(current.dataset.scale||100)===Number(stand.scale??100)&&Number(current.dataset.offsetX||0)===Number(stand.offsetX||0)&&Number(current.dataset.offsetY||0)===Number(stand.offsetY||0))continue;
  for(const old of [...stageArt.querySelectorAll('.novel-stand')]){
   if(old.dataset.position===pos&&!old.classList.contains('stand-exiting')){if(standAnimation==='none')old.remove();else{old.classList.add('stand-exiting');setTimeout(()=>old.remove(),650)}}
  }
  const slot=document.createElement('div');slot.className='novel-stand';slot.dataset.position=pos;slot.dataset.scale=String(stand.scale??100);slot.dataset.offsetX=String(stand.offsetX||0);slot.dataset.offsetY=String(stand.offsetY||0);if(stand.scale!==undefined||stand.offsetX!==undefined||stand.offsetY!==undefined){slot.classList.add('stand-custom-position');slot.style.left=`calc(50% + ${Number(stand.offsetX)||0}px)`;slot.style.right='auto';slot.style.bottom=`${Number(stand.offsetY)||0}px`;slot.style.width='0';slot.style.height='0'}
  if(standAnimation==='none')slot.classList.add('stand-instant');
  const image=document.createElement('img');image.alt='';image.src=path;image.onerror=()=>slot.remove();if(slot.classList.contains('stand-custom-position')){image.style.width='max-content';image.style.height='auto';image.style.maxWidth='none';image.style.maxHeight='none';image.style.transform=`translateX(-50%) scale(${Math.max(0.01,Number(stand.scale??100)/100)})`;image.style.transformOrigin='center bottom'}slot.append(image);stageArt.append(slot);
 }
 // Reuse the existing portrait at each position, changing only its expression image.
 for(const change of (Array.isArray(step.standExpressionChanges)?step.standExpressionChanges:[])){
  if(!change||!validPos(change.position)||!Number.isInteger(Number(change.expression))||Number(change.expression)<0)continue;
  const slot=[...stageArt.querySelectorAll('.novel-stand')].find(el=>el.dataset.position===change.position&&!el.classList.contains('stand-exiting'));
  const img=slot?.querySelector('img');if(!img)continue;
  const currentPath=img.getAttribute('src')||'';
  if(!/_\d{2}(?=\.png(?:$|\?))/i.test(currentPath))continue;
  const newPath=currentPath.replace(/_\d{2}(?=\.png(?:$|\?))/i,'_'+String(Number(change.expression)).padStart(2,'0'));
  if(newPath!==currentPath)novelFadeStandExpression(slot,img,newPath);
 }
 novelApplySpeakerHighlight(step);
 const choices=$('novel-choices');choices.replaceChildren();const list=Array.isArray(step.choices)?step.choices:[];choices.hidden=!list.length;
 for(const choice of list){const b=document.createElement('button');b.textContent=choice.text||'選択';b.onclick=()=>{if(choice.cost&&!eventPayment(choice.cost)){notice('コイン・おくすり・アイテムが足りません。');return}if(choice.completeEvent&&state?.eventProgress)state.flags['event-complete:'+state.eventProgress.id]=true;if(Number.isInteger(choice.eventNext)&&state?.eventProgress&&choice.eventNext>=0&&choice.eventNext<(item('events',state.eventProgress.id)?.steps||[]).length){novelChoiceEventNext=choice.eventNext;novelEnd();return}if(typeof choice.next==='number'&&choice.next>=0&&choice.next<novelSteps.length){novelIndex=choice.next;novelRender()}else{novelIndex++;novelRender()}};choices.append(b)}
 const voicePath=shared?.voice||step.voice;if(voicePath&&typeof voicePath==='string'&&/^assets\/voices\/[\w./-]+\.mp3$/i.test(voicePath)){novelVoice=new Audio(voicePath);cqPlayVoice(novelVoice,Number(shared?.voiceVolume??step.voiceVolume??100)/100)}
}
function novelAdvance(){if(novelHistoryOpen||novelInputSuspended||!$('novel-choices').hidden||Date.now()-novelLastRenderedAt<NOVEL_MIN_READ_MS)return;novelIndex++;novelRender()}
function clearNovelDialogueForTransition(){
 // Keep the scene and portraits intact; only stale dialogue must disappear.
 const speaker=$('novel-speaker'),text=$('novel-text');
 if(speaker)speaker.textContent='';
 if(text)text.textContent='';
 const choices=$('novel-choices');
 if(choices){choices.replaceChildren();choices.hidden=true;}
}
function novelEnd(){if(novelInputSuspended)return;novelToggleHistory(false);novelInputSuspended=true;clearNovelDialogueForTransition();novelStopVoice();$('novel-choices').hidden=true;const done=novelOnComplete;novelOnComplete=null;if(typeof done==='function'){done()}else if(!state?.eventProgress)go(novelReturn)}
let novelInputSuspended=false;
let novelRestoreStandsAfterBattle=false;
function novelPlay(steps,options={}){
 if(!Array.isArray(steps)||!steps.length)return false;
 // Consecutive NOVEL steps in the same event stay on the novel screen.
 // Keep the stand DOM so keepStands and expression-only changes can reuse it.
 const continuingEventNovel=screen==='novel'&&!!state?.eventProgress;
 // Prevent the previous line from flashing during the screen fade after a battle.
 clearNovelDialogueForTransition();
 novelInputSuspended=false;
 novelSteps=steps;novelIndex=0;
 if(!continuingEventNovel)novelExpression=0;
 novelChoiceEventNext=null;
 novelReturn=options.returnTo||screen||'adventure';novelOnComplete=options.onComplete||null;
 // Preserve the existing stand composition across an event battle.
 // Explicit stand changes in the next step still take precedence.
 novelRestoreStandsAfterBattle=!continuingEventNovel&&!!state?.eventProgress&&!!state.eventBattlePendingPortrait;
 if(!continuingEventNovel&&!novelRestoreStandsAfterBattle)$('novel-stage-art').replaceChildren();
 if(novelRestoreStandsAfterBattle)state.eventBattlePendingPortrait=false;
 applyEventBackground();
 if(continuingEventNovel){novelRender();}
 else{go('novel');setTimeout(novelRender,320);}
 return true;
}
$('novel-dialogue').addEventListener('wheel',e=>{if(e.deltaY<0||novelHistoryOpen){e.preventDefault();if(!novelHistoryOpen)novelToggleHistory(true);else $('novel-history-list').scrollTop+=e.deltaY}}, {passive:false});
$('novel-history-close').onclick=()=>novelToggleHistory(false);
$('novel-history').addEventListener('wheel',e=>e.stopPropagation());
$('novel-dialogue').onclick=novelAdvance;$('novel-dialogue').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();novelAdvance()}};
// No back/exit button during novel playback; choices and dialogue control progress.
window.ChainQuestNovel={play:novelPlay};
$('battle-attack').onclick=()=>selectAction('attack');$('battle-defend').onclick=()=>selectAction('defend');$('battle-item').onclick=()=>selectAction('item');$('battle-skill').onclick=()=>selectAction('skill');
// Present every earned drop in order. The inventory was already updated by
// endBattle, so this queue only controls presentation (never grants twice).
let battleDropPresentationActive=false;
function showBattleDropRewards(drops,done){
 const queue=Array.isArray(drops)?drops.map(reward=>({...reward})):[];
 if(!queue.length){done();return;}
 battleDropPresentationActive=true;
 let index=0;
 const showNext=()=>{
  if(index>=queue.length){
   battleDropPresentationActive=false;
   done();
   return;
  }
  const reward=queue[index++];
  // Each reward waits for its own Close action before advancing.
  notifyDialog('ドロップアイテムを獲得！',reward.name||'アイテム',reward.image||'',showNext);
 };
 showNext();
}
$('battle-return').onclick=()=>{
 if(battleDropPresentationActive||!battle?.ended||battle.logBusy||battle.logQueue.length)return;
 if(!battle.rewardDropsShown&&battle.victory&&battle.rewardDrops?.length){
  battle.rewardDropsShown=true;
  const rewards=battle.rewardDrops.slice();
  showBattleDropRewards(rewards,()=>{
   // Leave the battle only after the final reward was explicitly closed.
   if(battle?.ended)$('battle-return').click();
  });
  return;
 }
 const win=battle.victory,adventure=battle.inAdventure;
 battleAudio.pause();battle=null;musicSync();
 // イベント内の戦闘は冒険外のイベントテストでもイベント進行を優先する。
 if(state?.eventBattlePending&&state.eventProgress&&(win||Number.isInteger(item('events',state.eventProgress.id)?.steps?.[state.eventProgress.index]?.onLose))){
  const ev=state.eventProgress,step=item('events',ev.id)?.steps?.[ev.index];state.eventBattlePending=false;
  ev.index=win?(Number.isInteger(step?.onWin)?step.onWin:ev.index+1):step.onLose;auto();setTimeout(advanceEvent,600);
 }else if(!adventure){
  // 敗北時の分岐が未設定ならイベントテストを終了する。
  if(state?.eventBattlePending){state.eventBattlePending=false;state.eventProgress=null;clearEventStepImage();restoreEventBgm();auto();go('home')}
  else go('adventure');
 }else if(win){if(state?.adventure?.areaResolved&&state.adventure.area+1>=state.adventure.areaCount)finishAdventure(true);else go('adventure')}
 else{state.eventProgress=null;restoreEventBgm();state.eventBattlePending=false;finishAdventure(false)}
};

// Stage 9: developer-only test environment; never enabled in the published game.
if(TEST_MODE){
  $('test-tools').hidden=false;$('enemy-test').hidden=false;
  $('test-banner').hidden=false;
  $('test-coins').onclick=()=>{if(!state)return;state.player.coins+=20;auto();update();$('test-feedback').textContent='テスト用に20コインを付与しました。';};
  $('test-guest').onclick=()=>{if(!state)return;const candidates=catalog.guests.filter(g=>!state.inventory.guests.includes(g.id));if(!candidates.length){$('test-feedback').textContent='未所持のゲストがありません。Editorでゲストを登録してください。';return;}const g=candidates[0];state.inventory.guests.push(g.id);state.equipped.guest=g.id;auto();update();$('test-feedback').textContent=`${g.name||g.id} を取得し、装備しました。`;};
  $('test-novel').onclick=()=>novelPlay([{speaker:'前田ノカ',expression:0,text:'ここから冒険が始まるんだね。'},{speaker:'前田ノカ',expression:3,text:'えっ、何か聞こえた……？'},{speaker:'案内人',expression:1,text:'前田ノカ、準備はいい？'}],{returnTo:'adventure'});
    const testParams=new URLSearchParams(location.search);
    const encodedConfig=testParams.get('battleConfig');
    if(encodedConfig){
      (async()=>{try{
        await refreshCatalog();
        const cfg=JSON.parse(encodedConfig);
        const enemy=catalog.enemies.find(e=>e.id===cfg.enemyId);
        if(!enemy)throw Error('敵が見つかりません');
        {
          state=fresh();
          const clamp=(v,min,max,fallback)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback};
          state.player.level=clamp(cfg.level,1,999,1);
          for(const key of ['maxHp','atk','def','spd'])state.player[key]=clamp(cfg[key],key==='maxHp'?1:0,999999,state.player[key]);
          state.player.coins=clamp(cfg.coins,0,999999999,0);
          state.player.medicine=clamp(cfg.medicine,0,999999999,0);
          state.inventory.equipment=catalog.equipment.map(x=>x.id);
          state.inventory.items=catalog.items.map(x=>x.id);
          state.inventory.guests=catalog.guests.map(x=>x.id);
          state.inventory.skills=catalog.skills.map(x=>x.id);
          const selections=[['equipment','equipment'],['equipment2','equipment'],['item','items'],['item2','items'],['guest','guests'],['guest2','guests']];
          for(const [slot,kind] of selections){const id=cfg[slot];state.equipped[slot]=typeof id==='string'&&catalog[kind].some(x=>x.id===id)?id:null;}
          for(const key of ['equipment','item','guest'])state.slotUnlocks[key]=true;
          state.equipped.skills=Array.from({length:3},(_,i)=>{const id=cfg.skills?.[i];return catalog.skills.some(x=>x.id===id)?id:null});
          for(const kind of ['equipment','guests','skills'])for(const row of catalog[kind])state.itemLevels[kind+':'+row.id]=clamp(cfg[`${kind}Level`],1,3,1);
          state.player.hp=clamp(cfg.hp,1,effective('maxHp'),effective('maxHp'));
          go('home');startBattle(enemy,false);
          if(battle){battle.playerHP=state.player.hp;drawBattle();}
        }
      }catch(err){console.error('戦闘テスト設定の読み込み失敗:',err);notice('戦闘テスト開始失敗：'+err.message);}
      })();
    }
    const battleToTest=new URLSearchParams(location.search).get('battle');
  if(!encodedConfig&&battleToTest)refreshCatalog().then(()=>{if(!catalog.enemies.some(enemy=>enemy.id===battleToTest)){notice('敵が見つかりません：'+battleToTest);return;} state=fresh();state.inventory.equipment=catalog.equipment.map(x=>x.id);state.inventory.items=catalog.items.map(x=>x.id);state.inventory.guests=catalog.guests.map(x=>x.id);state.inventory.skills=catalog.skills.map(x=>x.id);state.equipped.equipment=state.inventory.equipment[0]||null;state.equipped.item=state.inventory.items[0]||null;state.equipped.guest=state.inventory.guests[0]||null;state.equipped.skills=state.inventory.skills.slice(0,3);state.player.hp=effective('maxHp');go('home');startBattle(item('enemies',battleToTest),false)}).catch(err=>notice('戦闘テスト開始失敗：'+err.message));
    const eventToTest=new URLSearchParams(location.search).get('event');
    if(eventToTest&&!encodedConfig&&!battleToTest){
      // イベント一覧は非同期取得されるため、取得前に存在判定しない。
      refreshCatalog().then(()=>{
        const ev=catalog.events.find(row=>String(row.id)===eventToTest);
        if(!ev){notice('テスト対象のイベントが見つかりません：'+eventToTest);return;}
        if(!Array.isArray(ev.steps)||!ev.steps.length){notice('イベントに実行できるステップがありません：'+(ev.name||eventToTest));return;}
        state=fresh();
        state.player.coins=999;
        state.player.medicine=99;
        // イベントテスト専用の仮ステータス。通常プレイ・保存データには反映しない。
        for(const stat of ['maxHp','atk','def','spd'])state.player[stat]=100;
        state.player.hp=100;
        state.inventory.items=catalog.items.map(x=>x.id);
        state.equipped.item=state.inventory.items[0]||null;
        state.equipped.item2=state.inventory.items[1]||null;
        state.slotUnlocks.item=true;
        // テスト対象は常に初回状態で開始し、既存セーブに影響させない。
        if(!state.flags)state.flags={};
        delete state.flags['event:'+eventToTest];
        delete state.flags['event-complete:'+eventToTest];
        go('home');
        if(!runEvent(eventToTest,{returnTo:'home'}))notice('イベントテストを開始できませんでした：'+(ev.name||eventToTest));
      }).catch(err=>{console.error('イベントテスト開始失敗:',err);notice('イベントテスト開始失敗：'+err.message)});
    }
$('test-reset').onclick=()=>modal('テスト用セーブを初期化しますか？（通常のセーブには影響しません）',()=>{localStorage.removeItem(AUTO);localStorage.removeItem(MANUAL);localStorage.removeItem(saveBackupKey(AUTO));localStorage.removeItem(saveBackupKey(MANUAL));state=fresh();auto();update();$('test-feedback').textContent='テストデータを初期化しました。';});
}
$('bgm-volume').value=String(Math.round(music.volume*100));$('bgm-mute').checked=music.muted;$('bgm-volume').oninput=e=>{music.volume=Number(e.target.value)/100;musicSave();musicSync()};$('bgm-mute').onchange=e=>{music.muted=e.target.checked;musicSave();musicSync()};$('bgm-settings-open').onclick=()=>{$('bgm-settings').hidden=false};$('bgm-settings-close').onclick=()=>{$('bgm-settings').hidden=true};refreshCatalog().finally(()=>update());

// Keyword redemption belongs inside the game closure: state, catalog and
// notification helpers are intentionally private to this scope.
async function redeemKeyword(){
 const input=$('shop-keyword');
 if(!input||!state){notice('ゲームを開始してから入力してください');return;}
 const code=input.value.trim().toUpperCase();
 if(!code){notifyDialog('キーワード特典','キーワードを入力してください。');return;}
 let entries;
 try{
  const response=await fetch('data/keywords.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw new Error('HTTP '+response.status);
  entries=await response.json();
  if(!Array.isArray(entries))throw new Error('キーワードデータの形式が不正です');
 }catch(err){console.error('キーワード読込失敗',err);notifyDialog('キーワード特典','キーワードデータを読み込めませんでした。');return;}
 const entry=entries.find(x=>x&&x.enabled!==false&&String(x.keyword||'').trim().toUpperCase()===code);
 if(!entry){notifyDialog('キーワード特典','キーワードが違います。');return;}
 state.redeemedCodes??=[];
 if(state.redeemedCodes.includes(entry.id)){notifyDialog('キーワード特典','この特典は受け取り済みです。');return;}
 const r=entry.rewards||{},rewards=[];
 const amounts={};
 for(const key of ['coins','medicine'])amounts[key]=Math.max(0,Math.min(100000,Math.floor(Number(r[key])||0)));
 const acquisitions={};
 for(const kind of ['items','equipment','guests','skills']){
  acquisitions[kind]=[];
  for(const id of Array.isArray(r[kind])?r[kind]:[]){
   const row=item(kind,id);
   if(row&&!state.inventory[kind].includes(id)&&!acquisitions[kind].includes(id))acquisitions[kind].push(id);
  }
 }
 for(const key of ['coins','medicine'])if(amounts[key]){
  state.player[key]+=amounts[key];
  rewards.push((key==='coins'?'コイン':'おくすり')+' ×'+amounts[key]);
 }
 for(const kind of ['items','equipment','guests','skills'])for(const id of acquisitions[kind]){
  state.inventory[kind].push(id);rewards.push(item(kind,id).name||id);
 }
 // Claim once per save even when the reward was already owned.
 state.redeemedCodes.push(entry.id);
 auto();update();input.value='';
 notifyDialog('キーワード特典',rewards.length?'特典を受け取りました！\n'+rewards.join('、'):'特典を受け取りました！\n（所持済みの報酬です）');
}
$('shop-keyword-claim')?.addEventListener('click',redeemKeyword);
$('shop-keyword')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();redeemKeyword();}});
})();

