/* 引擎自检：400 局随机对局，盯规则不变量（位置合法、同格不共存、撞子必回库、名次齐全）。problemCount 必须 0。 */
const engine = require('../engine.cjs');
const COLORS = ['blue','red','green','yellow'];
function players(n){ return Array.from({length:n},(_,i)=>({id:'p'+(i+1),name:'P'+(i+1),color:COLORS[i]})); }
const valid = p => p===-1||p===-2||p===-3||p===999||(p>=0&&p<52)||(p>=100&&p<105);
let games=0, actions=0, knocks=0, stacks=0, problems=[];
let seed=12345; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
const origRandom=Math.random; Math.random=rnd;
for (let g=0; g<400; g++) {
  const n = 2 + (g%3);
  const st = engine.createState(players(n));
  if (typeof engine.start==='function') engine.start(st);
  let guard=0;
  while (st.phase!=='game_over' && guard++<3000) {
    const p = st.players[st.currentIndex];
    if (st.phase==='awaiting_roll') { engine.actRoll ? engine.actRoll(st,p.id) : engine.roll(st,p.id); actions++; continue; }
    if (st.phase==='awaiting_move') {
      const can = engine.movable(st,p,st.dice);
      if (!can.length) { problems.push(`g${g} awaiting_move with no movable`); break; }
      const idx = can[Math.floor(rnd()*can.length)];
      const before = st.players.map(q=>q.planes.slice());
      const logLen = st.log.length;
      engine.actMove(st,p.id,idx); actions++;
      // invariants
      for (const q of st.players) for (const pos of q.planes) if (!valid(pos)) problems.push(`g${g} invalid pos ${pos}`);
      const cellOwner={};
      for (const q of st.players) for (const pos of q.planes) {
        if (pos>=0&&pos<52) { if (cellOwner[pos]&&cellOwner[pos]!==q.color) problems.push(`g${g} two colors on ring ${pos}`); cellOwner[pos]=q.color; }
      }
      const newLogs = st.log.slice(logLen);
      if (newLogs.some(e=>e.type==='knock')) knocks++;
      if (newLogs.some(e=>e.type==='stack')) stacks++;
      // landing on opponent ring cell must knock
      const me = st.players.find(q=>q.id===p.id); const land = me.planes[idx];
      if (land>=0&&land<52) {
        const bi = st.players.findIndex(q=>q.id===p.id);
        st.players.forEach((q,qi)=>{ if (qi!==bi) before[qi].forEach((bp,j)=>{ if (bp===land && q.planes[j]!==-1) problems.push(`g${g} opponent at ${land} not knocked`); }); });
      }
      for (const q of st.players) { const homes=q.planes.filter(x=>x===999).length; if (q.finished!==homes) problems.push(`g${g} finished ${q.finished} != homes ${homes} for ${q.id}`); }
      continue;
    }
    problems.push(`g${g} unexpected phase ${st.phase}`); break;
  }
  if (st.phase!=='game_over') problems.push(`g${g} did not finish (guard)`);
  else {
    const done = st.players.filter(q=>q.rank!=null).length;
    if (done!==st.players.length) problems.push(`g${g} game_over but ranks missing`);
  }
  games++;
}
Math.random=origRandom;
console.log(JSON.stringify({games,actions,knocks,stacks,problems:problems.slice(0,12),problemCount:problems.length}));
if (problems.length) { console.error(`✗ ${problems.length} problem(s)`); process.exit(1); }
console.log(`✓ ${games} random games, ${actions} actions, no rule violations`);
