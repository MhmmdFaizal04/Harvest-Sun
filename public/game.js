import { animalCare, areaOf, buildings, buyPrices, calendar, careHeartbeatLimit, crops, development, discoveries, distance, feedRecipes, foods, forage, height, houses, indoorPlaces, insideFootprint, items, livestock, marketNpc, maxMoveBatch, moveInterval, nearbyLandmark, openPlot, pens, places, plots, ranchLimit, regionAt, roles, sameArea, sellPrices, tile, trailPlots, treeRegrow, walkable, width, woodlots, workTime } from "./world.js";
import { drawOverview, paint } from "./map.js";
import { rememberGame, savedGames } from "./saves.js";
import { playSound, setSound, soundEnabled, unlockSound } from "./sound.js";

const $ = id => document.getElementById(id);
const map = $("map");
const ctx = map.getContext("2d");
const lobby = $("lobby");
const details = $("details");
const hud=$("hud");
const compactHud=matchMedia("(max-width:740px), (hover:none) and (pointer:coarse), (orientation:landscape) and (max-width:1000px) and (max-height:520px)");
const shareCode = new URLSearchParams(location.search).get("join") || "";
const storageKey = "harvest-sun-player";
let session;
try { session = JSON.parse(localStorage.getItem(storageKey)); } catch { session = null; }
let state, moveTarget, pendingInteraction, displayedPosition, toastTimer, detailType, lastHud;
let landmarkId=null, landmarkTimer;
let busy=false, polling=false, writeVersion=0, nextMove=0, showingTitle=true;
const moveQueue=[];
let moveFlight=null, recovering=false, interacting=false, routeCache=null;
let lastFrame;
let stickPointer=null, analog=null;
const camera={x:0,y:0,scale:1,w:1,h:1,dpr:1,area:null};
const keys = new Set();
const moves = { w:[0,-1], arrowup:[0,-1], a:[-1,0], arrowleft:[-1,0], s:[0,1], arrowdown:[0,1], d:[1,0], arrowright:[1,0] };
let selectedCrop="carrot", giftRecipient, unreadChat=0, lastStep=0, waypoint, ranchSpecies="chicken", tradeMode="sell";
const canGive=(me,friend)=>sameArea(me,friend)&&distance(me,friend)<=2;
const localPlayer=()=>displayedPosition ? {...state.me,...displayedPosition} : state?.me;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function button(text, callback, className = "quiet") {
  const result = node("button",text,className);
  result.type = "button";
  result.addEventListener("click",callback);
  return result;
}
function notice(message) {
  $("toast").textContent = message;
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(()=>notice(""),3700);
}
function updateLandmarkPopup() {
  const popup=$("landmark-popup");
  const landmark=state&&!showingTitle ? nearbyLandmark({...state,me:localPlayer()}) : null;
  const id=landmark?.id??null;
  if (landmarkId===id) return;
  landmarkId=id;
  clearTimeout(landmarkTimer);
  popup.textContent=landmark?.name??"";
  popup.hidden=!landmark;
  if (landmark) landmarkTimer=setTimeout(()=>{popup.hidden=true;},1800);
}
function connection(message, error = false) {
  $("connection").lastElementChild.textContent = message;
  $("connection").toggleAttribute("data-error",error);
}
async function api(input, auth = session) {
  const endpoint = auth ? `/api/game?room=${encodeURIComponent(auth.code)}` : "/api/game";
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth.token}`;
  if (input) headers["Content-Type"] = "application/json";
  const response = await fetch(endpoint, {
    method: input ? "POST" : "GET", headers, body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(8500)
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || "Koneksi terputus."),{status:response.status});
  if (body.state&&body.state.me.careTime==null) throw Object.assign(new Error("Mulai ulang server lokal untuk memakai versi terbaru."),{status:426});
  return body;
}
function accept(next, action) {
  if (areaOf(state?.me)!==areaOf(next.me)) {
    moveTarget=null;
    pendingInteraction=null;
    displayedPosition=null;
    moveQueue.length=0;
    keys.clear();
    centerStick();
  }
  const previous=state;
  state = { ...next, received: Date.now() };
  if (session) rememberGame(session,next.me);
  if (state.exploration.discoveries[waypoint]) waypoint=null;
  updateScreen();
  $("location").textContent=areaOf(state.me)==="house"?`Rumah ${state.me.name}`:regionAt(state.me);
  connection("Lembah tersambung");
  syncHud();
  syncChat(previous?.chat);
  updateWaypoint();
  if (!showingTitle&&previous?.me.id===next.me.id) showGains(previous,next,action);
}
function updateScreen() {
  $("welcome").hidden=!showingTitle;
  hud.hidden=showingTitle;
  $("start").textContent=state?"Lanjut bermain":"Buat lembah";
  $("new-game").hidden=!state;
  $("load").hidden=savedGames().length===0;
}
function setHudDrawer(name,open) {
  hud.toggleAttribute(`data-${name}-open`,open);
  $(`${name}-toggle`).setAttribute("aria-expanded",String(open));
}
function updateFullscreenButton() {
  const control=$("fullscreen");
  control.hidden=!document.fullscreenEnabled;
  control.textContent=document.fullscreenElement?"Keluar layar penuh":"Layar penuh";
}
async function enterFullscreen() {
  if (document.fullscreenElement) return true;
  if (!document.fullscreenEnabled) return false;
  try {
    await document.documentElement.requestFullscreen({navigationUI:"hide"});
    return true;
  } catch { return false; }
}
function startMobileFullscreen() {
  if (compactHud.matches) void enterFullscreen();
}
async function poll() {
  if (!session||busy||polling||moveFlight||moveQueue.length||document.hidden) return;
  const version = writeVersion;
  const current = session;
  polling = true;
  try {
    const {state: next} = await api();
    if (version===writeVersion&&current===session&&!moveQueue.length) {
      accept(next);
      recovering=false;
    }
  } catch (error) {
    if (version === writeVersion && current === session) {
      connection("Menyambung ulang",true);
      if (error.status===426) notice(error.message);
      if (!state && [401,404].includes(error.status)) {
        session = null;
        localStorage.removeItem(storageKey);
        connection("Pratinjau desa");
        updateScreen();
      }
    }
  } finally { polling = false; }
}
async function sendMovement(path,from,current) {
  writeVersion++;
  try {
    const reply=await api({action:"move",path,from},current);
    if (current!==session) return false;
    if (!moveQueue.length) displayedPosition=null;
    accept(reply.state);
    if (reply.message) notice(reply.message);
    return true;
  } catch (error) {
    if (current!==session) return false;
    moveQueue.length=0;
    displayedPosition=null;
    moveTarget=null;
    pendingInteraction=null;
    routeCache=null;
    recovering=true;
    connection("Menyinkronkan posisi",true);
    try {
      const reply=await api(undefined,current);
      if (current===session) {
        accept(reply.state);
        recovering=false;
      }
    } catch {
      // The normal polling loop will refresh the position when the connection returns.
    }
    if (error.status===426) notice(error.message);
    return false;
  }
}
function flushMovement() {
  if (moveFlight) return moveFlight.done;
  if (!moveQueue.length||recovering) return Promise.resolve(!recovering);
  const path=moveQueue.splice(0,maxMoveBatch);
  const {x,y}=state.me;
  const flight={count:path.length,done:null};
  moveFlight=flight;
  flight.done=sendMovement(path,{x,y,area:areaOf(state.me)},session).finally(()=>{
    if (moveFlight!==flight) return;
    moveFlight=null;
    if (moveQueue.length>=maxMoveBatch) void flushMovement();
  });
  return flight.done;
}
async function settleMovement() {
  while (moveFlight||moveQueue.length) if (!await flushMovement()) return false;
  return !recovering;
}
async function act(input) {
  if (!state || busy) return false;
  busy = true;
  const current=session;
  try {
    if (!await settleMovement()||current!==session) return false;
    writeVersion++;
    const reply=await api(input,current);
    if (current!==session) return false;
    accept(reply.state,input.action);
    if (reply.message) notice(reply.message);
    return true;
  } catch (error) {
    if (input.action !== "presence") notice(error.message);
    if (!error.status) connection("Menyambung ulang",true);
    return false;
  } finally { busy = false; }
}
function timeNow() {
  return state ? state.now + Date.now() - state.received : Date.now();
}
function clock() {
  const {day,hour,minutes} = calendar(state?.started || Date.now(), timeNow());
  $("time").textContent = `${String(hour).padStart(2,"0")}.${String(minutes).padStart(2,"0")}`;
  $("day").textContent = `Hari ${day}`;
  $("weather").textContent = hour>=18 || hour<6 ? "☾" : "☀";
}
function syncHud() {
  const p = state?.me;
  const active = state?.players.filter(other=>other.id===p.id || state.now-other.seen<30000) || [];
  const signature=JSON.stringify(p ? [p.name,p.role,p.gold,p.energy,p.hunger,p.progress,p.claimed,p.bag,p.ranch,state.chest,state.village,state.exploration.discoveries,state.exploration.restoredAt,nearBoard(),active.map(other=>[other.id,canGive(p,other)])] : null);
  if (signature===lastHud) return;
  lastHud=signature;
  if (p) {
    const role = roles[p.role];
    $("player-name").textContent = p.name;
    $("role-name").textContent = role.label;
    $("avatar").replaceChildren(artIcon("villager.webp"));
    $("avatar").style.color = role.color;
    $("gold").textContent = p.gold;
    $("energy").textContent = `${p.energy}/12`;
    $("energy-bar").value = p.energy;
    $("hunger").textContent = `${p.hunger}%`;
    $("hunger-bar").value = p.hunger;
    $("mission-count").textContent = `${p.claimed.length} / 3`;
    $("quests").replaceChildren(...[
      ["role",role.goal,role.metric,role.target],
      ["shared","Bagikan persediaan","shared",1],
      ["ate","Makan pertama","ate",1]
    ].map(([id,label,metric,count])=>{
      const line = node("div",undefined,"quest");
      line.append(node("span",label));
      const progress = Math.min(count,p.progress[metric]);
      if (p.claimed.includes(id)) line.append(node("span","✓ Selesai","done"));
      else if (progress===count) line.append(button("Klaim",()=>act({action:"claim",item:id}),"button"));
      else line.append(node("span",`${progress}/${count}`));
      return line;
    }));
    $("player-count").textContent = active.length;
    $("friends").replaceChildren(...active.map(other=>{
      const row = node("div",undefined,"friend");
      row.append(node("span",other.id===p.id ? other.name+" (kamu)" : other.name));
      row.append(other.id!==p.id&&canGive(p,other) ? button("Beri makanan",()=>renderGift(other.id)) : node("span",roles[other.role].label));
      return row;
    }));
    renderPlants();
    renderVillage();
    renderExploration();
  }
  const selected = document.activeElement?.dataset.item;
  $("bag").replaceChildren(...Object.entries(items).filter(([id])=>p?.bag[id]>0).map(([id,label])=>{
    const amount=p?.bag[id] ?? 0;
    const slot=button("",
      ()=>{
        if (Object.hasOwn(foods,id)) return act({action:"eat",item:id});
        if (id==="feed") return notice("Gunakan pakan di kandang.");
        if (id==="quartz") return notice("Kuarsa dapat dijual di pasar.");
        if (id==="wood") return notice("Jual kayu kepada Bu Rini di pasar.");
        if (id==="water") return notice("Gunakan air untuk menyiram tanaman atau memberi minum ternak.");
        if (id==="grass") return notice("Racik rumput liar menjadi pakan di Toko Pakan.");
        openPanel("plants");
      },
      "slot");
    slot.dataset.item=id;
    slot.setAttribute("aria-label",`${label}, ${amount}`);
    slot.title=`${label}${amount&&Object.hasOwn(foods,id)?" · makan":""}`;
    slot.disabled=amount===0;
    slot.append(artIcon(itemImage(id)),node("strong",amount),node("span",label,"slot-label"));
    return slot;
  }));
  if (selected) $("bag").querySelector(`[data-item="${selected}"]`)?.focus({preventScroll:true});
  if (["shop","chest"].includes(detailType) && details.open) renderTrade(detailType);
  if (detailType==="ranch"&&details.open) renderRanch();
  if (detailType==="feedShop"&&details.open) renderFeedShop();
  if (detailType==="kitchen"&&details.open) renderKitchen();
  if (detailType==="gift"&&details.open) renderGift(giftRecipient);
  clock();
}
function artIcon(file) {
  const image=node("img");
  image.src="/assets/"+file;
  image.alt="";
  return image;
}
const itemImage=id=>id==="moonSeed"?"mist.png":`${id}.png`;
function displayReward(title,description,icon) {
  const layer=$("rewards");
  const card=node("div",undefined,"reward-card");
  const text=node("div");
  text.append(node("strong",title),node("span",description));
  card.append(icon?artIcon(icon):node("span","◉","reward-coin"),text);
  if (layer.children.length>=2) layer.firstElementChild.remove();
  layer.append(card);
  setTimeout(()=>card.remove(),2600);
}
function showGains(previous,next,action) {
  const gains=Object.entries(items).flatMap(([id,label])=>{
    const amount=next.me.bag[id]-previous.me.bag[id];
    return amount>0?[{id,label,amount}]:[];
  });
  const coins=next.me.gold-previous.me.gold;
  const unlocked=next.village.level>previous.village.level;
  const restored=next.exploration.restoredAt&&!previous.exploration.restoredAt;
  for (const [id,site] of Object.entries(discoveries)) {
    if (next.exploration.discoveries[id]&&!previous.exploration.discoveries[id]) {
      displayReward("Temuan jurnal",site.name,`${site.art}.png`);
    }
  }
  if (restored) displayReward("Jalur Surya pulih",`Jembatan selatan dan ${trailPlots} petak Teras Purnama terbuka`,"bridge.png");
  if (unlocked) {
    const region=development[next.village.level-1];
    displayReward("Hadiah lembah",`${region.name} terbuka · +${region.land} petak`,"banner.png");
  }
  if (gains.length||coins>0) {
    const contents=gains.map(({amount,label})=>`+${amount} ${label}`);
    if (coins>0) contents.push(`+${coins} koin`);
    displayReward(action==="claim"?"Hadiah misi":gains.length?"Barang diterima":"Koin diterima",contents.join(" · "),gains[0]?itemImage(gains[0].id):null);
  }
  if (unlocked||restored||action==="claim"||action==="discover") playSound("reward");
  else if (gains.length||coins>0) playSound("item");
  else if (action==="enter"||action==="exit") playSound("door");
  else if (["plot","feed","drink","well"].includes(action)&&!gains.length) playSound("work");
}
function syncChat(previous) {
  const messages=state.chat;
  if (previous&&previous.at(-1)?.id===messages.at(-1)?.id) return;
  const panel=$("chat-panel"), log=$("chat-log");
  const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<35;
  if (previous) {
    const last=previous.at(-1)?.id;
    const index=messages.findIndex(message=>message.id===last);
    const incoming=messages.slice(index+1).filter(message=>message.sender!==state.me.id);
    if (incoming.length&&panel.hidden) unreadChat+=incoming.length;
    if (incoming.length&&!showingTitle) playSound("chat");
  }
  syncChatCount();
  log.replaceChildren(...messages.map(message=>{
    const row=node("li",undefined,message.sender===state.me.id?"chat-own":undefined);
    row.append(node("strong",message.sender===state.me.id?"Kamu":message.name),node("p",message.text));
    return row;
  }));
  if (!messages.length) log.append(node("li","Belum ada pesan. Sapa temanmu.","catalog-note"));
  if (nearBottom) log.scrollTop=log.scrollHeight;
}
function syncChatCount() {
  for (const id of ["chat-count","menu-chat-count"]) {
    $(id).hidden=unreadChat===0;
    $(id).textContent=unreadChat>9?"9+":unreadChat;
  }
}
function openLobby(joining=false) {
  if (lobby.open) return;
  $("lobby-error").textContent = "";
  const code=$("join-code");
  code.value=joining?shareCode:"";
  code.required=joining;
  $("join-optional").hidden=joining;
  $("lobby-submit").textContent=joining?"Gabung lembah":"Buat lembah";
  lobby.showModal();
}
async function openLobbyFromTitle(joining=false) {
  if (compactHud.matches) await enterFullscreen();
  openLobby(joining);
}
function openSaves() {
  const controls=savedGames().map(save=>{
    const row=node("div",undefined,"save-row");
    const info=node("div");
    const label=save.savedAt?`Disimpan ${new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short"}).format(save.savedAt)}`:"Simpan otomatis";
    info.append(node("strong",save.name),node("small",`${roles[save.role].label} · ${save.code}`),node("small",label));
    row.append(info,button("Muat",()=>loadSave(save),"button"));
    return row;
  });
  show("Muat permainan",controls.length?controls:[node("p","Belum ada permainan yang tersimpan.")],"saves");
}
function activateGame(code,token,next) {
  writeVersion++;
  session={code,token};
  localStorage.setItem(storageKey,JSON.stringify(session));
  rememberGame(session,next.me,true);
  state=null;
  lastHud=null;
  unreadChat=0;
  waypoint=null;
  selectedCrop="carrot";
  moveTarget=null;
  pendingInteraction=null;
  displayedPosition=null;
  moveQueue.length=0;
  moveFlight=null;
  routeCache=null;
  recovering=false;
  camera.area=null;
  openPanel(null);
  showingTitle=false;
  accept(next);
  history.replaceState(null,"",location.pathname);
}
async function loadSave(save) {
  if (busy) return;
  startMobileFullscreen();
  busy=true;
  writeVersion++;
  try {
    const reply=await api(null,save);
    activateGame(save.code,save.token,reply.state);
    details.close();
    notice("Permainan dimuat.");
  } catch (error) {
    notice(error.status===404?"Lembah ini tidak tersedia di server sekarang.":error.message);
  } finally {busy=false;}
}
function show(title, content, type) {
  detailType = type;
  $("details-title").textContent = title;
  $("details-body").replaceChildren(...content);
  if (!details.open) {
    details.showModal();
    details.append($("rewards"),$("toast"));
  }
}
function renderTrade(type) {
  const shop = type==="shop", p=state.me;
  const stock=Object.entries(items).filter(([id])=>{
    if (!shop) return Object.hasOwn(state.chest,id);
    if (tradeMode==="sell") return Object.hasOwn(sellPrices,id)&&p.bag[id]>0;
    return Object.hasOwn(buyPrices,id)&&(id!=="moonSeed"||state.exploration.restoredAt);
  });
  const rows=stock.map(([id,label])=>{
    const row=node("div",undefined,"trade");
    const actions=node("div");
    const product=node("div",undefined,"trade-item");
    product.append(artIcon(itemImage(id)),node("span",shop?`${label} · tas ${p.bag[id]}`:`${label} · lumbung ${state.chest[id]} · tas ${p.bag[id]}`));
    row.append(product,actions);
    const commands=shop
      ? (Object.hasOwn(sellPrices,id) ? [[`Jual ${sellPrices[id]+(p.role==="merchant"?4:0)}`,"sell",p.bag[id]===0]] : [[`Beli ${buyPrices[id]}`,"buy",p.gold<buyPrices[id]]])
      : [["Simpan","deposit",p.bag[id]===0],["Ambil","withdraw",state.chest[id]===0]];
    if (!shop&&Object.hasOwn(foods,id)) commands.push(["Sumbang","supply",p.bag[id]===0]);
    for (const [text,action,disabled] of commands) {
      const control=button(text,()=>act({action,item:id}));
      control.disabled=disabled;
      actions.append(control);
    }
    return row;
  });
  const overview=node("p",shop?`Koinmu ${p.gold}. ${marketNpc.name} membeli hasil kebun, ternak, dan jelajah.`:"Simpan persediaan agar teman bisa mengambilnya. Sumbangkan makanan ke dapur untuk menyelesaikan misi desa.","dialog-copy");
  if (!shop) {
    const fund=button("Sumbang 10 koin",()=>act({action:"fund"}));
    fund.disabled=p.gold<10;
    show("Lumbung bersama",[overview,fund,...rows],type);
    return;
  }
  const tabs=node("div",undefined,"menu-actions");
  for (const [id,label] of [["sell","Jual barang"],["buy","Beli kebutuhan"]]) {
    const tab=button(label,()=>{tradeMode=id;renderTrade(type);});
    tab.setAttribute("aria-pressed",String(tradeMode===id));
    tabs.append(tab);
  }
  if (!rows.length) rows.push(node("p","Tasmu belum berisi barang yang bisa dijual.","dialog-copy"));
  show(`Pasar Surya · ${marketNpc.name}`,[overview,tabs,...rows],type);
}
function renderFeedShop() {
  const p=state.me;
  const stock=node("div",undefined,"trade");
  const item=node("div",undefined,"trade-item");
  item.append(artIcon("feed.png"),node("span",`Pakan · tas ${p.bag.feed}`));
  const buy=button(`Beli ${buyPrices.feed} koin`,()=>act({action:"feed-buy"}));
  buy.disabled=p.gold<buyPrices.feed;
  stock.append(item,buy);
  const recipes=Object.entries(feedRecipes).map(([key,recipe])=>{
    const row=node("div",undefined,"trade");
    const text=node("div",undefined,"catalog-text");
    const materials=Object.entries(recipe.materials);
    text.append(node("strong",recipe.label),node("small",materials.map(([id,amount])=>`${amount} ${items[id].toLowerCase()} (tas ${p.bag[id]})`).join(" + ")));
    const make=button(`Racik +${recipe.amount}`,()=>act({action:"feed-craft",item:key}));
    make.disabled=materials.some(([id,amount])=>p.bag[id]<amount);
    row.append(text,make);
    return row;
  });
  show("Toko Pakan",[
    node("p",`${p.gold} koin. Petik rumput liar di jalan dekat toko atau bawa jagung dari kebun untuk meracik pakan.`,"dialog-copy"),
    stock,...recipes
  ],"feedShop");
}
function renderPlants() {
  const p=state.me;
  $("land-count").textContent=`${plots.filter(plot=>openPlot(plot,state.village,state.exploration)).length} petak`;
  $("plant-list").replaceChildren(...Object.entries(crops).map(([id,plant])=>{
    const row=node("div",undefined,"catalog-row");
    const text=node("div",undefined,"catalog-text");
    text.append(node("strong",items[id]),node("small",`${p.bag[plant.seed]} benih · panen ${plant.grow/1000} dtk`));
    const pick=button(id===selectedCrop?"Dipilih":"Pilih",()=>{
      selectedCrop=id;
      renderPlants();
      notice(`Benih ${items[id].toLowerCase()} dipilih.`);
    });
    pick.setAttribute("aria-pressed",String(id===selectedCrop));
    pick.disabled=Boolean(plant.rare&&!state.exploration.restoredAt);
    if (pick.disabled) pick.textContent="Terkunci";
    row.append(artIcon(`${id}.png`),text,pick);
    return row;
  }));
}
function nearBoard() {
  return areaOf(state.me)==="outside"&&distance(state.me,places.trailboard)<=2;
}
function renderExploration() {
  const {exploration}=state;
  const found=Object.keys(exploration.discoveries).length;
  $("discovery-count").textContent=`${found} / ${Object.keys(discoveries).length}`;
  const cards=Object.entries(discoveries).map(([id,site])=>{
    const row=node("div",undefined,"catalog-row");
    const text=node("div",undefined,"catalog-text");
    const entry=exploration.discoveries[id];
    const finder=state.players.find(player=>player.id===entry?.player);
    text.append(node("strong",site.name),node("small",entry?finder?`Ditemukan oleh ${finder.name}`:"Sudah ditemukan":site.clue));
    row.append(artIcon(`${site.art}.png`),text);
    if (!entry) {
      const mark=button(id===waypoint?"Lepas":"Tandai",()=>{
        waypoint=waypoint===id?null:id;
        renderExploration();
        updateWaypoint();
      });
      mark.setAttribute("aria-pressed",String(id===waypoint));
      row.append(mark);
    }
    return row;
  });
  const reward=node("p",exploration.restoredAt?"Jalur Surya pulih. Jembatan selatan, Teras Purnama, dan benih bulan sudah terbuka.":"Cari ketiga temuan bersama. Kembali ke papan jelajah di timur rumah untuk membuka jembatan selatan, Teras Purnama, dan benih bulan.","catalog-note");
  const restore=button("Pulihkan Jalur Surya",()=>act({action:"restore-trail"}),"button");
  restore.hidden=Boolean(exploration.restoredAt);
  restore.disabled=found<Object.keys(discoveries).length||!nearBoard();
  restore.id="trail-restore";
  $("discoveries").replaceChildren(...cards,reward,restore);
}
function updateWaypoint() {
  const control=$("waypoint"), site=discoveries[waypoint];
  control.hidden=!site||areaOf(state?.me)!=="outside";
  if (control.hidden) return;
  const player=localPlayer();
  const dx=site.x-player.x,dy=site.y-player.y;
  const directions=["Timur","Tenggara","Selatan","Barat Daya","Barat","Barat Laut","Utara","Timur Laut"];
  const heading=directions[(Math.round(Math.atan2(dy,dx)*4/Math.PI)+8)%8];
  const label=`${site.region} · ${heading} · ${distance(site,player)} petak`;
  if (control.textContent!==label) control.textContent=label;
}
function renderVillage() {
  const town=state.village;
  const next=development[town.level];
  const title=node("strong",next?`Buka ${next.name} · +${next.land} petak`:"Kedua wilayah sudah terbuka");
  $("village-status").textContent=development[town.level-1]?.status||"Rintisan";
  const targets=Object.entries({harvest:"Panen",ranch:"Hasil ternak",meals:"Makanan disumbang",funds:"Dana pembangunan"}).map(([key,label])=>{
    const row=node("div",undefined,"village-meter");
    row.append(node("span",label),node("strong",next?`${town[key]} / ${next[key]}`:town[key]));
    if (next) {
      const meter=node("progress");
      meter.max=next[key];
      meter.value=Math.min(town[key],next[key]);
      meter.setAttribute("aria-label",label);
      row.append(meter);
    }
    return row;
  });
  const contributors=Object.keys(town.team).map(id=>state.players.find(p=>p.id===id)?.name).filter(Boolean);
  $("village-progress").replaceChildren(title,...targets,node("p",contributors.length?`Kontributor: ${contributors.join(", ")}`:"Panen, rawat ternak, dan sumbang dari lumbung bersama teman.","catalog-note"));
}
function waitButton(label, readyAt, pendingLabel, callback) {
  const control=button(label,callback);
  if (readyAt) {
    control.dataset.ready=readyAt;
    control.dataset.label=label;
    control.dataset.wait=pendingLabel;
  }
  return control;
}
function updateRanchTimers() {
  for (const control of $("details-body").querySelectorAll("[data-ready]")) {
    const seconds=Math.max(0,Math.ceil((Number(control.dataset.ready)-timeNow())/1000));
    control.disabled=seconds>0;
    control.textContent=seconds?`${control.dataset.wait} · ${seconds} dtk`:control.dataset.label;
  }
  const line=$("ranch-care");
  const stock=state?.me.ranch[ranchSpecies];
  if (!line||!stock?.count) return;
  const health=animalCare(stock,currentCareTime());
  const remaining=ms=>{
    const seconds=Math.max(0,Math.ceil(ms/1000));
    return seconds>=60?`${Math.floor(seconds/60)} mnt ${seconds%60} dtk`:`${seconds} dtk`;
  };
  line.textContent=health.remaining<=0
    ?`Kritis · ${livestock[ranchSpecies].label.toLowerCase()} berisiko mati karena ${health.cause}.`
    :`Pakan ${remaining(health.food)} · Air ${remaining(health.water)}`;
  line.toggleAttribute("data-warning",health.warning);
}
function currentCareTime() {
  const p=state.me;
  const gap=timeNow()-p.seen;
  return p.careTime+(p.dormant||gap>careHeartbeatLimit?0:Math.max(0,gap));
}
function needsCare() {
  if (!state||showingTitle) return null;
  const now=currentCareTime();
  const alerts=Object.entries(state.me.ranch).filter(([,stock])=>stock.count>0).map(([id,stock])=>({id,...animalCare(stock,now)}));
  return alerts.filter(alert=>alert.warning).sort((a,b)=>a.remaining-b.remaining)[0]||null;
}
function routeTo(type) {
  const target=places[type];
  pendingInteraction={...target,type,radius:2};
  moveTarget=pendingInteraction;
}
function updateCareAlert() {
  const alert=needsCare();
  const button=$("ranch-alert");
  button.hidden=!alert;
  if (!alert) return;
  const label=`${livestock[alert.id].label} ${alert.cause}`;
  if (button.textContent!==label) button.textContent=label;
}
function renderRanch(id=ranchSpecies) {
  ranchSpecies=id;
  const p=state.me;
  const animal=livestock[id];
  const entries=[animal].map(animal=>{
    const stock=p.ranch[id];
    const section=node("section",undefined,"trade");
    const text=node("div",undefined,"catalog-text");
    const health=node("span",undefined,"care-status");
    health.id="ranch-care";
    text.append(node("strong",`${animal.label} · ${stock.count}/${ranchLimit}`),node("small",
      stock.readyAt?`Siapkan ${items[animal.product].toLowerCase()}`:`${stock.fed?"Sudah diberi pakan":"Butuh pakan"} · ${stock.watered?"Sudah minum":"Butuh minum"}`));
    if (stock.count) text.append(health);
    const actions=node("div",undefined,"ranch-actions");
    const buy=button(`Beli ${animal.price} koin`,()=>act({action:"ranch-buy",item:id}));
    buy.disabled=p.gold<animal.price||stock.count+Number(Boolean(stock.breedingAt))>=ranchLimit;
    const collect=animal.product==="egg"?"Panen telur":"Perah susu";
    const feed=waitButton(stock.readyAt?collect:"Beri pakan",stock.readyAt,"Dirawat",()=>{
      if (!stock.readyAt) details.close();
      act({action:"feed",item:id});
    });
    if (!stock.readyAt) feed.disabled=stock.count===0||p.bag.feed===0||stock.fed;
    const drink=button("Beri minum",()=>{
      details.close();
      act({action:"drink",item:id});
    });
    drink.disabled=Boolean(stock.readyAt||stock.watered)||stock.count===0||p.bag.water===0;
    const breed=waitButton(stock.breedingAt?"Ambil anak":"Biakkan (2 pakan)",stock.breedingAt,"Dibiakkan",()=>act({action:"breed",item:id}));
    if (!stock.breedingAt) breed.disabled=stock.count<2||stock.count>=ranchLimit||p.bag.feed<2;
    actions.append(buy,feed,drink,breed);
    section.append(artIcon(`${id}.png`),text,actions);
    section.classList.add("catalog-row");
    return section;
  });
  const shop=button("Ke Toko Pakan",()=>{details.close();routeTo("feedShop");});
  show(`Pagar ${animal.label.toLowerCase()}`,[
    node("p",`${p.gold} koin · ${p.bag.feed} pakan · ${p.bag.water} air. Ternak bisa mati setelah 8 menit tanpa pakan atau 6 menit tanpa minum saat bermain.`,"dialog-copy"),
    ...entries,shop
  ],"ranch");
  updateRanchTimers();
}
function renderKitchen() {
  const p=state.me;
  const recipes=[
    ["produce","Hasil kebun + hasil ternak",1,Object.keys(crops).some(id=>p.bag[id]>0)&&(p.bag.egg>0||p.bag.milk>0)],
    ...Object.entries(livestock).map(([id,animal])=>{
      const stock=p.ranch[id];
      return [id,`Olah 1 ${animal.label.toLowerCase()}`,id==="goat"?3:2,stock.count>0&&!stock.breedingAt&&!stock.readyAt&&!stock.fed&&!stock.watered];
    })
  ];
  show("Dapur rumah",[
    node("p","Masak hasil kebun dengan telur atau susu, atau olah ternak yang siap. Hidangan bisa dimakan, dijual, atau dibagikan.","dialog-copy"),
    ...recipes.map(([id,label,amount,available])=>{
      const row=node("div",undefined,"trade");
      const cook=button(`Masak · ${amount} hidangan`,()=>act({action:"cook",item:id}));
      cook.disabled=!available;
      row.append(node("span",label),cook);
      return row;
    })
  ],"kitchen");
}
function renderGift(id) {
  const friend=state.players.find(p=>p.id===id);
  if (!friend) return;
  giftRecipient=id;
  show(`Beri makanan ke ${friend.name}`,[
    node("p","Makanan langsung masuk ke tas temanmu.","dialog-copy"),
    ...Object.keys(foods).map(item=>{
      const row=node("div",undefined,"trade");
      const send=button("Berikan",()=>act({action:"gift",item,recipient:id}));
      send.disabled=!canGive(state.me,friend)||state.me.bag[item]===0;
      row.append(node("span",`${items[item]} · ${state.me.bag[item]}`),send);
      return row;
    })
  ],"gift");
}
function nearest(player) {
  if (!player) return null;
  if (areaOf(player)==="house") {
    return Object.entries(indoorPlaces).map(([type,p])=>({...p,type,radius:2}))
      .filter(p=>distance(player,p)<=p.radius)
      .sort((a,b)=>distance(player,a)-distance(player,b))[0];
  }
  const candidates = [
    ...plots.map((p,plot)=>({ ...p, type:"plot", plot, radius:1 })),
    ...explorationTargets(),
    {...houses[player.home].door,type:"home",radius:2},
    ...Object.entries(places).map(([type,p])=>({...p,type,radius:2}))
  ].filter(p=>distance(player,p)<=p.radius);
  return candidates.sort((a,b)=>distance(player,a)-distance(player,b))[0];
}
function explorationTargets() {
  const sites=Object.entries(discoveries).filter(([id])=>!state.exploration.discoveries[id]);
  return [
    ...sites.map(([id,site])=>({...site,id,type:"discover",radius:1})),
    ...Object.entries(forage).map(([id,site])=>({...site,id,type:"forage",radius:1})),
    ...Object.entries(woodlots).map(([id,site])=>({...site,id,type:"chop",radius:1}))
  ];
}
function targetLabel(target) {
  if (!target) return "";
  if (target.type==="plot") {
    const plot=plots[target.plot];
    if (!openPlot(plot,state.village,state.exploration)) return plot.trail?"Lihat proyek Jalur Surya":"Lihat proyek perluasan";
    const crop=state.crops[target.plot];
    if (!crop) return `Cangkul & tanam ${items[selectedCrop].toLowerCase()}`;
    const kind=crop.kind||"carrot";
    const seconds=Math.ceil((crops[kind].grow-timeNow()+crop.watered)/1000);
    return !crop.watered?`Siram ${items[kind].toLowerCase()}`:seconds<=0?`Panen ${items[kind].toLowerCase()}`:`${items[kind]} tumbuh · ${seconds} dtk`;
  }
  if (target.type==="discover") return `Catat ${target.name}`;
  if (target.type==="chop") {
    const seconds=Math.ceil(((state.felled[target.id]??0)-timeNow())/1000);
    return seconds>0?`Pohon tumbuh · ${seconds} dtk`:"Tebang pohon";
  }
  if (target.type==="forage") {
    const wait=Math.ceil(((state.exploration.forage[target.id]??0)-timeNow())/1000);
    return wait>0?`Sumber pulih · ${wait} dtk`:`Ambil ${items[target.item].toLowerCase()}`;
  }
  return target.label;
}
async function interact(target=nearest(localPlayer())) {
  if (!state||busy||interacting) return;
  if (!target) { notice("Dekati kebun, rumah, kandang, pasar, atau lumbung."); return; }
  interacting=true;
  try {
    if (await settleMovement()) interactAt(target);
  } finally { interacting=false; }
}
function interactAt(target) {
  if (target.type==="plot") {
    const plot=plots[target.plot];
    if (!openPlot(plot,state.village,state.exploration)) return openPanel(plot.trail?"explore-panel":"missions");
    act({action:"plot",plot:target.plot,item:selectedCrop});
  }
  const pen=pens.find(p=>p.id===target.type);
  if (pen) renderRanch(pen.animal);
  if (target.type==="well") act({action:"well"});
  if (target.type==="feedShop") renderFeedShop();
  if (target.type==="trailboard") openPanel("explore-panel");
  if (["discover","forage","chop"].includes(target.type)) act({action:target.type,item:target.id});
  if (target.type==="home") act({action:"enter"});
  if (target.type==="bed") act({action:"rest"});
  if (target.type==="kitchen") renderKitchen();
  if (target.type==="exit") act({action:"exit"});
  if (["shop","chest"].includes(target.type)) renderTrade(target.type);
}
function findPath(from, goal, radius) {
  const area=areaOf(from);
  const repaired=Boolean(state.exploration.restoredAt);
  const now=timeNow();
  const parents = new Map();
  const start = from.y*width+from.x;
  const queue = [start];
  parents.set(start, null);
  for (let i=0;i<queue.length;i++) {
    const id=queue[i], x=id%width, y=Math.floor(id/width);
    if (distance({x,y},goal)<=radius) {
      const path=[];
      for (let end=id;end!==start;end=parents.get(end)) path.unshift([end%width,Math.floor(end/width)]);
      return path;
    }
    for (const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]) {
      const nx=x+dx,ny=y+dy,next=ny*width+nx;
      if (walkable(nx,ny,area,repaired,state.felled,now)&&!parents.has(next)) {
        parents.set(next,id);
        queue.push(next);
      }
    }
  }
  return null;
}
function step() {
  if (!state||showingTitle||busy||interacting||recovering||details.open||lobby.open||performance.now()<nextMove) return;
  if (moveQueue.length+(moveFlight?.count??0)>=maxMoveBatch*2) return;
  const p=localPlayer();
  if (p.work&&timeNow()-p.work.at<workTime) return;
  const direction=[...keys].findLast(key=>moves[key]);
  let destination;
  if (analog || direction) {
    moveTarget=null;
    pendingInteraction=null;
    const [dx,dy]=analog || moves[direction];
    destination=[p.x+dx,p.y+dy];
  } else if (moveTarget) {
    const radius=pendingInteraction?.type==="plot" ? 0 : pendingInteraction?.radius || 0;
    if (routeCache?.target!==moveTarget) routeCache={target:moveTarget,path:findPath(p,moveTarget,radius)};
    const route=routeCache.path;
    if (!route?.length) {
      const target=pendingInteraction;
      moveTarget=null;
      pendingInteraction=null;
      if (route && target) interact(target);
      if (!route) notice("Tidak ada jalan ke lokasi itu.");
      return;
    }
    destination=route.shift();
  }
  if (!destination) return;
  if (!walkable(...destination,areaOf(p),Boolean(state.exploration.restoredAt),state.felled,timeNow())) {
    routeCache=null;
    return;
  }
  const [x,y]=destination;
  nextMove=performance.now()+moveInterval;
  displayedPosition={x,y,dir:x<p.x?"left":x>p.x?"right":y<p.y?"up":"down"};
  moveQueue.push(destination);
  if (performance.now()-lastStep>460) {
    playSound("step");
    lastStep=performance.now();
  }
}
function clickMap(event) {
  if (!state || showingTitle) return;
  if (compactHud.matches&&(hud.hasAttribute("data-menu-open")||hud.hasAttribute("data-profile-open")||$("sidebar").querySelector("section:not([hidden])"))) {
    openPanel(null);
    return;
  }
  const rect=map.getBoundingClientRect();
  const x=Math.floor((camera.x+(event.clientX-rect.left)/camera.scale)/tile);
  const y=Math.floor((camera.y+(event.clientY-rect.top)/camera.scale)/tile);
  if (x<0 || y<0 || x>=width || y>=height) return;
  const inside=areaOf(state.me)==="house";
  const plot=inside?-1:plots.findIndex(p=>p.x===x&&p.y===y);
  const building=inside?null:buildings.find(b=>insideFootprint(x,y,b));
  const pen=inside?null:pens.find(p=>insideFootprint(x,y,p));
  const ownDoor=houses[state.me.home].door;
  if (building?.id==="home"&&building.home!==state.me.home) {
    moveTarget=building.door;
    pendingInteraction=null;
    return;
  }
  const targets=inside?indoorPlaces:{...places,home:ownDoor};
  const feature=building||pen;
  const place=feature?[feature.id,targets[feature.id]]:Object.entries(targets).find(([,p])=>distance(p,{x,y})<=(inside?2:1));
  const site=inside?null:explorationTargets().find(p=>distance(p,{x,y})===0);
  pendingInteraction=plot>=0 ? {x,y,type:"plot",plot,radius:1} : site || (place ? {...place[1],type:place[0],radius:2} : null);
  moveTarget=pendingInteraction || {x,y};
}
function showInvite() {
  if (!state) return openLobby();
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("join",session.code);
  const field=node("input");
  field.value=url.href; field.readOnly=true;
  field.setAttribute("aria-label","Tautan undangan");
  const copy=button("Salin",async()=>{
    try { await navigator.clipboard.writeText(url.href); copy.textContent="Tersalin"; }
    catch { field.focus(); field.select(); }
  });
  const row=node("div",undefined,"invite");
  row.append(field,copy);
  show("Undang teman",[node("p",`Bagikan tautan atau kode ${session.code}. Satu lembah menampung hingga 8 karakter.`,"dialog-copy"),row], "invite");
}
for (const [id,role] of Object.entries(roles)) {
  const label=node("label");
  const radio=node("input");
  radio.type="radio"; radio.name="role"; radio.value=id; radio.checked=id==="farmer";
  label.append(radio,node("span",role.label),node("small",role.detail));
  $("roles").append(label);
}
$("join-code").addEventListener("input",()=>{ $("lobby-submit").textContent=$("join-code").value.trim()?"Gabung lembah":"Buat lembah"; });
$("lobby-form").addEventListener("submit",async event=>{
  event.preventDefault();
  if ($("lobby-submit").disabled) return;
  startMobileFullscreen();
  const form=new FormData(event.currentTarget);
  const code=String(form.get("code")).trim().toUpperCase();
  $("lobby-submit").disabled=true;
  try {
    const reply=await api({action:code?"join":"create",code,name:form.get("name"),role:form.get("role")},null);
    activateGame(reply.code,reply.token,reply.state);
    lobby.close();
    playSound("welcome");
    notice("Selamat datang di Lembah Surya!");
  } catch (error) { $("lobby-error").textContent=error.message; }
  finally { $("lobby-submit").disabled=false; }
});
$("start").addEventListener("click",()=>{
  if (!state) return openLobbyFromTitle();
  startMobileFullscreen();
  showingTitle=false;
  updateScreen();
  playSound("welcome");
  act({action:"presence"});
});
$("join").addEventListener("click",()=>openLobbyFromTitle(true));
$("new-game").addEventListener("click",()=>openLobbyFromTitle());
$("load").addEventListener("click",openSaves);
$("waypoint").addEventListener("click",()=>openPanel("explore-panel"));
$("room").addEventListener("click",showInvite);
function showControls() {
  show("Cara bermain",[
  node("p","Geser analog, tekan WASD atau tombol panah, atau ketuk peta untuk bergerak. Tekan E atau ketuk tombol aksi untuk berinteraksi.","dialog-copy"),
  node("p","Isi ember di sumur, lalu gunakan air untuk menyiram kebun atau memberi minum ternak. Pakan dan air diperlukan sebelum panen telur atau susu.","dialog-copy"),
  node("p","Ketuk pohon kayu di hutan untuk menebang. Jual kayu dan hasil kebun ke Bu Rini. Setiap karakter punya rumah sendiri.","dialog-copy"),
  node("p","Bagikan makanan lewat Teman atau lumbung, atur kerja bersama di Chat, lalu selesaikan Misi desa untuk membuka lahan baru.","dialog-copy"),
  node("p","Buka Jelajah untuk melihat peta, menandai lokasi temuan, dan memulihkan Jalur Surya.")
  ],"help");
}
$("help").addEventListener("click",()=>{
  centerStick();
  if (compactHud.matches) openPanel(null);
  const actions=node("div",undefined,"menu-actions");
  const audioToggle=button(soundEnabled()?"Bisukan suara":"Nyalakan suara",()=>{
    setSound(!soundEnabled());
    audioToggle.textContent=soundEnabled()?"Bisukan suara":"Nyalakan suara";
  });
  actions.append(button("Lanjut bermain",()=>details.close(),"button"),button("Simpan sekarang",()=>act({action:"save"})),
    button("Simpan & kembali",async()=>{
      if (!await act({action:"save",pause:true})) return;
      showingTitle=true;
      moveTarget=null;
      pendingInteraction=null;
      details.close();
      updateScreen();
    }),button("Kontrol",showControls),audioToggle);
  show("Harvest Sun",[actions],"menu");
});
const panelButtons=[...document.querySelectorAll("[data-panel]")];
function openPanel(panel) {
  setHudDrawer("menu",false);
  setHudDrawer("profile",false);
  for (const candidate of panelButtons) {
    const showPanel=candidate.dataset.panel===panel;
    candidate.setAttribute("aria-expanded",String(showPanel));
    $(candidate.dataset.panel).hidden=!showPanel;
  }
  if (panel==="chat-panel") {
    unreadChat=0;
    syncChatCount();
    $("chat-log").scrollTop=$("chat-log").scrollHeight;
  }
  if (panel==="explore-panel"&&state) drawOverview($("overview").getContext("2d"),state,waypoint);
}
for (const control of panelButtons) control.addEventListener("click",()=>{
  const panel=control.getAttribute("aria-expanded")==="false"?control.dataset.panel:null;
  openPanel(panel);
  if (panel&&compactHud.matches&&control.closest("#game-tools")) {
    const heading=$(panel).querySelector("h2");
    heading.tabIndex=-1;
    heading.focus({preventScroll:true});
  }
});
for (const name of ["menu","profile"]) {
  $(`${name}-toggle`).addEventListener("click",()=>{
    const opening=!hud.hasAttribute(`data-${name}-open`);
    openPanel(null);
    setHudDrawer(name,opening);
  });
}
$("fullscreen").addEventListener("click",async()=>{
  openPanel(null);
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(()=>{});
  } else if (!await enterFullscreen()) {
    notice("Layar penuh belum tersedia di browser ini.");
  }
  updateFullscreenButton();
});
document.addEventListener("fullscreenchange",updateFullscreenButton);
updateFullscreenButton();
$("chat-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const field=$("chat-text"), send=$("chat-send");
  const text=field.value.trim();
  if (!text||send.disabled) return;
  send.disabled=true;
  if (await act({action:"chat",text})) {
    if (field.value.trim()===text) field.value="";
    $("chat-log").scrollTop=$("chat-log").scrollHeight;
    playSound("chat");
  }
  send.disabled=false;
  field.focus({preventScroll:true});
});
document.querySelectorAll("[data-close]").forEach(control=>control.addEventListener("click",()=>control.closest("dialog").close()));
for (const modal of [lobby,details]) modal.addEventListener("close",()=>{ keys.clear(); });
details.addEventListener("close",()=>document.querySelector(".stage").append($("rewards"),$("toast")));
document.addEventListener("pointerdown",unlockSound,{once:true});
document.addEventListener("keydown",unlockSound,{once:true});
map.addEventListener("click",clickMap);
$("hint").addEventListener("click",()=>interact());
$("ranch-alert").addEventListener("click",()=>{
  const alert=needsCare();
  if (!alert) return;
  if (areaOf(state.me)==="house") return notice("Keluar dari rumah untuk menuju pagar ternak.");
  routeTo(livestock[alert.id].place);
});
const stick=$("stick");
function centerStick() {
  if (stickPointer!==null && stick.hasPointerCapture(stickPointer)) stick.releasePointerCapture(stickPointer);
  stickPointer=null;
  analog=null;
  stick.removeAttribute("data-active");
  stick.style.removeProperty("--stick-x");
  stick.style.removeProperty("--stick-y");
}
function steer(event) {
  const bound=stick.getBoundingClientRect();
  const dx=event.clientX-bound.left-bound.width/2,dy=event.clientY-bound.top-bound.height/2;
  const length=Math.hypot(dx,dy);
  const limit=bound.width*.28;
  const scale=length>limit?limit/length:1;
  stick.style.setProperty("--stick-x",`${dx*scale}px`);
  stick.style.setProperty("--stick-y",`${dy*scale}px`);
  analog=length<8?null:Math.abs(dx)>Math.abs(dy)?[Math.sign(dx),0]:[0,Math.sign(dy)];
  if (analog) void step();
}
stick.addEventListener("pointerdown",event=>{
  if (stickPointer!==null || event.button!==0) return;
  event.preventDefault();
  stickPointer=event.pointerId;
  stick.setPointerCapture(stickPointer);
  stick.setAttribute("data-active","");
  moveTarget=null;
  pendingInteraction=null;
  steer(event);
});
stick.addEventListener("pointermove",event=>{ if (event.pointerId===stickPointer) steer(event); });
for (const name of ["pointerup","pointercancel","lostpointercapture"]) {
  stick.addEventListener(name,event=>{ if (event.pointerId===stickPointer) centerStick(); });
}
window.addEventListener("keydown",event=>{
  const key=event.key.toLowerCase();
  if (showingTitle) return;
  if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,dialog")) return;
  if (moves[key]) {
    event.preventDefault();
    keys.add(key);
    if (!event.repeat) void step();
  }
  if (key==="e" && !event.repeat && !details.open && !lobby.open) interact();
});
window.addEventListener("keyup",event=>keys.delete(event.key.toLowerCase()));
window.addEventListener("blur",()=>{ keys.clear(); centerStick(); });
function resize() {
  const bounds=map.getBoundingClientRect();
  camera.w=Math.max(1,bounds.width);
  camera.h=Math.max(1,bounds.height);
  camera.dpr=Math.min(2,devicePixelRatio||1);
  camera.scale=Math.min(2.2,Math.max(1.45,Math.min(camera.w/650,camera.h/415)));
  map.width=Math.round(camera.w*camera.dpr);
  map.height=Math.round(camera.h*camera.dpr);
  camera.area=null;
}
function follow(center,size,low,high) {
  if (size>high-low) return (low+high-size)/2;
  return Math.max(low,Math.min(high-size,center-size/2));
}
function frame(t) {
  const frameTime=lastFrame==null?1000/60:Math.min(t-lastFrame,50);
  lastFrame=t;
  const player=displayedPosition || state?.me || {x:16,y:11};
  const area=areaOf(state?.me);
  const house=area==="house";
  const x=follow((player.x+.5)*tile,camera.w/camera.scale,house?6*tile:0,house?28*tile:width*tile);
  const y=follow((player.y+.65)*tile,camera.h/camera.scale,house?3*tile:0,house?18*tile:height*tile);
  const ease=camera.area!==area?1:1-Math.pow(.84,frameTime*60/1000);
  camera.x+=(x-camera.x)*ease;
  camera.y+=(y-camera.y)*ease;
  camera.area=area;
  ctx.setTransform(camera.dpr,0,0,camera.dpr,0,0);
  ctx.imageSmoothingEnabled=false;
  ctx.fillStyle=house?"#312821":"#263a29";
  ctx.fillRect(0,0,camera.w,camera.h);
  const zoom=camera.dpr*camera.scale;
  ctx.setTransform(zoom,0,0,zoom,Math.round(-camera.x*zoom),Math.round(-camera.y*zoom));
  paint(ctx,state,moveTarget,t,displayedPosition,frameTime);
  requestAnimationFrame(frame);
}
syncHud();
updateScreen();
resize();
new ResizeObserver(resize).observe(map);
if (shareCode && shareCode!==session?.code) openLobby(true);
if (session) poll();
setInterval(poll,1300);
setInterval(()=>{ if (state&&!showingTitle&&!document.hidden&&!moveFlight&&!moveQueue.length) act({action:"presence"}); },12000);
function pauseCare() {
  if (!session||showingTitle) return;
  void fetch(`/api/game?room=${encodeURIComponent(session.code)}`,{
    method:"POST",keepalive:true,headers:{Authorization:`Bearer ${session.token}`,"Content-Type":"application/json"},
    body:JSON.stringify({action:"presence",dormant:true})
  }).catch(()=>{});
}
document.addEventListener("visibilitychange",()=>{
  if (document.hidden) pauseCare();
  else if (state&&!showingTitle) act({action:"presence"});
});
window.addEventListener("pagehide",pauseCare);
setInterval(step,32);
setInterval(flushMovement,240);
setInterval(()=>{
  clock();
  updateLandmarkPopup();
  updateWaypoint();
  const target=nearest(localPlayer());
  $("hint").hidden=!target;
  $("hint").textContent=target ? targetLabel(target) : "";
  if (detailType==="ranch"&&details.open) updateRanchTimers();
  updateCareAlert();
  if (state&&!$("explore-panel").hidden) drawOverview($("overview").getContext("2d"),state,waypoint);
},250);
requestAnimationFrame(frame);
