/* 房卡左滑删除（她 2026-09-02 12:51 点的：「× 也删掉，改成左滑出现删除」）——六个大厅共用。
   卡片是 <a class="cn-card …">，里面原来那颗 [data-close] 按钮还在（CSS 藏起来），
   左滑露出红色「删除」，点它就等于点原来那颗 ×（确认框、接口一个字不改）。 */
(function () {
  var OPEN = 96, cur = null, card = null, sx = 0, sy = 0, dragging = false;
  function wrap(a) {
    var w = a.parentNode;
    if (w && w.classList && w.classList.contains('swp-wrap')) return w;
    w = document.createElement('div'); w.className = 'swp-wrap';
    a.parentNode.insertBefore(w, a); w.appendChild(a);
    var del = document.createElement('button'); del.type = 'button'; del.className = 'swp-del'; del.textContent = '删除';
    del.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); close();
      var b = a.querySelector('[data-close]'); if (b) b.click();
    });
    w.appendChild(del);
    return w;
  }
  function close() { if (cur) { cur.style.transform = ''; cur.parentNode.classList.remove('is-open'); cur = null; } }
  function cardOf(t) { var a = t && t.closest ? t.closest('a.cn-card') : null; return (a && a.querySelector('[data-close]')) ? a : null; }
  document.addEventListener('touchstart', function (e) {
    var a = cardOf(e.target);
    if (!a) { if (!(e.target.closest && e.target.closest('.swp-del'))) close(); card = null; return; }
    if (cur && cur !== a) close();
    card = a; wrap(a); sx = e.touches[0].clientX; sy = e.touches[0].clientY; dragging = false;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!card) return;
    var dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) dragging = true;
      else { if (Math.abs(dy) > 10) card = null; return; }
    }
    var base = (cur === card) ? -OPEN : 0;
    var x = Math.max(-OPEN, Math.min(0, base + dx));
    card.style.transition = 'none'; card.style.transform = 'translateX(' + x + 'px)';
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (!card) return;
    var c = card; card = null; c.style.transition = '';
    if (!dragging) return;
    var m = /-?[\d.]+/.exec(c.style.transform || ''); var x = m ? parseFloat(m[0]) : 0;
    if (x < -OPEN / 2) { c.style.transform = 'translateX(-' + OPEN + 'px)'; c.parentNode.classList.add('is-open'); cur = c; }
    else { c.style.transform = ''; c.parentNode.classList.remove('is-open'); if (cur === c) cur = null; }
    // 滑完手指一抬会冒一个 click，吃掉它，别把她带进房间
    var kill = function (ev) { ev.preventDefault(); ev.stopPropagation(); };
    c.addEventListener('click', kill, { capture: true, once: true });
    setTimeout(function () { c.removeEventListener('click', kill, { capture: true }); }, 400);
  });
})();
