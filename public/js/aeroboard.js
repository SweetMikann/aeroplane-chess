/* Bisca 飞行棋 —— 棋盘渲染（SVG）
 * v2: 海洋风重绘——照她甩来的参考图，加了海草/水母/泡泡/珊瑚/海星装饰，基地画成海绵宝宝风
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* 52 格外圈：沿用服务器规则索引，只把几何还原成中国飞行棋的八边形路线。 */
  var RING = [
    [92,292,"blue"],[150,275,"green"],[200,275,"red"],[258,292,"yellow"],[292,258,"blue"],
    [275,200,"green"],[275,150,"red"],[292,92,"yellow"],[350,75,"blue"],[400,75,"green"],
    [450,75,"red"],[500,75,"yellow"],[550,75,"blue"],[608,92,"green"],[625,150,"red"],
    [625,200,"yellow"],[608,258,"blue"],[642,292,"green"],[700,275,"red"],[750,275,"yellow"],
    [808,292,"blue"],[825,350,"green"],[825,400,"red"],[825,450,"yellow"],[825,500,"blue"],
    [825,550,"green"],[808,608,"red"],[750,625,"yellow"],[700,625,"blue"],[642,608,"green"],
    [608,642,"red"],[625,700,"yellow"],[625,750,"blue"],[608,808,"green"],[550,825,"red"],
    [500,825,"yellow"],[450,825,"blue"],[400,825,"green"],[350,825,"red"],[292,808,"yellow"],
    [275,750,"blue"],[275,700,"green"],[292,642,"red"],[258,608,"yellow"],[200,625,"blue"],
    [150,625,"green"],[92,608,"red"],[75,550,"yellow"],[75,500,"blue"],[75,450,"green"],
    [75,400,"red"],[75,350,"yellow"]
  ];
  /* 四色终点跑道，各 6 格。 */
  var RUN = {
    red: [[450,150],[450,200],[450,250],[450,300],[450,350],[450,400]],
    blue: [[450,750],[450,700],[450,650],[450,600],[450,550],[450,500]],
    green: [[150,450],[200,450],[250,450],[300,450],[350,450],[400,450]],
    yellow: [[750,450],[700,450],[650,450],[600,450],[550,450],[500,450]]
  };
  var GATE = { green: 1, red: 14, yellow: 27, blue: 40 };   /* 本色正门格：只用来算跑道入口(−4) */
  /* 8/25 她定的：起飞落在门口空白位，编号=正门格−2，走 2 正好踩到正门格跳 4 */
  var TAKEOFF = { green: 51, red: 12, yellow: 25, blue: 38 };   /* 正门空白位的基准格：走 n 落 TAKEOFF+n */
  var PAD_GATE = -2, PAD_SMALL = -3;
  function padBase(color, pos) { return pos === PAD_GATE ? TAKEOFF[color] : pos === PAD_SMALL ? SMALL[color] : pos; }
  /* ★2026-08-24 23:10 她：「从小门出来，前面还有两个格子」「直接就跳到第三个格子里了」——
     小门三角画在八边形外角（33 号旁边），引擎却把小门记成 29（斜边顶端），走两步落到的是三角往前第三格。
     23:30 她再数：三角在板子外面，进板子第一格就是角格，走 5 该落角格往前第 5 格——
     所以小门＝角格前一格（6/19/32/45），引擎 board.json 同步改了，画面和棋步一致。 */
  var SMALL = { green: 6, red: 19, yellow: 32, blue: 45 };
  /* 小门和正门是外环之外的独立方格，不占用 52 格外环。 */
  var START_PADS = {
    green:  { gate: [50,250],  small: [250,50] },
    red:    { gate: [650,50], small: [850,250] },
    yellow: { gate: [850,650], small: [650,850] },
    blue:   { gate: [250,850], small: [50,650] }
  };
  var AIR = { green: 17, red: 30, yellow: 43, blue: 4 };
  var FLY_TO = { green: 29, red: 42, yellow: 3, blue: 16 };
  var COLORS = ['red', 'yellow', 'blue', 'green'];

  var HEX = { red: '#ef5350', yellow: '#f6c945', blue: '#41a7f5', green: '#58c26a' };
  var HEX_DARK = { red: '#b73530', yellow: '#c79a1f', blue: '#2679c4', green: '#35914a' };
  var HEX_LIGHT = { red: '#ff8a80', yellow: '#fff176', blue: '#81d4fa', green: '#a5d6a7' };
  var CREAM = '#fdf6dc';
  var C = 450;

  var BASES = {
    green:  { ox: 10,  oy: 22 },
    red:    { ox: 690, oy: 22 },
    blue:   { ox: 10,  oy: 678 },
    yellow: { ox: 690, oy: 678 }
  };
  var BASE_PADS = [[64, 64], [136, 64], [64, 136], [136, 136]];

  function posXY(color, pos, planeIdx) {
    /* 起飞时棋子停在基地旁的空白位置；这里没有任何静态方格。 */
    /* 8/25 她定的：门口空白位是独立位置码（-2 正门 / -3 小门），不再借用环编号 */
    if (pos === PAD_GATE) return START_PADS[color].gate;
    if (pos === PAD_SMALL) return START_PADS[color].small;
    if (pos >= 0 && pos < 52) return [RING[pos][0], RING[pos][1]];
    if (pos >= 100 && pos < 999) return RUN[color][pos - 100];
    if (pos === 999) {
      /* 到家后飞回自己基地的原棋位；皇冠和名次负责与未起飞棋子区分。 */
      var homeBase = BASES[color];
      var homePad = BASE_PADS[planeIdx % 4];
      return [homeBase.ox + homePad[0], homeBase.oy + homePad[1]];
    }
    var b = BASES[color];
    var f = BASE_PADS[planeIdx % 4];
    return [b.ox + f[0], b.oy + f[1]];
  }

  /* 服务器只给每颗棋子的最终位置；在本页内记住四颗棋子到家的先后。 */
  function reconcileFinishRanks(state, previous) {
    var before = previous || {};
    var next = {};
    if (!state || !state.players) return next;
    state.players.forEach(function (p) {
      var used = {};
      p.planes.forEach(function (pos, i) {
        var key = p.id + ':' + i;
        var rank = Number(before[key]);
        if (pos === 999 && rank >= 1 && rank <= 4 && !used[rank]) {
          next[key] = rank;
          used[rank] = true;
        }
      });
      p.planes.forEach(function (pos, i) {
        var key = p.id + ':' + i;
        if (pos !== 999 || next[key]) return;
        var rank = 1;
        while (used[rank] && rank <= 4) rank++;
        next[key] = rank;
        used[rank] = true;
      });
    });
    return next;
  }

  function homeCrownSVG(rank) {
    return '<g class="aero-home-crown" aria-label="第' + rank + '架到家">' +
      '<path d="M-12 -19 L-10 -32 L-4 -25 L0 -35 L5 -25 L11 -32 L12 -19 Z" ' +
        'fill="#ffd54f" stroke="#7a5410" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<rect x="-12" y="-21" width="24" height="6" rx="2.5" fill="#f4b933" stroke="#7a5410" stroke-width="1.5"/>' +
      '<circle class="aero-finish-rank" cx="12" cy="12" r="8.5" fill="#fff8dc" stroke="#7a5410" stroke-width="2"/>' +
      '<text x="12" y="15.2" text-anchor="middle" font-size="9.5" font-weight="900" fill="#7a5410">' + rank + '</text>' +
      '</g>';
  }

  function playerFinishOrder(state) {
    if (!state || !state.players) return [];
    if (Array.isArray(state.finishOrder)) return state.finishOrder.slice();
    return state.players.filter(function (player) { return player.rank != null; })
      .sort(function (a, b) { return a.rank - b.rank; })
      .map(function (player) { return player.id; });
  }

  function playerById(state, id) {
    if (!state || !state.players) return null;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  /* 她 8/25 定的：卡片/榜单上不要 emoji 皇冠，用画的。跟棋盘上到家皇冠同一副轮廓；
     1 名金、2 名银、3 名铜、4 名灰。 */
  var CROWN_FILL = { 1: ['#ffd54f', '#f4b933', '#7a5410'], 2: ['#e6e9f0', '#c3c9d6', '#5b6270'],
                     3: ['#e0a370', '#c9895a', '#5e3a1c'], 4: ['#cfd2d8', '#b6bac2', '#5e6168'] };
  function crownIconHTML(rank, size) {
    var f = CROWN_FILL[rank] || CROWN_FILL[4];
    return '<svg class="aero-crown-ic" width="' + size + '" height="' + size + '" viewBox="-14 -37 28 24" aria-hidden="true" ' +
      'style="vertical-align:-2px;margin-right:2px">' +
      '<path d="M-12 -19 L-10 -32 L-4 -25 L0 -35 L5 -25 L11 -32 L12 -19 Z" fill="' + f[0] + '" stroke="' + f[2] +
        '" stroke-width="2" stroke-linejoin="round"/>' +
      '<rect x="-12" y="-21" width="24" height="6" rx="2.5" fill="' + f[1] + '" stroke="' + f[2] + '" stroke-width="1.8"/>' +
      '</svg>';
  }

  global.__aeroCrownIconHTML = crownIconHTML;

  function updatePlayerRankCards(state) {
    if (typeof document === 'undefined') return;
    var cards = document.querySelectorAll('#r-players .pl-card');
    Array.prototype.forEach.call(cards, function (card, index) {
      var player = state.players[index];
      var cash = card.querySelector('.cash');
      if (!player || !cash) return;
      if (player.rank != null) {
        card.classList.add('is-finished');
        cash.innerHTML = crownIconHTML(player.rank, 16) + '第 ' + Number(player.rank) + ' 名 · 已完成';
      } else {
        card.classList.remove('is-finished');
      }
    });
  }

  /* ── 海洋装饰 SVG 片段 ── */

  function seaweed(x, y, h, color, flip) {
    var sc = flip ? -1 : 1;
    var c1x = x + sc * 12, c1y = y - h * 0.35;
    var c2x = x - sc * 8, c2y = y - h * 0.7;
    var top = y - h;
    return '<path d="M' + x + ' ' + y +
      ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + (x + sc * 3) + ' ' + top + '"' +
      ' fill="none" stroke="' + color + '" stroke-width="5" stroke-linecap="round" opacity=".7"/>' +
      '<ellipse cx="' + (x + sc * 3) + '" cy="' + top + '" rx="4" ry="6" fill="' + color + '" opacity=".5"/>';
  }

  function seaweedClump(x, y, h) {
    return seaweed(x - 6, y, h, '#2e8b57', false) +
      seaweed(x + 6, y, h * 0.8, '#3cb371', true) +
      seaweed(x, y, h * 0.65, '#20b2aa', false);
  }

  function bubble(x, y, r) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="#a8e0ff" stroke-width="1" opacity=".6"/>' +
      '<circle cx="' + (x - r * 0.3) + '" cy="' + (y - r * 0.3) + '" r="' + (r * 0.2) + '" fill="#fff" opacity=".7"/>';
  }

  function jellyfish(x, y, color, size) {
    var s = size || 1;
    var r = 16 * s;
    var bodyColor = color || '#ff9ec6';
    var tentColor = color === '#a8e6cf' ? '#6ec898' : '#f472b6';
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')" opacity=".75">' +
      '<ellipse cx="0" cy="0" rx="' + 16 + '" ry="' + 13 + '" fill="' + bodyColor + '"/>' +
      '<ellipse cx="0" cy="0" rx="' + 13 + '" ry="' + 10 + '" fill="#fff" opacity=".3"/>' +
      '<path d="M-12 5 Q-14 18 -10 24" fill="none" stroke="' + tentColor + '" stroke-width="2" stroke-linecap="round" opacity=".6"/>' +
      '<path d="M-4 8 Q-6 22 -2 28" fill="none" stroke="' + tentColor + '" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' +
      '<path d="M4 8 Q6 22 2 28" fill="none" stroke="' + tentColor + '" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>' +
      '<path d="M12 5 Q14 18 10 24" fill="none" stroke="' + tentColor + '" stroke-width="2" stroke-linecap="round" opacity=".6"/>' +
      '<circle cx="-5" cy="-2" r="2" fill="#333" opacity=".5"/>' +
      '<circle cx="5" cy="-2" r="2" fill="#333" opacity=".5"/>' +
      '</g>';
  }

  function starfish(x, y, color, size) {
    var s = size || 1;
    var pts = [];
    for (var i = 0; i < 5; i++) {
      var aOuter = (i * 72 - 90) * Math.PI / 180;
      var aInner = ((i * 72) + 36 - 90) * Math.PI / 180;
      pts.push((Math.cos(aOuter) * 14 * s).toFixed(1) + ',' + (Math.sin(aOuter) * 14 * s).toFixed(1));
      pts.push((Math.cos(aInner) * 6 * s).toFixed(1) + ',' + (Math.sin(aInner) * 6 * s).toFixed(1));
    }
    return '<g transform="translate(' + x + ',' + y + ')">' +
      '<polygon points="' + pts.join(' ') + '" fill="' + (color || '#ffa726') + '" stroke="#e65100" stroke-width="1.5" stroke-linejoin="round" opacity=".8"/>' +
      '<circle cx="0" cy="0" r="' + (3 * s) + '" fill="#ffcc80" opacity=".6"/>' +
      '</g>';
  }

  function coral(x, y, color, size) {
    var s = size || 1;
    var c = color || '#ff7043';
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')" opacity=".65">' +
      '<path d="M0 0 Q-3 -12 -8 -20 Q-12 -26 -8 -30" fill="none" stroke="' + c + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M0 0 Q2 -14 0 -24 Q-1 -30 2 -34" fill="none" stroke="' + c + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M0 0 Q5 -10 10 -18 Q14 -24 12 -28" fill="none" stroke="' + c + '" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="-8" cy="-30" r="3" fill="' + c + '"/>' +
      '<circle cx="2" cy="-34" r="3" fill="' + c + '"/>' +
      '<circle cx="12" cy="-28" r="3" fill="' + c + '"/>' +
      '</g>';
  }

  function flower(x, y, petalColor, centerColor, size) {
    var s = size || 1;
    var petals = '';
    for (var i = 0; i < 6; i++) {
      var a = i * 60 * Math.PI / 180;
      var px = Math.cos(a) * 8 * s, py = Math.sin(a) * 8 * s;
      petals += '<ellipse cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" rx="' + (6 * s) + '" ry="' + (4 * s) + '" ' +
        'fill="' + petalColor + '" transform="rotate(' + (i * 60) + ' ' + px.toFixed(1) + ' ' + py.toFixed(1) + ')" opacity=".8"/>';
    }
    return '<g transform="translate(' + x + ',' + y + ')">' +
      petals +
      '<circle cx="0" cy="0" r="' + (4 * s) + '" fill="' + (centerColor || '#fff176') + '"/>' +
      '</g>';
  }

  /* ── 静态棋盘 ── */

  var CELL = 50;

  function cellAngle(i) {
    var p = RING[(i + 51) % 52], n = RING[(i + 1) % 52], me = RING[i];
    var a = Math.atan2(me[1] - p[1], me[0] - p[0]);
    var b = Math.atan2(n[1] - me[1], n[0] - me[0]);
    var d = Math.abs(a - b) % Math.PI;
    if (d < 0.2 || d > Math.PI - 0.2) return 0;
    var raw = Math.atan2(n[1] - p[1], n[0] - p[0]) * 180 / Math.PI;
    var snap = Math.round(raw / 45) * 45;
    return ((snap % 180) + 180) % 180 === 0 || Math.abs(snap % 180) === 90 ? 0 : snap;
  }

  /* 只定义左上象限的四种转角，其余三象限严格绕棋盘中心旋转生成。
     这样三角格外框和 RING 圆心永远使用同一个旋转关系，不会再出现底部圆心跑到斜线上。 */
  function rotateTurn(points, quarterTurns) {
    return points.map(function (point) {
      var x = point[0], y = point[1];
      for (var q = 0; q < quarterTurns; q++) {
        var nextX = 900 - y;
        y = x;
        x = nextX;
      }
      return [x, y];
    });
  }
  var TURN_SEEDS = {
    0: [[25,325],[125,225],[125,325]],
    3: [[225,225],[225,325],[325,325]],
    4: [[225,225],[325,225],[325,325]],
    7: [[225,125],[325,25],[325,125]]
  };
  var TURN_CELLS = {};
  for (var tq = 0; tq < 4; tq++) {
    Object.keys(TURN_SEEDS).forEach(function (seedIndex) {
      var index = (Number(seedIndex) + tq * 13) % 52;
      TURN_CELLS[index] = rotateTurn(TURN_SEEDS[seedIndex], tq);
    });
  }

  function buildStatic() {
    var s = '';

    function planeMark(x, y, color) {
      /* 参考 P2 的彩色飞机剪影：不用字体，保证各平台都收在落点圆内。 */
      /* 机头沿四色跳飞虚线：蓝右、绿下、红左、黄上。 */
      var angle = { blue: 0, green: 90, red: 180, yellow: -90 }[color] || 0;
      return '<g class="aero-air-mark" transform="translate(' + x + ' ' + y + ') rotate(' + angle + ')" aria-hidden="true">' +
        '<path d="M-10 -2 L-3 -2 L1 -9 L4 -9 L3 -2 L10 0 L3 2 L4 9 L1 9 L-3 2 L-10 2 Z" ' +
        'fill="' + HEX_DARK[color] + '"/></g>';
    }

    /* defs：渐变、marker、滤镜 */
    s += '<defs>';
    s += '<radialGradient id="sea" cx="50%" cy="40%" r="72%">' +
      '<stop offset="0%" stop-color="#e8f8ff"/>' +
      '<stop offset="50%" stop-color="#c5ecfa"/>' +
      '<stop offset="100%" stop-color="#a2d9f0"/>' +
      '</radialGradient>';
    s += '<radialGradient id="sea-deep" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="#b3e5fc" stop-opacity="0"/>' +
      '<stop offset="100%" stop-color="#4fc3f7" stop-opacity=".15"/>' +
      '</radialGradient>';
    for (var ci = 0; ci < 4; ci++) {
      var cc = COLORS[ci];
      s += '<marker id="arr-' + cc + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
        '<path d="M0 0 L10 5 L0 10 z" fill="' + HEX_DARK[cc] + '"/></marker>';
    }
    s += '</defs>';

    /* 棋盘本体使用透明背景；海洋装饰代码保留但不挂载。 */
    var deco = '';

    /* 海草 —— 四个角落附近和边缘 */
    deco += seaweedClump(55, 880, 55);
    deco += seaweedClump(845, 880, 48);
    deco += seaweedClump(845, 20, 40);
    deco += seaweedClump(55, 20, 42);
    deco += seaweedClump(450, 878, 38);
    deco += seaweedClump(450, 22, 35);
    deco += seaweed(15, 450, 45, '#2e8b57', false);
    deco += seaweed(885, 450, 45, '#3cb371', true);

    /* 珊瑚 */
    deco += coral(380, 878, '#ff7043', 0.9);
    deco += coral(520, 878, '#e91e63', 0.8);
    deco += coral(380, 22, '#ff5722', 0.7);
    deco += coral(520, 22, '#f06292', 0.75);

    /* 海星 */
    deco += starfish(30, 470, '#ffa726', 1.0);
    deco += starfish(870, 430, '#ff8a65', 0.9);
    deco += starfish(448, 14, '#ffb74d', 0.7);

    /* 水母（底层，半透明） */
    deco += jellyfish(340, 170, '#ff9ec6', 0.7);
    deco += jellyfish(560, 170, '#a8e6cf', 0.65);
    deco += jellyfish(340, 730, '#a8e6cf', 0.75);
    deco += jellyfish(560, 730, '#ff9ec6', 0.7);
    deco += jellyfish(170, 340, '#ffb7d5', 0.55);
    deco += jellyfish(730, 560, '#b2ebf2', 0.6);

    /* 泡泡 */
    var bubbles = [[180,160,5],[220,180,3],[740,160,4],[760,190,3],
      [180,720,4],[220,750,3],[740,720,5],[770,740,3],
      [420,160,3],[480,730,4],[160,420,3],[740,480,3],
      [330,330,3],[570,330,4],[330,570,3],[570,570,4],
      [60,300,4],[840,600,3],[300,60,3],[600,840,4],
      [155,550,2.5],[745,350,2.5],[350,155,2.5],[550,745,2.5]];
    for (var bi = 0; bi < bubbles.length; bi++) {
      deco += bubble(bubbles[bi][0], bubbles[bi][1], bubbles[bi][2]);
    }

    /* 花朵（跑道两侧） */
    deco += flower(370, 450, '#ffab91', '#fff176', 0.9);
    deco += flower(530, 450, '#ce93d8', '#fff9c4', 0.85);
    deco += flower(450, 370, '#81d4fa', '#fff176', 0.85);
    deco += flower(450, 530, '#a5d6a7', '#fff9c4', 0.9);

    /* ── 飞行捷径虚线 ── */
    for (var fi = 0; fi < 4; fi++) {
      var fc = COLORS[fi];
      var a = RING[AIR[fc]], z = RING[FLY_TO[fc]];
      s += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + z[0] + '" y2="' + z[1] +
        '" stroke="' + HEX_DARK[fc] + '" stroke-width="6" stroke-dasharray="13 11" ' +
        'stroke-linecap="round" opacity=".85" marker-end="url(#arr-' + fc + ')"/>';
    }

    /* ── 终点跑道 ── */
    var runCells = '';
    var runDots = '';
    for (var hc in RUN) {
      for (var hj = 0; hj < 6; hj++) {
        var h = RUN[hc][hj];
        var rw = 50, rh = 50;
        if (hj < 5) {
          runCells += '<rect class="aero-run-cell" x="' + (h[0] - rw / 2) + '" y="' + (h[1] - rh / 2) + '" width="' + rw +
            '" height="' + rh + '" fill="' + HEX[hc] + '" stroke="#22222a" stroke-width="3"/>' +
            '<circle cx="' + h[0] + '" cy="' + h[1] + '" r="15.5" fill="' + CREAM +
            '" stroke="#22222a" stroke-width="2.5"/>';
        } else {
          runDots += '<circle cx="' + h[0] + '" cy="' + h[1] + '" r="15.5" fill="' + CREAM +
            '" stroke="#22222a" stroke-width="2.5"/>';
        }
      }
    }
    s += runCells;

    /* ── 中心四色三角 ── */
    var R2 = 75;
    var tri = function (color, p1, p2) {
      return '<path d="M' + C + ' ' + C + ' L' + p1.join(' ') + ' L' + p2.join(' ') + ' z" ' +
        'fill="' + HEX[color] + '" stroke="#22222a" stroke-width="3" stroke-linejoin="round"/>';
    };
    s += '<rect class="aero-center-cell" x="' + (C - R2) + '" y="' + (C - R2) + '" width="' + (R2 * 2) + '" height="' + (R2 * 2) +
      '" fill="' + CREAM + '" stroke="#22222a" stroke-width="3"/>';
    s += tri('green',  [C - R2, C - R2], [C - R2, C + R2]);
    s += tri('red',    [C - R2, C - R2], [C + R2, C - R2]);
    s += tri('yellow', [C + R2, C - R2], [C + R2, C + R2]);
    s += tri('blue',   [C - R2, C + R2], [C + R2, C + R2]);
    s += runDots;
    s += '<line class="aero-center-divider" x1="' + (C - R2) + '" y1="' + (C - R2) + '" x2="' + (C + R2) + '" y2="' + (C + R2) +
      '" stroke="#22222a" stroke-width="3"/>' +
      '<line x1="' + (C + R2) + '" y1="' + (C - R2) + '" x2="' + (C - R2) + '" y2="' + (C + R2) +
      '" class="aero-center-divider" stroke="#22222a" stroke-width="3"/>';

    /* ── 外圈 52 格：直线格连续拼接，八个转角按参考棋盘切成斜边/三角格 ── */
    var straight = '', turnCells = '', dots = '', marks = '';
    for (var i = 0; i < 52; i++) {
      var x = RING[i][0], y = RING[i][1], col = RING[i][2];
      if (TURN_CELLS[i]) {
        turnCells += '<polygon class="aero-turn-cell" points="' + TURN_CELLS[i].map(function (p) { return p.join(','); }).join(' ') +
          '" fill="' + HEX[col] + '" stroke="#22222a" stroke-width="3" stroke-linejoin="round"/>';
      } else {
        var p2 = RING[(i + 51) % 52], n2 = RING[(i + 1) % 52];
        var horiz = Math.abs(n2[0] - p2[0]) >= Math.abs(n2[1] - p2[1]);
        /* P1 的外环是一条两格宽的连续带：顺路方向 1 格，横向 2 格。 */
        var w = horiz ? 52 : 100, hh = horiz ? 100 : 52;
        straight += '<rect x="' + (x - w / 2) + '" y="' + (y - hh / 2) + '" width="' + w +
          '" height="' + hh + '" fill="' + HEX[col] + '" stroke="#22222a" stroke-width="3"/>';
      }
      dots += '<circle cx="' + x + '" cy="' + y + '" r="15.5" fill="' + CREAM +
        '" stroke="#22222a" stroke-width="2.5"/>';
      for (var airColor in AIR) {
        if (i === AIR[airColor]) marks += planeMark(x, y, airColor);
      }
    }
    s += straight + turnCells + dots + marks;

    /* ── 四角基地：海绵宝宝风格 ── */
    var HOLE = { red: '#c62828', yellow: '#c79a1f', blue: '#1e6db3', green: '#2e7d32' };
    var HOLE_LIGHT = { red: '#ff8a80', yellow: '#ffe082', blue: '#82b1ff', green: '#81c784' };
    for (var bc in BASES) {
      var bb = BASES[bc];
      var g = '<g transform="translate(' + bb.ox + ',' + bb.oy + ')">';

      /* 四角基地保持澄澄原来的海绵手绘造型。 */
      g += '<path d="' +
        'M30 8 Q60 2 100 2 Q140 2 170 8 ' +
        'Q195 14 196 40 Q200 70 196 100 ' +
        'Q200 130 196 160 Q195 186 170 192 ' +
        'Q140 198 100 198 Q60 198 30 192 ' +
        'Q5 186 4 160 Q0 130 4 100 ' +
        'Q0 70 4 40 Q5 14 30 8 Z" ' +
        'fill="' + HEX[bc] + '" stroke="#22222a" stroke-width="4" stroke-linejoin="round"/>';

      /* 高光 */
      g += '<path d="M40 14 Q100 6 160 14 Q186 20 188 44 Q192 70 188 96 ' +
        'Q184 60 100 50 Q40 55 20 80 Q10 50 14 40 Q16 20 40 14 Z" ' +
        'fill="' + HEX_LIGHT[bc] + '" opacity=".3"/>';

      /* 海绵气泡洞（装饰性小坑） */
      var holes = [[36, 96, 7], [96, 28, 6], [164, 100, 7], [100, 172, 6], [164, 36, 5],
        [38, 38, 4], [160, 160, 4], [100, 100, 5], [38, 160, 4], [160, 38, 4]];
      holes.forEach(function (h) {
        g += '<circle cx="' + h[0] + '" cy="' + h[1] + '" r="' + h[2] +
          '" fill="' + HOLE[bc] + '" opacity=".35"/>' +
          '<circle cx="' + (h[0] - h[2] * 0.3) + '" cy="' + (h[1] - h[2] * 0.3) +
          '" r="' + (h[2] * 0.25) + '" fill="' + HOLE_LIGHT[bc] + '" opacity=".4"/>';
      });

      /* 停机圆圈 */
      BASE_PADS.forEach(function (f) {
        g += '<circle cx="' + f[0] + '" cy="' + f[1] + '" r="24" fill="' + CREAM +
          '" stroke="#22222a" stroke-width="3"/>';
      });

      /* 高光泡泡 */
      g += '<circle cx="172" cy="162" r="5" fill="#fff" opacity=".55"/>' +
        '<circle cx="180" cy="150" r="3" fill="#fff" opacity=".5"/>' +
        '<circle cx="28" cy="30" r="4" fill="#fff" opacity=".4"/>' +
        '<circle cx="20" cy="170" r="3.5" fill="#fff" opacity=".35"/>';

      s += g + '</g>';
    }

    return s;
  }

  /* ── 棋子 ── */

  function faceSVG(color) {
    if (color === 'yellow') {
      return '<rect x="-9.5" y="-9.5" width="19" height="19" rx="4.5" fill="#ffe24d" stroke="#8a6d00" stroke-width="1.5"/>' +
        '<circle cx="-4" cy="-2.6" r="3.7" fill="#fff" stroke="#8a6d00" stroke-width="0.9"/>' +
        '<circle cx="4" cy="-2.6" r="3.7" fill="#fff" stroke="#8a6d00" stroke-width="0.9"/>' +
        '<circle cx="-3.5" cy="-2.1" r="1.7" fill="#2b6cb0"/><circle cx="4.4" cy="-2.1" r="1.7" fill="#2b6cb0"/>' +
        '<path d="M-4.4 4.4 Q0 7.9 4.4 4.4" fill="none" stroke="#8a6d00" stroke-width="1.5" stroke-linecap="round"/>';
    }
    if (color === 'red') {
      return '<circle cx="0" cy="1.3" r="8.8" fill="#ff6f61" stroke="#8f231b" stroke-width="1.5"/>' +
        '<line x1="-4" y1="-6" x2="-4" y2="-9.7" stroke="#8f231b" stroke-width="1.5"/>' +
        '<line x1="4" y1="-6" x2="4" y2="-9.7" stroke="#8f231b" stroke-width="1.5"/>' +
        '<circle cx="-4" cy="-9.7" r="2.6" fill="#fff" stroke="#8f231b" stroke-width="1"/>' +
        '<circle cx="4" cy="-9.7" r="2.6" fill="#fff" stroke="#8f231b" stroke-width="1"/>' +
        '<circle cx="-4" cy="-9.7" r="1.1" fill="#222"/><circle cx="4" cy="-9.7" r="1.1" fill="#222"/>' +
        '<path d="M-3.5 4.4 Q0 7 3.5 4.4" fill="none" stroke="#8f231b" stroke-width="1.4" stroke-linecap="round"/>' +
        '<path d="M-8.8 -1.8 q-3.5 -2.6 -2.6 -5.3" fill="none" stroke="#8f231b" stroke-width="1.5" stroke-linecap="round"/>' +
        '<path d="M8.8 -1.8 q3.5 -2.6 2.6 -5.3" fill="none" stroke="#8f231b" stroke-width="1.5" stroke-linecap="round"/>';
    }
    if (color === 'blue') {
      return '<path d="M-8.8 2.6 Q-8.8 -9.7 0 -9.7 Q8.8 -9.7 8.8 2.6 L8.8 7 Q6.2 4.8 4.4 7 Q2.2 4.8 0 7 Q-2.2 4.8 -4.4 7 Q-6.2 4.8 -8.8 7 z" ' +
        'fill="#6fb7e8" stroke="#20567e" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<ellipse cx="-3.5" cy="-1.6" rx="2.7" ry="3.3" fill="#fff" stroke="#20567e" stroke-width="0.9"/>' +
        '<ellipse cx="3.5" cy="-1.6" rx="2.7" ry="3.3" fill="#fff" stroke="#20567e" stroke-width="0.9"/>' +
        '<circle cx="-3.5" cy="-0.5" r="1.3" fill="#222"/><circle cx="3.5" cy="-0.5" r="1.3" fill="#222"/>' +
        '<path d="M-4 -4 L-1.6 -3.2 M4 -4 L1.6 -3.2" stroke="#20567e" stroke-width="1.1" stroke-linecap="round"/>' +
        '<path d="M-2.2 4 Q0 2.8 2.2 4" fill="none" stroke="#20567e" stroke-width="1.3" stroke-linecap="round"/>';
    }
    return '<ellipse cx="0" cy="0" rx="7.5" ry="9.7" fill="#7ed957" stroke="#2e6b1e" stroke-width="1.5"/>' +
      '<circle cx="0" cy="-2.2" r="4" fill="#fff" stroke="#2e6b1e" stroke-width="1.1"/>' +
      '<circle cx="0.5" cy="-1.9" r="1.8" fill="#a33"/><circle cx="0.5" cy="-1.9" r="0.8" fill="#222"/>' +
      '<path d="M-4 -7.5 L3.5 -6" stroke="#2e6b1e" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path d="M-2.6 4.8 Q0 6.6 2.6 4.8" fill="none" stroke="#2e6b1e" stroke-width="1.3" stroke-linecap="round"/>';
  }

  /* ── 实例 ── */

  function init(container, opts) {
    var o = opts || {};
    container.innerHTML =
      '<svg id="aero-svg" viewBox="0 0 900 900" xmlns="http://www.w3.org/2000/svg">' +
      '<g id="aero-static">' + buildStatic() + '</g>' +
      '<g id="aero-planes"></g><g id="aero-celebration"></g></svg>';
    var layer = container.querySelector('#aero-planes');
    layer.addEventListener('click', function (e) {
      var g = e.target.closest('.aero-plane');
      if (g && o.onPlaneClick) o.onPlaneClick(g.dataset.pid, Number(g.dataset.idx));
    });
    return {
      update: function (state, uo) { update(container, state, uo || {}); }
    };
  }

  function update(container, state, uo) {
    var layer = container.querySelector('#aero-planes');
    if (!layer || !state || !state.players) return;

    var hasRendered = !!container.__aeroHasRendered;
    var previousLogLength = container.__aeroLogLength;
    var actionEvents = previousLogLength == null || !Array.isArray(state.log) ? [] : state.log.slice(previousLogLength);
    container.__aeroLogLength = Array.isArray(state.log) ? state.log.length : 0;
    var previousDiceKey = container.__aeroDiceKey;
    var diceKey = state.dice == null ? null : String(state.seq) + ':' + String(state.dice);
    container.__aeroDiceKey = diceKey;
    container.__aeroHasRendered = true;
    if (hasRendered && diceKey && diceKey !== previousDiceKey) playDiceRollAnimation(state.dice, container);

    var occ = {}, cellColors = {}, sameColorCell = {};
    /* 8/25 晚她圈图：门口空白位(-2/-3)上两架同色机完全重叠成"分体"。
       根因＝这里把所有负数位置都排除在归组外。门口位是真实站位，要参与堆叠；
       机库(-1)不算。门口位是各色私有的，键带上色名防串味。 */
    function stackKey(color, pos) { return pos < 0 ? color + '@' + pos : String(pos); }
    state.players.forEach(function (p) {
      p.planes.forEach(function (pos) {
        if (pos === 999) return;
        if (pos < 0 && pos !== PAD_GATE && pos !== PAD_SMALL) return;
        var k = stackKey(p.color, pos);
        occ[k] = (occ[k] || 0) + 1;
        (cellColors[k] = cellColors[k] || {})[p.color] = true;
      });
    });
    Object.keys(occ).forEach(function (k) { sameColorCell[k] = occ[k] > 1 && Object.keys(cellColors[k]).length === 1; });
    var placed = {};

    var previousPositions = container.__aeroPlanePositions || {};
    var currentPositions = {};
    var finishRanks = reconcileFinishRanks(state, container.__aeroFinishRanks);
    var html = '';
    state.players.forEach(function (p) {
      p.planes.forEach(function (pos, i) {
        currentPositions[p.id + ':' + i] = { color: p.color, pos: pos, planeIdx: i };
        var xy = posXY(p.color, pos, i);
        var x = xy[0], y = xy[1];
        var stacked = false, stackTop = false;
        if (pos !== 999 && (pos >= 0 || pos === PAD_GATE || pos === PAD_SMALL)) {
          var k = stackKey(p.color, pos);
          if (occ[k] > 1) {
            var n = (placed[k] = (placed[k] || 0) + 1) - 1;
            if (sameColorCell[k]) {
              /* 8/25 她画了张厚度图：同色同格摞成一叠、有厚度。每架往上垒 9px，
                 最上面那架露脸，底下几架只露出带厚度的侧壁 → 一摞筹码的样子。 */
              y -= n * 9;
              stacked = true; stackTop = (n === occ[k] - 1);
            } else {
              /* 8/25 她圈图：±8 会把第二架挤出格子。收成 ±5/±4，两架叠着还在格内 */
              x += (n % 2 ? 5 : -5); y += (n > 1 ? 4 : -4);
            }
          }
        }
        var mine = uo.movable && p.id === uo.myId && uo.movable.indexOf(i) !== -1;
        var home = pos === 999;
        var finishRank = finishRanks[p.id + ':' + i];
        html += '<g class="aero-plane' + (mine ? ' is-movable' : '') + (home ? ' is-home' : '') + '" ' +
          'data-pid="' + esc(p.id) + '" data-idx="' + i + '" ' +
          'style="transform:translate(' + x + 'px,' + y + 'px)">' +
          '<g class="aero-piece-body">' +
            (mine ? '<circle r="21" class="aero-pulse" fill="none" stroke="#fff" stroke-width="3"/>' : '') +
            /* 叠起来的厚度：先垫一层深色侧壁（圆盘往下 7px），主盘压在上面＝一枚有厚度的筹码 */
            (stacked ? '<path d="M-16.5 0 A16.5 16.5 0 0 0 16.5 0 L16.5 7 A16.5 16.5 0 0 1 -16.5 7 Z" fill="' + (HEX_DARK[p.color] || '#555') + '" stroke="#22222a" stroke-width="2.4"/>' : '') +
            '<circle r="16.5" fill="' + (HEX[p.color] || '#999') + '" stroke="#22222a" stroke-width="2.4"/>' +
            /* ★2026-08-29 17:18 她：「跳的时候上面图标会消失，只剩下一个黄色的」。
               原来这里只给「没叠着、或叠在最上面」那架画脸，底下的只当厚度垫着——
               静止时看不出来（位置完全重合，上面那架盖住下面的），
               可**一跳起来两架就分开了**，露出来的那架没脸，就是一个光秃秃的黄圆盘。
               改成每架都画自己的脸和序号：叠着时照旧只看得到最上面那架，
               跳开时每架都是完整的棋子。 */
              '<circle r="13.5" fill="' + CREAM + '" opacity=".92" stroke="none"/>' +
              '<g>' + faceSVG(p.color) + '</g>' +
              (home ? homeCrownSVG(finishRank || 1) :
                '<circle cx="11" cy="-11" r="5.8" fill="#22222a"/>' +
                '<text x="11" y="-8.2" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">' + (i + 1) + '</text>') +
          '</g>' +
          (false ? '<g class="aero-stack-badge"><rect x="-19" y="6" width="20" height="12" rx="6" fill="#fff8dc" stroke="#22222a" stroke-width="1.4"/>' +
            '<text x="-9" y="15.3" text-anchor="middle" font-size="8.5" font-weight="900" fill="#22222a">×' + stackBadge + '</text></g>' : '') +
          '</g>';
      });
    });
    layer.innerHTML = html;
    container.__aeroPlanePositions = currentPositions;
    container.__aeroFinishRanks = finishRanks;
    updatePlayerRankCards(state);

    var previousPlayerOrder = container.__aeroPlayerFinishOrder || [];
    var currentPlayerOrder = playerFinishOrder(state);
    var newlyFinished = currentPlayerOrder.filter(function (id) { return previousPlayerOrder.indexOf(id) === -1; });
    container.__aeroPlayerFinishOrder = currentPlayerOrder;
    if (state.phase === 'game_over') {
      global.__aeroFinalRanking = currentPlayerOrder.map(function (id, index) {
        var player = playerById(state, id) || {};
        return {
          rank: player.rank != null ? player.rank : index + 1,
          id: id,
          name: player.name || ('玩家 ' + (index + 1)),
          finished: typeof player.finished === 'number' ? player.finished : null,
          color: player.color || ''
        };
      });
    }
    var previousPhase = container.__aeroPhase;
    container.__aeroPhase = state.phase;
    if (state.phase === 'game_over' && previousPhase !== 'game_over') playGameOverAnimation(container, state);
    else if (newlyFinished.length) playPlayerFinishAnimation(container, state, newlyFinished[newlyFinished.length - 1]);

    /* 服务器给的是动作后的最终位置；前端用上一帧补出逐格移动轨迹。 */
    if (!layer.querySelectorAll || typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var lp = state.lastPath;
    var lpKey = lp ? (lp.pid + ':' + lp.idx) : null;
    var lpFresh = !!(lp && lp.segments && lp.segments.length && container.__aeroLastPathSeq !== lp.seq);
    Array.prototype.forEach.call(layer.querySelectorAll('.aero-plane'), function (plane) {
      if (typeof plane.animate !== 'function') return;
      var key = plane.dataset.pid + ':' + plane.dataset.idx;
      var before = previousPositions[key];
      var after = currentPositions[key];
      if (!before || !after) return;
      var hasFreshPath = lpFresh && key === lpKey;
      /* 8/25 晚她报的：叠着跳时其余几架瞬移。同一玩家、起终点与主机完全相同的同伴机，
         认定是同一摞里的，跟主机走同一条 segments 轨迹，一起逐格/抛物线。 */
      var isStackMate = false;
      if (lpFresh && !hasFreshPath && plane.dataset.pid === lp.pid) {
        var lpBefore = previousPositions[lpKey];
        var lpAfter = currentPositions[lpKey];
        if (lpBefore && lpAfter && before.pos === lpBefore.pos && after.pos === lpAfter.pos) isStackMate = true;
      }
      /* 超过终点后可能原路退回同一格；即使起终点相同，也必须按 lastPath 播完整往返。 */
      if (before.pos === after.pos && !hasFreshPath && !isStackMate) return;
      /* 刚动的这架用引擎发来的 segments 分段播（走段逐格 + 跳/飞段抛物线）；同伴机同轨 */
      if (hasFreshPath || isStackMate) {
        var built = buildPathAnimation(lp.segments, after.color, after.planeIdx);
        if (built) {
          var pathAnim = plane.animate(built.frames, { duration: built.duration, easing: 'linear', fill: 'both' });
          /* 8/25 她：「每次都会有位移」——动画停在最后一帧会盖住静态坐标，播完就撤，让 style 里的正中位置说了算 */
          pathAnim.onfinish = function () { try { pathAnim.cancel(); } catch (e) {} };
          if (!isStackMate) playSoundCues(built.cues);   /* 同伴机不重播音效 */
          if (after.pos === 999 && before.pos !== 999) {
            var homeBody = plane.querySelector && plane.querySelector('.aero-piece-body');
            if (homeBody && typeof homeBody.animate === 'function') {
              homeBody.animate([
                { opacity: .25, transform: 'scale(.55) rotate(-12deg)' },
                { opacity: 1, transform: 'scale(1.28) rotate(7deg)', offset: .62 },
                { opacity: 1, transform: 'scale(1) rotate(0deg)' }
              ], { duration: 720, delay: 260, easing: 'cubic-bezier(.2,.9,.25,1)' });
            }
          }
          return;
        }
      }
      var points = motionPoints(after.color, before.pos, after.pos, after.planeIdx);
      if (points.length < 2) return;
      var kind = after.pos === -1 ? 'knock' : motionKind(after.color, before.pos, after.pos, actionEvents);
      var frames = motionFrames(points, kind);
      var fbDur = motionDuration(points, kind);
      var fbAnim = plane.animate(frames, {
        duration: fbDur,
        easing: kind === 'walk' ? 'linear' : 'cubic-bezier(.2,.75,.25,1)',
        fill: 'both'
      });
      fbAnim.onfinish = function () { try { fbAnim.cancel(); } catch (e) {} };
      if (kind === 'walk') {
        var fbCues = [], fbSteps = Math.max(1, points.length - 1);
        for (var ci = 0; ci < fbSteps; ci++) fbCues.push({ at: ci * (fbDur / fbSteps), name: 'move' });
        playSoundCues(fbCues);
      } else if (kind !== 'knock') {
        playSoundCues([{ at: 0, name: kind === 'fly' ? 'card' : 'build' }]);
      }
      if (after.pos === 999 && before.pos !== 999) {
        var body = plane.querySelector && plane.querySelector('.aero-piece-body');
        if (body && typeof body.animate === 'function') {
          body.animate([
            { opacity: .25, transform: 'scale(.55) rotate(-12deg)' },
            { opacity: 1, transform: 'scale(1.28) rotate(7deg)', offset: .62 },
            { opacity: 1, transform: 'scale(1) rotate(0deg)' }
          ], { duration: 720, delay: 260, easing: 'cubic-bezier(.2,.9,.25,1)' });
        }
      }
    });
    if (lpFresh) container.__aeroLastPathSeq = lp.seq;
  }

  function playPlayerFinishAnimation(container, state, playerId) {
    var celebration = container.querySelector('#aero-celebration');
    var player = playerById(state, playerId);
    if (!celebration || !player) return;
    if (container.__aeroCelebrationTimer) clearTimeout(container.__aeroCelebrationTimer);
    celebration.innerHTML = '<g class="aero-player-finish-banner" pointer-events="none">' +
      '<rect x="295" y="392" width="310" height="116" rx="30" fill="#fff9e8" stroke="#d6a62b" stroke-width="5"/>' +
      '<path d="M414 427 L421 400 L439 415 L450 389 L461 415 L479 400 L486 427 Z" ' +
        'fill="#ffd54f" stroke="#7a5410" stroke-width="3" stroke-linejoin="round"/>' +
      '<text x="450" y="466" text-anchor="middle" font-size="25" font-weight="900" fill="#3d3320">' +
        esc(player.name) + ' 第 ' + player.rank + ' 名完成！</text>' +
      '<text x="450" y="492" text-anchor="middle" font-size="16" font-weight="800" fill="#80692d">其他玩家继续</text>' +
      '</g>';
    var banner = celebration.querySelector && celebration.querySelector('.aero-player-finish-banner');
    var reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && banner && typeof banner.animate === 'function') {
      banner.animate([
        { opacity: 0, transform: 'scale(.7) translateY(22px)' },
        { opacity: 1, transform: 'scale(1.06) translateY(0)', offset: .62 },
        { opacity: 1, transform: 'scale(1) translateY(0)' }
      ], { duration: 620, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'both' });
    }
    if (!reduce) {
      layerBodiesForPlayer(container, playerId).forEach(function (body, index) {
        if (typeof body.animate !== 'function') return;
        body.animate([
          { transform: 'translateY(0) rotate(0deg)' },
          { transform: 'translateY(-13px) rotate(-7deg)' },
          { transform: 'translateY(0) rotate(6deg)' },
          { transform: 'translateY(0) rotate(0deg)' }
        ], { duration: 620, delay: 180 + index * 90, easing: 'ease-in-out' });
      });
    }
    container.__aeroCelebrationTimer = setTimeout(function () {
      celebration.innerHTML = '';
      container.__aeroCelebrationTimer = null;
    }, reduce ? 900 : 1750);
  }

  function playGameOverAnimation(container, state) {
    var celebration = container.querySelector('#aero-celebration');
    if (!celebration) return;
    if (container.__aeroCelebrationTimer) {
      clearTimeout(container.__aeroCelebrationTimer);
      container.__aeroCelebrationTimer = null;
    }
    var winner = null;
    state.players.forEach(function (p) { if (p.id === state.winner) winner = p; });
    var order = playerFinishOrder(state);
    var standingLines = [];
    for (var oi = 0; oi < order.length; oi += 2) {
      var pair = order.slice(oi, oi + 2).map(function (id, offset) {
        var player = playerById(state, id);
        return '第' + (oi + offset + 1) + '名 ' + (player ? player.name : id);
      });
      standingLines.push(pair.join('　'));
    }
    var palette = ['red', 'yellow', 'blue', 'green'];
    var bits = '';
    for (var i = 0; i < 36; i++) {
      var color = HEX[palette[i % palette.length]];
      bits += '<circle class="aero-game-over-confetti" cx="450" cy="450" r="' + (4 + i % 3) +
        '" fill="' + color + '" data-i="' + i + '"/>';
    }
    celebration.innerHTML = '<g class="aero-finish-banner" pointer-events="none">' +
      '<rect x="265" y="350" width="370" height="200" rx="34" fill="#fff9e8" stroke="#d6a62b" stroke-width="5"/>' +
      '<path d="M415 402 L422 372 L440 388 L450 360 L461 388 L479 372 L485 402 Z" ' +
        'fill="#ffd54f" stroke="#7a5410" stroke-width="3" stroke-linejoin="round"/>' +
      '<text x="450" y="438" text-anchor="middle" font-size="27" font-weight="900" fill="#3d3320">' +
        esc(winner ? winner.name : '冠军') + ' 获胜</text>' +
      '<text x="450" y="468" text-anchor="middle" font-size="16" font-weight="800" fill="#80692d">所有玩家都完成了</text>' +
      standingLines.map(function (line, index) {
        return '<text class="aero-final-standing" x="450" y="' + (500 + index * 25) +
          '" text-anchor="middle" font-size="14.5" font-weight="800" fill="#4f4531">' + esc(line) + '</text>';
      }).join('') +
      '</g>' + bits;

    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var banner = celebration.querySelector && celebration.querySelector('.aero-finish-banner');
    if (banner && typeof banner.animate === 'function') {
      banner.animate([
        { opacity: 0, transform: 'scale(.65) translateY(28px)' },
        { opacity: 1, transform: 'scale(1.06) translateY(0)', offset: .65 },
        { opacity: 1, transform: 'scale(1) translateY(0)' }
      ], { duration: 760, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'both' });
    }
    if (celebration.querySelectorAll) {
      Array.prototype.forEach.call(celebration.querySelectorAll('.aero-game-over-confetti'), function (bit, index) {
        if (typeof bit.animate !== 'function') return;
        var angle = index * 137.5 * Math.PI / 180;
        var distance = 135 + (index % 6) * 24;
        var dx = Math.cos(angle) * distance;
        var dy = Math.sin(angle) * distance + 90;
        bit.animate([
          { opacity: 1, transform: 'translate(0px,0px) scale(.4)' },
          { opacity: 1, transform: 'translate(' + dx + 'px,' + (dy - 70) + 'px) scale(1)', offset: .58 },
          { opacity: 0, transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(240deg) scale(.75)' }
        ], { duration: 1500 + (index % 5) * 120, delay: index * 18, easing: 'cubic-bezier(.15,.75,.25,1)', fill: 'forwards' });
      });
    }
    layerBodies(container).forEach(function (body, index) {
      if (typeof body.animate !== 'function') return;
      body.animate([
        { transform: 'translateY(0) rotate(0deg)' },
        { transform: 'translateY(-16px) rotate(-8deg)' },
        { transform: 'translateY(0) rotate(7deg)' },
        { transform: 'translateY(0) rotate(0deg)' }
      ], { duration: 680, delay: 420 + index * 105, easing: 'ease-in-out' });
    });
  }

  function layerBodies(container) {
    var layer = container.querySelector('#aero-planes');
    if (!layer || !layer.querySelectorAll) return [];
    return Array.prototype.slice.call(layer.querySelectorAll('.aero-plane.is-home .aero-piece-body'));
  }

  function layerBodiesForPlayer(container, playerId) {
    var layer = container.querySelector('#aero-planes');
    if (!layer || !layer.querySelectorAll) return [];
    return Array.prototype.slice.call(layer.querySelectorAll('.aero-plane.is-home')).filter(function (plane) {
      return plane.dataset && plane.dataset.pid === playerId;
    }).map(function (plane) {
      return plane.querySelector('.aero-piece-body');
    }).filter(Boolean);
  }

  function decorateFinalRankingPopup() {
    var popup = document.querySelector('.mono-win');
    var ranking = global.__aeroFinalRanking;
    if (!popup || !Array.isArray(ranking) || !ranking.length || popup.querySelector('.aero-total-ranking')) return;

    var panel = document.createElement('section');
    panel.className = 'aero-total-ranking';
    panel.setAttribute('aria-label', '最终总排名');
    var title = document.createElement('h3');
    title.textContent = '最终总排名';
    panel.appendChild(title);

    ranking.forEach(function (player, index) {
      var rank = Number(player.rank) || index + 1;
      var row = document.createElement('div');
      row.className = 'aero-ranking-row' + (rank === 1 ? ' is-champion' : '');

      var medal = document.createElement('span');
      medal.className = 'aero-ranking-medal';
      medal.innerHTML = crownIconHTML(rank, 20);
      var dot = document.createElement('span');
      dot.className = 'aero-ranking-dot';
      dot.style.backgroundColor = HEX[player.color] || '#999';
      var name = document.createElement('strong');
      name.className = 'aero-ranking-name';
      name.textContent = '第 ' + rank + ' 名　' + player.name;
      var done = document.createElement('span');
      done.className = 'aero-ranking-done';
      /* 8/25 她截图：被「剩一人自动收局」收的那位显示真实到家数，别硬写 4/4 */
      done.textContent = (player.finished != null ? player.finished : 4) + '/4 到家';

      row.appendChild(medal);
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(done);
      panel.appendChild(row);
    });

    var button = popup.querySelector('.mono-btn');
    if (button) popup.insertBefore(panel, button);
    else popup.appendChild(panel);
    if (typeof panel.animate === 'function') {
      panel.animate([
        { opacity: 0, transform: 'translateY(12px) scale(.98)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' }
      ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
    }
  }

  /* 先让棋盘结算动画完整露出，再进入房间原有的全屏获胜页。 */
  function installDelayedWinScreen() {
    var ui = global.MonoUI;
    if (!ui || typeof ui.showWin !== 'function' || ui.__aeroDelayedWin) return;
    var originalShowWin = ui.showWin;
    var pending = null;
    var shown = false;
    ui.showWin = function (name, colors) {
      if (pending || shown) return;
      var reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      pending = setTimeout(function () {
        pending = null;
        shown = true;
        originalShowWin(name, colors);
        decorateFinalRankingPopup();
        setTimeout(decorateFinalRankingPopup, 0);
      }, reduce ? 0 : 1900);
    };
    ui.__aeroDelayedWin = true;
  }

  function motionKind(color, from, to, events) {
    var types = (events || []).map(function (event) { return event && event.type; });
    if (types.indexOf('fly') !== -1 || (from === AIR[color] && to !== from)) return 'fly';
    if (types.indexOf('jump') !== -1) return 'jump';
    if (from >= 0 && from < 52 && to >= 0 && to < 52 && (to - from + 52) % 52 > 6) return 'jump';
    return 'walk';
  }

  function frameTransform(point, lift, rotate, scale) {
    return 'translate(' + point[0] + 'px,' + (point[1] - (lift || 0)) + 'px)' +
      ' rotate(' + (rotate || 0) + 'deg) scale(' + (scale || 1) + ')';
  }

  function motionFrames(points, kind) {
    var start = points[0];
    var end = points[points.length - 1];
    if (kind === 'jump' || kind === 'fly') {
      var height = kind === 'fly' ? 92 : 54;
      var turn = kind === 'fly' ? 16 : 5;
      var middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      return [
        { offset: 0, transform: frameTransform(start, 0, 0, 1) },
        { offset: .12, transform: frameTransform(start, 9, -turn / 2, .94) },
        { offset: .5, transform: frameTransform(middle, height, turn, kind === 'fly' ? 1.16 : 1.09) },
        { offset: .88, transform: frameTransform(end, 8, -turn / 3, 1.04) },
        { offset: .96, transform: frameTransform(end, -4, 0, .9) },
        { offset: 1, transform: frameTransform(end, 0, 0, 1) }
      ];
    }
    if (kind === 'knock') {
      return [
        { offset: 0, transform: frameTransform(start, 0, 0, 1), opacity: 1 },
        { offset: .4, transform: frameTransform(start, 18, -20, .72), opacity: .72 },
        { offset: 1, transform: frameTransform(end, 0, 0, 1), opacity: 1 }
      ];
    }

    var frames = [{ offset: 0, transform: frameTransform(start, 0, 0, 1) }];
    var segments = points.length - 1;
    for (var i = 0; i < segments; i++) {
      var fromPoint = points[i];
      var toPoint = points[i + 1];
      var hop = [(fromPoint[0] + toPoint[0]) / 2, (fromPoint[1] + toPoint[1]) / 2];
      frames.push({
        offset: (i + .48) / segments,
        transform: frameTransform(hop, 9, i % 2 ? -4 : 4, 1.04)
      });
      frames.push({
        offset: (i + 1) / segments,
        transform: frameTransform(toPoint, 0, 0, 1)
      });
    }
    return frames;
  }

  function motionDuration(points, kind) {
    if (kind === 'fly') return 820;
    if (kind === 'jump') return 620;
    if (kind === 'knock') return 580;
    return Math.min(1500, Math.max(360, (points.length - 1) * 220));
  }

  /* ★2026-08-24 23:25 她：走5到黄格该逐格走完再跳4，前端却把9格差当一次跳、吞了逐格那段。
     引擎现在把这步拆成 segments（walk/jump/fly/spawn）；这里按段拼一条完整动画，走段逐格、跳飞段抛物线。 */
  function advanceForAnimation(color, pos, steps) {
    var homeLength = 5;
    if (pos >= 100 && pos < 999) {
      var runTarget = (pos - 100) + steps;
      if (runTarget === homeLength) return 999;
      if (runTarget > homeLength) return 100 + (homeLength - (runTarget - homeLength));
      return 100 + runTarget;
    }
    if (pos === PAD_GATE || pos === PAD_SMALL) pos = padBase(color, pos);
    if (pos < 0 || pos >= 52) return pos;
    var entry = (GATE[color] - 4 + 52) % 52;
    var toEntry = (entry - pos + 52) % 52;
    if (steps <= toEntry) return (pos + steps) % 52;
    var into = steps - toEntry - 1;
    if (into === homeLength) return 999;
    if (into > homeLength) return 100 + (homeLength - (into - homeLength));
    return 100 + into;
  }

  function routePoint(color, pos, planeIdx) {
    /* 999 的静态位置是基地皇冠；走动途中先落到终点跑道第 6 格，再飞回基地。 */
    if (pos === 999) return RUN[color][5];
    return posXY(color, pos, planeIdx);
  }

  function walkSegmentPoints(segment, color, planeIdx) {
    var steps = Number(segment && segment.steps);
    if (!segment || segment.kind !== 'walk' || !Number.isFinite(steps) || steps <= 0) {
      return motionPoints(color, segment.from, segment.to, planeIdx);
    }
    var points = [routePoint(color, segment.from, planeIdx)];
    for (var step = 1; step <= steps; step++) {
      points.push(routePoint(color, advanceForAnimation(color, segment.from, step), planeIdx));
    }
    return points;
  }

  function buildPathAnimation(segments, color, planeIdx) {
    var segData = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var pts = seg.kind === 'walk' ? walkSegmentPoints(seg, color, planeIdx) :
        motionPoints(color, seg.from, seg.to, planeIdx);
      if (pts.length < 2) continue;
      var kind = seg.kind === 'walk' || seg.kind === 'spawn' ? 'walk'
               : seg.kind === 'fly' ? 'fly' : 'jump';
      segData.push({ pts: pts, kind: kind, dur: motionDuration(pts, kind) });
      if (seg.kind === 'walk' && seg.to === 999) {
        /* 先走到跑道终点，再单独飞回基地圆位显示皇冠，避免中途瞬移。 */
        segData.push({
          pts: [RUN[color][5], posXY(color, 999, planeIdx)],
          kind: 'jump',
          dur: 720
        });
      }
    }
    if (!segData.length) return null;
    var total = 0;
    for (var j = 0; j < segData.length; j++) total += segData[j].dur;
    if (total <= 0) return null;
    var frames = [];
    var accum = 0;
    /* 8/25 她要的走棋声：每一格一声 tick 跟动画对齐；飞一声呼啸、跳一声。cues 交给 SFX 按毫秒排。 */
    var cues = [];
    for (var k = 0; k < segData.length; k++) {
      var sd = segData[k];
      if (sd.kind === 'walk') {
        var steps = Math.max(1, sd.pts.length - 1);
        for (var si = 0; si < steps; si++) cues.push({ at: accum + si * (sd.dur / steps), name: 'move' });
      } else {
        cues.push({ at: accum, name: sd.kind === 'fly' ? 'card' : 'build' });
      }
      var local = motionFrames(sd.pts, sd.kind);
      for (var m = 0; m < local.length; m++) {
        if (k > 0 && m === 0) continue;   /* 相邻段端点重合，跳过后段首帧免得 offset 撞车 */
        var kf = local[m];
        var g = (accum + (kf.offset || 0) * sd.dur) / total;
        var copy = {};
        for (var prop in kf) if (kf.hasOwnProperty(prop)) copy[prop] = kf[prop];
        copy.offset = Math.min(1, Math.max(0, g));
        frames.push(copy);
      }
      accum += sd.dur;
    }
    return { frames: frames, duration: total, cues: cues };
  }

  function playSoundCues(cues) {
    if (!global.SFX || !cues) return;
    for (var i = 0; i < cues.length; i++) global.SFX.play(cues[i].name, cues[i].at / 1000);
  }

  function playDiceRollAnimation(value, container) {
    if (typeof document === 'undefined') return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    /* ★2026-08-24 23:25 她：「骰子动画不居中，可不可以让骰子在棋盘中间动」「这样能看到」——
       原来锚在底栏 #r-actions 上，贴着屏幕底边还被裁掉一半。现在锚在棋盘 SVG 的正中心（四色方块）。 */
    var anchor = (container && container.querySelector && container.querySelector('svg')) ||
                 document.getElementById('aero-svg') || document.getElementById('r-actions') || container;
    if (!anchor || !anchor.getBoundingClientRect || !document.body) return;
    var rect = anchor.getBoundingClientRect();
    var die = document.createElement('div');
    /* ★2026-08-24 23:05 她：「骰子还是没有居中」——之前用 Unicode 骰子字（⚄）当面，字形在方框里天生偏。
       现在自己画：3×3 点阵铺满方框、按点数亮点，几何上就是居中的。 */
    var FACES = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    var finalValue = Math.max(1, Math.min(6, Number(value) || 1));
    die.className = 'aero-dice-roll-fx';
    die.setAttribute('aria-hidden', 'true');
    var SIZE = 60;
    die.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;box-sizing:border-box;left:' +
      (rect.left + rect.width / 2 - SIZE / 2) + 'px;top:' + (rect.top + rect.height / 2 - SIZE / 2) +
      'px;width:' + SIZE + 'px;height:' + SIZE + 'px;padding:9px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);' +
      'border-radius:15px;background:#fff;box-shadow:0 12px 30px rgb(44 35 79 / .28)';
    var pips = [];
    for (var pi = 0; pi < 9; pi++) {
      var pip = document.createElement('span');
      pip.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#26232f;place-self:center;opacity:0';
      die.appendChild(pip); pips.push(pip);
    }
    function showFace(v) {
      var on = FACES[v] || FACES[1];
      for (var k = 0; k < 9; k++) pips[k].style.opacity = on.indexOf(k) !== -1 ? '1' : '0';
    }
    showFace(1);
    document.body.appendChild(die);
    var faceIndex = 1;
    var timer = setInterval(function () {
      faceIndex = faceIndex % 6 + 1;
      showFace(faceIndex);
    }, 72);
    if (typeof die.animate === 'function') {
      die.animate([
        { transform: 'translateY(12px) rotate(0deg) scale(.72)', opacity: .2 },
        { transform: 'translateY(-22px) rotate(170deg) scale(1.12)', opacity: 1, offset: .42 },
        { transform: 'translateY(-5px) rotate(330deg) scale(.96)', opacity: 1, offset: .78 },
        { transform: 'translateY(0) rotate(360deg) scale(1)', opacity: 1 }
      ], { duration: 720, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
    }
    setTimeout(function () {
      clearInterval(timer);
      showFace(finalValue);
      if (typeof die.animate === 'function') {
        die.animate([
          { transform: 'scale(.88)' },
          { transform: 'scale(1.18)', offset: .48 },
          { transform: 'scale(1)' }
        ], { duration: 260, easing: 'ease-out' });
      }
    }, 650);
    setTimeout(function () { if (die.parentNode) die.parentNode.removeChild(die); }, 1120);
  }

  function motionPoints(color, from, to, planeIdx) {
    var out = [posXY(color, from, planeIdx)];
    if (from === -1 || from === 999 || to === 999) {
      out.push(posXY(color, to, planeIdx));
      return out;
    }
    var fromCell = padBase(color, from);   /* 从门口空白位出发：按基准格逐格数 */
    if (fromCell >= 0 && fromCell < 52 && to >= 0 && to < 52) {
      var from0 = from; from = fromCell;
      var steps = (to - from + 52) % 52;
      /* 飞机场直飞沿虚线飞过去；普通 1—6 步则逐格走。 */
      if (from === AIR[color] && to === FLY_TO[color]) {
        out.push(posXY(color, to, planeIdx));
        return out;
      }
      if (steps > 0 && steps <= 6) {
        for (var step = 1; step <= steps; step++) out.push(posXY(color, (from + step) % 52, planeIdx));
        return out;
      }
    }
    if (from >= 100 && from < 999 && to >= 100 && to < 999 && to > from && to - from <= 6) {
      for (var runStep = from + 1; runStep <= to; runStep++) out.push(posXY(color, runStep, planeIdx));
      return out;
    }
    out.push(posXY(color, to, planeIdx));
    return out;
  }

  /* ── 房间消息分区：棋盘下放战局动态，底部只留聊天 ── */
  function installSeparatedRoomFeed() {
    installDelayedWinScreen();
    var stage = document.querySelector('.aero-stage');
    var boardEl = document.getElementById('r-board');
    var chatBox = document.getElementById('r-chat');
    var mixedLog = document.getElementById('r-chat-log');

    var style = document.createElement('style');
    style.id = 'aero-separated-feed-style';
    style.textContent =
      '.aero-stage.aero-has-separated-feed{flex-direction:column;justify-content:flex-start;align-items:center}' +
      '#r-battle-panel{width:min(calc(100% - 20px),720px);min-height:92px;max-height:132px;' +
        'margin:8px auto 12px;padding:10px 12px;border:1px solid var(--chat-panel-border);' +
        'border-radius:16px;background:var(--chat-panel-bg);overflow:hidden}' +
      '#r-battle-panel[hidden]{display:none}' +
      '.aero-feed-title{margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.08em;color:var(--text-dim)}' +
      '#r-battle-log{max-height:88px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;' +
        'font-size:12.5px;line-height:1.45}' +
      '#r-chat .aero-chat-title{margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.08em;color:var(--text-dim)}' +
      /* ★2026-09-02 12:19 她两次圈图：iPhone 上这张卡的 box-shadow 画成直角、圆角外露一块浅色——阴影整个删掉（iOS 卡片一律零阴影） */
      '#r-players .pl-card.is-finished{border-color:#d6a62b;background:linear-gradient(135deg,#fff9e8,#fff2b8);box-shadow:none}' +
      '#r-players .pl-card.is-finished .cash{color:#80610b;font-weight:900}' +
      /* 8/25 她要的：金卡上名字/尾注/「（我）」别再用深色主题的浅字，全换深金棕 */
      '#r-players .pl-card.is-finished .nm,#r-players .pl-card.is-finished .nm::after{color:#3d3320}' +
      '#r-players .pl-card.is-finished .tail{color:#8a7340}' +
      '#r-players .pl-card.is-finished .mono-dot{box-shadow:0 0 0 1.5px rgb(61 51 32 / .35)}' +
      '.mono-win .aero-total-ranking{width:min(86vw,360px);margin:18px auto 22px;padding:14px;' +
        'border:1px solid rgb(255 255 255 / .48);border-radius:18px;background:rgb(255 255 255 / .78);' +
        'box-shadow:0 12px 32px rgb(71 50 129 / .16);backdrop-filter:blur(12px)}' +
      '.mono-win .aero-total-ranking h3{margin:0 0 10px;color:#4c3b83;font-size:16px;font-weight:900;letter-spacing:.08em}' +
      '.mono-win .aero-ranking-row{display:grid;grid-template-columns:32px 12px minmax(0,1fr) auto;align-items:center;' +
        'gap:8px;min-height:42px;padding:5px 8px;border-radius:12px;color:#3e3851;text-align:left}' +
      '.mono-win .aero-ranking-row+.aero-ranking-row{margin-top:5px;border-top:1px solid rgb(80 63 134 / .08)}' +
      '.mono-win .aero-ranking-row.is-champion{background:linear-gradient(90deg,#fff3b0,#fff9dc);color:#75520b}' +
      '.mono-win .aero-ranking-medal{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;' +
        'background:rgb(255 255 255 / .75);font-weight:900}' +
      /* 8/25 深夜她抓的：榜单皇冠偏左（量她截图：墨心比圆心左 3px）。真凶=crownIconHTML 里为行内贴字
         设计的 margin-right:2px 被圆底复用 + Safari 对 grid 里属性宽高 SVG 的对齐怪癖（今晚文件图标同案）。
         修法照抄同晚她验收过的配方：CSS 定宽高 + block + margin 清零。 */
      '.mono-win .aero-ranking-medal{position:relative}' +
      /* 8/26 00:10 第三轮（她验收两轮还偏）：放弃赌任何引擎的 grid/svg 对齐，
         改绝对定位+transform 居中——所有内核唯一公认的死居中法。 */
      '.mono-win .aero-ranking-medal>svg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);margin:0 !important;width:20px;height:20px;display:block}' +
      '.mono-win .aero-ranking-dot{width:10px;height:10px;border:1.5px solid rgb(34 34 42 / .65);border-radius:50%}' +
      '.mono-win .aero-ranking-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}' +
      '.mono-win .aero-ranking-done{color:#777084;font-size:11px;font-weight:700;white-space:nowrap}';
    document.head.appendChild(style);

    if (!stage || !boardEl || !chatBox || !mixedLog || document.getElementById('r-battle-panel')) return;

    var panel = document.createElement('section');
    panel.id = 'r-battle-panel';
    panel.hidden = true;
    panel.innerHTML = '<h3 class="aero-feed-title">战局动态</h3><div id="r-battle-log"></div>';
    boardEl.insertAdjacentElement('afterend', panel);
    stage.classList.add('aero-has-separated-feed');

    var chatTitle = document.createElement('h3');
    chatTitle.className = 'aero-feed-title aero-chat-title';
    chatTitle.textContent = '聊天';
    chatBox.insertBefore(chatTitle, mixedLog);

    var battleLog = document.getElementById('r-battle-log');
    function splitMessages() {
      Array.prototype.slice.call(mixedLog.children).forEach(function (line) {
        if (/\baero-log-/.test(line.className)) battleLog.appendChild(line);
      });
      panel.hidden = battleLog.children.length === 0;
      battleLog.scrollTop = battleLog.scrollHeight;
    }
    new MutationObserver(splitMessages).observe(mixedLog, { childList: true });
    splitMessages();
  }

  global.MonoBoard = {
    esc: esc,
    init: init,
    HEX: HEX,
    GATE: GATE,
    TAKEOFF: TAKEOFF,
    PAD_GATE: PAD_GATE,
    PAD_SMALL: PAD_SMALL,
    SMALL: SMALL,
    COLORS: COLORS,
    geometry: { ring: RING, runs: RUN, bases: BASES, basePads: BASE_PADS, startPads: START_PADS,
      positionFor: posXY, motionPoints: motionPoints, motionKind: motionKind, motionFrames: motionFrames,
      motionDuration: motionDuration, pathAnimation: buildPathAnimation,
      walkSegmentPoints: walkSegmentPoints, advanceForAnimation: advanceForAnimation,
      finishRanks: reconcileFinishRanks, turnCells: TURN_CELLS }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSeparatedRoomFeed);
    else installSeparatedRoomFeed();
  }
})(window);
