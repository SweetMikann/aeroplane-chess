/* 飞行棋引擎 —— 2026-08-24。规则全是她定的，棋盘数据是她让 ChatGPT 出的（我逐条验过）。
 *
 * 她定的规则（原话）：
 *   「四种颜色各四架飞机、同色可以叠着走、撞到别人的送他回家、走满一圈进终点」——「对对对对！就是这个」
 *   同色格往前跳 + 箭头格整段飞 ——「也要也要！」
 *   掷 6 再掷一次 ——「要嘟宝宝！」
 *   「1和6可以出来」（8/24 10:28）；「1 走小门，6 走正门」，掷 1 出来「落在斜三角本身」
 *
 * 棋盘几何全部来自 data/board.json（15×15 网格、外圈 52 格、八边形斜切角）：
 *   · 正门 gate：绿1 红14 黄27 蓝40（间隔 13）
 *   · 小门 smallGate：八边形四个外角的斜三角，记成角格前一格（6/19/32/45；2026-08-24 前是 3/16/29/42，画板改成八边形后对齐）
 *   · 飞机场 airfield：正门 +16（17/30/43/4），落上去直飞 12 格
 *   · 跑道入口 entry：正门 −4（49/10/23/36）——四个都是本色格，跟实体棋盘的画法一致
 *   · 走向：编号增大 = 顺时针
 */
'use strict';

const path = require('path');
const BOARD = require(path.join(__dirname, 'data', 'board.json'));

const COLORS = ['red', 'yellow', 'blue', 'green'];
const RING = BOARD.ringCount;    // 52
const HOME_LEN = 5;              // 可停跑道格 5 个（100..104）；第 6 格＝家（走到跑道尽头即到达，999）
/* ★2026-08-24 23:33 她：「我的位置就是6，却让我多走一步才给到家」——
   跑道画 6 格，旧逻辑走到第 6 格(105)还要再走 1 步(第7步)才判到家，多算了一步。
   现在第 6 格＝终点：走满 5 步进跑道、第 6 步踏上尽头即到家。 */
const PLANES = 4;                // 每色飞机数

/* 每一格的颜色直接查棋盘数据，不再用 idx%4 猜（旧版猜的循环序是错的） */
const CELL_COLOR = BOARD.ring.map(c => c.color);
function cellColor(idx) { return CELL_COLOR[idx]; }

/* 正门（掷 6 出来落这儿） */
/* ★8/25 00:58 她定的（圈图）：正门是角上的空白位，「应该是空白走到黄色，然后可以直接跳」——
   从门口空白往前数，走 n 落在门格前 (2-n) 格：走 2 正好落到本色正门格 27 触发跳 4。
   所以起飞落点 = 正门格 −2（=25），跑道入口仍按正门格 −4 算，不受影响。 */
const GATE_CELL = { ...BOARD.gate };                       // 本色正门格（27 等），只用来推入口
/* ★8/25 01:15 她圈图（同一编号画在两处、撞子串）：两个门口空白位改成独立位置码，不再借用环编号。
   -1 机库 · -2 正门空白位 · -3 小门空白位。从空白位走 n 步 = 从「基准格」往前 n 格：
   正门基准 = 正门格 −2（走 2 正好踩本色正门格跳 4）；小门基准 = 棋盘给的小门格编号（走几就是几）。 */
const PAD_GATE = -2, PAD_SMALL = -3;
const START = {}, PAD_BASE = {};
for (const c of COLORS) {
  START[c] = PAD_GATE;
  PAD_BASE[c] = { [PAD_GATE]: (GATE_CELL[c] - 2 + BOARD.ringCount) % BOARD.ringCount, [PAD_SMALL]: BOARD.smallGate[c].index };
}
/* 小门（掷 1 出来落这儿）＝正门 +2 的斜三角格。
   ★我上午暂定 −2，方向猜反了——她给的棋盘数据说话：+2。 */
const SMALL_GATE = {};
for (const c of COLORS) SMALL_GATE[c] = PAD_SMALL;
/* 跑道入口 = 正门 −4。棋盘上这四格分别是 (7,0)(0,7)(7,14)(14,7)——
   四条边的正中点，紧挨着各家通向中心的跑道，而且四格都是本色。几何和颜色互相印证。 */
const ENTRY = {};
for (const c of COLORS) ENTRY[c] = (GATE_CELL[c] - 4 + RING) % RING;
/* 飞机场（落上去直飞 12 格）。+12 的落点还是本色（12 ≡ 0 mod 4），所以飞完还能再跳一次。 */
const AIRFIELD = { ...BOARD.airfield };

/* 开机自检：数据要是不自洽，宁可当场炸也别带病开局 */
for (const c of COLORS) {
  if (cellColor(GATE_CELL[c]) !== c) throw new Error(`棋盘数据不自洽：${c} 的正门 ${GATE_CELL[c]} 不是本色格`);
  if (cellColor(ENTRY[c]) !== c) throw new Error(`棋盘数据不自洽：${c} 的跑道入口 ${ENTRY[c]} 不是本色格`);
  if (cellColor(AIRFIELD[c]) !== c) throw new Error(`棋盘数据不自洽：${c} 的飞机场 ${AIRFIELD[c]} 不是本色格`);
}

function createState(players) {
  // players: [{id,name,color}]
  const st = {
    seq: 0,
    /* ★她定的：「1和6可以出来」——写死在这儿，免得哪次漏传就变成只有 6 */
    config: { takeoff: [1, 6] },
    phase: 'awaiting_roll',
    currentIndex: 0,
    /* ★server.cjs 读的是 currentPlayer（玩家 id），引擎内部用 currentIndex（下标）。
       两个字段必须一起维护——8/24 上午端到端测出来的教训：只维护一个，一步棋都走不了。 */
    currentPlayer: null,
    dice: null,
    doubleSix: 0,                // 连续掷出 6 的次数
    /* 玩家完成顺序；只有所有人都完成后才进入 game_over。 */
    finishOrder: [],
    players: players.map(p => ({
      id: p.id, name: p.name, color: p.color,
      // 每架飞机：-1=还在机库，0..51=外圈位置，100+n=跑道第 n 格，999=已到终点
      planes: [-1, -1, -1, -1],
      finished: 0,
      rank: null
    })),
    log: [],
    winner: null
  };
  st.currentPlayer = st.players.length ? st.players[0].id : null;
  log(st, 'start', `牌局开始：${players.map(p => p.name).join('、')}`);
  return st;
}

function log(st, type, text) {
  st.log.push({ seq: st.log.length + 1, t: st.seq, type, text });
}

function cur(st) { return st.players[st.currentIndex]; }

function playerDone(player) {
  return !!player && (player.rank != null || player.finished >= PLANES);
}

function recordPlayerFinish(st, player) {
  if (!Array.isArray(st.finishOrder)) st.finishOrder = [];
  if (st.finishOrder.includes(player.id)) return player.rank;
  const rank = st.finishOrder.length + 1;
  st.finishOrder.push(player.id);
  player.rank = rank;
  log(st, 'player_finish', `${player.name} 四架全部到家，获得第 ${rank} 名`);
  return rank;
}

/* 只剩一个人没到家时，这位不用再走，直接排最后一名 */
function recordLastPlace(st, player) {
  if (!Array.isArray(st.finishOrder)) st.finishOrder = [];
  if (st.finishOrder.includes(player.id)) return player.rank;
  const rank = st.finishOrder.length + 1;
  st.finishOrder.push(player.id);
  player.rank = rank;
  log(st, 'player_last', `${player.name} 是最后一位，排第 ${rank} 名`);
  return rank;
}

function finishGame(st) {
  if (!Array.isArray(st.finishOrder)) st.finishOrder = [];
  st.winner = st.finishOrder[0] || null;
  st.currentPlayer = null;
  st.phase = 'game_over';
  const standings = st.finishOrder.map((id, index) => {
    const player = st.players.find(p => p.id === id);
    return `第${index + 1}名 ${player ? player.name : id}`;
  }).join('、');
  log(st, 'game_over', `这局结束！${standings}`);
}

/* 一架飞机从外圈位置往前走 n 步，返回新位置（可能进跑道 / 超出退回） */
function advance(color, pos, n) {
  if (pos === PAD_GATE || pos === PAD_SMALL) {   // 门口空白位：从基准格往前数
    const base = PAD_BASE[color][pos];
    return advance(color, base, n);
  }
  if (pos >= 100 && pos < 999) {          // 已在跑道里
    const t = (pos - 100) + n;
    if (t === HOME_LEN) return 999;       // 精确到达终点
    if (t > HOME_LEN) return 100 + (HOME_LEN - (t - HOME_LEN));  // 多了原路退回
    return 100 + t;
  }
  const entry = ENTRY[color];
  // 算出还差几步到跑道入口
  let toEntry = (entry - pos + RING) % RING;
  if (n <= toEntry) return (pos + n) % RING;
  const into = n - toEntry - 1;           // 迈过入口后进跑道的步数
  if (into === HOME_LEN) return 999;
  if (into > HOME_LEN) return 100 + (HOME_LEN - (into - HOME_LEN));
  return 100 + into;
}

/* 撞子：pos 这一格上别家的飞机全回机库（叠着的一起回，她定的「撞到别人的送他回家」） */
/* ★2026-08-24 23:05 起飞垫（小门/正门）画在外环之外，是自己家门口的独立方格——
   引擎却拿同一个索引记它，于是别人走到那个环格就把垫子上的飞机"撞"了（她刚出小门那架就是这么没的）。
   垫子上的飞机：不可撞、也不撞人。 */
function onPad(player, pos) {
  return pos === PAD_GATE || pos === PAD_SMALL;
}

function knock(st, player, pos) {
  if (onPad(player, pos)) return;
  for (const other of st.players) {
    if (other.id === player.id) continue;
    let n = 0;
    other.planes.forEach((p, i) => { if (p === pos && !onPad(other, p)) { other.planes[i] = -1; n += 1; } });
    if (n) log(st, 'knock', `${player.name} 把 ${other.name} 的 ${n} 架撞回机库`);
  }
}

/* ── 落点结算 ──
 * 链条只有一种合法走法：骰子落点 →（本色格？跳 4）→（落飞机场？飞 12）→（本色格？再跳 4）→ 停。
 * ★跳不再触发跳：外圈每隔 4 格就是自己颜色，跳完的落点永远还是本色——
 *   旧版在这儿写成了 while 循环，等于每次踩色一口气连跳 8 次（guard 兜底），比真规则多飞一大截。
 * ★起飞落在正门（本色格）不触发跳，只撞子。
 */
function settle(st, player, planeIdx, viaTakeoff, path) {
  /* ★2026-08-24 23:22 她：走5到黄格该逐格走完再跳4，但前端只拿到起点和跳完的终点、9格差被判成一次跳，把逐格走那段吞了。
     现在把每一跳/飞记进 path，前端照段分别播（走段逐格、跳/飞段抛物线）。 */
  let pos = player.planes[planeIdx];
  if (pos < 0 || pos >= 100) return;
  knock(st, player, pos);

  /* ★2026-08-25 00:08 她圈图澄清：只有中间四色终点跑道不跳 4；外围 52 格仍按本色跳 4。
     本函数开头已对 pos >= 100 直接 return，所以跑道天然排除；起飞仍由 viaTakeoff 保护。 */
  /* ★8/25 01:05 她圈图定的：「在外围走着走着怎么进跑道了」——跳 4 只在外围跳，
     会越过跑道入口的那次跳不跳（留在原地）。进跑道只能靠骰子走进去。 */
  var _toEntry = (ENTRY[player.color] - pos + RING) % RING;
  if (!viaTakeoff && cellColor(pos) === player.color && pos !== AIRFIELD[player.color] && _toEntry >= 4) {
    var _j1 = pos;
    pos = advance(player.color, pos, 4);
    player.planes[planeIdx] = pos;
    if (path) path.push({ kind: 'jump', from: _j1, to: pos });
    log(st, 'jump', `${player.name} 踩到外围自己的颜色，往前跳 4 格`);
    if (pos >= 100) return;
    knock(st, player, pos);
  }

  // ② 落在本色飞机场 → 直飞 12
  if (pos === AIRFIELD[player.color]) {
    var _f1 = pos;
    pos = advance(player.color, pos, 12);
    player.planes[planeIdx] = pos;
    if (path) path.push({ kind: 'fly', from: _f1, to: pos });
    log(st, 'fly', `${player.name} 落在飞机场，直飞 12 格！`);
    if (pos >= 100) return;
    knock(st, player, pos);

    if (cellColor(pos) === player.color && ((ENTRY[player.color] - pos + RING) % RING) >= 4) {
      var _j2 = pos;
      pos = advance(player.color, pos, 4);
      player.planes[planeIdx] = pos;
      if (path) path.push({ kind: 'jump', from: _j2, to: pos });
      log(st, 'jump', `${player.name} 飞完落在外围自己的颜色，再跳 4 格`);
      if (pos >= 100) return;
      knock(st, player, pos);
    }
  }
}

/* 掷骰之后，列出这一手能动的飞机（返回下标数组） */
function movable(st, player, dice) {
  const out = [];
  const takeoff = (st.config && st.config.takeoff) || [6];
  const canTakeoff = takeoff.indexOf(dice) !== -1;
  player.planes.forEach((pos, i) => {
    if (pos === 999) return;                          // 已到终点
    if (pos === -1) { if (canTakeoff) out.push(i); return; }   // 机库：1 走小门 6 走正门
    out.push(i);                                      // 场上的飞机都能走
  });
  return out;
}

/* ── 对外动作 ── */
function actRoll(st, playerId) {
  if (st.phase !== 'awaiting_roll') throw new Error('现在不是掷骰子的时候');
  const p = cur(st);
  if (p.id !== playerId) throw new Error('还没轮到你');
  const d = 1 + Math.floor(Math.random() * 6);
  st.dice = d; st.seq += 1;
  log(st, 'roll', `${p.name} 掷出 ${d}`);
  const can = movable(st, p, d);
  if (!can.length) {
    log(st, 'pass', `${p.name} 这一手没有能动的飞机，轮空`);
    endTurn(st, d === 6);
    return { state: st, movable: [] };
  }
  st.phase = 'awaiting_move';
  return { state: st, movable: can };
}

function actMove(st, playerId, planeIdx) {
  if (st.phase !== 'awaiting_move') throw new Error('现在不是走棋的时候');
  const p = cur(st);
  if (p.id !== playerId) throw new Error('还没轮到你');
  const can = movable(st, p, st.dice);
  if (!can.includes(planeIdx)) throw new Error('这架飞机现在动不了');

  let takeoff = false;
  var _startPos = p.planes[planeIdx];
  var _path = [];
  if (p.planes[planeIdx] === -1) {
    takeoff = true;
    /* 掷 6 走正门、掷 1 走小门（落在斜三角本身），她定的 */
    if (st.dice === 1) {
      p.planes[planeIdx] = SMALL_GATE[p.color];
      log(st, 'takeoff', `${p.name} 掷出 1，从小门出来一架`);
    } else {
      p.planes[planeIdx] = START[p.color];
      log(st, 'takeoff', `${p.name} 掷出 6，从正门出来一架`);
    }
    _path.push({ kind: 'spawn', from: -1, to: p.planes[planeIdx] });
  } else {
    p.planes[planeIdx] = advance(p.color, p.planes[planeIdx], st.dice);
    log(st, 'move', `${p.name} 走了 ${st.dice} 步`);
    /* 把骰子步数一起交给前端：进终点跑道和超过终点后回退，不能只靠起终点猜路径。 */
    _path.push({ kind: 'walk', from: _startPos, to: p.planes[planeIdx], steps: st.dice });
  }
  /* ★8/25 01:10 她定的叠机：自己几架落在同一格就叠成一摞，一个骰子一起走（跳/飞也跟着）；
     别人一架踩上来整摞回机库（knock 本来就清整格，「一架也能撞」是她选的）。 */
  const _mates = (!takeoff && _startPos >= 0 && _startPos !== 999)
    ? p.planes.map((q, j) => (j !== planeIdx && q === _startPos) ? j : -1).filter(j => j >= 0) : [];
  settle(st, p, planeIdx, takeoff, _path);
  if (_mates.length) {
    _mates.forEach(j => { p.planes[j] = p.planes[planeIdx]; });
    log(st, 'stack', `${p.name} 叠着的 ${_mates.length + 1} 架一起走`);
  }
  st.lastPath = { seq: st.seq, pid: p.id, idx: planeIdx, segments: _path };

  if (p.planes[planeIdx] === 999) {
    p.finished += 1 + _mates.length;
    log(st, 'home', `${p.name} 有${_mates.length ? ' ' + (_mates.length + 1) + ' ' : '一'}架到终点了（${p.finished}/4）`);
    if (p.finished >= PLANES) {
      const rank = recordPlayerFinish(st, p);
      /* ★2026-08-25 00:35 她定的：「人多的话，直到最后一个人才结束」——只剩最后一个人没到家就收局，
         那位自动排最后一名；两人局＝一人到家立刻结束，不用等另一个慢慢走完。 */
      const remaining = st.players.filter(x => !playerDone(x));
      if (remaining.length <= 1) {
        remaining.forEach(x => recordLastPlace(st, x));
        st.seq += 1;
        finishGame(st);
        return { state: st };
      }
      log(st, 'continue', `${p.name} 已获得第 ${rank} 名，其他玩家继续`);
    }
  }
  st.seq += 1;
  /* 已完成玩家即使最后一手掷出 6，也不再获得额外回合。 */
  endTurn(st, st.dice === 6 && !playerDone(p));
  return { state: st };
}

function endTurn(st, rolledSix) {
  if (st.phase === 'game_over') return;
  if (rolledSix) {                       // 她定的：掷 6 可以再来一次
    st.doubleSix += 1;
    if (st.doubleSix >= 3) {             // 连三个 6 收手，防一个人无限掷
      log(st, 'turn', `连着三个 6，这轮到此为止`);
      st.doubleSix = 0;
    } else {
      st.phase = 'awaiting_roll'; st.dice = null;
      log(st, 'turn', `掷出 6，再来一次`);
      return;
    }
  } else st.doubleSix = 0;
  /* 已经四架到家的玩家退出回合轮转，其他人一直玩到最后一位。 */
  let checked = 0;
  do {
    st.currentIndex = (st.currentIndex + 1) % st.players.length;
    checked += 1;
  } while (checked < st.players.length && playerDone(cur(st)));
  if (checked >= st.players.length && playerDone(cur(st))) {
    finishGame(st);
    return;
  }
  st.currentPlayer = cur(st).id;
  st.phase = 'awaiting_roll'; st.dice = null;
  log(st, 'turn', `轮到 ${cur(st).name}`);
}

/* ── 给 server.cjs 用的兼容层 ──
   monopoly 的 server 调的是 createGame(opts) 和 apply(state, playerId, action)，
   照抄过来的服务端不改，这里补两个同名函数转发过去。 */
function createGame(opts) {
  const seats = (opts && opts.players) || [];
  return createState(seats.map((s, i) => ({
    id: s.playerId || s.id,
    name: s.name,
    color: s.color && COLORS.indexOf(s.color) !== -1 ? s.color : COLORS[i % 4]
  })));
}

function apply(state, playerId, action) {
  const act = (typeof action === 'string') ? { type: action } : (action || {});
  const before = state.log.length;
  let out;
  if (act.type === 'roll') out = actRoll(state, playerId);
  else if (act.type === 'move') out = actMove(state, playerId, Number(act.plane));
  else throw new Error(`未知动作：${act.type || '(空)'}`);
  return { state: out.state, movable: out.movable, events: state.log.slice(before) };
}

module.exports = { COLORS, RING, HOME_LEN, PLANES, START, GATE_CELL, PAD_GATE, PAD_SMALL, PAD_BASE, SMALL_GATE, ENTRY, AIRFIELD, BOARD, cellColor,
                   createGame, apply,
                   createState, advance, cur, log, settle, movable, actRoll, actMove, endTurn,
                   playerDone, recordPlayerFinish, finishGame };
