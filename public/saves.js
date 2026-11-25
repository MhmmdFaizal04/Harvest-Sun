const key="harvest-sun-saves-v1";

export function savedGames() {
  try {
    const saves=JSON.parse(localStorage.getItem(key));
    return Array.isArray(saves)?saves:[];
  } catch { return []; }
}
export function rememberGame(session,player,visited=false) {
  const saves=savedGames();
  const index=saves.findIndex(save=>save.code===session.code&&save.token===session.token);
  const old=saves[index];
  if (!visited&&old?.name===player.name&&old.savedAt===(player.savedAt||0)) return;
  const entry={...session,name:player.name,role:player.role,savedAt:player.savedAt||0,visitedAt:visited||!old?Date.now():old.visitedAt};
  if (index<0) saves.unshift(entry);
  else saves[index]=entry;
  saves.sort((a,b)=>b.visitedAt-a.visitedAt);
  localStorage.setItem(key,JSON.stringify(saves));
}
