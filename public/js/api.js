/* Bisca 飞行棋 —— 后端封装（照抄大富翁 api.js，只改前缀和颜色板）
 * ① REST（错误一律抛成带中文 message 的 Error，调用方直接 toast）
 * ② openSync：SSE 主链路 + 断线 3s 重连 + 连续 3 次失败退化成 3s 轮询；seq 只前进不回退
 * ③ 座位 token 的 localStorage 存取（按房间码分键）
 */
(function (global) {
  'use strict';

  var BASE = '/aeroplane/api';

  /* ★2026-08-22 22:24 补上访客邀请的透传（写法照抄棋牌室 cards/public/js/api.js）。
     后端本来就认 ?invite=，是前端从来没把它带上——所以邀请链接点进来照样被当陌生人。
     EventSource 不能塞 header，所以只能挂 query；刷新丢参靠 sessionStorage 续命。 */
  var INVITE = (function () {
    try {
      var q = new URLSearchParams(location.search).get('invite');
      if (q) { sessionStorage.setItem('aero-invite', q); return q; }
      return sessionStorage.getItem('aero-invite') || '';
    } catch (e) { return ''; }
  })();

  function url(p) {
    if (!INVITE) return BASE + p;
    return BASE + p + (p.indexOf('?') >= 0 ? '&' : '?') + 'invite=' + encodeURIComponent(INVITE);
  }

  function req(p, opts) {
    var o = Object.assign({ credentials: 'same-origin' }, opts || {});
    o.headers = Object.assign({ 'content-type': 'application/json' }, o.headers || {});
    return fetch(url(p), o).then(function (r) {
      return r.text().then(function (raw) {
        var body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
        if (!r.ok || body.error) {
          /* ★2026-08-22 23:41 她在 iPad 上看到红字「未授权：请先登录」——
             其实是房主把房关了、房间档案没了，同房的人下一个请求就吃 403。
             人已经在房间里了还说"请先登录"，那是把「结束」误报成「你没资格」。
             所以在房间页里遇到 403/404，一律翻译成「这局结束了」。 */
          var inRoom = /room\.html/.test(location.pathname);
          var gone = inRoom && (r.status === 403 || r.status === 404);
          var err = new Error(gone ? '这局结束了' : (body.error || ('请求失败了（' + r.status + '）')));
          err.status = r.status;
          err.roomGone = gone;
          throw err;
        }
        return body;
      });
    }, function () {
      throw new Error('连不上服务器，等会儿再试试');
    });
  }

  function post(p, body) {
    return req(p, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  // ── REST ──────────────────────────────────────────────────────────────────

  function listRooms() { return req('/rooms'); }

  function createRoom(name) { return post('/rooms', { name: name }); }

  /* ★2026-08-22 22:55 补的关房。她问「我自己不能关闭房间吗」——
     棋牌室有，大富翁前端后端都没有（翻过原始代码确认，不是漏看）。
     写法照抄 cards/public/js/zjh-room.js + lobby.js。 */
  /* ★2026-08-22 22:59 她要的牌桌闲聊（棋牌室有，大富翁没有）。 */
  function sendChat(code, text, playerToken) {
    return post('/rooms/' + encodeURIComponent(code) + '/chat', { text: text, playerToken: playerToken || '' });
  }

  /* 停止分享 / 换一把新钥匙（她 23:43 要的，对应会客厅"收回酒牌"）。 */
  function revokeInvite(code, playerToken, reissue) {
    return post('/rooms/' + encodeURIComponent(code) + '/revoke_invite',
      { playerToken: playerToken || '', reissue: !!reissue });
  }

  /* purge=true 才真删房间档；不带就只是收摊（清这一局的棋面，房间座位都留着）。
     ★2026-08-23 她：「我没删他就没了」——「结束」和「删掉」本来就是两件事。 */
  function pauseRoom(code, playerToken) {
    return post('/rooms/' + encodeURIComponent(code) + '/pause', { playerToken: playerToken || '' });
  }

  function closeRoom(code, playerToken, purge) {
    return post('/rooms/' + encodeURIComponent(code) + '/close',
                { playerToken: playerToken || '', purge: !!purge });
  }

  /* ★2026-08-24 房主把卡住的当前玩家推过这一回合（服务端替他按最小合法路径走到 end_turn）。
     后端会挡两种情况：他正欠债（只能自己决定破不破产）、以及还没卡满 60 秒。 */
  function skipTurn(code, playerToken) {
    return post('/rooms/' + encodeURIComponent(code) + '/skip', { playerToken: playerToken || '' });
  }

  function joinRoom(code, body) { return post('/rooms/' + code + '/join', body); }

  function startRoom(code, playerToken) { return post('/rooms/' + code + '/start', { playerToken: playerToken }); }

  function getState(code) { return req('/rooms/' + code + '/state'); }

  function action(code, playerToken, type, extra) {
    var body = Object.assign({}, extra || {}, { playerToken: playerToken, type: type });
    return post('/rooms/' + code + '/action', body);
  }

  // ── 同步 ──────────────────────────────────────────────────────────────────

  /**
   * openSync(code, onPayload, onStatus) -> {close()}
   * onStatus 收 'live' | 'retry' | 'polling'
   */
  function openSync(code, onPayload, onStatus) {
    var es = null, fails = 0, poll = null, retry = null, closed = false, lastSeq = -1;

    function status(s) { if (onStatus) { try { onStatus(s); } catch (e) { /* 状态回调炸了不影响同步 */ } } }

    function deliver(payload) {
      if (!payload || closed) return;
      var seq = typeof payload.seq === 'number' ? payload.seq : 0;
      if (seq < lastSeq) return;          // 旧 seq 直接丢，不让画面回退
      lastSeq = seq;
      onPayload(payload);
    }

    function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

    function startPoll() {
      if (poll || closed) return;
      status('polling');
      var tick = function () {
        if (closed) return;
        getState(code).then(deliver, function () { /* 轮询失败继续下一轮 */ });
      };
      tick();
      poll = setInterval(tick, 3000);
    }

    function connect() {
      if (closed) return;
      try {
        es = new EventSource(url('/rooms/' + code + '/events'));
      } catch (e) {
        startPoll();
        return;
      }
      es.addEventListener('state', function (ev) {
        fails = 0;
        stopPoll();
        status('live');
        var payload = null;
        try { payload = JSON.parse(ev.data); } catch (e) { return; }
        deliver(payload);
      });
      es.onerror = function () {
        if (closed) return;
        try { es.close(); } catch (e) { /* ignore */ }
        es = null;
        fails += 1;
        if (fails >= 3) { status('polling'); startPoll(); } else { status('retry'); }
        if (retry) clearTimeout(retry);
        retry = setTimeout(connect, fails >= 3 ? 15000 : 3000);
      };
    }

    connect();

    return {
      close: function () {
        closed = true;
        stopPoll();
        if (retry) clearTimeout(retry);
        if (es) { try { es.close(); } catch (e) { /* ignore */ } }
      }
    };
  }

  // ── 座位 token（按房间码存）────────────────────────────────────────────────

  function seatKey(code) { return 'aeroplane_seat_' + code; }

  function loadSeat(code) {
    try { return JSON.parse(localStorage.getItem(seatKey(code)) || 'null'); } catch (e) { return null; }
  }
  function saveSeat(code, seat) {
    try { localStorage.setItem(seatKey(code), JSON.stringify(seat)); } catch (e) { /* 隐私模式写不了就算了 */ }
  }
  function clearSeat(code) {
    try { localStorage.removeItem(seatKey(code)); } catch (e) { /* ignore */ }
  }

  /** 上一次用过的昵称/颜色，方便下次直接带出来 */
  function loadMe() {
    try { return JSON.parse(localStorage.getItem('aeroplane_me') || 'null') || {}; } catch (e) { return {}; }
  }
  function saveMe(me) {
    try { localStorage.setItem('aeroplane_me', JSON.stringify(me)); } catch (e) { /* ignore */ }
  }

  /* 飞行棋四色＝四个角色。后端 join 只认 red/yellow/blue/green（色名直接决定执哪家棋）。
     hex 只用来在界面上显示。 */
  var COLORS = [
    { hex: '#f6c945', key: 'yellow', name: '海绵小方' },
    { hex: '#ef5350', key: 'red', name: '小螃蟹' },
    { hex: '#41a7f5', key: 'blue', name: '章鱼仔' },
    { hex: '#58c26a', key: 'green', name: '独眼仔' }
  ];
  function colorHex(key) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].key === key) return COLORS[i].hex;
    return '#999';
  }

  global.MonoAPI = {
    COLORS: COLORS,
    colorHex: colorHex,
    listRooms: listRooms,
    createRoom: createRoom,
    closeRoom: closeRoom,
    pauseRoom: pauseRoom,
    skipTurn: skipTurn,
    sendChat: sendChat,
    revokeInvite: revokeInvite,
    joinRoom: joinRoom,
    startRoom: startRoom,
    getState: getState,
    action: action,
    openSync: openSync,
    loadSeat: loadSeat,
    saveSeat: saveSeat,
    clearSeat: clearSeat,
    loadMe: loadMe,
    saveMe: saveMe
  };
})(window);
