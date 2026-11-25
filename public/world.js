export const width=54, height=32, tile=28;
export const maxMoveBatch=8;
export const moveInterval=128;
export const serverMoveInterval=95;
export const roles = {
  farmer: { label: "Petani", icon: "♧", color: "#a6be62", detail: "Tanam, siram, dan panen lebih banyak.", goal: "Panen 3 tanaman", metric: "harvest", target: 3 },
  rancher: { label: "Peternak", icon: "♘", color: "#e8ad69", detail: "Rawat ternak untuk mengumpulkan lebih banyak telur dan susu.", goal: "Kumpulkan 3 telur", metric: "eggs", target: 3 },
  merchant: { label: "Pedagang", icon: "◇", color: "#e4bb63", detail: "Jual hasil desa dengan harga lebih tinggi.", goal: "Jual 5 hasil desa", metric: "sold", target: 5 }
};
export const items = {
  seed:"Benih wortel", tomatoSeed:"Benih tomat", cornSeed:"Benih jagung", feed:"Pakan",
  carrot:"Wortel", tomato:"Tomat", corn:"Jagung", egg:"Telur", milk:"Susu", bread:"Roti", meal:"Hidangan desa",
  berries:"Beri hutan", quartz:"Kuarsa sungai", moonSeed:"Benih bulan", moonfruit:"Buah bulan",
  water:"Air sumur", wood:"Kayu", grass:"Rumput liar"
};
export const crops = {
  carrot:{seed:"seed", grow:30000, yield:1},
  tomato:{seed:"tomatoSeed", grow:42000, yield:2},
  corn:{seed:"cornSeed", grow:55000, yield:2},
  moonfruit:{seed:"moonSeed",grow:72000,yield:2,rare:true}
};
export const buyPrices = {seed:5,tomatoSeed:8,cornSeed:9,feed:4,bread:6,moonSeed:13};
export const sellPrices = {carrot:9,tomato:10,corn:12,egg:8,milk:12,meal:17,berries:6,quartz:14,moonfruit:23,wood:11};
export const foods = {carrot:25,tomato:25,corn:30,egg:25,milk:32,bread:40,meal:60,berries:23,moonfruit:48};
export const livestock = {
  chicken:{label:"Ayam", place:"coop", product:"egg", price:16, wait:22000, breed:45000},
  cow:{label:"Sapi", place:"cowPen", product:"milk", price:26, wait:36000, breed:72000},
  goat:{label:"Kambing", place:"goatPen", product:"milk", price:24, wait:32000, breed:65000}
};
export const ranchLimit = 6;
export const feedRecipes={
  mixed:{label:"Pakan jagung",materials:{corn:1,grass:1},amount:3},
  grass:{label:"Pakan rumput",materials:{grass:3},amount:1}
};
export const careHeartbeatLimit=18000;
export const careLossInterval=120000;
export const careLimits={food:480000,water:360000,warning:180000};
export function animalCare(stock,time) {
  const food=careLimits.food-(time-stock.lastFed);
  const water=careLimits.water-(time-stock.lastDrink);
  const remaining=Math.min(food,water);
  return {food,water,remaining,warning:remaining<=careLimits.warning,cause:food<water?"lapar":"haus"};
}
export const waterCapacity=8;
export const workTime=667;
export const treeRegrow=120000;
export const development = [
  {name:"Kebun Selatan", status:"Bertumbuh", x:8,y:16, harvest:6, ranch:4, meals:4, funds:35, land:18},
  {name:"Ladang Tepi Sungai", status:"Sejahtera", x:20,y:16, harvest:15, ranch:12, meals:12, funds:85, land:16}
];
export const discoveries = {
  mist:{x:11,y:27,name:"Benih Embun Purba",region:"Hutan Embun",clue:"Ikuti jalan ke selatan dari desa.",art:"mist"},
  wind:{x:45,y:6,name:"Lonceng Angin",region:"Bukit Angin",clue:"Seberangi jembatan timur lalu ikuti jalan ke utara.",art:"wind"},
  sun:{x:46,y:25,name:"Medali Surya",region:"Gua Batu Surya",clue:"Dari jembatan timur, ikuti jalan ke selatan.",art:"sun"}
};
export const forage = {
  berriesWest:{x:7,y:24,item:"berries"}, berriesSouth:{x:16,y:28,item:"berries"},
  quartzHill:{x:43,y:11,item:"quartz"}, quartzCave:{x:48,y:25,item:"quartz"},
  grassVillage:{x:12,y:13,item:"grass",amount:3},
  grassForest:{x:8,y:23,item:"grass",amount:3},
  grassRiver:{x:34,y:12,item:"grass",amount:3}
};
export const forageTime=75000;
export const trailPlots=12;
export const openPlot=(plot,village,exploration)=>plot.trail ? Boolean(exploration?.restoredAt) : plot.level<=(village?.level||0);
export const bridgeRows=[{y:9,locked:false},{y:25,locked:true}];
export const riverStart=y=>29+Math.floor(Math.sin(y*.49)*1.8);
export const crossing=(x,y,repaired=false)=>bridgeRows.some(bridge=>
  (!bridge.locked||repaired)&&y>=bridge.y&&y<bridge.y+2&&x>=26&&x<=35);
export const places = {
  coop:{x:25,y:8,label:"Rawat ayam"},
  cowPen:{x:20,y:7,label:"Rawat sapi"},
  goatPen:{x:25,y:22,label:"Rawat kambing"},
  shop:{x:24,y:15,label:"Bicara dengan Bu Rini"},
  chest: { x: 17, y: 12, label: "Buka lumbung bersama" },
  well:{x:13,y:10,label:"Isi air dari sumur"},
  feedShop:{x:14,y:14,label:"Buka Toko Pakan"},
  trailboard:{x:18,y:9,label:"Buka jurnal jelajah"}
};
export const indoorPlaces = {
  bed: { x: 9, y: 10, label: "Istirahat di ranjang" },
  kitchen: { x: 25, y: 9, label: "Masak di dapur" },
  exit: { x: 17, y: 17, label: "Keluar rumah" }
};
export const plots = [
  ...Array.from({length:24},(_,i)=>({x:5+i%6,y:10+Math.floor(i/6),level:0})),
  ...Array.from({length:development[0].land},(_,i)=>({x:5+i%6,y:16+Math.floor(i/6),level:1})),
  ...Array.from({length:development[1].land},(_,i)=>({x:18+i%8,y:16+Math.floor(i/8),level:2})),
  ...Array.from({length:trailPlots},(_,i)=>({x:38+i%6,y:27+Math.floor(i/6),trail:true}))
];
export const houses=[
  [8,4,6,4,11],[2,4,5,4,4],[14,2,5,4,16],[17,22,5,3,19],
  [36,2,5,4,38],[47,2,5,4,49],[40,14,5,4,42],[39,20,5,4,41]
].map(([x,y,w,h,doorX],home)=>({id:"home",home,x,y,w,h,door:{x:doorX,y:y+h,label:"Masuk rumahku"}}));
export const buildings=[...houses,{id:"shop",x:22,y:11,w:5,h:4}];
export const pens=[
  {id:"coop",animal:"chicken",x:23,y:4,w:5,h:4,label:"Pagar ayam"},
  {id:"cowPen",animal:"cow",x:19,y:3,w:4,h:4,label:"Pagar sapi"},
  {id:"goatPen",animal:"goat",x:23,y:19,w:5,h:3,label:"Pagar kambing"}
];
export const marketNpc={name:"Bu Rini",x:24.65,y:15};
export const woodlots=Object.fromEntries([[7,22],[12,24],[4,27],[6,28],[10,30],[19,27],[21,29]].map(([x,y])=>[`${x},${y}`,{x,y}]));
export const insideFootprint=(x,y,b)=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h;
export const sameArea=(left,right)=>areaOf(left)===areaOf(right)&&(areaOf(left)==="outside"||left.home===right.home);
export const trees = [[1,3,1.2],[3,3,.9],[5,3,1.1],[7,2,.8],[10,2,.7],[13,3,.8],[17,3,.9],[20,3,1.17],[22,2,.75],[25,2,.85],[27,2,1.13],[2,6,1.2],[4,5,.85],[1,9,1.02],[3,9,.83],[1,12,.9],[3,13,.8],[2,20,1.16],[5,19,.8],[7,20,1],[10,20,1.15],[12,19,.8],[18,20,.95],[21,19,1.03],[23,20,.88],[25,19,1.13],[27,17,.85],[28,11,.9],[28,7,.7],
  [2,23,1.2],[4,22,1.1],[5,24,1],[7,22,1.3],[9,23,.85],[11,22,1.1],[12,24,1.28],[2,26,1.3],[4,27,1.25],[6,28,1.38],[8,29,1],[10,30,1.25],[12,29,1.2],[14,31,1.12],[17,23,1.3],[19,24,1.02],[22,22,1.11],[24,23,1.13],[26,21,.9],[19,27,1.01],[21,29,1.17],[24,28,1.08],[26,30,1.25],
  [34,4,.8],[37,3,.94],[41,3,.8],[44,2,1.1],[47,3,.9],[50,4,1.15],[52,7,.86],[34,14,1.11],[39,12,1],[41,13,.78],[47,11,.82],[52,13,1],[34,18,.83],[40,17,.88],[44,16,.8],[46,18,1.15],[50,22,.8],[34,23,.95],[39,23,1.1],[41,21,.85],[44,21,.89],[48,22,.9],[51,24,1.17],[46,28,.9],[49,29,1.16],[38,30,1.1],[42,31,.92]];
export function waterAt(x, y) {
  const river=riverStart(y);
  return (x>=river&&x<river+4)||(x<4&&y>15&&y<=20&&x+y>18)
    || ((x-51)/3)**2+((y-17)/3)**2<1;
}
export function walkable(x,y,area="outside",repaired=false,felled={},now=Date.now()) {
  if (area === "house") return x>=7 && x<=26 && y>=8 && y<=17
    && !(x<=9 && y<=10) && !(x>=24 && y===8);
  return x>=1&&y>=1&&x<width-1&&y<height-1&&(!waterAt(x,y)||crossing(x,y,repaired))
    && !(x===places.well.x&&y===places.well.y)
    && !trees.some(([tx,ty])=>x===tx&&y===ty&&!(felled[`${x},${y}`]>now))
    && !buildings.some(b=>insideFootprint(x,y,b))&&!pens.some(p=>insideFootprint(x,y,p));
}
export const areaOf = player => player?.area === "house" ? "house" : "outside";
export function regionAt(player) {
  if (areaOf(player)==="house") return "Rumah";
  const {x,y}=player;
  if (x<24&&y>=22) return "Hutan Embun";
  if (x>=35&&y<=12) return "Bukit Angin";
  if (x>=44&&y>=22) return "Gua Batu Surya";
  if (x>=38&&x<=43&&y>=26) return "Teras Purnama";
  return "Lembah Surya";
}
export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const landmarks=[
  ["shop",places.shop,"Pasar Surya · "+marketNpc.name],
  ["field",{x:8,y:11},"Kebun Desa"],
  ["chest",places.chest,"Lumbung"],
  ["well",places.well,"Sumur"],
  ["feedShop",places.feedShop,"Toko Pakan"],
  ["trailboard",places.trailboard,"Papan Jelajah"],
  ...pens.map(pen=>[pen.id,places[pen.id],pen.label]),
  ...Object.entries(discoveries).map(([id,site])=>[id,site,site.region])
];
const indoorLandmarks=[
  ["bed",indoorPlaces.bed,"Ranjang"],
  ["kitchen",indoorPlaces.kitchen,"Dapur"],
  ["exit",indoorPlaces.exit,"Pintu keluar"]
];
export function nearbyLandmark(state) {
  const {me,players,village,exploration}=state;
  const candidates=areaOf(me)==="house" ? indoorLandmarks : [
    ...landmarks,
    ...players.map(player=>[`house-${player.home}`,houses[player.home].door,`Rumah ${player.name}`]),
    ...development.map((region,index)=>[`development-${index}`,region,index<village.level?region.name:`${region.name} · Terkunci`]),
    ["terrace",{x:40,y:27},exploration.restoredAt?"Teras Purnama":"Teras Purnama · Terkunci"]
  ];
  let nearest=null;
  let range=6;
  for (const [id,position,name] of candidates) {
    const distanceToPlayer=distance(me,position);
    if (distanceToPlayer<range) {
      nearest={id,name};
      range=distanceToPlayer;
    }
  }
  return nearest;
}
export const dayLength = 240_000;
export function calendar(start, now = Date.now()) {
  const ticks = Math.max(0, now - start) / dayLength;
  const minutes = Math.floor(((ticks % 1) * 1440 + 360) % 1440);
  return { day: 1 + Math.floor(ticks + .25), hour: Math.floor(minutes / 60), minutes: minutes % 60 };
}
