import { areaOf, bridgeRows, buildings, calendar, crops, development, discoveries, distance, forage, height, insideFootprint, marketNpc, openPlot, pens, places, plots, riverStart, roles, sameArea, tile, treeRegrow, trees, waterAt, width, woodlots, workTime } from "./world.js";

const terrain = document.createElement("canvas");
terrain.width = width * tile;
terrain.height = height * tile;
const g = terrain.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const graphics = {};
const positions = new Map();
let atlas, workAtlas, needsBake=true, lastArea, bakedLevel, bakedTrail;
const lamps = [[12,15],[18,8],[23,16],[9,8],[17,12],[26,9]];
const previewCrops = Object.fromEntries([0,1,2,5,6,7,8,9,12,13,17,18,19,22].map(i=>[i,{watered:1}]));

function random(x,y,n = 0) {
  const value = Math.sin(x * 72.67 + y * 136.23 + n * 62.71) * 72343.17;
  return value - Math.floor(value);
}
function box(ctx,color,x,y,w,h) {
  ctx.fillStyle=color;
  ctx.fillRect(Math.round(x),Math.round(y),w,h);
}
function oval(ctx,color,x,y,w,h) {
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.ellipse(x,y,w,h,0,0,Math.PI*2);
  ctx.fill();
}
function loadImage(name, path, trim = true) {
  const image=new Image();
  image.onload=()=>{
    let x=0,y=0,w=image.naturalWidth,h=image.naturalHeight;
    if (trim) {
      const sample=document.createElement("canvas");
      sample.width=w; sample.height=h;
      const sampleContext=sample.getContext("2d",{willReadFrequently:true});
      sampleContext.drawImage(image,0,0);
      const pixels=sampleContext.getImageData(0,0,w,h).data;
      let top=h, left=w, bottom=0, right=0;
      for (let row=0;row<h;row++) for (let column=0;column<w;column++) {
        if (pixels[(row*w+column)*4+3]<40) continue;
        left=Math.min(left,column); right=Math.max(right,column);
        top=Math.min(top,row); bottom=Math.max(bottom,row);
      }
      if (left<=right && top<=bottom) [x,y,w,h]=[left,top,right-left+1,bottom-top+1];
    }
    graphics[name]={image,x,y,w,h};
    needsBake=true;
  };
  image.src=path;
}
loadImage("terrain","/assets/terrain.webp",false);
loadImage("villager","/assets/villager.webp");
loadImage("interior","/assets/interior.webp",false);
for (const name of ["home","shop","tree","chest","chicken","goat","cow","well","vendor","stump","trough","nest","seedling","carrot","tomato","corn","banner","fence","flowers","lantern","stones",
  "sun","mist","wind","berries","quartz","cave","bridge","moonfruit","feedshop","grass"]) {
  loadImage(name,`/assets/${name}.png`);
}
fetch("/assets/villager/manifest.json").then(response=>response.ok ? response.json() : null).then(manifest=>{
  if (!manifest?.frame_layout?.rows) return;
  atlas={images:{},rects:manifest.frame_layout.rows,motions:manifest.animation.rows};
  for (const [role,file] of Object.entries({farmer:"sprite-sheet-alpha",rancher:"rancher",merchant:"merchant"})) {
    const image=new Image();
    image.onload=()=>{atlas.images[role]=image;};
    image.src=`/assets/villager/${file}.png`;
  }
}).catch(()=>{});
fetch("/assets/work/manifest.json").then(response=>response.ok?response.json():null).then(manifest=>{
  if (!manifest?.frame_layout?.rows) return;
  workAtlas={images:{},rects:manifest.frame_layout.rows,motions:manifest.animation.rows};
  for (const [role,file] of Object.entries({farmer:"sprite-sheet-alpha",rancher:"rancher",merchant:"merchant"})) {
    const image=new Image();
    image.onload=()=>{ workAtlas.images[role]=image; };
    image.src=`/assets/work/${file}.png`;
  }
}).catch(()=>{});

function object(ctx,name,x,y,maxW,maxH,mirror=false) {
  const art=graphics[name];
  if (!art) return;
  const factor=Math.min(maxW/art.w,maxH/art.h);
  const w=Math.round(art.w*factor),h=Math.round(art.h*factor);
  ctx.save();
  ctx.translate(Math.round(x),Math.round(y));
  if (mirror) ctx.scale(-1,1);
  ctx.drawImage(art.image,art.x,art.y,art.w,art.h,-Math.round(w/2),-h,w,h);
  ctx.restore();
}
function isPath(x,y) {
  return (y>=14 && y<=15 && x>=3 && x<=28) || (x>=15 && x<=16 && y>=3 && y<20)
    || (y===8 && x>=11 && x<=25) || (x>=23 && x<=24 && y>=15 && y<=17)
    || (y>=9&&y<=10&&x>=16&&x<=37)
    || (x>=36&&x<=37&&y>=7&&y<=28)
    || (y>=7&&y<=8&&x>=36&&x<=47)
    || (y>=24&&y<=25&&x>=36&&x<=48)
    || (x>=14&&x<=15&&y>=20&&y<=29)
    || (y>=25&&y<=26&&x>=7&&x<=37);
}
function surface(ctx,kind,x,y,w,h,gx,gy) {
  const texture=graphics.terrain;
  if (!texture) {
    box(ctx,["#74894a","#c19761","#326976","#8b5d3c"][kind],x,y,w,h);
    return;
  }
  const sx=(kind%2)*128+Math.floor(random(gx,gy,2)*68);
  const sy=Math.floor(kind/2)*128+Math.floor(random(gx,gy,5)*68);
  ctx.drawImage(texture.image,sx,sy,55,55,x,y,w,h);
}
function penFence(ctx,pen,front) {
  const x=pen.x*tile,y=(pen.y+Number(front)*pen.h)*tile;
  if (!front) {
    box(ctx,"#936c3b",x+1,y-2,3,pen.h*tile);
    box(ctx,"#936c3b",x+pen.w*tile-4,y-2,3,pen.h*tile);
    for (let j=1;j<pen.h;j++) {
      object(ctx,"fence",x+1,y+j*tile,9,12);
      object(ctx,"fence",x+pen.w*tile-1,y+j*tile,9,12);
    }
  }
  for (let i=0;i<pen.w;i++) object(ctx,"fence",x+(i+.5)*tile,y+7,30,20);
}
function paintWoodlot(ctx,site,until,now) {
  const x=(site.x+.5)*tile,y=(site.y+.65)*tile;
  const elapsed=now-until+treeRegrow;
  if (until>now&&elapsed>=660) {
    object(ctx,"stump",x,y,26,19);
    return;
  }
  const fall=until>now&&!reduced?Math.max(0,(elapsed-230)/430):0;
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(fall*1.42);
  object(ctx,"tree",0,0,76,83);
  box(ctx,"#dfbe78",-3,-7,7,2);
  ctx.restore();
}
function bake(level,repaired) {
  needsBake=false;
  bakedLevel=level;
  bakedTrail=repaired;
  g.imageSmoothingEnabled=false;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const px=x*tile,py=y*tile,water=waterAt(x,y),path=isPath(x,y);
    surface(g,water?2:path?1:0,px,py,tile,tile,x,y);
    if (!water&&!path&&y>=22&&x<24) box(g,"#24574a44",px,py,tile,tile);
    if (!water&&!path&&x>=35&&y<=13) box(g,"#c5a74c37",px,py,tile,tile);
    if (water) {
      if (x>0&&!waterAt(x-1,y)) {
        box(g,"#708b61",px,py,4,tile);
        box(g,"#487986",px+4,py,3,tile);
      }
      if (x<width-1&&!waterAt(x+1,y)) box(g,"#73916a",px+24,py,4,tile);
    } else if (!path && random(x,y,1)<.2 && !plots.some(p=>p.x===x&&p.y===y)) {
      const type=random(x,y,7)<.75?"flowers":"stones";
      object(g,type,px+5+random(x,y,8)*18,py+12+random(x,y,9)*14,14,9);
    }
  }
  for (const plot of plots) {
    if (!openPlot(plot,{level},{restoredAt:repaired})) continue;
    const x=plot.x*tile,y=plot.y*tile;
    box(g,"#684e32",x+1,y+2,26,25);
    surface(g,3,x+2,y+2,24,22,plot.x,plot.y);
  }
  for (const [x,y,count] of [[155,270,4],[184,536,3],[562,529,3]]) {
    for (let i=0;i<count;i++) object(g,"fence",x+i*40,y,43,20);
  }
  for (const [x,y,s] of trees) {
    if (woodlots[`${x},${y}`]||buildings.some(b=>insideFootprint(x,y,b))||pens.some(p=>insideFootprint(x,y,p))) continue;
    const px=(x+.5)*tile,py=(y+.65)*tile;
    oval(g,"#3c4d324c",px+6,py,25*s,7*s);
    object(g,"tree",px,py,70*s,77*s,(x+y)%2===0);
  }
  for (const bridge of bridgeRows) {
    const {y,locked}=bridge;
    const center=(riverStart(y)+2)*tile;
    if (!locked||repaired) {
      const art=graphics.bridge;
      if (art) g.drawImage(art.image,art.x,art.y,art.w,art.h,center-87,y*tile-4,174,64);
      else box(g,"#866047",center-87,y*tile,174,2*tile);
    } else {
      object(g,"fence",center-73,(y+1)*tile,36,18);
      object(g,"fence",center+73,(y+1)*tile,36,18);
    }
  }
  for (const building of buildings) {
    const {id,x,y,w,h}=building;
    const bottom=(y+h)*tile+5, center=(x+w*.5)*tile;
    oval(g,"#3b4c344e",center+7,bottom-3,w*tile*.45,11);
    object(g,id,center,bottom,w*tile-3,h*tile+10);
  }
  for (const pen of pens) {
    const x=(pen.x+.8)*tile,y=(pen.y+.85)*tile;
    penFence(g,pen,false);
    object(g,"trough",x,y,29,15);
    if (pen.animal==="chicken") object(g,"nest",x+60,y+2,23,14);
  }
  object(g,"well",(places.well.x+.5)*tile,(places.well.y+.83)*tile,50,56);
  object(g,"feedshop",(places.feedShop.x+.5)*tile,(places.feedShop.y+.85)*tile,56,49);
  object(g,"chest",(places.chest.x+.5)*tile,(places.chest.y+.8)*tile,32,28);
  object(g,"banner",(places.trailboard.x+.5)*tile,(places.trailboard.y+.9)*tile,32,44);
  object(g,"cave",46.6*tile,24.9*tile,91,91);
  for (const [x,y] of lamps) object(g,"lantern",(x+.58)*tile,(y+.81)*tile,12,21);
  for (const region of development) object(g,"banner",(region.x+.54)*tile,region.y*tile+2,29,39);
}
function person(ctx,p,x,y,walk,t,size,elapsed) {
  oval(ctx,"#28372b70",x,y+2,size*.23,4);
  oval(ctx,roles[p.role]?.color||"#dadd9a",x,y+2,5,1.8);
  const direction = ["left","right"].includes(p.dir) ? "side" : p.dir;
  const motion = `${direction}_${walk&&!reduced?"walk":"idle"}`;
  const workImage=workAtlas?.images[p.role]||workAtlas?.images.farmer;
  const work=p.work&&elapsed>=0&&elapsed<workTime&&workImage&&workAtlas.rects[p.work.kind];
  const frames=work||atlas?.rects[motion]||atlas?.rects.down_idle;
  const speed=(work?workAtlas.motions[p.work.kind]?.fps:atlas?.motions[motion]?.fps)||4;
  const image=work?workImage:atlas?.images[p.role]||atlas?.images.farmer;
  if (frames?.length && image) {
    const index=work?(reduced?2:Math.min(frames.length-1,Math.floor(elapsed/1000*speed))):reduced?0:Math.floor(t/1000*speed)%frames.length;
    const f=frames[index];
    ctx.save();
    ctx.translate(Math.round(x),Math.round(y));
    if (work?p.work.left:p.dir==="left") ctx.scale(-1,1);
    ctx.drawImage(image,f.x,f.y,f.w,f.h,-size/2,-size+Math.round(size*.077),size,size);
    ctx.restore();
  } else {
    const step=walk&&!reduced ? Math.floor(t/80)%2*2 : 0;
    object(ctx,"villager",x,y-step,size*.61,size*.77,p.dir==="left");
  }
}
function paintHouse(ctx) {
  box(ctx,"#312821",0,0,terrain.width,terrain.height);
  const image=graphics.interior;
  if (image) ctx.drawImage(image.image,6*tile,3*tile,22*tile,15*tile);
  else box(ctx,"#946941",6*tile,3*tile,22*tile,15*tile);
}
export function paint(ctx,state,selection,t,localPosition=null) {
  const level=state?.village?.level||0;
  const exploration=state?.exploration;
  const repaired=Boolean(exploration?.restoredAt);
  if (needsBake||bakedLevel!==level||bakedTrail!==repaired) bake(level,repaired);
  const now = state ? state.now+Date.now()-state.received : Date.now();
  const {hour} = calendar(state?.started||now,now);
  const area=areaOf(state?.me);
  const room=area==="house"?state.me.home:area;
  if (lastArea!==room) {
    positions.clear();
    lastArea=room;
  }
  ctx.imageSmoothingEnabled=false;
  if (area==="house") paintHouse(ctx);
  else ctx.drawImage(terrain,0,0);
  if (area==="outside") {
    for (let i=0;i<104;i++) {
      const x=Math.floor(random(i,11)*width),y=Math.floor(random(i,12)*height);
      if (!waterAt(x,y)) continue;
      const offset=reduced?0:Math.sin(t/1000+i)*4;
      box(ctx,i%3?"#669b98":"#80aca3",x*tile+8+offset,y*tile+9+random(i,14)*12,5+i%8,1);
    }
    for (const [idx,crop] of Object.entries(state?.crops||previewCrops)) {
      const plot=plots[idx];
      const kind=crop.kind||"carrot";
      const mature=crop.watered&&now-crop.watered>=crops[kind].grow;
      const x=(plot.x+.5)*tile,y=(plot.y+.83)*tile;
      if (crop.watered&&!mature) box(ctx,"#49352388",x-10,y-9,20,10);
      object(ctx,mature?kind:"seedling",x,y,mature?24:15,mature?27:14);
    }
    const herd=state?.herd||{chicken:2,goat:1,cow:1};
    for (const pen of pens) {
      const count=Math.min(4,herd[pen.animal]);
      for (let i=0;i<count;i++) {
        const gait=reduced?0:Math.sin(t/(1000+i*140)+i+pen.x)*.15;
        const x=(pen.x+1.25+i%2*(pen.w-2.3)+gait)*tile;
        const y=(pen.y+1.7+Math.floor(i/2)*.8)*tile;
        const size=pen.animal==="chicken"?24:pen.animal==="cow"?38:33;
        oval(ctx,"#38462b66",x,y,10,3);
        object(ctx,pen.animal,x,y,size,size,i%2===0?gait>0:gait<0);
      }
      penFence(ctx,pen,true);
    }
    for (const [id,site] of Object.entries(woodlots)) paintWoodlot(ctx,site,state?.felled[id]??0,now);
    const npcX=(marketNpc.x+.5)*tile,npcY=(marketNpc.y+.7)*tile;
    oval(ctx,"#28372b70",npcX,npcY,11,4);
    object(ctx,"vendor",npcX,npcY,29,42);
    for (const [id,site] of Object.entries(forage)) {
      if ((exploration?.forage[id]??0)<=now) object(ctx,site.item,(site.x+.5)*tile,(site.y+.9)*tile,23,26);
    }
    for (const [id,site] of Object.entries(discoveries)) {
      if (exploration?.discoveries[id]) continue;
      const x=(site.x+.5)*tile,y=(site.y+.85)*tile;
      oval(ctx,"#f6d58980",x,y+1,12,4);
      object(ctx,site.art,x,y-(reduced?0:Math.sin(t/280)*2),28,27);
    }
  }
  if (selection) {
    ctx.strokeStyle="#f8d578"; ctx.lineWidth=2;
    ctx.strokeRect(selection.x*tile+2,selection.y*tile+2,tile-4,tile-4);
  }
  const players=state?.players.filter(p=>sameArea(p,state.me)&&(p.id===state.me.id||state.now-p.seen<30000))
    .map(p=>p.id===state.me.id&&localPosition?{...p,...localPosition}:p)
    || [{id:"preview",name:"",x:16,y:13,role:"farmer",dir:"down"}];
  const seen=new Set(players.map(p=>p.id));
  for (const id of positions.keys()) if (!seen.has(id)) positions.delete(id);
  for (const p of players.sort((a,b)=>a.y-b.y)) {
    const targetX=(p.x+.5)*tile,targetY=(p.y+.8)*tile;
    const pos=positions.get(p.id)||{x:targetX,y:targetY};
    const moving=Math.hypot(pos.x-targetX,pos.y-targetY)>1.2;
    pos.x+=(targetX-pos.x)*(reduced?1:.24); pos.y+=(targetY-pos.y)*(reduced?1:.24);
    if (p.work&&pos.workAt!==p.work.at) {
      pos.workAt=p.work.at;
      pos.workDrawnAt=now-p.work.at<=2000?now:p.work.at;
    }
    positions.set(p.id,pos);
    const size=area==="house"?76:52;
    person(ctx,p,pos.x,pos.y,moving,t,size,now-(pos.workDrawnAt??0));
    if (!p.name||distance(p,state.me)>5) continue;
    ctx.font="bold 13px system-ui"; ctx.textAlign="center";
    ctx.lineWidth=3; ctx.strokeStyle="#253529";
    ctx.strokeText(p.name,pos.x,pos.y-size+5); ctx.fillStyle="#fff1ca"; ctx.fillText(p.name,pos.x,pos.y-size+5);
  }
  if (area==="outside"&&(hour>=18||hour<6)) {
    const opacity=hour>=18?Math.min(.54,.14+(hour-18)*.13):Math.max(.14,.53-(hour-1)*.065);
    box(ctx,`rgba(24,34,70,${opacity})`,0,0,terrain.width,terrain.height);
    for (const [x,y] of lamps) {
      const glow=ctx.createRadialGradient(x*tile+18,y*tile+9,0,x*tile+18,y*tile+9,34);
      glow.addColorStop(0,"#ffcd7270"); glow.addColorStop(1,"#ffcd7200");
      ctx.fillStyle=glow; ctx.fillRect(x*tile-16,y*tile-25,70,70);
    }
  }
}
export function drawOverview(ctx,state,waypoint) {
  const {width:w,height:h}=ctx.canvas;
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(terrain,0,0,w,h);
  for (const [id,site] of Object.entries(discoveries)) {
    const x=(site.x+.5)*w/width,y=(site.y+.5)*h/height;
    oval(ctx,"#20291f",x,y,5,5);
    oval(ctx,state.exploration.discoveries[id]?"#b8d69b":id===waypoint?"#ffe99a":"#dba755",x,y,3,3);
  }
  if (areaOf(state.me)==="outside") {
    const x=(state.me.x+.5)*w/width,y=(state.me.y+.5)*h/height;
    oval(ctx,"#25312c",x,y,4,4);
    oval(ctx,"#f6f0df",x,y,2.5,2.5);
  }
}
