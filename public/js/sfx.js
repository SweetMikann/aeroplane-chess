/* 大富翁音效 —— 2026-08-23 堂妹提的：「要不要加点音效或音乐啥的，感觉有点太干巴了」。
 *
 * 全部用 WebAudio 现场合成，一个音频文件都不引：
 *   · 加载不多一个请求，手机流量上也不卡；
 *   · 每次掷骰的碰撞点、力度都带随机，不会像循环采样那样听两轮就腻。
 * 事件是按引擎的 log.type 对的（roll / move / buy / rent / jail …），
 * 不是靠猜文本——引擎那边 logAdd(ctx, type, text) 本来就打好标签了。
 *
 * iOS 的规矩：AudioContext 必须由用户手势唤醒，所以第一次点屏幕才真正开声。
 */
(function () {
  'use strict';

  var KEY = 'mono.sfx';                 // localStorage：'0' 静音
  var ac = null, master = null, ready = false;

  function on() { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } }
  function setOn(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} }

  function ctx() {
    if (ac) return ac;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.32;           // 整体压着点，是背景不是主角
    master.connect(ac.destination);
    return ac;
  }

  /* 第一次真实手势时唤醒：iOS/Safari 不给手势就一直 suspended，听起来像"没声音的 bug" */
  /* 8/25 她说听不见骰子和走棋声。iPhone 静音键一拨，WKWebView 里的 WebAudio 就跟着哑。
     老招：第一次手势时循环播一段无声的 <audio>，音频会话被切成 playback，之后 WebAudio 不再理静音键。 */
  var unmuteEl = null;
  function unmuteIOS() {
    if (unmuteEl) return;
    try {
      unmuteEl = document.createElement('audio');
      unmuteEl.setAttribute('playsinline', ''); unmuteEl.setAttribute('x-webkit-airplay', 'deny');
      unmuteEl.loop = true; unmuteEl.volume = 0.01; unmuteEl.preload = 'auto';
      /* 0.05s 的静音 WAV（44.1k/8bit/单声道） */
      var n = 2205, hdr = 'RIFF' + str32(36 + n) + 'WAVEfmt ' + str32(16) + str16(1) + str16(1) + str32(44100) + str32(44100) + str16(1) + str16(8) + 'data' + str32(n);
      var body = ''; for (var i = 0; i < n; i++) body += String.fromCharCode(128);
      unmuteEl.src = 'data:audio/wav;base64,' + btoa(hdr + body);
      var pr = unmuteEl.play(); if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
  }
  function str16(v) { return String.fromCharCode(v & 255, (v >> 8) & 255); }
  function str32(v) { return String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }

  function wake() {
    var c = ctx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    unmuteIOS();
    ready = true;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, wake, { once: false, passive: true });
  });

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* 一个带包络的振荡器：合成里所有"乐音"都从这儿出 */
  function tone(freq, t0, dur, gain, type, glideTo) {
    var c = ctx(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);      // 快起音，脆
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  /* 一撮噪声：碰撞、翻纸、金属摩擦都靠它 */
  function noise(t0, dur, gain, filterType, freq, q) {
    var c = ctx(); if (!c) return;
    var n = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);  // 自带衰减
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.value = freq || 1800;
    f.Q.value = q || 1.2;
    var g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  var S = {};

  /* 掷骰：七八下木头撞桌面，间隔越来越密再收住——这是"滚"的听感来源 */
  S.roll = function (t) {
    var n = 7 + Math.floor(Math.random() * 3), at = t, gap = 0.085;
    for (var i = 0; i < n; i++) {
      noise(at, 0.055, rnd(0.22, 0.4), 'bandpass', rnd(900, 2400), 1.6);
      tone(rnd(150, 260), at, 0.05, 0.10, 'triangle');           // 一点木头的体腔声
      gap *= 0.86;
      at += gap + rnd(-0.012, 0.012);
    }
    noise(at + 0.05, 0.09, 0.3, 'lowpass', 700, 0.8);            // 最后落定那一下闷响
  };

  S.move = function (t) {                                         // 每格一声「嗒」：木头感，别像电子表
    tone(1040, t, 0.05, 0.16, 'triangle', 720);
    noise(t, 0.04, 0.12, 'bandpass', 2600, 1.4);
  };

  S.buy = function (t) {                                          // 买地：明亮的上行三音
    tone(523.25, t, 0.13, 0.16, 'triangle');
    tone(659.25, t + 0.075, 0.13, 0.16, 'triangle');
    tone(783.99, t + 0.15, 0.30, 0.18, 'triangle');
  };

  S.build = function (t) {                                        // 盖房：两记木槌
    noise(t, 0.07, 0.34, 'lowpass', 900, 0.7); tone(180, t, 0.09, 0.16, 'square');
    noise(t + 0.13, 0.07, 0.30, 'lowpass', 900, 0.7); tone(200, t + 0.13, 0.09, 0.14, 'square');
  };

  S.coinIn = function (t) {                                       // 进账：金币叮当
    [1318.5, 1567.98, 2093].forEach(function (f, i) {
      tone(f, t + i * 0.055, 0.20, 0.13, 'sine');
      noise(t + i * 0.055, 0.05, 0.10, 'highpass', 4200, 0.6);
    });
  };

  S.coinOut = function (t) {                                      // 出账：下行，带点肉疼
    tone(587.33, t, 0.14, 0.14, 'sine');
    tone(440, t + 0.08, 0.16, 0.14, 'sine');
    tone(329.63, t + 0.17, 0.30, 0.15, 'sine');
  };

  S.card = function (t) {                                         // 抽牌：一下翻纸
    noise(t, 0.16, 0.26, 'highpass', 2600, 0.5);
    tone(1200, t, 0.10, 0.05, 'sine', 2400);
  };

  S.jail = function (t) {                                         // 入狱：铁门加低音
    noise(t, 0.20, 0.34, 'bandpass', 420, 3.5);
    tone(110, t, 0.42, 0.20, 'sawtooth', 82);
  };

  S.bankrupt = function (t) {                                     // 破产：一路滑到底
    tone(392, t, 0.75, 0.18, 'sawtooth', 82);
    noise(t + 0.1, 0.4, 0.12, 'lowpass', 600, 0.7);
  };

  /* ── 8/25 她要的「很牛逼的」「噔噔噔噔噔噔噔那种」收官号 ──
     铜管：三支锯齿波错开几音分叠在一起，过一个会张嘴的低通（起音闷、随即亮起来）——铜管的"噗-哒"就是这么来的。
     定音鼓：正弦从 110 滑到 55，底下垫一撮低通噪声。镲：高通噪声长尾。 */
  function brass(freq, t0, dur, gain) {
    var c = ctx(); if (!c) return;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(freq * 1.2, t0);
    f.frequency.exponentialRampToValueAtTime(freq * 6, t0 + 0.06);
    f.frequency.exponentialRampToValueAtTime(freq * 2.5, t0 + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.03);
    g.gain.setValueAtTime(gain, t0 + Math.max(0.03, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.05);
    [-8, 0, 7].forEach(function (cents) {
      var o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = freq; o.detune.value = cents;
      o.connect(f); o.start(t0); o.stop(t0 + dur + 0.1);
    });
    f.connect(g); g.connect(master);
  }
  function timpani(t0, gain) {
    tone(110, t0, 0.42, gain, 'sine', 55);
    noise(t0, 0.18, gain * 0.6, 'lowpass', 220, 0.8);
  }
  function cymbal(t0, gain) {
    noise(t0, 1.4, gain, 'highpass', 5200, 0.6);
    noise(t0, 0.5, gain * 0.7, 'bandpass', 9000, 0.9);
  }

  S.win = function (t) {
    var G4 = 392, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
    /* 0-0.45s 鼓滚奏：越敲越密 */
    [0, 0.12, 0.22, 0.30, 0.37, 0.43].forEach(function (d, i) { timpani(t + d, 0.22 + i * 0.03); });
    /* 噔噔噔 噔—— */
    brass(G4, t + 0.46, 0.13, 0.30);
    brass(G4, t + 0.62, 0.13, 0.30);
    brass(G4, t + 0.78, 0.13, 0.30);
    brass(C5, t + 0.94, 0.55, 0.36); timpani(t + 0.94, 0.4);
    /* 噔噔噔 噔———— （最后一声整个和弦一起顶上去） */
    brass(E5, t + 1.54, 0.13, 0.30);
    brass(G5, t + 1.70, 0.13, 0.30);
    brass(C6, t + 1.86, 1.35, 0.34);
    brass(G5, t + 1.86, 1.35, 0.18);
    brass(E5, t + 1.86, 1.35, 0.16);
    brass(C5, t + 1.86, 1.35, 0.16);
    timpani(t + 1.86, 0.5); cymbal(t + 1.86, 0.28);
    /* 高音闪光：正弦快速上行，像撒了一把亮片 */
    [C6, 1318.5, 1567.98, 2093, 2637, 3135.96].forEach(function (f, i) {
      tone(f, t + 2.0 + i * 0.07, 0.35, 0.10, 'sine');
    });
  };

  S.myTurn = function (t) {                                       // 轮到我：清脆两声，不吓人
    tone(783.99, t, 0.12, 0.15, 'sine');
    tone(1046.5, t + 0.1, 0.24, 0.15, 'sine');
  };

  function play(name, delay) {
    if (!on()) return;
    var c = ctx(); if (!c || !S[name]) return;
    if (c.state === 'suspended') { c.resume(); }
    try { S[name](c.currentTime + (delay || 0)); } catch (e) { /* 声音坏了不能拖累牌局 */ }
  }

  /* 引擎 log.type → 音效。money 要看正负，所以带上文本判断。 */
  function forLog(entry) {
    var t = entry && entry.type, txt = (entry && entry.text) || '';
    switch (t) {
      case 'roll': return 'roll';
      /* 8/25 起走/跳/飞的声音由 aeroboard 按动画每一格排（cues），日志这里不再重复出声 */
      case 'move': case 'jump': case 'fly': return null;
      case 'takeoff': return 'build';
      case 'knock': return 'jail';
      case 'home': return 'coinIn';
      case 'game_over': return 'win';
      default: return null;
    }
  }

  window.SFX = {
    play: play,
    forLog: forLog,
    isOn: on,
    toggle: function () { var v = !on(); setOn(v); if (v) { wake(); play('move'); } return v; },
    wake: wake
  };
})();
