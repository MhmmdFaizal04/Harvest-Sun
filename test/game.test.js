import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { areaOf, calendar, careLimits, careLossInterval, crops, discoveries, distance, forage, forageTime, houses, indoorPlaces, livestock, places, plots, riverStart, walkable, waterCapacity, width, woodlots } from "../public/world.js";

test("two players share a world while inventories and mission claims stay isolated", async t => {
  const temp = await mkdtemp(join(tmpdir(), "harvest-sun-"));
  // A test-only root prevents test rooms from appearing in a developer's local game.
  let current=1000000;
  t.mock.method(Date, "now", () => current);
  process.env.HARVEST_SUN_LOCAL_DIR=pathToFileURL(temp+"/").href;
  const { default: handler }=await import("../api/game.js");
  t.after(async()=>{
    delete process.env.HARVEST_SUN_LOCAL_DIR;
    for (const name of await readdir(temp)) await unlink(join(temp,name));
    await rmdir(temp);
  });
  async function request(input, session, respond=handler) {
    let response;
    const res={statusCode:200,setHeader(){},end(body){response=JSON.parse(body);}};
    await respond({
      method:input?"POST":"GET",url:session?`/api/game?room=${session.code}`:"/api/game",
      headers:session?{authorization:`Bearer ${session.token}`}:{},body:input
    },res);
    return {status:res.statusCode,...response};
  }
  const farmer=await request({action:"create",name:"Ayu",role:"farmer"});
  assert.equal(farmer.status,200);
  const friend=await request({action:"join",code:farmer.code,name:"Raka",role:"rancher"});
  assert.equal(friend.status,200);
  const trader=await request({action:"join",code:farmer.code,name:"Nara",role:"merchant"});
  assert.equal(trader.status,200);
  const remote=await request(null,farmer);
  assert.equal(remote.state.players.length,3);
  assert.equal(remote.state.players[1].name,"Raka");
  assert.notDeepEqual([remote.state.players[0].x,remote.state.players[0].y],[remote.state.players[1].x,remote.state.players[1].y]);
  assert.notEqual(farmer.state.me.home,friend.state.me.home);
  const ownDoor=player=>houses[player.state.me.home].door;
  assert.deepEqual([farmer.state.me.x,farmer.state.me.y],[ownDoor(farmer).x,ownDoor(farmer).y]);
  assert.equal((await request({action:"enter"},friend)).state.me.home,friend.state.me.home);
  assert.equal((await request({action:"exit"},friend)).state.me.x,ownDoor(friend).x);
  assert.ok(!JSON.stringify(remote).includes(friend.token));
  assert.equal((await request(null,{code:farmer.code,token:"0".repeat(48)})).status,404);

  async function go(session, target, radius) {
    const {me,exploration,felled}= (await request(null,session)).state;
    const start=me.y*width+me.x;
    const found=new Map([[start,[]]]);
    const queue=[start];
    for (const at of queue) {
      const x=at%width, y=Math.floor(at/width);
      if (distance({x,y},target)<=radius) {
        for (let offset=0;offset<found.get(at).length;offset+=8) {
          const path=found.get(at).slice(offset,offset+8);
          current+=path.length*130;
          assert.equal((await request({action:"move",path},session)).status,200);
        }
        return;
      }
      for (const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
        const index=ny*width+nx;
        if (!walkable(nx,ny,areaOf(me),Boolean(exploration.restoredAt),felled,current)||found.has(index)) continue;
        found.set(index,[...found.get(at),[nx,ny]]);
        queue.push(index);
      }
    }
    assert.fail("Target must be reachable");
  }
  await go(friend,ownDoor(farmer),0);
  assert.match((await request({action:"enter"},friend)).error,/rumahmu sendiri/);
  assert.equal((await request({action:"plot",plot:0},farmer)).status,400);
  for (const plot of [0,1,2]) {
    await go(farmer,plots[plot],1);
    const planted=await request({action:"plot",plot},farmer);
    assert.equal(planted.status,200);
    assert.equal(planted.state.me.work.kind,"hoe");
    assert.ok((await request(null,friend)).state.crops[plot]);
    if (plot===0) {
      assert.match((await request({action:"plot",plot},farmer)).error,/sumur/);
      await go(farmer,places.well,2);
      assert.equal((await request({action:"well"},farmer)).state.me.bag.water,waterCapacity);
      await go(farmer,plots[plot],1);
    }
    assert.equal((await request({action:"plot",plot},farmer)).state.me.work.kind,"water");
    assert.equal((await request({action:"plot",plot},farmer)).status,400);
    current+=30001;
    assert.equal((await request({action:"plot",plot},farmer)).status,200);
  }
  assert.equal((await request(null,farmer)).state.me.bag.carrot,6);
  await go(farmer,places.chest,2);
  await go(friend,places.chest,2);
  await go(trader,places.chest,2);
  for (let i=0;i<5;i++) assert.equal((await request({action:"deposit",item:"carrot"},farmer)).status,200);
  for (let i=0;i<5;i++) assert.equal((await request({action:"withdraw",item:"carrot"},trader)).status,200);
  assert.equal((await request({action:"deposit",item:"carrot"},farmer)).status,200);
  const withdrawals=await Promise.all([request({action:"withdraw",item:"carrot"},friend),request({action:"withdraw",item:"carrot"},trader)]);
  assert.deepEqual(withdrawals.map(r=>r.status).sort(),[200,400]);
  assert.equal((await request({action:"eat",item:"bread"},farmer)).status,200);
  for (const item of ["role","shared","ate"]) assert.equal((await request({action:"claim",item},farmer)).status,200);
  assert.equal((await request({action:"claim",item:"role"},farmer)).status,400);
  assert.equal((await request(null,farmer)).state.me.gold,135);
  await go(friend,places.well,2);
  assert.equal((await request({action:"well"},friend)).status,200);
  await go(friend,places.coop,2);
  for (let i=0;i<2;i++) {
    const fed=await request({action:"feed"},friend);
    assert.equal(fed.state.me.work.kind,"feed");
    assert.equal(fed.state.me.ranch.chicken.readyAt,0);
    assert.equal(fed.state.me.ranch.chicken.lastFed,fed.state.me.careTime);
    assert.equal((await request({action:"feed"},friend)).status,400);
    assert.equal((await request({action:"drink"},friend)).state.me.ranch.chicken.watered,true);
    current+=22000;
    assert.equal((await request({action:"feed"},friend)).status,200);
  }
  assert.equal((await request({action:"claim",item:"role"},friend)).status,200);
  assert.equal((await request(null,friend)).state.me.bag.egg,4);
  await go(trader,places.shop,2);
  for (let i=0;i<5;i++) assert.match((await request({action:"sell",item:"carrot"},trader)).message,/Bu Rini membeli/);
  assert.equal((await request({action:"claim",item:"role"},trader)).state.me.gold,140);
  assert.equal((await request({action:"buy",item:"bread"},trader)).state.me.bag.bread,3);
  await go(farmer,ownDoor(farmer),2);
  assert.equal((await request({action:"rest"},farmer)).status,400);
  assert.equal((await request({action:"enter"},farmer)).state.me.area,"house");
  assert.equal((await request(null,friend)).state.players.find(p=>p.id===farmer.state.me.id).area,"house");
  assert.equal((await request({action:"plot",plot:0},farmer)).status,400);
  await go(farmer,indoorPlaces.bed,2);
  assert.equal((await request({action:"rest"},farmer)).state.me.energy,12);
  assert.equal((await request({action:"rest"},farmer)).status,400);
  assert.equal((await request({action:"exit"},farmer)).status,400);
  await go(farmer,indoorPlaces.exit,2);
  assert.equal((await request({action:"exit"},farmer)).state.me.area,"outside");

  const posted=await request({action:"chat",text:" Siap panen bersama! "},friend);
  assert.equal(posted.status,200);
  assert.equal((await request(null,farmer)).state.chat.at(-1).text,"Siap panen bersama!");
  assert.equal((await request({action:"chat",text:"Pesan berikutnya"},friend)).status,429);
  assert.equal((await request({action:"chat",text:"x".repeat(181)},farmer)).status,400);

  await go(farmer,plots[24],0);
  assert.match((await request({action:"plot",plot:24},farmer)).error,/misi desa/);
  for (const [plot,kind] of [[3,"tomato"],[4,"corn"],[5,"tomato"]]) {
    await go(farmer,plots[plot],0);
    assert.equal((await request({action:"plot",plot,item:kind},farmer)).state.crops[plot].kind,kind);
    assert.equal((await request({action:"plot",plot},farmer)).status,200);
    current+=crops[kind].grow-1;
    assert.equal((await request({action:"plot",plot},farmer)).status,400);
    current+=1;
    assert.equal((await request({action:"plot",plot},farmer)).status,200);
  }
  await go(friend,places.goatPen,2);
  for (let n=0;n<2;n++) assert.equal((await request({action:"ranch-buy",item:"goat"},friend)).status,200);
  assert.equal((await request({action:"breed",item:"goat"},friend)).status,200);
  assert.equal((await request({action:"breed",item:"goat"},friend)).status,400);
  current+=livestock.goat.breed;
  assert.equal((await request({action:"breed",item:"goat"},friend)).state.me.ranch.goat.count,3);
  assert.equal((await request({action:"feed",item:"goat"},friend)).status,200);
  assert.equal((await request({action:"drink",item:"goat"},friend)).status,200);
  current+=livestock.goat.wait;
  assert.equal((await request({action:"feed",item:"goat"},friend)).state.me.bag.milk,4);
  const recipient=farmer.state.me.id;
  assert.equal((await request({action:"gift",item:"milk",recipient},friend)).status,400);
  await go(farmer,places.chest,0);
  await go(friend,places.chest,0);
  await go(trader,places.chest,0);
  assert.equal((await request({action:"gift",item:"milk",recipient},friend)).state.me.bag.milk,3);
  assert.equal((await request(null,farmer)).state.me.bag.milk,1);
  for (const item of ["tomato","corn","tomato"]) assert.equal((await request({action:"supply",item},farmer)).status,200);
  assert.equal((await request({action:"supply",item:"bread"},trader)).state.village.level,0);
  assert.match((await request({action:"fund"},trader)).message,/Kebun Selatan terbuka/);
  const project=(await request(null,friend)).state.village;
  assert.equal(project.level,1);
  assert.equal(Object.keys(project.team).length,3);
  await go(farmer,plots[24],0);
  assert.equal((await request({action:"plot",plot:24,item:"corn"},farmer)).status,200);
  await go(farmer,plots[42],0);
  assert.equal((await request({action:"plot",plot:42},farmer)).status,400);

  await go(farmer,ownDoor(farmer),2);
  assert.equal((await request({action:"enter"},farmer)).status,200);
  await go(farmer,indoorPlaces.kitchen,2);
  const cooked=await request({action:"cook",item:"produce"},farmer);
  assert.equal(cooked.state.me.bag.meal,1);
  assert.equal(cooked.state.me.bag.milk,0);
  assert.equal((await request({action:"eat",item:"meal"},farmer)).state.me.hunger,100);
  await go(friend,ownDoor(friend),2);
  assert.equal((await request({action:"enter"},friend)).status,200);
  await go(friend,indoorPlaces.kitchen,2);
  const roast=await request({action:"cook",item:"goat"},friend);
  assert.equal(roast.state.me.ranch.goat.count,2);
  assert.equal(roast.state.me.bag.meal,3);
  assert.equal((await request({action:"gift",item:"meal",recipient},friend)).status,400);

  for (const player of [farmer,friend]) {
    await go(player,indoorPlaces.exit,2);
    assert.equal((await request({action:"exit"},player)).status,200);
  }
  await go(trader,places.well,2);
  assert.equal((await request({action:"well"},trader)).status,200);
  await go(trader,places.coop,0);
  assert.equal((await request({action:"ranch-buy",item:"cow"},trader)).status,400);
  await go(trader,places.cowPen,2);
  assert.equal((await request({action:"ranch-buy",item:"cow"},trader)).state.herd.cow,1);
  assert.equal((await request({action:"drink",item:"cow"},trader)).state.me.ranch.cow.readyAt,0);
  assert.equal((await request({action:"feed",item:"cow"},trader)).status,200);
  current+=livestock.cow.wait;
  assert.equal((await request({action:"feed",item:"cow"},trader)).state.me.bag.milk,1);
  const [treeId,tree]=Object.entries(woodlots)[0];
  await go(farmer,tree,1);
  const chopped=await request({action:"chop",item:treeId},farmer);
  assert.equal(chopped.state.me.work.kind,"chop");
  assert.equal(chopped.state.me.bag.wood,2);
  assert.equal((await request({action:"chop",item:treeId},farmer)).status,400);
  assert.ok((await request(null,trader)).state.felled[treeId]>current);
  await go(farmer,places.trailboard,2);
  assert.equal((await request({action:"restore-trail"},farmer)).status,400);
  assert.equal((await request({action:"discover",item:"wind"},farmer)).status,400);
  const river=riverStart(25);
  await go(farmer,{x:river-1,y:25},0);
  current+=130;
  assert.equal((await request({action:"move",path:[[river,25]]},farmer)).status,400);
  await go(farmer,forage.berriesWest,0);
  await go(friend,forage.berriesWest,0);
  const pick={action:"forage",item:"berriesWest"};
  const picks=await Promise.all([request(pick,farmer),request(pick,friend)]);
  assert.deepEqual(picks.map(result=>result.status).sort(),[200,400]);
  current+=forageTime;
  assert.equal((await request(pick,farmer)).status,200);
  for (const [id,player] of [["mist",farmer],["wind",friend],["sun",trader]]) {
    await go(player,discoveries[id],1);
    const found=await request({action:"discover",item:id},player);
    assert.equal(found.state.exploration.discoveries[id].player,player.state.me.id);
    assert.equal((await request({action:"discover",item:id},player)).status,400);
  }
  const lastPlot=plots.length-1;
  await go(trader,plots[lastPlot],1);
  assert.match((await request({action:"plot",plot:lastPlot},trader)).error,/Jalur Surya/);
  await go(farmer,places.trailboard,2);
  const restored=await request({action:"restore-trail"},farmer);
  assert.equal(restored.state.exploration.restoredAt,current);
  assert.equal((await request({action:"restore-trail"},farmer)).status,400);
  assert.equal((await request(null,trader)).state.me.bag.moonSeed,2);
  await go(farmer,{x:river-1,y:25},0);
  current+=130;
  assert.equal((await request({action:"move",path:[[river,25]]},farmer)).status,200);
  assert.equal((await request({action:"plot",item:"moonfruit",plot:lastPlot},trader)).state.crops[lastPlot].kind,"moonfruit");

  const save=await request({action:"save"},farmer);
  assert.equal(save.state.me.savedAt,current);
  const {default: restarted}=await import("../api/game.js?save-restart");
  const loaded=await request(null,farmer,restarted);
  assert.deepEqual(loaded.state.me.bag,save.state.me.bag);
  assert.deepEqual([loaded.state.me.x,loaded.state.me.y],[river,25]);
  assert.deepEqual(loaded.state.exploration,save.state.exploration);
  assert.equal(loaded.state.me.savedAt,save.state.me.savedAt);

  const file=join(temp,`${farmer.code}.json`);
  const oldRoom=JSON.parse(await readFile(file,"utf8"));
  for (const p of Object.values(oldRoom.players)) {
    delete p.home;
    delete p.ranch.cow;
    delete p.bag.water;
  }
  await writeFile(file,JSON.stringify(oldRoom));
  const upgraded=(await request(null,farmer)).state;
  assert.equal(new Set(upgraded.players.map(player=>player.home)).size,3);
  assert.equal(upgraded.me.gold,save.state.me.gold);
  assert.equal(upgraded.me.bag.water,0);
  assert.equal(upgraded.me.ranch.cow.count,0);

  await go(farmer,places.feedShop,0);
  assert.equal((await request({action:"feed-craft",item:"grass"},farmer)).status,400);
  const bought=await request({action:"feed-buy"},farmer);
  assert.equal(bought.state.me.bag.feed,upgraded.me.bag.feed+1);
  assert.equal(bought.state.me.gold,upgraded.me.gold-4);
  await go(farmer,forage.grassVillage,0);
  assert.equal((await request({action:"forage",item:"grassVillage"},farmer)).state.me.bag.grass,3);
  await go(farmer,places.feedShop,0);
  const mixed=await request({action:"feed-craft",item:"mixed"},farmer);
  assert.equal(mixed.state.me.bag.feed,bought.state.me.bag.feed+3);
  assert.equal(mixed.state.me.bag.grass,2);
  assert.equal(mixed.state.me.bag.corn,bought.state.me.bag.corn-1);
  await go(farmer,forage.grassForest,0);
  assert.equal((await request({action:"forage",item:"grassForest"},farmer)).state.me.bag.grass,5);
  await go(farmer,places.feedShop,0);
  const emergency=await request({action:"feed-craft",item:"grass"},farmer);
  assert.equal(emergency.state.me.bag.feed,mixed.state.me.bag.feed+1);
  assert.equal(emergency.state.me.bag.grass,2);

  const keeper=await request({action:"create",name:"Uji Pakan",role:"rancher"});
  await go(keeper,places.coop,2);
  const pair=await request({action:"ranch-buy",item:"chicken"},keeper);
  assert.equal(pair.state.me.ranch.chicken.count,2);
  await request({action:"presence",dormant:true},keeper);
  current+=60*60*1000;
  const resumed=(await request({action:"presence"},keeper)).state.me;
  assert.equal(resumed.careTime,pair.state.me.careTime);
  assert.equal(resumed.ranch.chicken.count,2);
  async function playUntil(threshold) {
    let next=await request(null,keeper);
    while (next.state.me.careTime<threshold) {
      current+=Math.min(12000,threshold-next.state.me.careTime);
      next=await request({action:"presence"},keeper);
    }
    return next;
  }
  assert.equal((await playUntil(careLimits.water-1)).state.me.ranch.chicken.count,2);
  const firstLoss=await playUntil(careLimits.water);
  assert.match(firstLoss.message,/1 ayam mati karena haus/);
  assert.equal(firstLoss.state.herd.chicken,1);
  assert.equal((await playUntil(careLimits.water+careLossInterval-1)).state.me.ranch.chicken.count,1);
  assert.equal((await playUntil(careLimits.water+careLossInterval)).state.me.ranch.chicken.count,0);

  const walker=await request({action:"create",name:"Uji Gerak",role:"farmer"});
  const {x,y}=walker.state.me;
  const from={x,y,area:"outside"};
  const forward=[[x,y+1],[x,y+2],[x,y+3]];
  assert.equal((await request({action:"move",from,path:forward},walker)).state.me.y,y+3);
  assert.equal((await request({action:"move",from,path:[[x,y+2]]},walker)).status,409);
  const back=[[x,y+2],[x,y+1],[x,y]];
  assert.equal((await request({action:"move",from:{...from,y:y+3},path:back},walker)).state.me.y,y);
  assert.equal((await request({action:"move",from,path:forward},walker)).status,429);
  current+=95;
  assert.equal((await request({action:"move",from,path:forward},walker)).state.me.y,y+3);
});

test("the shared clock crosses dusk and midnight",()=>{
  assert.deepEqual(calendar(0,0),{day:1,hour:6,minutes:0});
  assert.deepEqual(calendar(0,120000),{day:1,hour:18,minutes:0});
  assert.deepEqual(calendar(0,180000),{day:2,hour:0,minutes:0});
});
