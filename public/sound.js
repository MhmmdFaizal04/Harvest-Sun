let audio;
let enabled=localStorage.getItem("harvest-sun-sound")!=="off";
const sounds={
  welcome:[[392,0],[494,.09],[587,.19]],
  step:[[112,0]],
  item:[[523,0],[659,.09]],
  reward:[[392,0],[523,.08],[659,.16],[784,.25]],
  chat:[[660,0],[540,.07]],
  work:[[305,0],[390,.075]],
  door:[[220,0],[330,.10]]
};
export function unlockSound() {
  const Audio=window.AudioContext||window.webkitAudioContext;
  if (!enabled||!Audio) return;
  audio ??= new Audio();
  if (audio.state==="suspended") void audio.resume().catch(()=>{});
}
export function soundEnabled() {
  return enabled;
}
export function setSound(value) {
  enabled=value;
  localStorage.setItem("harvest-sun-sound",value?"on":"off");
  if (value) unlockSound();
}
export function playSound(name) {
  if (!enabled||audio?.state!=="running") return;
  for (const [frequency,offset] of sounds[name]) {
    const start=audio.currentTime+offset;
    const duration=name==="step"?.055:.18;
    const note=audio.createOscillator();
    const volume=audio.createGain();
    note.type=name==="step"?"triangle":"sine";
    note.frequency.value=frequency;
    volume.gain.setValueAtTime(.0001,start);
    volume.gain.exponentialRampToValueAtTime(name==="step"?.026:.08,start+.012);
    volume.gain.exponentialRampToValueAtTime(.0001,start+duration);
    note.connect(volume).connect(audio.destination);
    note.start(start);
    note.stop(start+duration);
  }
}
