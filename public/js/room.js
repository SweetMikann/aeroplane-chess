/* Bisca 飞行棋 —— 房间页
 * 骨架照抄大富翁 room.js，棋盘换成 aeroboard（SVG），动作只有掷骰/选飞机两种。
 * 消息流：SSE 全量 state → render()；聊天和对局日志合流显示在同一条时间线里。
 */
(function (global) {
  'use strict';

  var API = global.MonoAPI;
  var UI = global.MonoUI;
  var Board = global.MonoBoard;
  var esc = Board.esc;
  var $ = function (id) { return document.getElementById(id); };

  var CODE = new URLSearchParams(location.search).get('c') || '';
  if (!CODE) { location.href = '/aeroplane/'; return; }

  var seat = API.loadSeat(CODE);        // {playerId, playerToken, name, color} | null
  var watching = false;                  // 明确选了只看看
  var sync = null;
  var board = null;
  var last = null;                       // 最近一次 payload
  var lastLogSeq = 0;                    // 对局日志渲染到哪条了
  var lastChatTs = 0;
  var joinShown = false;
  var busy = false;
  /* ★邀请码单独一个变量。之前存在 last.inviteToken 上，SSE 全量包（脱敏、不带码）
     一到就把 last 整个覆盖——她点「邀请」永远是「拿不到邀请码」。 */
  var inviteToken = '';

  var FACE_NAME = { yellow: '海绵小方', red: '小螃蟹', blue: '章鱼仔', green: '独眼仔' };

  function myPlayer(state) {
    if (!seat || !state || !state.players) return null;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === seat.playerId) return state.players[i];
    }
    return null;
  }

  /* 跟引擎 movable() 同一套逻辑：机库里的要掷出 1/6 才能动，场上的都能动 */
  function movablePlanes(state, p) {
    var out = [];
    if (!state || !p) return out;
    var takeoff = (state.config && state.config.takeoff) || [6];
    var can = takeoff.indexOf(state.dice) !== -1;
    p.planes.forEach(function (pos, i) {
      if (pos === 999) return;
      if (pos === -1) { if (can) out.push(i); return; }
      out.push(i);
    });
    return out;
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  function render(payload) {
    last = payload;
    var st = payload.state;

    $('r-name').textContent = payload.name || '飞行棋';
    $('r-code').textContent = CODE;

    renderPlayers(payload);
    renderChatAndLog(payload);
    renderActions(payload);

    var isHost = seat && payload.seats && payload.seats.length && payload.seats[0].playerId === seat.playerId;
    $('r-end').hidden = !(isHost && payload.started);
    $('r-pause').hidden = !(isHost && payload.started && !(payload.state && payload.state.phase === 'game_over'));
    /* ★2026-08-24 23:03 她：「把开局后的那个邀请按钮换成暂停吧，都已经开局了就没法邀请别人了」 */
    $('r-share').hidden = !inviteToken || !!payload.started;

    if (payload.closed) {
      showClosed();
      return;
    }

    if (!payload.started) {
      $('r-board').hidden = true;
      renderWait(payload);
      maybeJoin(payload);
      return;
    }
    $('r-wait').hidden = true;
    $('r-board').hidden = false;

    if (!board) board = Board.init($('r-board'), { onPlaneClick: onPlaneClick });
    var me = myPlayer(st);
    var myTurn = me && st && st.currentPlayer === seat.playerId;
    var movable = (myTurn && st.phase === 'awaiting_move') ? movablePlanes(st, me) : null;
    board.update(st, { movable: movable, myId: seat && seat.playerId });

    if (st && st.phase === 'game_over' && st.winner) {
      var w = null;
      st.players.forEach(function (p) { if (p.id === st.winner) w = p; });
      UI.showWin(w ? w.name : '有人', [API.colorHex(w && w.color)]);
    }
  }

  function renderPlayers(payload) {
    /* 照大富翁的 pl-card 抄（她 12:46 说的：「直接把大富翁的改一改拿来用」——
       之前自造的紫圈高亮她圈出来说奇怪） */
    var st = payload.state;
    var seats = payload.seats || [];
    $('r-players').innerHTML = seats.map(function (s, si) {
      var p = null;
      if (st) st.players.forEach(function (x) { if (x.id === s.playerId) p = x; });
      var turn = st && st.currentPlayer === s.playerId && st.phase !== 'game_over';
      var me = seat && seat.playerId === s.playerId;
      var tail = [FACE_NAME[s.color] || ''];
      if (si === 0) tail.push('房主');
      return '<div class="pl-card' + (turn ? ' is-turn' : '') + (me ? ' is-me' : '') + '">' +
        '<div class="top"><span class="mono-dot" style="background:' + API.colorHex(s.color) + '"></span>' +
        '<span class="nm">' + esc(s.name) + '</span></div>' +
        '<div class="cash">' + (p ? '到家 ' + p.finished + '/4' : '等开局') + '</div>' +
        '<div class="tail">' + esc(tail.join(' · ')) + '</div></div>';
    }).join('');
  }

  function renderWait(payload) {
    var box = $('r-wait');
    box.hidden = false;
    var seats = payload.seats || [];
    var isHost = seat && seats.length && seats[0].playerId === seat.playerId;
    var canStart = isHost && seats.length >= 2;
    var chips = seats.map(function (s) {
      return '<div class="wt-seat"><span class="dot" style="background:' + API.colorHex(s.color) + '"></span>' +
        '<span class="nm">' + esc(s.name) + '</span><span class="fc">' + esc(FACE_NAME[s.color] || '') + '</span></div>';
    }).join('');
    for (var i = seats.length; i < 4; i++) chips += '<div class="wt-seat is-empty">空位</div>';
    box.innerHTML = '<div class="cn-card wt-card">' +
      '<div class="wt-plane">✈</div>' +
      '<div class="wt-big">等人齐</div>' +
      '<div class="wt-sub">房间号 <b>' + esc(CODE) + '</b> · ' + seats.length + '/4 人' +
      (seats.length < 2 ? '，至少 2 人才能开' : '') + '</div>' +
      '<div class="wt-seats">' + chips + '</div>' +
      '<div class="wt-btns">' +
      (isHost ? '<button class="mono-btn mono-btn--primary" id="wt-start"' + (canStart ? '' : ' disabled') + '>开局</button>' : '') +
      '<button class="mono-btn mono-btn--ghost" id="wt-share">复制邀请链接</button>' +
      '</div>' +
      (isHost ? '' : '<div class="wt-sub" style="margin-top:8px">等房主开局…</div>') +
      '</div>';
    var b = $('wt-start');
    if (b) b.addEventListener('click', function () {
      API.startRoom(CODE, seat.playerToken).catch(function (e) { UI.toast(e.message, true); });
    });
    var sh = $('wt-share');
    if (sh) sh.addEventListener('click', copyInvite);
  }

  function maybeJoin(payload) {
    if (seat || watching || joinShown) return;
    if ((payload.seats || []).length >= 4) return;
    joinShown = true;
    var me = API.loadMe();
    UI.joinDialog({
      name: me.name || '',
      preferColor: me.color || '',
      taken: (payload.seats || []).map(function (s) { return s.color; }),
      onWatch: function () { watching = true; },
      onSubmit: function (d) {
        API.joinRoom(CODE, { name: d.name, color: d.color }).then(function (r) {
          seat = r;
          API.saveSeat(CODE, r);
          API.saveMe({ name: r.name, color: r.color });
          UI.toast('坐下了，你执' + (FACE_NAME[r.color] || r.color));
        }, function (e) {
          joinShown = false;
          UI.toast(e.message, true);
        });
      }
    });
  }

  /* 战局动态 → gamelog 区；闲聊 → chat 区 */
  function renderChatAndLog(payload) {
    var gbox = $('r-gamelog');
    var cbox = $('r-chat-log');
    var st = payload.state;
    var gAdded = false, cAdded = false;

    if (st && st.log) {
      st.log.forEach(function (e) {
        if (e.seq <= lastLogSeq) return;
        lastLogSeq = e.seq;
        gAdded = true;
        var div = document.createElement('div');
        div.className = 'gl gl-' + esc(e.type);
        div.textContent = e.text;
        gbox.appendChild(div);
        if (global.SFX) { var k = global.SFX.forLog(e); if (k) global.SFX.play(k); }
      });
    }
    (payload.chat || []).forEach(function (m) {
      if (m.ts <= lastChatTs) return;
      lastChatTs = m.ts;
      cAdded = true;
      var div = document.createElement('div');
      div.className = 'mono-chat-msg' + (m.by === null ? ' is-sys' : '');
      div.innerHTML = m.by === null ? esc(m.text)
        : '<b>' + esc(m.name) + '</b>：' + esc(m.text);
      cbox.appendChild(div);
    });
    if (gAdded) {
      while (gbox.children.length > 100) gbox.removeChild(gbox.firstChild);
      gbox.scrollTop = gbox.scrollHeight;
    }
    if (cAdded) {
      while (cbox.children.length > 200) cbox.removeChild(cbox.firstChild);
      cbox.scrollTop = cbox.scrollHeight;
    }
  }


  /* 骰子自己画（她 12:14 定的：「别用ChatGPT的了，你自己画吧」）——白面圆角黑点点经典款 */
  var PIPS = [[], [[7,7]], [[4,4],[10,10]], [[4,4],[7,7],[10,10]],
    [[4,4],[10,4],[4,10],[10,10]], [[4,4],[10,4],[7,7],[4,10],[10,10]],
    [[4,4],[10,4],[4,7],[10,7],[4,10],[10,10]]];
  function diceSVG(n, size) {
    var dots = (PIPS[n] || []).map(function (p) {
      return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.55" fill="#22222a"/>';
    }).join('');
    size = size || 34;
    return '<svg class="aero-dice" viewBox="0 0 14 14" width="' + size + '" height="' + size + '">' +
      '<rect x="0.8" y="0.8" width="12.4" height="12.4" rx="3.2" fill="#fffdf4" ' +
      'stroke="#22222a" stroke-width="1.3"/>' + dots + '</svg>';
  }

  function renderActions(payload) {
    var bar = $('r-actions');
    var st = payload.state;
    if (!payload.started || !st || st.phase === 'game_over') { bar.innerHTML = ''; return; }

    var turnName = '';
    st.players.forEach(function (p) { if (p.id === st.currentPlayer) turnName = p.name; });
    var me = myPlayer(st);
    var myTurn = me && st.currentPlayer === seat.playerId;

    /* ★2026-08-29 16:55 她圈出「等 澄澄 走…」左边一块白方块：那不是印记，是**骰子画得太大**——
       这里没传 size，diceSVG 默认 34，比按钮里那颗（17）大一倍，在 48 高的条里被裁得只剩白底，
       还把整行撑歪、文字被挤得不居中。三态统一 17。 */

    if (!myTurn) {
      /* ★2026-08-29 17:08 她第三次圈这里：「一块奇怪的印记」「还是有」。
         那是骰子——在她的 WebView 里只画出白底，成了一个白方块。
         但这一态**本来就不需要它**：对方掷了几，下面战局日志白纸黑字写着。
         等别人走的时候只留一句话，白块连同它的来源一起没了。 */
      bar.innerHTML = '<div class="aero-turnline">等 <b>' + esc(turnName) + '</b> 走…</div>';
      return;
    }
    if (st.phase === 'awaiting_roll') {
      bar.innerHTML = '<div class="aero-turnline">轮到你了</div>' +
        '<button class="mono-btn mono-btn--primary aero-rollbtn" id="a-roll">' + diceSVG(5, 17) + '掷骰子</button>';   /* 8/25 她：不许 emoji，用画的骰子 */
      $('a-roll').addEventListener('click', roll);
    } else if (st.phase === 'awaiting_move') {
      /* ★2026-08-29 17:16 她：「我打字或者弄点别的操作又会消失，然后下一轮又会有」——
         白块是**时有时无**的，跟回合走。它就是这里这颗骰子：轮到自己选飞机时才画，
         打字触发重绘就没了。在她的 WebView 上它只画得出白底。
         这一行里骰子本来也只是替「掷出几」说话，那就直接写出来——
         信息比一颗画不出来的骰子更清楚，而且再没有 SVG 可以画坏。 */
      var can = movablePlanes(st, me);
      var rolled = st.dice ? ('掷出 ' + st.dice + '，') : '';
      bar.innerHTML = '<div class="aero-turnline">' + rolled +
        (can.length ? '点一架亮着的飞机' : '没有能动的飞机') + '</div>';
    }
  }

  // ── 动作 ──────────────────────────────────────────────────────────────────

  function roll() {
    if (busy || !seat) return;
    busy = true;
    API.action(CODE, seat.playerToken, 'roll').then(function () { busy = false; },
      function (e) { busy = false; UI.toast(e.message, true); });
  }

  function onPlaneClick(pid, idx) {
    if (!seat || pid !== seat.playerId || busy || !last || !last.state) return;
    var st = last.state;
    if (st.currentPlayer !== seat.playerId || st.phase !== 'awaiting_move') return;
    if (movablePlanes(st, myPlayer(st)).indexOf(idx) === -1) { UI.toast('这架现在动不了', true); return; }
    busy = true;
    API.action(CODE, seat.playerToken, 'move', { plane: idx }).then(function () { busy = false; },
      function (e) { busy = false; UI.toast(e.message, true); });
  }

  function copyInvite() {
    var go = function (t) {
      var link = location.origin + '/aeroplane/room.html?c=' + CODE + '&invite=' + t;
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () {
        UI.toast('邀请链接复制好了，发给对面吧');
      }, function () { window.prompt('手动复制这个链接', link); });
    };
    if (inviteToken) return go(inviteToken);
    API.getState(CODE).then(function (d) {
      if (d.inviteToken) { inviteToken = d.inviteToken; go(inviteToken); }
      else UI.toast('这个房间没开放邀请', true);
    }, function (e) { UI.toast(e.message, true); });
  }

  function showClosed() {
    if (showClosed.done) return;
    showClosed.done = true;
    UI.modal({
      dismissable: false,
      html: '<h2>这局收摊了</h2><div class="sub">房主结束了这一局。</div>' +
        '<a class="mono-btn mono-btn--primary" style="margin-top:16px" href="/aeroplane/">回大厅</a>'
    });
  }

  // ── boot ──────────────────────────────────────────────────────────────────

  function boot() {
    $('r-back').innerHTML = UI.icon('back', 18);


    /* ★2026-08-24 textarea 随内容长高（CSS 里封顶 5 行）；回车发送、shift+回车换行 */
    (function () {
      var ta = $('r-chat-input'), fm = $('r-chat-form');
      if (!ta || !fm) return;
      var grow = function () { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.addEventListener('input', grow);
      ta.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); if (fm.requestSubmit) fm.requestSubmit(); else fm.dispatchEvent(new Event('submit', { cancelable: true })); }
      });
      fm.addEventListener('submit', function () { setTimeout(grow, 0); });
    })();

    $('r-chat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('r-chat-input');
      var text = (inp.value || '').trim();
      if (!text) return;
      inp.value = '';
      API.sendChat(CODE, text, seat && seat.playerToken).catch(function (err) { UI.toast(err.message, true); });
    });

    $('r-share').addEventListener('click', copyInvite);

    $('r-pause').addEventListener('click', function () {
      if (!window.confirm('暂停这一局？棋面原样留着，下次进来接着走。')) return;
      API.pauseRoom(CODE, seat && seat.playerToken).then(function () { location.href = 'index.html'; },
        function (e) { UI.toast(e.message, true); });
    });

    $('r-end').addEventListener('click', function () {
      if (!window.confirm('结束这一局？棋面会清掉，房间和座位留着，可以再开新的一局。')) return;
      API.closeRoom(CODE, seat && seat.playerToken, false).catch(function (e) { UI.toast(e.message, true); });
    });

    /* 2026-08-24 她定的：小喇叭按钮删掉，「有声音就行，不必小喇叭」。音效默认开。 */

    sync = API.openSync(CODE, render, function (s) {
      var el = $('r-conn');
      el.dataset.conn = s;
      el.querySelector('.tx').textContent = s === 'live' ? '实时' : (s === 'polling' ? '轮询' : '重连中');
    });

    /* 邀请码只在 owner 级 GET /state 里给（SSE 全量包脱敏、永远不带），所以单独拉一次存好 */
    API.getState(CODE).then(function (d) {
      if (d.inviteToken) { inviteToken = d.inviteToken; $('r-share').hidden = !!(last && last.started); }
    }, function () { /* 拉不到就算了，点邀请时还会再试一次 */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
