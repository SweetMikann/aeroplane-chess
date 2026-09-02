/* Bisca theme engine — boot.js
 * Synchronous, dependency-free, first-paint theme applier.
 * Include in <head> BEFORE any content:  <script src="/assets-theme/boot.js"></script>
 *
 * Owns localStorage key `bisca_look` = {theme:'purple'|'blue', sat:0..1,
 *   mode:'dark'|'light', font:'sans'|'serif'}.
 * ES5-flavoured so it runs on iOS Safari 16+ without transpiling.
 */
(function () {
  'use strict';

  var LS_KEY = 'bisca_look';
  /* ★2026-08-23 00:03 她：「你没有做日间模式，只有一个夜间模式」。
   查下来：**浅色那一整套变量本来就写好了**（下面每处都是 dark ? 暗 : 浅），
   卡的只是这里默认写死 'dark'、而且没有跟系统走这条路。
   改成 'auto'：跟着手机的浅色/深色开关变；她想锁死也还能存 'dark'/'light'。 */
var DEFAULTS = { theme: 'purple', sat: 0.55, mode: 'auto', font: 'sans' };
function sysDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return true; }
}

  var state = null; // cached, normalized look

  /* ---------- small helpers ---------- */

  function clamp01(x) {
    x = +x;
    if (isNaN(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function clone(o) {
    return { theme: o.theme, sat: o.sat, mode: o.mode, font: o.font };
  }

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  }

  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (_) {}
  }

  function normalize(o) {
    o = o || {};
    var theme = (o.theme === 'blue' || o.theme === 'purple') ? o.theme : DEFAULTS.theme;
    var mode = (o.mode === 'dark' || o.mode === 'light' || o.mode === 'auto') ? o.mode : DEFAULTS.mode;
    var font = (o.font === 'sans' || o.font === 'serif') ? o.font : DEFAULTS.font;
    var sat = (typeof o.sat === 'number' && isFinite(o.sat)) ? clamp01(o.sat) : DEFAULTS.sat;
    return { theme: theme, sat: sat, mode: mode, font: font };
  }

  function save(look) {
    lsSet(LS_KEY, JSON.stringify({ theme: look.theme, sat: look.sat, mode: look.mode, font: look.font }));
  }

  function load() {
    var raw = lsGet(LS_KEY);
    if (raw == null) { state = clone(DEFAULTS); return state; }
    var o = null;
    try { o = JSON.parse(raw); } catch (_) { o = null; }
    state = normalize(o || DEFAULTS);
    return state;
  }

  /* ---------- oklch(L C H) → sRGB hex (for <meta name=theme-color>) ---------- */

  function oklchToHex(L, C, H) {
    var hr = H * Math.PI / 180;
    var a = C * Math.cos(hr);
    var b = C * Math.sin(hr);

    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    var l = l_ * l_ * l_;
    var m = m_ * m_ * m_;
    var s = s_ * s_ * s_;

    var r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    var bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    return '#' + gamma(r) + gamma(g) + gamma(bl);
  }

  function gamma(v) {
    if (v <= 0.0031308) v = 12.92 * v;
    else v = 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    var n = Math.round(v * 255).toString(16);
    return n.length === 1 ? '0' + n : n;
  }

  function hexFromBg(bgStr) {
    // bgStr looks like "oklch(0.15 0.0212 285)"
    var m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)/.exec(String(bgStr));
    if (!m) return null;
    return oklchToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }

  /* ---------- token engine ---------- */

  function tokens(look) {
    look = normalize(look);
    var family = look.theme, mode = look.mode, sat = look.sat;
    var dark = mode === 'auto' ? sysDark() : (mode === 'dark');

    var FAM = ({
      purple: { h: 285, aLd: 0.70, aLl: 0.48, cMax: 0.175 },
      blue:   { h: 266, aLd: 0.64, aLl: 0.42, cMax: 0.205 }
    })[family] || { h: 285, aLd: 0.70, aLl: 0.48, cMax: 0.175 };
    var h = FAM.h;
    var s = Math.max(0, Math.min(1, (sat == null ? 0.55 : sat)));
    var P = {
      aC: 0.05 + s * (FAM.cMax - 0.05),
      bC: 0.008 + s * 0.024,
      sC: 0.011 + s * 0.030,
      aur: 0.09 + s * 0.18,
      glow: 0.15 + s * 0.30
    };
    var ok = function (l, c, hh, a) {
      return 'oklch(' + l + ' ' + c + ' ' + hh + (a != null ? ' / ' + a : '') + ')';
    };
    var L = dark
      ? { bg: 0.15, su: 0.195, su2: 0.235, su3: 0.275, ts: 0.97, t: 0.90, tm: 0.72, td: 0.58, tf: 0.45, ac: FAM.aLd, br: 0.34, brs: 0.30, brf: 0.26, gl: 0.22, ga: 0.55 }
      : { bg: 0.975, su: 0.998, su2: 0.965, su3: 0.935, ts: 0.24, t: 0.33, tm: 0.48, td: 0.60, tf: 0.72, ac: FAM.aLl, br: 0.86, brs: 0.90, brf: 0.93, gl: 0.99, ga: 0.62 };
    var ac = ok(L.ac, P.aC, h);
    var aur = dark
      ? 'radial-gradient(55% 45% at 16% 6%, ' + ok(0.56, P.aC * 1.5, h - 11, P.aur) + ', transparent 66%),radial-gradient(48% 42% at 90% 16%, ' + ok(0.50, P.aC * 1.4, h + 19, P.aur * 0.9) + ', transparent 64%),radial-gradient(72% 60% at 54% 110%, ' + ok(0.48, P.aC * 1.6, h + 5, P.aur) + ', transparent 70%)'
      : 'radial-gradient(55% 45% at 16% 6%, ' + ok(0.90, P.aC * 1.1, h - 7, P.aur * 1.4) + ', transparent 70%),radial-gradient(48% 42% at 90% 16%, ' + ok(0.92, P.aC, h + 17, P.aur * 1.2) + ', transparent 68%),radial-gradient(72% 60% at 54% 110%, ' + ok(0.88, P.aC * 1.2, h + 5, P.aur * 1.3) + ', transparent 72%)';
    var vars = {
      '--bg': ok(L.bg, P.bC, h), '--surface': ok(L.su, P.sC, h), '--surface-2': ok(L.su2, P.sC, h), '--surface-3': ok(L.su3, P.sC * 1.1, h), '--scrim': ok(dark ? 0.08 : 0.5, 0.02, h, 0.55),
      '--border': ok(L.br, P.sC, h), '--border-soft': ok(L.brs, P.sC * 0.8, h), '--border-faint': ok(L.brf, P.sC * 0.6, h),
      '--text-strong': ok(L.ts, dark ? 0.008 : 0.03, h), '--text': ok(L.t, dark ? 0.010 : 0.025, h), '--text-mute': ok(L.tm, 0.012, h), '--text-dim': ok(L.td, 0.012, h), '--text-faint': ok(L.tf, 0.010, h),
      '--accent': ac, '--accent-hover': ok(L.ac + 0.05, P.aC, h), '--accent-press': ok(L.ac - 0.06, P.aC, h), '--accent-on': ok(dark ? 0.16 : 0.99, 0.02, h), '--accent-wash': ok(L.ac, P.aC, h, dark ? 0.14 : 0.12), '--accent-line': ok(L.ac, P.aC, h, 0.38), '--accent-grad': 'linear-gradient(135deg, ' + ok(L.ac + 0.03, P.aC, h + 8) + ', ' + ok(L.ac - 0.04, P.aC * 1.1, h - 10) + ')',
      '--ink': ok(dark ? 0.74 : 0.50, 0.09, 172), '--ink-wash': ok(dark ? 0.74 : 0.50, 0.09, 172, 0.15), '--shared': ok(dark ? 0.70 : 0.50, 0.10, 250), '--shared-wash': ok(dark ? 0.70 : 0.50, 0.10, 250, 0.15),
      '--layer-deep': ok(dark ? 0.70 : 0.50, 0.10, 285), '--layer-daily': ok(dark ? 0.82 : 0.60, 0.12, 85), '--layer-weekly': ok(dark ? 0.78 : 0.55, 0.06, 250), '--layer-monthly': ok(dark ? 0.74 : 0.54, 0.11, 300), '--layer-diary': ok(dark ? 0.74 : 0.52, 0.09, 172), '--layer-project': ok(dark ? 0.70 : 0.50, 0.10, 250), '--layer-tech': ok(dark ? 0.68 : 0.50, 0.02, 285),
      '--glass-surface': ok(L.gl, P.sC * 1.2, h, L.ga), '--glass-blur': '20px',
      '--glow-border': ok(L.ac, P.aC, h, dark ? P.glow : P.glow * 0.7), '--glow-shadow': '0 0 12px ' + ok(L.ac, P.aC, h, dark ? 0.12 * (P.glow / 0.30) : 0.08),
      '--danger': ok(dark ? 0.64 : 0.55, 0.20, 22), '--focus': ok(L.ac, 0.13, h), '--aurora': aur,
      '--chat-me-bg': ok(dark ? 0.58 : 0.58, dark ? P.aC * 1.2 : P.aC, h, dark ? 0.40 : 0.52), '--chat-me-solid': ok(0.58, dark ? P.aC * 1.2 : P.aC, h), '--chat-me-border': ok(dark ? 0.74 : 0.52, P.aC, h, dark ? 0.55 : 0.5), '--chat-me-text': ok(0.99, 0.008, h),
      '--metal-grad': 'linear-gradient(135deg, ' + ok(0.97, 0.012, 285) + ', ' + ok(0.60, 0.02, 285) + ' 20%, ' + ok(0.32, 0.012, 285) + ' 47%, ' + ok(0.66, 0.02, 285) + ' 72%, ' + ok(0.98, 0.012, 285) + ')',
      '--chat-panel-bg': dark ? ok(0.22, 0, h, 0.40) : ok(0.99, 0, h, 0.55), '--panel-solid': dark ? ok(0.22, 0, h) : ok(0.99, 0, h), '--home-card': ok(0.58, dark ? P.aC * 1.2 : P.aC, h, dark ? 0.22 : 0.30), '--chat-panel-border': ok(L.ac, P.aC, h, dark ? 0.30 : 0.28),
      '--chat-scrim': dark ? 'linear-gradient(180deg, rgba(10,9,16,0.55), rgba(10,9,16,0.30) 26%, rgba(10,9,16,0.50))' : 'linear-gradient(180deg, rgba(250,249,255,0.5), rgba(250,249,255,0.26) 26%, rgba(250,249,255,0.44))',
      '--chat-scrim-top': dark ? 'rgba(10,9,16,0.55)' : 'rgba(250,249,255,0.55)', '--chat-scrim-bottom': dark ? 'rgba(10,9,16,0.92)' : 'rgba(250,249,255,0.92)'
    };
    /* 玻璃个性化:bisca_glass={a,b} 是全站玻璃质感的联动开关。
     * a → --home-card 透明度 + --glass-surface 的 alpha(全站 .cn-card/.cn-glass);
     * b → --home-blur + --glass-blur。页面头里若有同名内联覆写与此等价,双写无害。 */
    try {
      var hc = localStorage.getItem('bisca_glass');
      if (hc) {
        var oo = JSON.parse(hc);
        if (oo && typeof oo.a === 'number') {
          var ga2 = Math.max(0.05, Math.min(0.92, +oo.a));
          vars['--home-card'] = 'color-mix(in srgb, ' + vars['--chat-me-solid'] + ' ' + Math.round(ga2 * 100) + '%, transparent)';
          vars['--glass-surface'] = ok(L.gl, P.sC * 1.2, h, ga2);
        }
        if (oo && oo.b != null) {
          var bb = parseInt(oo.b, 10);
          if (isFinite(bb)) {
            bb = Math.max(0, Math.min(40, bb));
            vars['--glass-blur'] = bb + 'px';
            vars['--home-blur'] = bb + 'px';
          }
        }
      }
    } catch (e) {}
    return vars;
  }

  /* ---------- DOM application ---------- */

  function setThemeColor(hex) {
    if (!hex) return;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      var head = document.head || document.getElementsByTagName('head')[0];
      if (head) head.appendChild(meta);
    }
    meta.setAttribute('content', hex);
  }

  function apply() {
    var look = state || load();
    var vars = tokens(look);
    var root = document.documentElement;
    root.setAttribute('data-theme', look.theme);
    root.setAttribute('data-mode', look.mode);
    root.setAttribute('data-font', look.font);
    for (var k in vars) {
      if (vars.hasOwnProperty(k)) root.style.setProperty(k, vars[k]);
    }
    setThemeColor(hexFromBg(vars['--bg']));
    /* 全站壁纸:用户自选的壁纸地址存在 bisca_wall。
     * base.css 的 html[data-wall] .cn-aurora::after 负责渲染(带压字渐变);
     * 页面若自绘背景时隐藏 aurora,天然不双重渲染。 */
    try {
      var wb = localStorage.getItem('bisca_wall');
      if (wb && /^[\w\-./:%]+$/.test(wb)) {
        root.style.setProperty('--cn-wall', 'url("' + wb + '")');
        root.setAttribute('data-wall', '1');
      } else {
        root.style.removeProperty('--cn-wall');
        root.removeAttribute('data-wall');
      }
    } catch (e) {}
    return look;
  }

  function get() {
    if (!state) load();
    return clone(state);
  }

  function set(partial) {
    if (!state) load();
    if (partial) {
      for (var k in partial) {
        if (partial.hasOwnProperty(k)) state[k] = partial[k];
      }
    }
    state = normalize(state);
    save(state);
    apply();
    return clone(state);
  }

  window.BiscaTheme = {
    get: get,
    set: set,
    apply: apply,
    tokens: tokens // pure: tokens(look) → variable object, for the settings-page preview
  };

  // Apply immediately, synchronously, before first paint.
  apply();
})();


/* ★2026-08-23 00:05 跟随系统时，手机切了浅色/深色要当场变，不用重开页面。 */
(function () {
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var relook = function () {
      try {
        var raw = localStorage.getItem('bisca_look');
        var m = raw ? (JSON.parse(raw) || {}).mode : null;
        if (m && m !== 'auto') return;              // 手动锁过就不跟着变
        if (window.CNBoot && typeof window.CNBoot.apply === 'function') window.CNBoot.apply();
        else location.reload();
      } catch (e) {}
    };
    if (mq.addEventListener) mq.addEventListener('change', relook);
    else if (mq.addListener) mq.addListener(relook);
  } catch (e) {}
})();

/* 【2026-08-28 22:54 她定的】柜子…不，游戏页顶上原来有两个返回叠着：
   庭院工具条那个写「返回」的按钮，和这些牌桌页自己左上角那个「<」。
   她说「返回删掉只留 <」。可页面里这个「<」本来只会跳回本游戏的大厅，
   退不出庭院的游戏页——删了那个「返回」她就出不来了。
   所以让这个「<」在被庭院嵌着的时候改行：不跳转，喊一声父窗口，由庭院退出游戏页。
   单独在浏览器里打开时行为不变，照旧回大厅。 */
(function () {
  try {
    if (window.parent === window) return;
    var wire = function () {
      var back = document.querySelector('.cd-back');
      if (!back) return;
      back.addEventListener('click', function (ev) {
        ev.preventDefault();
        try { window.parent.postMessage({ type: 'bisca-exit' }, window.location.origin); } catch (e) {}
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
  } catch (e) {}
})();
