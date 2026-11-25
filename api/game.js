import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { animalCare, areaOf, buyPrices, calendar, careHeartbeatLimit, careLossInterval, crops, development, discoveries, distance, feedRecipes, foods, forage, forageTime, houses, indoorPlaces, items, livestock, marketNpc, openPlot, places, plots, ranchLimit, roles, sameArea, sellPrices, treeRegrow, walkable, waterCapacity, woodlots } from "../public/world.js";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const local = !process.env.VERCEL && (process.env.HARVEST_SUN_LOCAL_DIR || (!redisUrl && !redisToken));
const queues = new Map();
const roomDirectory = process.env.HARVEST_SUN_LOCAL_DIR ? new URL(process.env.HARVEST_SUN_LOCAL_DIR) : new URL("../.local/", import.meta.url);
const fresh = () => ({ started: Date.now(), players: {}, crops: {}, chest: { seed: 4, feed: 4, bread: 2, carrot: 0, egg: 0 } });
const own = (object, key) => Object.hasOwn(object, key);

class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
async function redis(...command) {
  if (!redisUrl || !redisToken) throw new GameError("Penyimpanan online belum dikonfigurasi.", 503);
  const response = await fetch(redisUrl, {
    method: "POST", headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(command), signal: AbortSignal.timeout(6000)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error("Redis request failed");
  return body.result;
}
const compareAndSet = "if (redis.call('GET', KEYS[1]) or '') == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 end; return 0";
async function transact(code, update, readOnly = false) {
  if (!local) {
    const key = `harvest-sun:v1:${code}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const saved = await redis("GET", key);
      const room = saved ? JSON.parse(saved) : null;
      const result = update(room);
      if (readOnly || !result.room) return result.value;
      if (await redis("EVAL", compareAndSet, 1, key, saved || "", JSON.stringify(result.room))) return result.value;
    }
    throw new GameError("Lembah sedang sibuk. Coba lagi.", 409);
  }
  const file = new URL(`${code}.json`, roomDirectory);
  const task = (queues.get(code) || Promise.resolve()).catch(() => {}).then(async () => {
    let room = null;
    try { room = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const result = update(room);
    if (!readOnly && result.room) {
      await mkdir(roomDirectory, { recursive: true });
      const temporary = new URL(`${code}.tmp`, roomDirectory);
      await writeFile(temporary, JSON.stringify(result.room));
      await rename(temporary, file);
    }
    return result.value;
  });
  queues.set(code, task);
  try { return await task; }
  finally { if (queues.get(code) === task) queues.delete(code); }
}
function hunger(player, now) {
  return Math.max(0, player.hunger - Math.floor(Math.max(0, now - player.ate) / 18000));
}
function restoreRoom(room,now) {
  room.village ??= {level:0, harvest:0, ranch:0, meals:0, funds:0, team:{}};
  room.exploration ??= {discoveries:{},forage:{},restoredAt:0};
  room.chat ??= [];
  room.felled ??= {};
  for (const item of Object.keys(items)) if (item!=="water") room.chest[item] ??= 0;
  const players=Object.values(room.players);
  const occupied=new Set(players.map(p=>p.home).filter(home=>Number.isInteger(home)&&houses[home]));
  for (const player of players) {
    if (!Number.isInteger(player.home)||!houses[player.home]) {
      player.home=houses.findIndex((_,index)=>!occupied.has(index));
      occupied.add(player.home);
      if (areaOf(player)==="outside"&&!walkable(player.x,player.y,"outside",Boolean(room.exploration.restoredAt),room.felled,now)) {
        const {x,y}=houses[player.home].door;
        Object.assign(player,{x,y});
      }
    }
    for (const item of Object.keys(items)) player.bag[item] ??= 0;
    player.careTime ??= 0;
    player.ranch ??= {};
    for (const id of Object.keys(livestock)) {
      player.ranch[id] ??= {count:id==="chicken"?1:0,readyAt:id==="chicken"?player.eggAt||0:0,breedingAt:0};
      player.ranch[id].fed ??= false;
      player.ranch[id].watered ??= false;
      player.ranch[id].lastFed ??= player.careTime;
      player.ranch[id].lastDrink ??= player.careTime;
    }
    delete player.eggAt;
  }
}
function advanceCare(player,now,input) {
  const gap=now-player.seen;
  if (input.action==="presence"&&input.dormant===true) return [];
  if (!player.dormant&&gap>0&&gap<=careHeartbeatLimit) player.careTime+=gap;
  const losses=[];
  for (const [id,stock] of Object.entries(player.ranch)) {
    if (!stock.count) continue;
    const health=animalCare(stock,player.careTime);
    if (health.remaining>0 || (stock.lastLoss!=null&&player.careTime-stock.lastLoss<careLossInterval)) continue;
    stock.count--;
    stock.lastLoss=player.careTime;
    if (stock.count<2) stock.breedingAt=0;
    if (!stock.count) {
      Object.assign(stock,{readyAt:0,fed:false,watered:false});
      delete stock.batch;
    }
    losses.push(`1 ${livestock[id].label.toLowerCase()} mati karena ${health.cause}.`);
  }
  return losses;
}
function contribute(room, player, metric, amount) {
  const village=room.village;
  const entry=village.team[player.id] ??= {harvest:0, ranch:0, meals:0, funds:0};
  village[metric]+=amount;
  entry[metric]+=amount;
  const goal=development[village.level];
  if (goal && ["harvest","ranch","meals","funds"].every(key=>village[key]>=goal[key])) village.level++;
}
function publicView(room, token, now) {
  const players=Object.values(room.players);
  const me = room.players[token];
  const herd=Object.fromEntries(Object.keys(livestock).map(id=>[id,players.reduce((sum,p)=>sum+p.ranch[id].count,0)]));
  return {
    started:room.started, now, crops:room.crops, chest:room.chest, village:room.village, herd, chat:room.chat,
    exploration:room.exploration, felled:room.felled,
    me: { ...me, hunger: hunger(me, now) },
    players:players.map(p=>({id:p.id,x:p.x,y:p.y,area:areaOf(p),dir:p.dir,name:p.name,role:p.role,seen:p.seen,home:p.home,work:p.work}))
  };
}
function requireGame(condition, message, status) {
  if (!condition) throw new GameError(message, status);
}
function playerAction(room, player, input, now) {
  const { action, item } = input;
  const bag = player.bag;
  const role = roles[player.role];
  const area = areaOf(player);
  const exploration=room.exploration;
  const door=houses[player.home].door;
  const near = (place, requiredArea = "outside") => {
    const target = (requiredArea === "house" ? indoorPlaces : places)[place];
    requireGame(area === requiredArea && distance(player,target) <= 2,"Dekati lokasi itu terlebih dahulu.");
  };
  const debit = key => {
    requireGame(bag[key]>0,key==="water"?"Isi air terlebih dahulu di sumur.":"Persediaanmu belum cukup.");
    bag[key]--;
  };
  const effort = () => {
    requireGame(hunger(player, now) > 0, "Kamu lapar. Makan dulu sebelum bekerja.");
    requireGame(player.energy > 0, "Energimu habis. Istirahat di rumah atau makan.");
    player.energy--;
  };
  const animate=(kind,target)=>{ player.work={kind,at:now,left:target.x<player.x}; };
  switch (action) {
    case "move": {
      requireGame(Array.isArray(input.path) && input.path.length <= 8 && input.path.length > 0, "Langkah tidak valid.");
      requireGame(now - player.moved >= input.path.length * 95, "Kamu bergerak terlalu cepat.", 429);
      for (const step of input.path) {
        requireGame(Array.isArray(step) && step.length === 2 && step.every(Number.isInteger), "Langkah tidak valid.");
        const [x,y] = step;
        requireGame(walkable(x,y,area,exploration.restoredAt>0,room.felled,now)&&distance(player,{x,y})===1,"Jalur terhalang.");
        player.dir = x < player.x ? "left" : x > player.x ? "right" : y < player.y ? "up" : "down";
        Object.assign(player, { x,y });
      }
      player.moved = now;
      return "";
    }
    case "well":
      near("well");
      requireGame(bag.water<waterCapacity,"Ember sudah penuh.");
      bag.water=waterCapacity;
      return `Ember diisi hingga ${waterCapacity} takaran air.`;
    case "chop": {
      requireGame(own(woodlots,item),"Pohon ini tidak bisa ditebang.");
      const tree=woodlots[item];
      requireGame(area==="outside"&&distance(player,tree)<=1,"Berdiri di dekat pohon kayu.");
      requireGame((room.felled[item]??0)<=now,"Pohon sedang tumbuh kembali.");
      effort();
      animate("chop",tree);
      room.felled[item]=now+treeRegrow;
      bag.wood+=2;
      return "Dua kayu masuk ke tas. Pohon akan tumbuh kembali.";
    }
    case "plot": {
      const plot = Number.isInteger(input.plot) && plots[input.plot];
      requireGame(area === "outside" && plot && distance(player, plot) <= 1, "Berdiri di dekat petak kebun.");
      requireGame(openPlot(plot,room.village,exploration),plot.trail?"Pulihkan Jalur Surya untuk membuka teras ini.":"Selesaikan misi desa untuk membuka lahan ini.");
      effort();
      const crop = room.crops[input.plot];
      if (!crop) {
        const kind=item ?? "carrot";
        requireGame(own(crops,kind),"Jenis tanaman tidak tersedia.");
        requireGame(!crops[kind].rare||exploration.restoredAt,"Pulihkan Jalur Surya untuk membuka tanaman ini.");
        debit(crops[kind].seed);
        room.crops[input.plot] = { kind, watered:0 };
        animate("hoe",plot);
        return `Benih ${items[kind].toLowerCase()} ditanam.`;
      }
      const kind=crop.kind || "carrot";
      const plant=crops[kind];
      if (!crop.watered) {
        debit("water");
        crop.watered = now;
        animate("water",plot);
        return `${items[kind]} disiram. Panen dalam ${plant.grow/1000} detik.`;
      }
      requireGame(now-crop.watered>=plant.grow,`${items[kind]} masih tumbuh.`);
      bag[kind]+=plant.yield+(player.role==="farmer"?1:0);
      player.progress.harvest++;
      contribute(room,player,"harvest",1);
      delete room.crops[input.plot];
      return `${items[kind]} segar dipanen!`;
    }
    case "ranch-buy":
    case "breed":
    case "drink":
    case "feed": {
      const species=item ?? "chicken";
      requireGame(own(livestock,species),"Jenis ternak tidak tersedia.");
      const animal=livestock[species], stock=player.ranch[species];
      near(animal.place);
      if (action==="ranch-buy") {
        requireGame(stock.count+Number(Boolean(stock.breedingAt))<ranchLimit,"Kandang jenis ternak ini penuh.");
        requireGame(player.gold>=animal.price,"Koinmu belum cukup.");
        player.gold-=animal.price;
        if (stock.count===0) {
          stock.lastFed=player.careTime;
          stock.lastDrink=player.careTime;
          delete stock.lastLoss;
        }
        stock.count++;
        return `${animal.label} baru masuk kandang.`;
      }
      if (action==="breed") {
        if (stock.breedingAt) {
          requireGame(now>=stock.breedingAt,"Anak ternak belum siap.");
          stock.breedingAt=0;
          stock.count++;
          return `Anak ${animal.label.toLowerCase()} menambah isi kandang.`;
        }
        requireGame(stock.count>=2&&stock.count<ranchLimit,"Butuh dua induk dan satu tempat kosong.");
        requireGame(bag.feed>=2,"Pembiakan memerlukan dua pakan.");
        effort();
        bag.feed-=2;
        stock.breedingAt=now+animal.breed;
        return `Pembiakan dimulai. Kembali dalam ${animal.breed/1000} detik.`;
      }
      requireGame(stock.count>0,"Beli ternak jenis ini dulu.");
      if (stock.readyAt) {
        requireGame(action==="feed",`${animal.label} sudah mendapat cukup air.`);
        requireGame(now>=stock.readyAt,`${animal.label} masih dirawat.`);
        effort();
        const amount=stock.batch??(stock.count+Number(player.role==="rancher"));
        bag[animal.product]+=amount;
        if (species==="chicken") player.progress.eggs+=amount;
        stock.readyAt=0;
        stock.fed=false;
        stock.watered=false;
        delete stock.batch;
        contribute(room,player,"ranch",amount);
        return `${amount} ${items[animal.product].toLowerCase()} masuk tasmu.`;
      }
      effort();
      if (action==="feed") {
        requireGame(!stock.fed,`${animal.label} sudah diberi pakan. Beri minum untuk memulai produksi.`);
        debit("feed");
        stock.fed=true;
        stock.lastFed=player.careTime;
        animate("feed",places[animal.place]);
      } else {
        requireGame(!stock.watered,`${animal.label} sudah diberi minum. Beri pakan untuk memulai produksi.`);
        debit("water");
        stock.watered=true;
        stock.lastDrink=player.careTime;
        animate("water",places[animal.place]);
      }
      if (stock.fed&&stock.watered) {
        stock.readyAt=now+animal.wait;
        stock.batch=stock.count+Number(player.role==="rancher");
        return `Ambil ${items[animal.product].toLowerCase()} dalam ${animal.wait/1000} detik.`;
      }
      return `${animal.label} sudah diberi ${stock.fed?"pakan. Sekarang beri minum.":"minum. Sekarang beri pakan."}`;
    }
    case "feed-buy":
      near("feedShop");
      requireGame(player.gold>=buyPrices.feed,"Koinmu belum cukup untuk membeli pakan.");
      player.gold-=buyPrices.feed;
      bag.feed++;
      return "Pakan dibeli di Toko Pakan.";
    case "feed-craft": {
      near("feedShop");
      requireGame(own(feedRecipes,item),"Resep pakan tidak dikenal.");
      const recipe=feedRecipes[item];
      const materials=Object.entries(recipe.materials);
      requireGame(materials.every(([id,amount])=>bag[id]>=amount),"Bahan racikan belum cukup.");
      for (const [id,amount] of materials) bag[id]-=amount;
      bag.feed+=recipe.amount;
      return `${recipe.label} selesai diracik.`;
    }
    case "buy":
      near("shop");
      requireGame(own(buyPrices,item)&&player.gold>=buyPrices[item],"Barang atau koin belum cukup.");
      requireGame(item!=="moonSeed"||exploration.restoredAt,"Pulihkan Jalur Surya untuk membuka benih bulan.");
      player.gold-=buyPrices[item];
      bag[item]++;
      return "Barang dibeli.";
    case "sell":
      near("shop");
      requireGame(own(sellPrices,item),"Barang ini tidak dibeli pasar.");
      debit(item);
      player.gold+=sellPrices[item]+(player.role==="merchant"?4:0);
      player.progress.sold++;
      contribute(room,player,"funds",2);
      return `${marketNpc.name} membeli ${items[item].toLowerCase()} seharga ${sellPrices[item]+(player.role==="merchant"?4:0)} koin.`;
    case "deposit":
    case "withdraw":
      near("chest");
      requireGame(own(room.chest, item), "Barang tidak dikenal.");
      if (action === "deposit") {
        debit(item);
        room.chest[item]++;
        player.progress.shared++;
      } else {
        requireGame(room.chest[item] > 0, "Lumbung kehabisan barang ini.");
        room.chest[item]--;
        bag[item]++;
      }
      return action === "deposit" ? "Persediaan dibagikan." : "Persediaan diambil.";
    case "gift": {
      requireGame(own(foods,item),"Pilih makanan dari tas.");
      const friend=Object.values(room.players).find(p=>p.id===input.recipient);
      requireGame(friend&&friend!==player&&sameArea(player,friend)&&distance(player,friend)<=2,"Dekati teman untuk membagikan makanan.");
      debit(item);
      friend.bag[item]++;
      player.progress.shared++;
      return `${items[item]} diberikan kepada ${friend.name}.`;
    }
    case "chat": {
      requireGame(typeof input.text==="string"&&input.text.length<=180,"Pesan maksimal 180 karakter.");
      const text=input.text.replace(/[\u0000-\u001f\u007f]/g," ").trim();
      requireGame(text.length>0,"Tulis pesan terlebih dahulu.");
      requireGame(now-(player.lastChat??0)>=900,"Tunggu sebentar sebelum mengirim lagi.",429);
      player.lastChat=now;
      room.chat.push({id:randomUUID(),sender:player.id,name:player.name,text,at:now});
      room.chat=room.chat.slice(-50);
      return "";
    }
    case "save":
      player.savedAt=now;
      return "Permainan disimpan.";
    case "discover": {
      requireGame(own(discoveries,item),"Temuan ini tidak dikenal.");
      const site=discoveries[item];
      requireGame(area==="outside"&&distance(player,site)<=1,"Dekati lokasi temuan.");
      requireGame(!own(exploration.discoveries,item),"Temuan ini sudah tercatat di jurnal lembah.");
      exploration.discoveries[item]={player:player.id,at:now};
      return `${site.name} tercatat di jurnal lembah.`;
    }
    case "forage": {
      requireGame(own(forage,item),"Lokasi tersebut tidak dikenal.");
      const site=forage[item];
      requireGame(area==="outside"&&distance(player,site)<=1,"Dekati sumber barang terlebih dahulu.");
      requireGame((exploration.forage[item]??0)<=now,"Sumber ini belum pulih. Datang lagi sebentar.");
      exploration.forage[item]=now+forageTime;
      bag[site.item]+=site.amount??(site.item==="berries"?2:1);
      return `${items[site.item]} masuk ke tas.`;
    }
    case "restore-trail":
      near("trailboard");
      requireGame(!exploration.restoredAt,"Jalur Surya sudah dipulihkan.");
      requireGame(Object.keys(discoveries).every(id=>own(exploration.discoveries,id)),"Temukan ketiga benda dari wilayah penjelajahan.");
      exploration.restoredAt=now;
      for (const member of Object.values(room.players)) member.bag.moonSeed+=2;
      return "Jalur Surya pulih. Jembatan selatan, Teras Purnama, dan benih bulan terbuka untuk lembah!";
    case "supply":
      near("chest");
      requireGame(own(foods,item),"Dapur desa menerima makanan.");
      debit(item);
      contribute(room,player,"meals",1);
      contribute(room,player,"funds",5);
      return `${items[item]} disumbangkan ke dapur desa.`;
    case "fund":
      near("chest");
      requireGame(player.gold>=10,"Sumbangan memerlukan 10 koin.");
      player.gold-=10;
      contribute(room,player,"funds",10);
      return "10 koin disumbangkan untuk pembangunan desa.";
    case "cook": {
      near("kitchen","house");
      if (own(livestock,item)) {
        const stock=player.ranch[item];
        requireGame(stock.count>0&&!stock.breedingAt&&!stock.readyAt&&!stock.fed&&!stock.watered,"Butuh ternak yang tidak sedang dirawat atau dibiakkan.");
        effort();
        stock.count--;
        bag.meal+=item==="goat"?3:2;
      } else {
        const vegetable=Object.keys(crops).find(kind=>bag[kind]>0);
        const product=bag.egg>0?"egg":"milk";
        requireGame(item==="produce"&&vegetable&&bag[product]>0,"Butuh satu hasil kebun dan satu telur atau susu.");
        effort();
        debit(vegetable);
        debit(product);
        bag.meal++;
      }
      return "Hidangan desa siap dimakan atau dibagikan.";
    }
    case "eat":
      requireGame(own(foods,item),"Pilih makanan dari tas.");
      debit(item);
      player.hunger=Math.min(100,hunger(player,now)+foods[item]);
      player.ate = now;
      player.energy = Math.min(12, player.energy + 3);
      player.progress.ate++;
      return "Kamu sudah makan.";
    case "enter":
      requireGame(area==="outside"&&distance(player,door)<=2,"Dekati pintu rumahmu sendiri.");
      Object.assign(player,{area:"house",x:17,y:15,dir:"up"});
      delete player.work;
      return "Kamu masuk ke rumah.";
    case "exit":
      near("exit","house");
      Object.assign(player,{area:"outside",x:door.x,y:door.y,dir:"down"});
      delete player.work;
      return "Kamu keluar dari rumah.";
    case "rest": {
      near("bed","house");
      const day = calendar(room.started, now).day;
      requireGame(player.rested !== day || now - player.restTime >= 60000, "Kamu bisa beristirahat lagi setelah satu menit.");
      Object.assign(player, { energy: 12, rested: day, restTime: now });
      return "Energi pulih.";
    }
    case "claim":
      requireGame(["role", "shared", "ate"].includes(item) && !player.claimed.includes(item), "Hadiah ini sudah diklaim atau tidak tersedia.");
      requireGame(item === "role" ? player.progress[role.metric] >= role.target : player.progress[item] >= 1, "Selesaikan misinya dulu.");
      player.claimed.push(item);
      player.gold += item === "role" ? 45 : 15;
      if (player.claimed.length === 3) {
        player.gold += 30;
        return "Semua misi selesai! Kamu menjadi Sahabat Lembah.";
      }
      return "Hadiah misi diterima!";
    default:
      throw new GameError("Aksi tidak dikenal.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    requireGame(["GET","POST"].includes(req.method), "Metode tidak didukung.", 405);
    const url = new URL(req.url, "http://localhost");
    const input = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body) : req.body) : {};
    requireGame(input && typeof input === "object" && !Array.isArray(input), "Permintaan tidak valid.");
    const now = Date.now();
    if (input.action === "create" || input.action === "join") {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      requireGame(name.length >= 2 && name.length <= 20 && own(roles, input.role), "Masukkan nama 2–20 karakter dan pilih profesi.");
      const creating = input.action === "create";
      const token = randomBytes(24).toString("hex");
      for (let attempt = 0; attempt < (creating ? 4 : 1); attempt++) {
        const code = creating ? randomBytes(5).toString("hex").toUpperCase() : String(input.code || "").trim().toUpperCase();
        requireGame(/^[0-9A-F]{10}$/.test(code), "Kode lembah harus berisi 10 karakter.");
        const result = await transact(code, existing => {
          if (creating && existing) return { value: null };
          requireGame(creating || existing, "Lembah tidak ditemukan.", 404);
          const room = existing || fresh();
          requireGame(Object.keys(room.players).length<houses.length,"Lembah sudah penuh.",409);
          restoreRoom(room,now);
          const home=houses.findIndex((_,index)=>!Object.values(room.players).some(p=>p.home===index));
          const {x,y}=houses[home].door;
          room.players[token] = {
            id:randomUUID(), name, role:input.role, home, x, y, area:"outside", dir:"down", seen:now, moved:0,
            hunger:85, ate:now, energy:12, gold:30, rested:0, restTime:0,
            bag:{seed:6,tomatoSeed:2,cornSeed:2,feed:5,bread:2},
            progress: { harvest: 0, eggs: 0, sold: 0, shared: 0, ate: 0 }, claimed: []
          };
          restoreRoom(room,now);
          return { room, value: { code, token, state: publicView(room, token, now) } };
        });
        if (result) return res.end(JSON.stringify(result));
      }
      throw new GameError("Kode lembah belum dapat dibuat. Coba lagi.", 503);
    }
    const code = url.searchParams.get("room") || "";
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    requireGame(/^[0-9A-F]{10}$/.test(code) && /^[0-9a-f]{48}$/.test(token), "Sesi lembah tidak valid.", 401);
    const state = await transact(code, room => {
      requireGame(room && own(room.players, token), "Sesi lembah tidak ditemukan.", 404);
      restoreRoom(room,now);
      const player = room.players[token];
      if (req.method === "GET") return { value: { state: publicView(room, token, now) } };
      const level=room.village.level;
      const losses=advanceCare(player,now,input);
      let message=input.action==="presence"?"":playerAction(room,player,input,now);
      if (room.village.level>level) message+=` ${development[level].name} terbuka untuk semua pemain!`;
      if (losses.length) message=[...losses,message].filter(Boolean).join(" ");
      if (now>=player.seen) {
        player.dormant=(input.action==="presence"&&input.dormant===true)||(input.action==="save"&&input.pause===true);
        player.seen=now;
      }
      return { room, value: { state: publicView(room, token, now), message } };
    }, req.method === "GET");
    res.end(JSON.stringify(state));
  } catch (error) {
    res.statusCode = error.status || (error instanceof SyntaxError ? 400 : 500);
    if (res.statusCode === 500) console.error(error.message);
    res.end(JSON.stringify({ error: error instanceof GameError ? error.message : res.statusCode === 400 ? "Data permintaan tidak valid." : "Lembah sedang tidak dapat dihubungi." }));
  }
}
