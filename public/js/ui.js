/* Bisca 飞行棋 —— 浮层件：toast / 通用弹层 / 入座卡 / 胜利屏（照抄大富翁 ui.js，砍掉地产专用件） */
(function (global) {
  'use strict';

  var esc = global.MonoBoard.esc;

  function icon(name, size) {
    return (global.BiscaIcons && global.BiscaIcons.svg(name, size)) || '';
  }

  // ── toast ──────────────────────────────────────────────────────────────────

  function toastLayer() {
    var el = document.getElementById('mono-toasts');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mono-toasts';
      el.className = 'mono-toasts';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(text, bad) {
    var el = document.createElement('div');
    el.className = 'mono-toast' + (bad ? ' is-bad' : '');
    el.textContent = String(text || '');
    toastLayer().appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 220);
    }, bad ? 3200 : 2200);
  }

  // ── 通用弹层 ───────────────────────────────────────────────────────────────

  function modal(opts) {
    var o = opts || {};
    var scrim = document.createElement('div');
    scrim.className = 'mono-scrim';
    var box = document.createElement('div');
    box.className = 'mono-modal ' + (o.className || '');
    box.innerHTML = o.html || '';
    scrim.appendChild(box);
    document.body.appendChild(scrim);

    var handle = {
      el: box,
      scrim: scrim,
      close: function () {
        if (scrim.parentNode) scrim.remove();
        if (o.onClose) o.onClose();
      }
    };
    if (o.dismissable !== false) {
      scrim.addEventListener('click', function (e) { if (e.target === scrim) handle.close(); });
    }
    if (o.onMount) o.onMount(handle);
    return handle;
  }

  // ── 入座卡 ─────────────────────────────────────────────────────────────────

  function joinDialog(opts) {
    var o = opts || {};
    /* taken 传进来的是后端座位色名（red/yellow/blue/green） */
    var taken = (o.taken || []).map(function (c) { return String(c).toLowerCase(); });
    var colors = global.MonoAPI.COLORS;
    var chosen = null;
    for (var i = 0; i < colors.length; i++) {
      if (taken.indexOf(colors[i].key) === -1) {
        if (!chosen || (o.preferColor && colors[i].key === String(o.preferColor).toLowerCase())) {
          chosen = colors[i].key;
        }
      }
    }
    function swatches() {
      return colors.map(function (c) {
        var isTaken = taken.indexOf(c.key) !== -1;
        return '<button type="button" class="mono-sw aero-sw' + (isTaken ? ' is-taken' : '') +
          (c.key === chosen ? ' is-on' : '') + '" data-key="' + c.key + '" title="' + c.name +
          '" aria-label="' + c.name + '" style="background:' + c.hex + '"' +
          (isTaken ? ' disabled' : '') + '></button>';
      }).join('');
    }

    return modal({
      dismissable: false,
      html: '<h2>坐下来一起玩</h2>' +
        '<div class="sub">' + esc(o.subtitle || '选个名字和阵营，坐进这局。') + '</div>' +
        '<div class="mono-field" style="margin-top:16px"><span class="k">昵称</span>' +
        '<input id="jd-name" maxlength="16" placeholder="怎么称呼你" value="' + esc(o.name || '') + '"></div>' +
        '<div class="mono-field" style="margin-top:14px"><span class="k">阵营</span>' +
        '<div class="mono-swatches">' + swatches() + '</div></div>' +
        '<div style="display:flex;gap:8px;margin-top:18px">' +
        '<button class="mono-btn mono-btn--ghost" id="jd-watch">只看看</button>' +
        '<button class="mono-btn mono-btn--primary" id="jd-ok" style="flex:1">入座</button></div>',
      onMount: function (h) {
        var box = h.el;
        box.querySelectorAll('.mono-sw').forEach(function (b) {
          b.addEventListener('click', function () {
            if (b.disabled) return;
            box.querySelectorAll('.mono-sw').forEach(function (x) { x.classList.remove('is-on'); });
            b.classList.add('is-on');
            chosen = b.dataset.key;
          });
        });
        box.querySelector('#jd-watch').addEventListener('click', function () {
          h.close();
          if (o.onWatch) o.onWatch();
        });
        box.querySelector('#jd-ok').addEventListener('click', function () {
          var nm = (box.querySelector('#jd-name').value || '').trim();
          if (!nm) { toast('先起个名字吧', true); return; }
          if (!chosen) { toast('挑个阵营', true); return; }
          h.close();
          o.onSubmit({ name: nm, color: chosen });
        });
      }
    });
  }

  // ── 胜利屏 ─────────────────────────────────────────────────────────────────

  var winEl = null;

  function showWin(name, colors) {
    if (winEl) return;
    winEl = document.createElement('div');
    winEl.className = 'mono-win';
    var bits = '';
    var palette = (colors && colors.length) ? colors : ['#f6c945', '#ef5350', '#41a7f5', '#58c26a'];
    for (var i = 0; i < 70; i++) {
      var c = palette[i % palette.length];
      bits += '<i style="left:' + (Math.random() * 100).toFixed(2) + '%;background:' + c +
        ';animation-duration:' + (2.4 + Math.random() * 2.6).toFixed(2) + 's;animation-delay:' +
        (Math.random() * 2.2).toFixed(2) + 's;transform:rotate(' + ((Math.random() * 90) | 0) + 'deg)"></i>';
    }
    winEl.innerHTML = '<div class="mono-confetti">' + bits + '</div>' +
      /* 8/25 她定的：不要 emoji 皇冠。用 aeroboard 画的那顶（金），放大到 72 */
      '<div class="crown">' + (global.__aeroCrownIconHTML ? global.__aeroCrownIconHTML(1, 72) : '') + '</div>' +
      '<div class="big">' + esc(name) + ' 获胜</div>' +
      '<div class="sub">这局到此为止，服不服？</div>' +
      '<a class="mono-btn mono-btn--primary" href="/aeroplane/">回大厅</a>';
    document.body.appendChild(winEl);
  }

  function hideWin() {
    if (winEl) { winEl.remove(); winEl = null; }
  }

  global.MonoUI = {
    icon: icon,
    toast: toast,
    modal: modal,
    joinDialog: joinDialog,
    showWin: showWin,
    hideWin: hideWin
  };
})(window);
