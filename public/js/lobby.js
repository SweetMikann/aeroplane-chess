/* Bisca 飞行棋 —— 大厅（照抄大富翁 lobby.js，颜色板换成四阵营） */
(function (global) {
  'use strict';

  var API = global.MonoAPI;
  var UI = global.MonoUI;
  var esc = global.MonoBoard.esc;
  var $ = function (id) { return document.getElementById(id); };

  var chosen = API.loadMe().color || API.COLORS[0].key;

  function renderColors() {
    $('lb-colors').innerHTML = API.COLORS.map(function (c) {
      return '<button type="button" class="mono-sw aero-sw' + (c.key === chosen ? ' is-on' : '') +
        '" data-key="' + c.key + '" title="' + c.name + '" aria-label="' + c.name +
        '" style="background:' + c.hex + '"></button>';
    }).join('');
    $('lb-colors').querySelectorAll('.mono-sw').forEach(function (b) {
      b.addEventListener('click', function () {
        chosen = b.dataset.key;
        renderColors();
      });
    });
  }

  function tag(room) {
    if (room.finished) return '<span class="mono-tag is-done">已结束</span>';
    if (room.paused) return '<span class="mono-tag is-open">暂停</span>';
    if (room.started) return '<span class="mono-tag is-live">进行中</span>';
    return '<span class="mono-tag is-open">等人中</span>';
  }

  function roomCard(room) {
    var dots = (room.players || []).map(function (p) {
      return '<span class="mono-dot" style="background:' + esc(API.colorHex(p.color)) + '" title="' + esc(p.name) + '"></span>';
    }).join('');
    var seatMine = API.loadSeat(room.code);
    return '<a class="cn-card room-card" href="room.html?c=' + esc(room.code) + '">' +
      '<div class="main">' +
      '<div class="nm">' + esc(room.name || '未命名房间') + '</div>' +
      '<div class="sub">' + tag(room) + '<span>' + esc(room.code) + '</span><span>' +
      room.playerCount + '/4 人</span>' + (seatMine ? '<span>有你的座位</span>' : '') + '</div>' +
      (dots ? '<div class="avatars">' + dots + '</div>' : '') +
      '</div>' +
      '<button class="mono-room-close" type="button" data-close="' + esc(room.code) +
        '" aria-label="关闭房间" style="background:none;border:0;padding:6px 8px;opacity:.55;cursor:pointer">✕</button>' +
      '<span class="chev">' + UI.icon('chevron', 18) + '</span></a>';
  }

  function loadRooms() {
    return API.listRooms().then(function (d) {
      var rooms = d.rooms || [];
      var box = $('lb-rooms');
      if (!rooms.length) {
        box.innerHTML = '<div class="lb-empty">还没有房间，上面开一间吧</div>';
        return;
      }
      var rank = function (r) { return r.finished ? 2 : (r.started ? 1 : 0); };
      rooms.sort(function (a, b) { return rank(a) - rank(b); });
      box.innerHTML = rooms.map(roomCard).join('');
      box.querySelectorAll('.mono-room-close').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var code = el.dataset.close;
          if (!window.confirm('删掉「' + code + '」？房间、棋局和聊天记录都会没掉，撤不回来。')) return;
          var seat = API.loadSeat(code);
          API.closeRoom(code, seat && seat.playerToken, true).then(function () {
            loadRooms();
            // ★9/2 13:29 她：「删掉了但还是会显示」——服务端稍后才删档，马上刷会把卡拉回来，补两枪
            setTimeout(loadRooms, 700);
            setTimeout(loadRooms, 1800);
          }, function (err) { alert(err.message || '关不掉，再试试'); });
        });
      });
    }, function (e) {
      $('lb-rooms').innerHTML = '<div class="lb-empty">' + esc(e.message) + '</div>';
    });
  }

  function create() {
    var btn = $('lb-create');
    var roomName = ($('lb-room').value || '').trim();
    var myName = ($('lb-name').value || '').trim();
    if (!myName) { UI.toast('先起个昵称', true); $('lb-name').focus(); return; }
    btn.disabled = true;
    API.createRoom(roomName || '未命名房间').then(function (r) {
      return API.joinRoom(r.code, { name: myName, color: chosen }).then(function (seat) {
        API.saveSeat(r.code, seat);
        API.saveMe({ name: seat.name, color: seat.color });
        location.href = 'room.html?c=' + r.code;
      });
    }).catch(function (e) {
      btn.disabled = false;
      UI.toast(e.message, true);
    });
  }

  function boot() {
    $('lb-ic-new').innerHTML = UI.icon('plus', 18);
    $('lb-name').value = API.loadMe().name || '';
    renderColors();
    $('lb-create').addEventListener('click', create);
    $('lb-refresh').addEventListener('click', function () {
      $('lb-rooms').innerHTML = '<div class="lb-empty">加载中…</div>';
      loadRooms();
    });
    loadRooms();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
